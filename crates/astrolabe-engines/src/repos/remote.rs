//! Remote URLs, how a repository stands against its remote, and the result of
//! a remote check. Pure parsing and classification; no I/O.

use super::model::{GhRepo, Relation, RemoteUrl, Stats, Tip};

/// Splits a remote URL into host and path. Local paths and `file://` give None.
pub fn parse_url(url: &str) -> Option<RemoteUrl> {
    let url = url.trim();
    let (host, path) = if let Some((scheme, rest)) = url.split_once("://") {
        if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https" | "ssh" | "git") {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        let hostport = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        let host = match hostport.rsplit_once(':') {
            Some((h, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => h,
            _ => hostport,
        };
        (host, path)
    } else {
        if url.starts_with(['/', '.', '~']) {
            return None;
        }
        let (left, path) = url.split_once(':')?;
        if left.contains('/') {
            return None;
        }
        (left.rsplit_once('@').map_or(left, |(_, h)| h), path)
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path).trim_end_matches('/');
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(RemoteUrl { host: host.to_ascii_lowercase(), path: path.to_string() })
}

fn is_github(url: &RemoteUrl) -> bool {
    matches!(url.host.as_str(), "github.com" | "www.github.com" | "ssh.github.com")
}

/// The `owner/name` of a GitHub URL.
pub fn github_slug(url: &RemoteUrl) -> Option<String> {
    if !is_github(url) {
        return None;
    }
    let mut parts = url.path.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(o), Some(n), None) if !o.is_empty() && !n.is_empty() => Some(url.path.clone()),
        _ => None,
    }
}

/// Lowercase `host/path`, the same for all copies of one remote.
pub fn copy_key(url: &RemoteUrl) -> String {
    format!("{}/{}", url.host, url.path).to_lowercase()
}

/// Canonical lowercase `github.com/{full_name}` key for a GitHub repository slug.
pub fn github_copy_key(full_name: &str) -> String {
    format!("github.com/{}", full_name.trim().trim_matches('/')).to_lowercase()
}

/// How the repository stands against its main remote.
pub fn relation(stats: &Stats, gh: Option<&GhRepo>) -> Relation {
    let Some(remote) = stats.main_remote() else {
        return Relation::LocalOnly;
    };
    let Some(url) = parse_url(&remote.url) else {
        return Relation::OtherHost("local path".to_string());
    };
    if github_slug(&url).is_none() {
        return Relation::OtherHost(url.host);
    }
    match gh {
        None => Relation::GitHub,
        Some(g) if g.private || matches!(g.visibility.as_str(), "private" | "internal") => Relation::Private,
        Some(_) => Relation::Public,
    }
}

/// The page of the repository on GitHub.
pub fn web_url(stats: &Stats, gh: Option<&GhRepo>) -> Option<String> {
    if let Some(g) = gh {
        return Some(g.html_url.clone());
    }
    let slug = github_slug(&parse_url(&stats.main_remote()?.url)?)?;
    Some(format!("https://github.com/{slug}"))
}

