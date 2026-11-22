//! Read only ZCode's own sign-in fields. Encrypted v2 credentials use its
//! existing macOS Keychain key; decrypted values never leave memory except
//! as authorization headers to the corresponding official quota endpoints.

use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{aead, digest};
use serde::Deserialize;

#[derive(Default, Deserialize)]
struct Record {
    #[serde(default, rename = "oauth:active_provider")]
    provider: String,
    #[serde(default, rename = "oauth:zai:access_token")]
    access: String,
    #[serde(default, rename = "zcodejwttoken")]
    jwt: String,
}

// Deliberately no Debug/Serialize implementation for authentication material.
pub struct Auth {
    pub access: String,
    pub jwt: String,
}

fn record(path: &Path) -> Result<Option<Record>, &'static str> {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(m) if m.len() <= 1_048_576 => {}
        _ => return Err("ZCode sign-in could not be read"),
    }
    let raw = std::fs::read(path).map_err(|_| "ZCode sign-in could not be read")?;
    serde_json::from_slice(&raw).map(Some).map_err(|_| "ZCode sign-in format was not recognized")
}

pub fn has_login(home: &Path) -> Result<bool, &'static str> {
    Ok(record(&home.join(".zcode/v2/credentials.json"))?.is_some_and(|r| !r.access.is_empty() || !r.jwt.is_empty()))
}

/// One instance per quota worker. Keep the unlocked key only for this app
/// session, while reading fresh OAuth credentials on every check.
#[derive(Default)]
pub struct Credentials {
    key: Option<CachedKey>,
}

struct CachedKey {
    path: PathBuf,
    fingerprint: String,
    // Remember a denied read too: periodic refresh must not reopen the prompt.
    result: Result<Vec<u8>, &'static str>,
}

impl Credentials {
    pub fn auth(&mut self, home: &Path) -> Result<Option<Auth>, &'static str> {
        self.auth_with(home, system_key)
    }

    fn auth_with(
        &mut self,
        home: &Path,
        read_key: impl FnOnce(&Path) -> Result<Vec<u8>, &'static str>,
    ) -> Result<Option<Auth>, &'static str> {
        let path = home.join(".zcode/v2/credentials.json");
        let Some(record) = record(&path)? else { return Ok(None) };
        if record.access.is_empty() && record.jwt.is_empty() {
            return Ok(None);
        }
        let fingerprint = record_fingerprint(&record)?;
        let key = if let Some(fingerprint) = fingerprint {
            if !self.key.as_ref().is_some_and(|k| k.path == path && k.fingerprint == fingerprint) {
                self.key = Some(CachedKey { result: read_key(&path), path, fingerprint: fingerprint.to_owned() });
            }
            Some(self.key.as_ref().unwrap().result.as_deref().map_err(|e| *e)?)
        } else {
            None
        };
        decode(record, key)
    }
}

fn record_fingerprint(record: &Record) -> Result<Option<&str>, &'static str> {
    let mut fingerprint = None;
    for value in [&record.provider, &record.access, &record.jwt] {
        if !value.starts_with("enc:") {
            continue;
        }
        let payload = value
            .strip_prefix("enc:v2:os:")
            .ok_or("This ZCode credential encryption format is not supported; add a Coding Plan key in Settings")?;
        let (current, _) = payload.split_once(':').ok_or("ZCode sign-in format was not recognized")?;
        if current.len() != 24
            || !current.bytes().all(|c| c.is_ascii_hexdigit())
            || fingerprint.is_some_and(|previous| previous != current)
        {
            return Err("ZCode sign-in could not be decrypted; sign in again in ZCode");
        }
        fingerprint = Some(current);
    }
    Ok(fingerprint)
}

