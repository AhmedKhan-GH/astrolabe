//! Setup entries for harnesses whose account quota readers are not connected.
//! Missing quota data must not become a zero-percent bar.

use crate::agents::model::{Limit, Provider, Status};
use crate::agents::tools::{Agent, SignIn};

pub fn setup(agent: &Agent) -> Option<Limit> {
    let provider = agent.provider?;
    if !matches!(provider, Provider::Grok | Provider::Meta | Provider::Qwen | Provider::Tencent) {
        return None;
    }
    // Desktop and CLI discovery describe the same CodeBuddy account.
    if provider == Provider::Tencent && agent.id != "codebuddy" {
        return None;
    }
    let installed = agent.installed() || (provider == Provider::Tencent && agent.app.is_some());
    let (status, detail) = if !installed {
        (Status::NotInstalled, format!("Install {}", agent.name))
    } else if agent.sign_in == SignIn::SignedOut {
        (Status::Setup, format!("Sign in with {} · usage tracking not connected", agent.id))
    } else if provider == Provider::Tencent {
        (Status::Unavailable, "Quota not available; check Usage in CodeBuddy".into())
    } else {
        (Status::Unavailable, "Usage tracking not connected".into())
    };
    Some(Limit::new(provider, status, detail))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::tools::{self, Env};

    #[test]
    fn tencent_desktop_without_a_cli_is_recognized() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("apps/CodeBuddy.app")).unwrap();
        let env = Env {
            home: dir.path().join("home"),
            bin_dirs: vec![],
            app_dirs: vec![dir.path().join("apps")],
            probe: dir.path().join("probe"),
            run_status: false,
        };
        let list = tools::detect(&env);
        let limits: Vec<_> = list.iter().filter_map(setup).filter(|l| l.provider == Provider::Tencent).collect();
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0].status, Status::Unavailable);
        assert!(limits[0].windows.is_empty());
    }

    #[test]
    fn setup_entries_follow_installation_without_inventing_quota() {
        let dir = tempfile::tempdir().unwrap();
        let env = Env {
            home: dir.path().join("home"),
            bin_dirs: vec![],
            app_dirs: vec![],
            probe: dir.path().join("probe"),
            run_status: false,
        };
        let agents = tools::detect(&env);
        let missing: Vec<_> = agents.iter().filter_map(setup).collect();
        assert_eq!(
            missing.iter().map(|l| l.provider).collect::<Vec<_>>(),
            [Provider::Grok, Provider::Meta, Provider::Qwen, Provider::Tencent]
        );
        assert!(missing.iter().all(|l| l.status == Status::NotInstalled));
        for mut a in agents.into_iter().filter(|a| setup(a).is_some()) {
            a.path = Some(dir.path().join(a.id));
            for sign_in in
                [SignIn::SignedOut, SignIn::SignedIn("Saved login".into()), SignIn::Unknown("Unknown".into())]
            {
                a.sign_in = sign_in;
                let l = setup(&a).unwrap();
                assert_eq!(l.status, if a.sign_in == SignIn::SignedOut { Status::Setup } else { Status::Unavailable });
                assert!(l.account.is_empty() && l.windows.is_empty());
            }
        }
    }
}
