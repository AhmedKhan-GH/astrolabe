//! Finding the git repositories under the configured roots.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::model::{Config, Discovery, Found, GhRepo, Ide, IdeSource, THIRD_PARTY};
use super::tags;

/// How many folders below a root are examined.
const MAX_DEPTH: usize = 6;

/// What a folder with a `.git` entry is.
enum Tree {
    /// A repository with this git directory.
    Repo(PathBuf),
    /// A linked worktree whose main working tree is this, with the common git directory.
    Worktree {
        main: PathBuf,
        common: PathBuf,
    },
    Submodule,
}

/// The IDE a folder's top-level project files point to, in a fixed order.
pub fn infer_ide(path: &Path) -> Option<Ide> {
    const FILES: [(&[&str], Ide); 5] = [
        (&["Cargo.toml"], Ide::RustRover),
        (&["go.mod"], Ide::GoLand),
        (&["CMakeLists.txt"], Ide::CLion),
        (&["pyproject.toml", "setup.py", "requirements.txt"], Ide::PyCharm),
        (&["package.json"], Ide::WebStorm),
    ];
    FILES.iter().find(|(names, _)| names.iter().any(|n| path.join(n).is_file())).map(|(_, ide)| *ide)
}

/// The category of a repository: the override, else third party when its root
/// detects that and GitHub says the user cannot push, else the root's.
pub fn category(found: &Found, config: &Config, gh: Option<&GhRepo>) -> String {
    if let Some(c) = config.override_for(&found.path).and_then(|o| o.category.as_ref()) {
        return c.clone();
    }
    let root = &config.roots[found.root];
    if root.detect_third_party && gh.is_some_and(|g| g.can_push == Some(false)) {
        return THIRD_PARTY.to_owned();
    }
    root.category.clone()
}

/// Scan every root for repositories. Linked worktrees and submodules are not
/// listed, but a worktree's main repository is.
pub fn discover(config: &Config) -> Discovery {
    // Skip paths are compared with canonical folders, so resolve them once.
    let mut config = config.clone();
    for p in &mut config.skip_paths {
        if let Ok(c) = fs::canonicalize(&*p) {
            *p = c;
        }
    }
    let mut walk =
        Walk { config: &config, seen: HashSet::new(), repos: BTreeMap::new(), mains: Vec::new(), errors: Vec::new() };
    for (index, root) in config.roots.iter().enumerate() {
        if let Ok(path) = fs::canonicalize(&root.path)
            && path.is_dir()
            && walk.seen.insert(path.clone())
        {
            walk.visit(&path, 0, index);
        }
    }
    for (main, common, root) in std::mem::take(&mut walk.mains) {
        if !walk.repos.contains_key(&main) {
            let found = walk.found(main.clone(), common, root);
            walk.repos.insert(main, found);
        }
    }
    let Walk { repos, mut errors, .. } = walk;
    errors.sort();
    Discovery { repos: repos.into_values().filter(|f| !config.removes_repo(&f.path)).collect(), errors }
}

struct Walk<'a> {
    config: &'a Config,
    /// Folders already visited, so overlapping roots count once.
    seen: HashSet<PathBuf>,
    repos: BTreeMap<PathBuf, Found>,
    /// Main repositories reached through a worktree: path, git dir, root.
    mains: Vec<(PathBuf, PathBuf, usize)>,
    errors: Vec<(PathBuf, String)>,
}

impl Walk<'_> {
    fn found(&self, path: PathBuf, git_dir: PathBuf, root: usize) -> Found {
        let (ide, ide_source) = if let Some(ide) = self.config.override_for(&path).and_then(|o| o.ide) {
            (Some(ide), IdeSource::Config)
        } else if let Some(ide) = self.config.roots[root].ide {
            (Some(ide), IdeSource::Root)
        } else if let Some(ide) = infer_ide(&path) {
            (Some(ide), IdeSource::ProjectFile)
        } else {
            (None, IdeSource::None)
        };
        let langs = tags::detect_langs(&path);
        Found { path, git_dir, root, ide, ide_source, langs }
    }

    fn visit(&mut self, dir: &Path, depth: usize, root: usize) {
        let mut skip_children = Vec::new();
        match classify(dir) {
            Some(Tree::Submodule) => return,
            Some(Tree::Worktree { main, common }) => {
                self.mains.push((main, common, root));
                return;
            }
            Some(Tree::Repo(git_dir)) => {
                let found = self.found(dir.to_owned(), git_dir, root);
                self.repos.insert(dir.to_owned(), found);
                skip_children = submodule_paths(dir);
            }
            None => {}
        }
        if depth >= MAX_DEPTH {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) => {
                self.errors.push((dir.to_owned(), e.to_string()));
                return;
            }
        };
        let mut children: Vec<PathBuf> = Vec::new();
        for entry in entries {
            match entry {
                Ok(e) if e.file_type().is_ok_and(|t| t.is_dir()) => {
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    if name != ".git" && !self.config.skips_name(&name) {
                        children.push(e.path());
                    }
                }
                Ok(_) => {}
                Err(e) => self.errors.push((dir.to_owned(), e.to_string())),
            }
        }
        children.sort();
        for child in children {
            if self.config.skips_path(&child) || skip_children.contains(&child) {
                continue;
            }
            self.visit(&child, depth + 1, root);
        }
    }
}