fn decode(r: Record, key: Option<&[u8]>) -> Result<Option<Auth>, &'static str> {
    let provider = decrypt(&r.provider, key)?;
    if !provider.is_empty() && provider != "zai" {
        return Err("Connect a Z.ai account in ZCode, or add a Z.ai Coding Plan key in Settings");
    }
    let access = decrypt(&r.access, key)?;
    let jwt = decrypt(&r.jwt, key)?;
    if access.trim().is_empty() && jwt.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(Auth { access, jwt }))
}

#[cfg(target_os = "macos")]
fn system_key(path: &Path) -> Result<Vec<u8>, &'static str> {
    // ZCode keys the item by SHA-256 of the absolute credentials file path.
    let account = hex(digest::digest(&digest::SHA256, path.to_string_lossy().as_bytes()).as_ref());
    let encoded = security_framework::passwords::get_generic_password("ZCode Credential Encryption", &account)
        .map_err(|_| "ZCode sign-in is locked; restart Astrolabe to retry Keychain access, or add a Coding Plan key in Settings")?;
    let key = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "ZCode encryption key format was not recognized")?;
    if key.len() != 32 {
        return Err("ZCode encryption key format was not recognized");
    }
    Ok(key)
}

#[cfg(not(target_os = "macos"))]
fn system_key(_path: &Path) -> Result<Vec<u8>, &'static str> {
    Err("Encrypted ZCode sign-in is supported through the macOS Keychain")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn decrypt(value: &str, key: Option<&[u8]>) -> Result<String, &'static str> {
    const INVALID: &str = "ZCode sign-in could not be decrypted; sign in again in ZCode";
    if !value.starts_with("enc:") {
        return Ok(value.to_owned());
    }
    let Some(payload) = value.strip_prefix("enc:v2:os:") else {
        return Err("This ZCode credential encryption format is not supported; add a Coding Plan key in Settings");
    };
    let (fingerprint, payload) = payload.split_once(':').ok_or(INVALID)?;
    let key = key.ok_or(INVALID)?;
    if hex(digest::digest(&digest::SHA256, key).as_ref()).get(..24) != Some(fingerprint) {
        return Err(INVALID);
    }
    let parts: Vec<_> = payload.split('.').collect();
    if parts.len() != 3 {
        return Err(INVALID);
    }
    let nonce = URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| INVALID)?;
    let tag = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| INVALID)?;
    if nonce.len() != 12 || tag.len() != 16 {
        return Err(INVALID);
    }
    let mut ciphertext = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| INVALID)?;
    ciphertext.extend_from_slice(&tag);
    let key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| INVALID)?);
    let plaintext = key
        .open_in_place(
            aead::Nonce::try_assume_unique_for_key(&nonce).map_err(|_| INVALID)?,
            aead::Aad::empty(),
            &mut ciphertext,
        )
        .map_err(|_| INVALID)?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| INVALID)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encrypted(value: &str, key: &[u8; 32]) -> String {
        // Deterministic nonce for fixture construction only.
        let nonce = [3u8; 12];
        let cipher = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, key).unwrap());
        let mut ciphertext = value.as_bytes().to_vec();
        let tag = cipher
            .seal_in_place_separate_tag(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::empty(), &mut ciphertext)
            .unwrap();
        format!(
            "enc:v2:os:{}:{}.{}.{}",
            &hex(digest::digest(&digest::SHA256, key).as_ref())[..24],
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(tag.as_ref()),
            URL_SAFE_NO_PAD.encode(&ciphertext)
        )
    }

    fn write_access(home: &Path, access: &str) {
        let dir = home.join(".zcode/v2");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("credentials.json"),
            serde_json::to_vec(&serde_json::json!({"oauth:active_provider":"zai", "oauth:zai:access_token":access}))
                .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn v2_credentials_require_the_matching_key_and_authenticated_ciphertext() {
        let key = [7u8; 32];
        let encoded = encrypted("fixture-access-token", &key);
        assert_eq!(decrypt(&encoded, Some(&key)).unwrap(), "fixture-access-token");
        assert!(decrypt(&encoded, Some(&[8u8; 32])).is_err());
        assert!(decrypt(&encoded, None).is_err());
        let mut ciphertext = URL_SAFE_NO_PAD.decode(encoded.rsplit_once('.').unwrap().1).unwrap();
        ciphertext[0] ^= 1;
        let corrupt =
            format!("{}{}", encoded.rsplit_once('.').unwrap().0.to_owned() + ".", URL_SAFE_NO_PAD.encode(ciphertext));
        assert!(decrypt(&corrupt, Some(&key)).is_err());
        assert!(decrypt("enc:v2:env:invalid", None).is_err());
    }

    #[test]
    fn refresh_reuses_unlock_but_reads_updated_tokens_and_rotated_keys() {
        let home = tempfile::tempdir().unwrap();
        let mut credentials = Credentials::default();
        let key = [7u8; 32];
        write_access(home.path(), &encrypted("first-token", &key));
        let mut reads = 0;
        for _ in 0..3 {
            let auth = credentials
                .auth_with(home.path(), |_| {
                    reads += 1;
                    Ok(key.to_vec())
                })
                .unwrap()
                .unwrap();
            assert_eq!(auth.access, "first-token");
        }
        assert_eq!(reads, 1);
        write_access(home.path(), &encrypted("refreshed-token", &key));
        let auth = credentials.auth_with(home.path(), |_| panic!("already unlocked")).unwrap().unwrap();
        assert_eq!(auth.access, "refreshed-token");

        let rotated = [8u8; 32];
        write_access(home.path(), &encrypted("rotated-token", &rotated));
        let auth = credentials
            .auth_with(home.path(), |_| {
                reads += 1;
                Ok(rotated.to_vec())
            })
            .unwrap()
            .unwrap();
        assert_eq!(auth.access, "rotated-token");
        assert_eq!(reads, 2);

        // The Keychain account includes the path, even if a copied record uses the same key.
        let other = tempfile::tempdir().unwrap();
        write_access(other.path(), &encrypted("other-token", &rotated));
        credentials
            .auth_with(other.path(), |_| {
                reads += 1;
                Ok(rotated.to_vec())
            })
            .unwrap();
        assert_eq!(reads, 3);
    }

    #[test]
    fn denied_unlock_does_not_prompt_again_until_restart() {
        let home = tempfile::tempdir().unwrap();
        write_access(home.path(), &encrypted("fixture", &[7; 32]));
        let mut credentials = Credentials::default();
        assert_eq!(credentials.auth_with(home.path(), |_| Err("denied")).err(), Some("denied"));
        assert_eq!(credentials.auth_with(home.path(), |_| panic!("must not reprompt")).err(), Some("denied"));
        assert!(Credentials::default().auth_with(home.path(), |_| Ok(vec![7; 32])).unwrap().is_some());
    }

    #[test]
    fn plain_missing_and_unsupported_records_do_not_open_keychain() {
        let home = tempfile::tempdir().unwrap();
        let mut credentials = Credentials::default();
        assert!(credentials.auth_with(home.path(), |_| panic!("no login")).unwrap().is_none());
        write_access(home.path(), "plain-token");
        assert_eq!(
            credentials.auth_with(home.path(), |_| panic!("not encrypted")).unwrap().unwrap().access,
            "plain-token"
        );
        write_access(home.path(), "enc:v2:env:unsupported");
        assert!(credentials.auth_with(home.path(), |_| panic!("unsupported format")).is_err());
    }

    #[test]
    fn plain_sign_in_and_signed_out_records() {
        assert!(decode(Record::default(), None).unwrap().is_none());
        let r = Record { provider: "zai".into(), access: "fixture".into(), jwt: String::new() };
        assert_eq!(decode(r, None).unwrap().unwrap().access, "fixture");
        assert!(
            decode(Record { provider: "bigmodel".into(), access: "fixture".into(), jwt: String::new() }, None).is_err()
        );
    }
}
