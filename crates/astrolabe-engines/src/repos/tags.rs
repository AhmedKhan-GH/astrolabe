//! Automatic tags: tags derived from facts about a repository, so they need no
//! upkeep. The facts are the IDE, the languages of the project files, the
//! category, how the repository stands against its remote, and what the last
//! read found. Only `detect_langs` does I/O, and only on the top level and `src/`.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use super::model::{Relation, Repo, THIRD_PARTY, tag_slug};

/// Single-word automatic tags, in the order the sidebar lists them.
pub const STATUS: [&str; 8] =
    ["uncommitted", "unpushed", "behind", "stale", "local-only", "private", "public", "third-party"];

/// Automatic tag for repositories on this Mac with no remote.
pub const LOCATION_LOCAL_ONLY: &str = "location:local-only";
/// Automatic tag for GitHub repositories with no local clone.
pub const LOCATION_REMOTE_ONLY: &str = "location:remote-only";
/// Automatic tag for local clones of GitHub repositories.
pub const LOCATION_BOTH: &str = "location:both";

/// Location automatic tags, in the order the sidebar lists them.
pub const LOCATION: [&str; 3] = [LOCATION_LOCAL_ONLY, LOCATION_REMOTE_ONLY, LOCATION_BOTH];

/// The prefixes of the automatic tags that carry a value.
pub const PREFIXES: [&str; 4] = ["app:", "lang:", "category:", "location:"];

/// Days since the last commit after which a repository is stale.
pub const STALE_DAYS: u64 = 30;

/// The most languages guessed from file extensions.
const MAX_GUESSED: usize = 3;

/// The most folder entries looked at per folder when guessing from extensions.
const MAX_ENTRIES: usize = 500;

/// Whether a tag is automatic: one of [`STATUS`], one of [`LOCATION`], or
/// starting with one of [`PREFIXES`]. Manual tags never take these names.
pub fn is_automatic(tag: &str) -> bool {
    STATUS.contains(&tag) || LOCATION.contains(&tag) || PREFIXES.iter().any(|p| tag.starts_with(p))
}

/// The automatic tags of a repository, in this order: `app:`, then `lang:` (in
/// `found.langs` order), then `category:`, then `location:` when applicable,
/// then the [`STATUS`] words that apply, in `STATUS` order.
pub fn automatic(repo: &Repo, now: SystemTime) -> Vec<String> {
    let mut tags = Vec::new();
    if let Some(ide) = repo.ide {
        tags.push(format!("app:{}", ide.name().to_lowercase()));
    }
    tags.extend(repo.found.langs.iter().map(|l| format!("lang:{l}")));
    tags.push(format!("category:{}", tag_slug(&repo.category)));
    match repo.relation {
        Relation::LocalOnly => tags.push(LOCATION_LOCAL_ONLY.to_owned()),
        Relation::Private | Relation::Public | Relation::GitHub => tags.push(LOCATION_BOTH.to_owned()),
        Relation::OtherHost(_) => {}
    }
    let applies = |word: &str| match word {
        "uncommitted" => repo.stats().is_some_and(|s| s.has_uncommitted()),
        "unpushed" => repo.stats().is_some() && repo.unpushed() > 0,
        "behind" => repo.stats().is_some() && repo.is_behind(),
        "stale" => repo.stats().is_some_and(|s| s.last_commit.as_ref().is_some_and(|c| is_stale(c.commit_time, now))),
        "local-only" => repo.relation == Relation::LocalOnly,
        "private" => repo.relation == Relation::Private,
        "public" => repo.relation == Relation::Public,
        "third-party" => repo.category == THIRD_PARTY,
        _ => false,
    };
    tags.extend(STATUS.into_iter().filter(|w| applies(w)).map(String::from));
    tags
}

/// Whether a commit is more than [`STALE_DAYS`] days older than `now`.
fn is_stale(commit_time: SystemTime, now: SystemTime) -> bool {
    now.duration_since(commit_time).is_ok_and(|age| age > Duration::from_secs(STALE_DAYS * 86_400))
}

/// The languages of the project at `path`, most likely first. Marker files at
/// the top level decide; without any, the extensions of the files at the top
/// level and directly inside `src/` do. An unreadable folder gives none.
pub fn detect_langs(path: &Path) -> Vec<String> {
    let marked = marker_langs(path);
    if marked.is_empty() { guess_langs(path) } else { marked }
}

