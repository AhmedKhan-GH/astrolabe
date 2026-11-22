//! Optional provider API keys, kept only in the macOS login Keychain.
//! Each worker caches its first read, including absence or denied access, so
//! refreshing usage does not repeatedly prompt for Keychain access.

use super::model::Provider;

pub const SERVICE: &str = "Astrolabe";
/// Read-only Keychain service name for one-time import of standalone agent keys.
pub const AGENT_MONITOR_SERVICE: &str = "Agent Monitor";
// Preserve the existing GLM account name so imported keys keep their slot.
pub const ACCOUNT: &str = "glm-coding-plan";
pub const KEY_PROVIDERS: &[Provider] =
    &[Provider::Glm, Provider::Mistral, Provider::MiniMax, Provider::DeepSeek, Provider::Xiaomi];

type KeyRead = Result<Option<String>, String>;

fn account(provider: Provider) -> Result<&'static str, String> {
    match provider {
        Provider::Glm => Ok(ACCOUNT),
        Provider::Mistral => Ok("mistral-api"),
        Provider::MiniMax => Ok("minimax-api"),
        Provider::DeepSeek => Ok("deepseek-api"),
        Provider::Xiaomi => Ok("xiaomi-token-plan"),
        _ => Err("This provider does not support a stored API key".into()),
    }
}

/// The worker's private key cache. Do not derive Debug: it contains a secret.
pub struct CachedKey {
    provider: Provider,
    cached: Option<KeyRead>,
    revision: u64,
}

impl CachedKey {
    pub fn new(provider: Provider) -> Self {
        Self { provider, cached: None, revision: 0 }
    }

    /// Changes after a successful explicit save or removal, so callers can
    /// discard requests that used an earlier key state. Reads leave it intact.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn read(&mut self) -> KeyRead {
        self.read_using(key)
    }

    pub fn store(&mut self, value: &str) -> Result<(), String> {
        self.store_using(value, set_key)
    }

    pub fn forget(&mut self) -> Result<(), String> {
        self.forget_using(delete_key)
    }

    fn read_using(&mut self, read: impl FnOnce(Provider) -> KeyRead) -> KeyRead {
        self.cached.get_or_insert_with(|| read(self.provider)).clone()
    }

    fn store_using(
        &mut self,
        value: &str,
        store: impl FnOnce(Provider, &str) -> Result<(), String>,
    ) -> Result<(), String> {
        let value = value.trim();
        if value.is_empty() {
            return Err("Enter an API key".into());
        }
        store(self.provider, value)?;
        self.cached = Some(Ok(Some(value.to_owned())));
        self.revision = self.revision.wrapping_add(1);
        Ok(())
    }

    fn forget_using(&mut self, delete: impl FnOnce(Provider) -> Result<(), String>) -> Result<(), String> {
        delete(self.provider)?;
        self.cached = Some(Ok(None));
        self.revision = self.revision.wrapping_add(1);
        Ok(())
    }
}

#[cfg(any(target_os = "macos", test))]
fn read_or_import(
    provider: Provider,
    mut get: impl FnMut(&str, &str) -> KeyRead,
    mut set: impl FnMut(&str, &str, &str) -> Result<(), String>,
) -> KeyRead {
    let account = account(provider)?;
    match get(SERVICE, account)? {
        Some(value) => Ok(Some(value)),
        None => match get(AGENT_MONITOR_SERVICE, account) {
            Ok(Some(value)) => {
                let _ = set(SERVICE, account, &value);
                Ok(Some(value))
            }
            Ok(None) | Err(_) => Ok(None),
        },
    }
}

#[cfg(target_os = "macos")]
fn get_generic(service: &str, account: &str) -> KeyRead {
    match security_framework::passwords::get_generic_password(service, account) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(|value| if value.trim().is_empty() { None } else { Some(value) })
            .map_err(|_| "The stored API key is invalid".into()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("Couldn't read the API key from the Keychain".into()),
    }
}

#[cfg(target_os = "macos")]
fn set_generic(service: &str, account: &str, value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(service, account, value.as_bytes())
        .map_err(|_| "Couldn't store the API key in the Keychain".into())
}