/// The working trees of the submodules a repository's `.gitmodules` lists.
fn submodule_paths(dir: &Path) -> Vec<PathBuf> {
    let Ok(text) = fs::read_to_string(dir.join(".gitmodules")) else { return Vec::new() };
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("path"))
        .filter_map(|l| l.trim_start().strip_prefix('='))
        .map(|p| dir.join(p.trim()))
        .collect()
}

/// What the `.git` entry of a folder says it is; None without one.
fn classify(dir: &Path) -> Option<Tree> {
    let dot_git = dir.join(".git");
    let meta = fs::symlink_metadata(&dot_git).ok()?;
    if meta.is_dir() {
        return Some(Tree::Repo(dot_git));
    }
    if !meta.is_file() {
        return None;
    }
    let text = fs::read_to_string(&dot_git).ok()?;
    let target = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    let git_dir = fs::canonicalize(dir.join(target)).ok()?;
    if git_dir.parent().and_then(Path::file_name).is_some_and(|n| n == "worktrees") {
        let common = match fs::read_to_string(git_dir.join("commondir")) {
            Ok(c) => fs::canonicalize(git_dir.join(c.trim())).ok()?,
            Err(_) => git_dir.parent()?.parent()?.to_owned(),
        };
        let main = common.file_name().is_some_and(|n| n == ".git").then(|| common.parent().map(Path::to_owned))??;
        return Some(Tree::Worktree { main, common });
    }
    if git_dir.ancestors().any(|a| a.file_name().is_some_and(|n| n == "modules")) {
        return Some(Tree::Submodule);
    }
    Some(Tree::Repo(git_dir))
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;
    use crate::repos::config as repo_config;
    use crate::repos::model::{Override, Root};

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test-local", "-c", "protocol.file.allow=always"])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// A repository with one commit.
    fn repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q"]);
        git(dir, &["commit", "-q", "--allow-empty", "-m", "x"]);
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "").unwrap();
    }

    /// A temp folder with a canonical path.
    fn temp() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let p = fs::canonicalize(t.path()).unwrap();
        (t, p)
    }

    fn config(roots: &[&Path]) -> Config {
        let mut c = Config::defaults();
        c.skip_paths.clear();
        c.roots = roots
            .iter()
            .map(|p| Root { path: p.to_path_buf(), ide: None, category: "Research".into(), detect_third_party: true })
            .collect();
        c
    }

    fn paths_of(d: &Discovery) -> Vec<PathBuf> {
        d.repos.iter().map(|f| f.path.clone()).collect()
    }

    #[test]
    fn finds_nested_repositories_and_hidden_folders() {
        let (_t, root) = temp();
        repo(&root.join("a"));
        repo(&root.join("a/inner"));
        repo(&root.join("b/.hidden/deep"));
        fs::create_dir_all(root.join("plain/empty")).unwrap();
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("a"), root.join("a/inner"), root.join("b/.hidden/deep")]);
        assert_eq!(d.repos[0].git_dir, root.join("a/.git"));
        assert!(d.errors.is_empty());
    }

    #[test]
    fn removed_repository_is_not_rediscovered_but_nested_and_siblings_remain() {
        let (_t, root) = temp();
        repo(&root.join("a"));
        repo(&root.join("a/nested"));
        repo(&root.join("a-other"));
        let file = root.join("config.toml");
        fs::write(&file, format!("[[root]]\npath = {:?}\ncategory = 'Test'\n", root.to_str().unwrap())).unwrap();
        repo_config::remove_repo(&file, &root.join("a")).unwrap();
        let (c, error) = repo_config::load(&file);
        assert_eq!(error, None);
        assert_eq!(paths_of(&discover(&c)), [root.join("a/nested"), root.join("a-other")]);
        let mut direct = c;
        direct.roots[0].path = root.join("a");
        assert_eq!(paths_of(&discover(&direct)), [root.join("a/nested")]);
        assert!(root.join("a/.git").is_dir());
    }

    #[test]
    fn a_worktree_does_not_restore_its_removed_main_repository() {
        let (_t, base) = temp();
        let main = base.join("outside/main");
        let root = base.join("root");
        repo(&main);
        git(&main, &["worktree", "add", "-q", &root.join("wt").display().to_string(), "-b", "side"]);
        repo(&root.join("keep"));
        let mut c = config(&[&root]);
        c.removed_repos.push(main.clone());
        assert_eq!(paths_of(&discover(&c)), [root.join("keep")]);
        assert!(main.join(".git").is_dir());
        assert!(root.join("wt/.git").is_file());
    }

    #[test]
    fn skips_names_globs_and_paths() {
        let (_t, root) = temp();
        repo(&root.join("keep"));
        repo(&root.join("keep/node_modules/pkg"));
        repo(&root.join("cmake-build-debug/_deps/lib"));
        repo(&root.join("target"));
        repo(&root.join("other/x"));
        let mut c = config(&[&root]);
        c.skip_paths.push(root.join("other"));
        assert_eq!(paths_of(&discover(&c)), [root.join("keep")]);
    }

    #[test]
    fn skip_paths_given_through_a_symlink_apply() {
        let (_t, root) = temp();
        repo(&root.join("other/x"));
        let link = root.join("link");
        std::os::unix::fs::symlink(root.join("other"), &link).unwrap();
        let mut c = config(&[&root]);
        c.skip_paths.push(link);
        assert!(discover(&c).repos.is_empty());
    }

    #[test]
    fn worktrees_attach_to_their_parent() {
        let (_t, root) = temp();
        repo(&root.join("main"));
        git(&root.join("main"), &["worktree", "add", "-q", "../wt", "-b", "side"]);
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("main")]);
    }

    #[test]
    fn worktree_whose_parent_is_outside_the_roots() {
        let (_t, base) = temp();
        let (root, outside) = (base.join("root"), base.join("outside"));
        repo(&outside.join("main"));
        git(&outside.join("main"), &["worktree", "add", "-q", &root.join("wt").display().to_string(), "-b", "side"]);
        let mut c = config(&[&root, &outside.join("none")]);
        c.roots[0].ide = Some(Ide::GoLand);
        let d = discover(&c);
        assert_eq!(paths_of(&d), [outside.join("main")]);
        assert_eq!(d.repos[0].root, 0);
        assert_eq!(d.repos[0].ide, Some(Ide::GoLand));
        assert_eq!(d.repos[0].git_dir, outside.join("main/.git"));
    }

    #[test]
    fn submodules_are_not_listed() {
        let (_t, base) = temp();
        repo(&base.join("source"));
        let root = base.join("root");
        repo(&root.join("super"));
        let src = base.join("source").display().to_string();
        git(&root.join("super"), &["submodule", "add", "-q", &src, "libs/sub"]);
        repo(&root.join("super/nested"));
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("super"), root.join("super/nested")]);
    }

    #[test]
    fn external_git_dir_is_a_repository() {
        let (_t, root) = temp();
        fs::create_dir_all(root.join("r")).unwrap();
        git(&root.join("r"), &["init", "-q", "--separate-git-dir", "../r.gitdir"]);
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("r")]);
        assert_eq!(d.repos[0].git_dir, root.join("r.gitdir"));
    }

    #[test]
    fn symlink_loops_are_not_followed() {
        let (_t, root) = temp();
        repo(&root.join("a"));
        std::os::unix::fs::symlink(&root, root.join("a/loop")).unwrap();
        std::os::unix::fs::symlink(root.join("a"), root.join("alias")).unwrap();
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("a")]);
    }

    #[test]
    fn a_symlinked_root_is_resolved() {
        let (_t, base) = temp();
        repo(&base.join("real/a"));
        std::os::unix::fs::symlink(base.join("real"), base.join("link")).unwrap();
        let d = discover(&config(&[&base.join("link"), &base.join("missing")]));
        assert_eq!(paths_of(&d), [base.join("real/a")]);
        assert!(d.errors.is_empty());
    }

    #[test]
    fn depth_is_limited_to_six_levels() {
        let (_t, root) = temp();
        repo(&root.join("1/2/3/4/5/6"));
        repo(&root.join("1/2/3/4/5/6/7"));
        let d = discover(&config(&[&root]));
        assert_eq!(paths_of(&d), [root.join("1/2/3/4/5/6")]);
    }

    #[test]
    fn unreadable_folders_are_reported() {
        use std::os::unix::fs::PermissionsExt;
        let (_t, root) = temp();
        fs::create_dir_all(root.join("locked")).unwrap();
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
        let d = discover(&config(&[&root]));
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(d.errors.len(), 1);
        assert_eq!(d.errors[0].0, root.join("locked"));
    }

    #[test]
    fn infers_the_ide_in_order() {
        let (_t, root) = temp();
        let cases: [(&[&str], Option<Ide>); 8] = [
            (&["Cargo.toml", "go.mod", "package.json"], Some(Ide::RustRover)),
            (&["go.mod", "CMakeLists.txt"], Some(Ide::GoLand)),
            (&["CMakeLists.txt", "pyproject.toml"], Some(Ide::CLion)),
            (&["pyproject.toml", "package.json"], Some(Ide::PyCharm)),
            (&["setup.py"], Some(Ide::PyCharm)),
            (&["requirements.txt"], Some(Ide::PyCharm)),
            (&["package.json"], Some(Ide::WebStorm)),
            (&["README.md"], None),
        ];
        for (i, (files, want)) in cases.iter().enumerate() {
            let dir = root.join(i.to_string());
            fs::create_dir_all(&dir).unwrap();
            files.iter().for_each(|f| touch(&dir.join(f)));
            assert_eq!(infer_ide(&dir), *want, "{files:?}");
        }
    }

    #[test]
    fn ide_comes_from_override_then_root_then_files() {
        let (_t, root) = temp();
        for n in ["a", "b", "c", "d"] {
            repo(&root.join(n));
        }
        touch(&root.join("a/Cargo.toml"));
        touch(&root.join("b/Cargo.toml"));
        touch(&root.join("c/package.json"));
        let mut c = config(&[&root]);
        c.overrides.push((root.join("a"), Override { category: None, ide: Some(Ide::CLion) }));
        let d = discover(&c);
        let got: Vec<_> = d.repos.iter().map(|f| (f.ide, f.ide_source)).collect();
        assert_eq!(
            got,
            [
                (Some(Ide::CLion), IdeSource::Config),
                (Some(Ide::RustRover), IdeSource::ProjectFile),
                (Some(Ide::WebStorm), IdeSource::ProjectFile),
                (None, IdeSource::None),
            ]
        );
        c.roots[0].ide = Some(Ide::PyCharm);
        let d = discover(&c);
        assert_eq!((d.repos[0].ide, d.repos[0].ide_source), (Some(Ide::CLion), IdeSource::Config));
        assert_eq!((d.repos[1].ide, d.repos[1].ide_source), (Some(Ide::PyCharm), IdeSource::Root));
    }

    fn gh(can_push: Option<bool>) -> GhRepo {
        GhRepo {
            full_name: "o/n".into(),
            private: false,
            visibility: "public".into(),
            can_push,
            archived: false,
            fork: false,
            html_url: String::new(),
            default_branch: "main".into(),
        }
    }

    #[test]
    fn category_follows_override_then_third_party_then_root() {
        let (_t, root) = temp();
        repo(&root.join("a"));
        let mut c = config(&[&root]);
        let found = discover(&c).repos.remove(0);
        assert_eq!(category(&found, &c, None), "Research");
        assert_eq!(category(&found, &c, Some(&gh(Some(true)))), "Research");
        assert_eq!(category(&found, &c, Some(&gh(None))), "Research");
        assert_eq!(category(&found, &c, Some(&gh(Some(false)))), THIRD_PARTY);
        c.roots[0].detect_third_party = false;
        assert_eq!(category(&found, &c, Some(&gh(Some(false)))), "Research");
        c.roots[0].detect_third_party = true;
        c.overrides.push((root.join("a"), Override { category: Some("Company".into()), ide: None }));
        assert_eq!(category(&found, &c, Some(&gh(Some(false)))), "Company");
    }
}