/// Languages from marker files at the top level, each once, in marker order.
fn marker_langs(path: &Path) -> Vec<String> {
    let has = |name: &str| path.join(name).is_file();
    let has_ext = |exts: &[&str]| {
        fs::read_dir(path).is_ok_and(|entries| {
            entries.flatten().any(|e| {
                let p = e.path();
                p.is_file() && p.extension().and_then(|x| x.to_str()).is_some_and(|x| exts.contains(&x))
            })
        })
    };
    let checks: [(bool, &str); 13] = [
        (has("Cargo.toml"), "rust"),
        (has("go.mod"), "go"),
        (has("CMakeLists.txt"), "cpp"),
        (has("Package.swift"), "swift"),
        (
            ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "environment.yml"].iter().any(|f| has(f)),
            "python",
        ),
        (has("package.json") && has("tsconfig.json"), "typescript"),
        (has("package.json") && !has("tsconfig.json"), "javascript"),
        (has("pom.xml") || has("build.gradle"), "java"),
        (has("build.gradle.kts"), "kotlin"),
        (has("Gemfile"), "ruby"),
        (has("composer.json"), "php"),
        (has("mix.exs"), "elixir"),
        (has_ext(&["csproj", "sln"]), "csharp"),
    ];
    checks.into_iter().filter(|(hit, _)| *hit).map(|(_, lang)| lang.to_string()).collect()
}

/// The language of a file extension, if it is one the guess knows.
fn lang_of_extension(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "rs" => "rust",
        "go" => "go",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" => "cpp",
        "py" | "ipynb" => "python",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" => "javascript",
        "swift" => "swift",
        "java" => "java",
        "kt" => "kotlin",
        "rb" => "ruby",
        "tex" => "latex",
        "jl" => "julia",
        "r" | "R" => "r",
        "sv" | "svh" => "systemverilog",
        "v" => "verilog",
        "vhd" | "vhdl" => "vhdl",
        _ => return None,
    })
}