#[cfg(target_os = "macos")]
fn key(provider: Provider) -> KeyRead {
    read_or_import(provider, get_generic, set_generic)
}

#[cfg(target_os = "macos")]
fn set_key(provider: Provider, value: &str) -> Result<(), String> {
    set_generic(SERVICE, account(provider)?, value)
}

#[cfg(target_os = "macos")]
fn delete_key(provider: Provider) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, account(provider)?) {
        Ok(()) => Ok(()),
        // Nothing stored is the wanted end state.
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("Couldn't remove the API key from the Keychain".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn key(provider: Provider) -> KeyRead {
    account(provider)?;
    Err("The Keychain is only on macOS".into())
}

#[cfg(not(target_os = "macos"))]
fn set_key(provider: Provider, _value: &str) -> Result<(), String> {
    account(provider)?;
    Err("The Keychain is only on macOS".into())
}

#[cfg(not(target_os = "macos"))]
fn delete_key(provider: Provider) -> Result<(), String> {
    account(provider)?;
    Err("The Keychain is only on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_accounts_are_fixed_and_distinct() {
        assert_eq!(SERVICE, "Astrolabe");
        assert_eq!(AGENT_MONITOR_SERVICE, "Agent Monitor");
        assert_eq!(account(Provider::Glm).unwrap(), "glm-coding-plan");
        assert_eq!(account(Provider::Mistral).unwrap(), "mistral-api");
        assert_eq!(account(Provider::MiniMax).unwrap(), "minimax-api");
        assert_eq!(account(Provider::DeepSeek).unwrap(), "deepseek-api");
        assert_eq!(account(Provider::Xiaomi).unwrap(), "xiaomi-token-plan");
        let accounts: Vec<_> = KEY_PROVIDERS.iter().map(|&p| account(p).unwrap()).collect();
        let unique: std::collections::HashSet<_> = accounts.iter().collect();
        assert_eq!(unique.len(), accounts.len());
        assert!(account(Provider::Claude).is_err());
    }

    #[test]
    fn read_or_import_returns_astrolabe_key_without_checking_import_service() {
        let mut queries = Vec::new();
        let result = read_or_import(
            Provider::Glm,
            |service, acct| {
                queries.push((service.to_owned(), acct.to_owned()));
                assert_eq!(service, SERVICE);
                Ok(Some("astrolabe-fixture".into()))
            },
            |_, _, _| panic!("must not write when Astrolabe already has the key"),
        );
        assert_eq!(result, Ok(Some("astrolabe-fixture".into())));
        assert_eq!(queries, vec![(SERVICE.into(), "glm-coding-plan".into())]);
    }

    #[test]
    fn read_or_import_imports_once_leaves_source_untouched_and_caches() {
        use std::cell::RefCell;
        use std::collections::BTreeMap;

        let store: RefCell<BTreeMap<(String, String), String>> = RefCell::new(BTreeMap::new());
        store.borrow_mut().insert((AGENT_MONITOR_SERVICE.into(), "mistral-api".into()), "legacy-fixture".into());
        let mut reads = Vec::new();
        let mut writes = Vec::new();

        let mut cached = CachedKey::new(Provider::Mistral);
        for _ in 0..3 {
            let result = cached.read_using(|provider| {
                read_or_import(
                    provider,
                    |service, acct| {
                        reads.push((service.to_owned(), acct.to_owned()));
                        Ok(store.borrow().get(&(service.to_owned(), acct.to_owned())).cloned())
                    },
                    |service, acct, value| {
                        writes.push((service.to_owned(), acct.to_owned()));
                        store.borrow_mut().insert((service.to_owned(), acct.to_owned()), value.to_owned());
                        Ok(())
                    },
                )
            });
            assert_eq!(result, Ok(Some("legacy-fixture".into())));
        }
        assert_eq!(
            reads,
            vec![(SERVICE.into(), "mistral-api".into()), (AGENT_MONITOR_SERVICE.into(), "mistral-api".into())]
        );
        assert_eq!(writes, vec![(SERVICE.into(), "mistral-api".into())]);
        assert_eq!(
            store.borrow().get(&(SERVICE.into(), "mistral-api".into())).map(String::as_str),
            Some("legacy-fixture")
        );
        assert_eq!(
            store.borrow().get(&(AGENT_MONITOR_SERVICE.into(), "mistral-api".into())).map(String::as_str),
            Some("legacy-fixture")
        );

        let mut next_reads = Vec::new();
        let mut fresh = CachedKey::new(Provider::Mistral);
        let result = fresh.read_using(|provider| {
            read_or_import(
                provider,
                |service, acct| {
                    next_reads.push((service.to_owned(), acct.to_owned()));
                    Ok(store.borrow().get(&(service.to_owned(), acct.to_owned())).cloned())
                },
                |_, _, _| panic!("must not rewrite an already imported key"),
            )
        });
        assert_eq!(result, Ok(Some("legacy-fixture".into())));
        assert_eq!(next_reads, vec![(SERVICE.into(), "mistral-api".into())]);
    }

    #[test]
    fn read_or_import_caches_absence_when_missing_or_unreadable_in_import_service() {
        for import_result in [Ok(None), Err("Access denied".into())] {
            let mut cached = CachedKey::new(Provider::MiniMax);
            let mut queries = Vec::new();
            for _ in 0..3 {
                let result = cached.read_using(|provider| {
                    read_or_import(
                        provider,
                        |service, acct| {
                            queries.push((service.to_owned(), acct.to_owned()));
                            if service == SERVICE { Ok(None) } else { import_result.clone() }
                        },
                        |_, _, _| panic!("must not write when no key is imported"),
                    )
                });
                assert_eq!(result, Ok(None));
            }
            assert_eq!(
                queries,
                vec![(SERVICE.into(), "minimax-api".into()), (AGENT_MONITOR_SERVICE.into(), "minimax-api".into())]
            );
        }
    }

    #[test]
    fn read_or_import_returns_imported_key_when_store_fails_without_modifying_source() {
        let source = Some("legacy-fixture".to_owned());
        let mut writes = Vec::new();
        let mut cached = CachedKey::new(Provider::DeepSeek);
        for _ in 0..3 {
            let result = cached.read_using(|provider| {
                read_or_import(
                    provider,
                    |service, _| if service == SERVICE { Ok(None) } else { Ok(source.clone()) },
                    |service, acct, _| {
                        assert_eq!(service, SERVICE);
                        writes.push((service.to_owned(), acct.to_owned()));
                        Err("Couldn't store the API key in the Keychain".into())
                    },
                )
            });
            assert_eq!(result, Ok(Some("legacy-fixture".into())));
        }
        assert_eq!(writes, vec![(SERVICE.into(), "deepseek-api".into())]);
        assert_eq!(source.as_deref(), Some("legacy-fixture"));
    }

    #[test]
    fn read_or_import_propagates_astrolabe_error_without_querying_import_service() {
        let mut queries = Vec::new();
        let mut cached = CachedKey::new(Provider::Xiaomi);
        for _ in 0..3 {
            let result = cached.read_using(|provider| {
                read_or_import(
                    provider,
                    |service, acct| {
                        queries.push((service.to_owned(), acct.to_owned()));
                        assert_eq!(service, SERVICE);
                        Err("Couldn't read the API key from the Keychain".into())
                    },
                    |_, _, _| panic!("must not write on read error"),
                )
            });
            assert_eq!(result, Err("Couldn't read the API key from the Keychain".into()));
        }
        assert_eq!(queries, vec![(SERVICE.into(), "xiaomi-token-plan".into())]);
    }

    #[test]
    fn reads_once_including_absence_and_denial() {
        for response in [Ok(Some("test-key".into())), Ok(None), Err("Access denied".into())] {
            let mut cached = CachedKey::new(Provider::Glm);
            let mut reads = 0;
            for _ in 0..3 {
                assert_eq!(
                    cached.read_using(|provider| {
                        assert_eq!(provider, Provider::Glm);
                        reads += 1;
                        response.clone()
                    }),
                    response
                );
            }
            assert_eq!(reads, 1);
        }
    }

    #[test]
    fn failed_save_and_delete_preserve_the_cached_result() {
        for response in [Ok(Some("old-key".into())), Ok(None), Err("Access denied".into())] {
            let mut cached = CachedKey::new(Provider::DeepSeek);
            assert_eq!(cached.read_using(|_| response.clone()), response);
            assert!(cached.store_using("new-key", |_, _| Err("Store failed".into())).is_err());
            assert_eq!(cached.read_using(|_| panic!("must retain the cache")), response);
            assert!(cached.forget_using(|_| Err("Delete failed".into())).is_err());
            assert_eq!(cached.read_using(|_| panic!("must retain the cache")), response);
        }
    }

    #[test]
    fn explicit_save_replaces_absence_denial_and_old_keys() {
        for response in [Ok(Some("old-key".into())), Ok(None), Err("Access denied".into())] {
            let mut cached = CachedKey::new(Provider::MiniMax);
            assert_eq!(cached.read_using(|_| response.clone()), response);
            cached
                .store_using("  new-key \n", |provider, value| {
                    assert_eq!(provider, Provider::MiniMax);
                    assert_eq!(value, "new-key");
                    Ok(())
                })
                .unwrap();
            assert_eq!(cached.read_using(|_| panic!("save must replace the cache")), Ok(Some("new-key".into())));
        }
    }

    #[test]
    fn successful_forget_caches_absence() {
        let mut cached = CachedKey::new(Provider::Glm);
        assert_eq!(cached.read_using(|_| Ok(Some("old-key".into()))), Ok(Some("old-key".into())));
        cached
            .forget_using(|provider| {
                assert_eq!(provider, Provider::Glm);
                Ok(())
            })
            .unwrap();
        assert_eq!(cached.read_using(|_| panic!("forget must cache absence")), Ok(None));
    }

    #[test]
    fn revision_changes_only_after_successful_explicit_mutations() {
        let mut cached = CachedKey::new(Provider::DeepSeek);
        assert_eq!(cached.revision(), 0);
        assert_eq!(cached.read_using(|_| Ok(Some("old-key".into()))), Ok(Some("old-key".into())));
        assert_eq!(cached.revision(), 0);

        assert!(cached.store_using("new-key", |_, _| Err("Store failed".into())).is_err());
        assert!(cached.forget_using(|_| Err("Delete failed".into())).is_err());
        assert_eq!(cached.revision(), 0);
        assert_eq!(cached.read_using(|_| panic!("must retain the cache")), Ok(Some("old-key".into())));

        cached.store_using("new-key", |_, _| Ok(())).unwrap();
        assert_eq!(cached.revision(), 1);
        assert_eq!(cached.read_using(|_| panic!("must use the saved key")), Ok(Some("new-key".into())));
        assert_eq!(cached.revision(), 1);
        assert!(cached.store_using(" ", |_, _| panic!("must reject empty keys")).is_err());
        assert!(cached.store_using("other-key", |_, _| Err("Store failed".into())).is_err());
        assert!(cached.forget_using(|_| Err("Delete failed".into())).is_err());
        assert_eq!(cached.revision(), 1);
        assert_eq!(cached.read_using(|_| panic!("must retain the cache")), Ok(Some("new-key".into())));

        cached.forget_using(|_| Ok(())).unwrap();
        assert_eq!(cached.revision(), 2);
        assert_eq!(cached.read_using(|_| panic!("must cache absence")), Ok(None));
        assert_eq!(cached.revision(), 2);
        cached.forget_using(|_| Ok(())).unwrap();
        assert_eq!(cached.revision(), 3);
    }

    #[test]
    fn empty_save_preserves_cache_without_accessing_keychain() {
        let mut cached = CachedKey::new(Provider::Glm);
        assert_eq!(cached.read_using(|_| Ok(None)), Ok(None));
        assert!(cached.store_using(" \n", |_, _| panic!("empty keys must not be stored")).is_err());
        assert_eq!(cached.read_using(|_| panic!("must retain the cache")), Ok(None));
    }
}