/// Compares the answer of `git ls-remote` with the local remote-tracking tip.
pub fn tip(stats: &Stats, ls: Result<Option<String>, String>) -> Tip {
    match ls {
        Ok(Some(sha)) if stats.upstream_tip.as_deref() == Some(sha.as_str()) => Tip::Same,
        Ok(Some(remote_sha)) => Tip::Moved { remote_sha },
        Ok(None) => Tip::Missing,
        Err(e) => Tip::Failed(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Head, Remote};
    use std::time::SystemTime;

    fn stats(remotes: &[(&str, &str)]) -> Stats {
        Stats {
            head: Head::Branch("main".into()),
            head_sha: None,
            upstream: None,
            upstream_remote: None,
            upstream_ref: None,
            upstream_tip: Some("aaa".into()),
            ahead: None,
            behind: None,
            unpushed: None,
            unpushed_commits: vec![],
            changes: Changes::default(),
            oldest_change: None,
            stashes: vec![],
            worktrees: vec![],
            submodules: vec![],
            commits_total: 0,
            commits_7d: 0,
            commits_30d: 0,
            recent_commits: vec![],
            last_commit: None,
            remotes: remotes.iter().map(|(n, u)| Remote { name: n.to_string(), url: u.to_string() }).collect(),
            root_commits: vec![],
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        }
    }

    fn gh(private: bool, visibility: &str) -> GhRepo {
        GhRepo {
            full_name: "o/r".into(),
            private,
            visibility: visibility.into(),
            can_push: None,
            archived: false,
            fork: false,
            html_url: "https://github.com/o/r".into(),
            default_branch: "main".into(),
        }
    }

    #[test]
    fn parses_urls() {
        let cases: [(&str, Option<(&str, &str)>); 14] = [
            ("https://github.com/ExampleOrg/compass.git", Some(("github.com", "ExampleOrg/compass"))),
            ("https://github.com/acme-labs/prism", Some(("github.com", "acme-labs/prism"))),
            ("git@github.com:o/r.git", Some(("github.com", "o/r"))),
            ("ssh://git@github.com:22/o/r", Some(("github.com", "o/r"))),
            (
                "https://git.overleaf.com/0123456789abcdef01234567",
                Some(("git.overleaf.com", "0123456789abcdef01234567")),
            ),
            ("http://host:8080/a/b/c.git", Some(("host", "a/b/c"))),
            ("https://user@bitbucket.org/team/r.git", Some(("bitbucket.org", "team/r"))),
            ("https://GitHub.com/o/r/", Some(("github.com", "o/r"))),
            ("git://example.org/x/y.git", Some(("example.org", "x/y"))),
            ("host.example:path/r.git", Some(("host.example", "path/r"))),
            ("/opt/work/repo", None),
            ("file:///var/repos/r.git", None),
            ("../relative", None),
            ("", None),
        ];
        for (url, want) in cases {
            let got = parse_url(url).map(|u| (u.host, u.path));
            assert_eq!(got, want.map(|(h, p)| (h.to_string(), p.to_string())), "{url}");
        }
    }

    #[test]
    fn slugs_and_keys() {
        let slug = |u: &str| github_slug(&parse_url(u).unwrap());
        assert_eq!(slug("git@github.com:o/r.git").as_deref(), Some("o/r"));
        assert_eq!(slug("https://www.github.com/o/r").as_deref(), Some("o/r"));
        assert_eq!(slug("ssh://git@ssh.github.com:443/o/r.git").as_deref(), Some("o/r"));
        assert_eq!(slug("https://github.com/o"), None);
        assert_eq!(slug("https://github.com/o/r/tree"), None);
        assert_eq!(slug("https://gitlab.com/o/r"), None);
        let key = |u: &str| copy_key(&parse_url(u).unwrap());
        assert_eq!(key("git@GitHub.com:Foo/Bar.git"), "github.com/foo/bar");
        assert_eq!(key("https://github.com/foo/bar"), key("git@github.com:Foo/Bar.git"));
        assert_eq!(github_copy_key("Northstar-Labs/Sextant-Core"), "github.com/northstar-labs/sextant-core");
        assert_eq!(github_copy_key(" /Foo/Bar/ "), "github.com/foo/bar");
    }

    #[test]
    fn relations() {
        let gh_url = "https://github.com/o/r.git";
        let rel = |urls: &[(&str, &str)], g: Option<&GhRepo>| relation(&stats(urls), g);
        assert_eq!(rel(&[], None), Relation::LocalOnly);
        assert_eq!(rel(&[("origin", gh_url)], None), Relation::GitHub);
        assert_eq!(rel(&[("origin", gh_url)], Some(&gh(true, "private"))), Relation::Private);
        assert_eq!(rel(&[("origin", gh_url)], Some(&gh(false, "public"))), Relation::Public);
        assert_eq!(rel(&[("origin", gh_url)], Some(&gh(false, "internal"))), Relation::Private);
        assert_eq!(
            rel(&[("origin", "https://git.overleaf.com/abc")], None),
            Relation::OtherHost("git.overleaf.com".into())
        );
        assert_eq!(rel(&[("origin", "/opt/work/repo")], None), Relation::OtherHost("local path".into()));
        assert_eq!(rel(&[("origin", "file:///var/repos/r.git")], None), Relation::OtherHost("local path".into()));
        let mut s = stats(&[("origin", gh_url), ("up", "https://gitlab.com/a/b")]);
        s.upstream_remote = Some("up".into());
        assert_eq!(relation(&s, None), Relation::OtherHost("gitlab.com".into()));
    }

    #[test]
    fn web_urls() {
        let s = stats(&[("origin", "git@github.com:o/r.git")]);
        assert_eq!(web_url(&s, None).as_deref(), Some("https://github.com/o/r"));
        let mut g = gh(false, "public");
        g.html_url = "https://github.com/O/R".into();
        assert_eq!(web_url(&s, Some(&g)).as_deref(), Some("https://github.com/O/R"));
        assert_eq!(web_url(&stats(&[("origin", "https://gitlab.com/o/r")]), None), None);
        assert_eq!(web_url(&stats(&[]), None), None);
    }

    #[test]
    fn tips() {
        let s = stats(&[]);
        assert_eq!(tip(&s, Ok(Some("aaa".into()))), Tip::Same);
        assert_eq!(tip(&s, Ok(Some("bbb".into()))), Tip::Moved { remote_sha: "bbb".into() });
        assert_eq!(tip(&s, Ok(None)), Tip::Missing);
        assert_eq!(tip(&s, Err("boom".into())), Tip::Failed("boom".into()));
    }
}