/// Up to three languages by file count, then name, from the regular files at
/// the top level and directly inside `src/`.
fn guess_langs(path: &Path) -> Vec<String> {
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for dir in [path.to_path_buf(), path.join("src")] {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten().take(MAX_ENTRIES) {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            if let Some(lang) = p.extension().and_then(|x| x.to_str()).and_then(lang_of_extension) {
                *counts.entry(lang).or_default() += 1;
            }
        }
    }
    let mut ranked: Vec<_> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    ranked.into_iter().take(MAX_GUESSED).map(|(l, _)| l.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Commit, Found, Head, Ide, IdeSource, RemoteCheck, Stats, Tip};
    use std::path::PathBuf;

    fn at(days_ago: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(100 * 86_400 - days_ago * 86_400)
    }

    fn now() -> SystemTime {
        at(0)
    }

    fn stats() -> Stats {
        Stats {
            head: Head::Branch("main".into()),
            head_sha: None,
            upstream: None,
            upstream_remote: None,
            upstream_ref: None,
            upstream_tip: None,
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
            remotes: vec![],
            root_commits: vec![],
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        }
    }

    fn commit(time: SystemTime) -> Commit {
        Commit { sha: "a".repeat(40), commit_time: time, author_time: time, subject: String::new() }
    }

    fn repo(category: &str, relation: Relation, stats: Option<Stats>) -> Repo {
        Repo {
            found: Found {
                path: PathBuf::from("/x/demo"),
                git_dir: PathBuf::from("/x/demo/.git"),
                root: 0,
                ide: None,
                ide_source: IdeSource::None,
                langs: vec![],
            },
            name: "demo".into(),
            ide: None,
            category: category.into(),
            stats: stats.map(Ok),
            relation,
            gh: None,
            check: None,
        }
    }

    #[test]
    fn full_repo() {
        let mut s = stats();
        s.changes.unstaged = 1;
        s.unpushed = Some(2);
        s.behind = Some(1);
        s.last_commit = Some(commit(at(40)));
        let mut r = repo("Products and tools", Relation::Private, Some(s));
        r.ide = Some(Ide::RustRover);
        r.found.langs = vec!["rust".into(), "python".into()];
        assert_eq!(
            automatic(&r, now()),
            [
                "app:rustrover",
                "lang:rust",
                "lang:python",
                "category:products-and-tools",
                "location:both",
                "uncommitted",
                "unpushed",
                "behind",
                "stale",
                "private"
            ]
        );
        r.category = THIRD_PARTY.into();
        r.relation = Relation::Public;
        assert_eq!(
            automatic(&r, now())[4..],
            ["location:both", "uncommitted", "unpushed", "behind", "stale", "public", "third-party"]
        );
    }

    #[test]
    fn unread_repo_has_no_state_tags() {
        let mut r = repo("Research", Relation::LocalOnly, None);
        r.ide = Some(Ide::CLion);
        r.found.langs = vec!["cpp".into()];
        assert_eq!(
            automatic(&r, now()),
            ["app:clion", "lang:cpp", "category:research", "location:local-only", "local-only"]
        );
        r.stats = Some(Err("broken".into()));
        assert_eq!(
            automatic(&r, now()),
            ["app:clion", "lang:cpp", "category:research", "location:local-only", "local-only"]
        );
    }

    #[test]
    fn github_relation_has_no_visibility() {
        let r = repo("Research", Relation::GitHub, Some(stats()));
        assert_eq!(automatic(&r, now()), ["category:research", "location:both"]);
        let r = repo("Research", Relation::OtherHost("git.overleaf.com".into()), Some(stats()));
        assert_eq!(automatic(&r, now()), ["category:research"]);
    }

    #[test]
    fn local_only_is_never_unpushed() {
        let mut s = stats();
        s.unpushed = Some(5);
        let r = repo("Research", Relation::LocalOnly, Some(s));
        assert_eq!(automatic(&r, now()), ["category:research", "location:local-only", "local-only"]);
    }

    #[test]
    fn stale_boundary() {
        let tags = |days: u64, secs: u64| {
            let mut s = stats();
            s.last_commit = Some(commit(at(days) - Duration::from_secs(secs)));
            automatic(&repo("Research", Relation::Private, Some(s)), now())
        };
        assert_eq!(tags(30, 0), ["category:research", "location:both", "private"]);
        assert_eq!(tags(29, 0), ["category:research", "location:both", "private"]);
        assert_eq!(tags(30, 1), ["category:research", "location:both", "stale", "private"]);
        assert_eq!(tags(31, 0), ["category:research", "location:both", "stale", "private"]);
    }

    #[test]
    fn no_commits_is_not_stale() {
        let r = repo("Research", Relation::Private, Some(stats()));
        assert_eq!(automatic(&r, now()), ["category:research", "location:both", "private"]);
    }

    #[test]
    fn behind_by_count_or_moved_tip() {
        let mut s = stats();
        s.behind = Some(3);
        let r = repo("Research", Relation::Private, Some(s));
        assert_eq!(automatic(&r, now()), ["category:research", "location:both", "behind", "private"]);

        let mut r = repo("Research", Relation::Private, Some(stats()));
        r.check = Some(RemoteCheck { at: now(), tip: Tip::Moved { remote_sha: "b".repeat(40) } });
        assert_eq!(automatic(&r, now()), ["category:research", "location:both", "behind", "private"]);
        r.check = Some(RemoteCheck { at: now(), tip: Tip::Same });
        assert_eq!(automatic(&r, now()), ["category:research", "location:both", "private"]);
    }

    #[test]
    fn automatic_names() {
        for tag in ["app:x", "lang:x", "category:x", "location:local-only", "location:remote-only", "location:both"] {
            assert!(is_automatic(tag), "{tag}");
        }
        for tag in STATUS {
            assert!(is_automatic(tag), "{tag}");
        }
        for tag in LOCATION {
            assert!(is_automatic(tag), "{tag}");
        }
        for tag in ["northstar", "application", "language", "app", "lang", "categories", "location"] {
            assert!(!is_automatic(tag), "{tag}");
        }
    }

    fn touch(dir: &Path, name: &str) {
        let p = dir.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "").unwrap();
    }

    #[test]
    fn cargo_marker() {
        let d = tempfile::tempdir().unwrap();
        touch(d.path(), "Cargo.toml");
        touch(d.path(), "notes.py");
        assert_eq!(detect_langs(d.path()), ["rust"]);
    }

    #[test]
    fn package_json_with_and_without_tsconfig() {
        let d = tempfile::tempdir().unwrap();
        touch(d.path(), "package.json");
        assert_eq!(detect_langs(d.path()), ["javascript"]);
        touch(d.path(), "tsconfig.json");
        assert_eq!(detect_langs(d.path()), ["typescript"]);
    }

    #[test]
    fn several_markers_keep_order() {
        let d = tempfile::tempdir().unwrap();
        for f in ["pom.xml", "package.json", "requirements.txt", "go.mod", "Cargo.toml", "App.csproj", "build.gradle"] {
            touch(d.path(), f);
        }
        assert_eq!(detect_langs(d.path()), ["rust", "go", "python", "javascript", "java", "csharp"]);
    }

    #[test]
    fn extensions_decide_without_markers() {
        let d = tempfile::tempdir().unwrap();
        for f in ["a.tex", "b.tex", "c.tex", "x.py", "y.py", "z.jl", "README.md"] {
            touch(d.path(), f);
        }
        assert_eq!(detect_langs(d.path()), ["latex", "python", "julia"]);
        touch(d.path(), "w.v");
        assert_eq!(detect_langs(d.path()), ["latex", "python", "julia"]);
    }

    #[test]
    fn tie_breaks_by_name_and_src_counts() {
        let d = tempfile::tempdir().unwrap();
        touch(d.path(), "src/a.rs");
        touch(d.path(), "src/b.go");
        touch(d.path(), "src/deep/c.py");
        assert_eq!(detect_langs(d.path()), ["go", "rust"]);
    }

    #[test]
    fn missing_folder_has_no_languages() {
        let d = tempfile::tempdir().unwrap();
        assert!(detect_langs(&d.path().join("nope")).is_empty());
    }
}
