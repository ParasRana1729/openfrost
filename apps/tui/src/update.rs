//! `openfrost update`: pull the latest source for a source-based install,
//! rebuild it, and reinstall the `openfrost` binary.
//!
//! OpenFrost is installed from a checkout of the repo by `scripts/install.ps1`,
//! which records the checkout path as `repoRoot` in `runtime.json`. Updating is
//! therefore: fast-forward that checkout, `pnpm install`, then re-run the
//! installer (rebuild API, refresh `runtime.json`, `cargo install --force`).
//! A managed background API is stopped for the rebuild and restarted after.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, bail, Context, Result};

use crate::runtime::{self, EnsureOutcome, RuntimeConfig, StopOutcome};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoState {
    pub branch: String,
    pub upstream: String,
    pub behind: usize,
    pub ahead: usize,
}

/// Locate the OpenFrost checkout this install was built from.
pub fn resolve_repo_root(home: &Path) -> Result<PathBuf> {
    let config = runtime::read_runtime_config(home);
    repo_root_from_config(config.as_ref()).ok_or_else(|| {
        anyhow!(
            "Could not find the OpenFrost source checkout (runtime.json missing or stale). \
             Run .\\scripts\\install.ps1 once from your OpenFrost repo, then retry."
        )
    })
}

fn repo_root_from_config(config: Option<&RuntimeConfig>) -> Option<PathBuf> {
    let config = config?;
    let mut candidates = Vec::new();
    if let Some(root) = &config.repo_root {
        candidates.push(PathBuf::from(root));
    }
    // <repo>/apps/api/dist/main.js -> <repo>
    if let Some(root) = Path::new(&config.api_entry).ancestors().nth(4) {
        candidates.push(root.to_path_buf());
    }
    candidates.into_iter().find(|root| is_checkout(root))
}

fn is_checkout(root: &Path) -> bool {
    root.join(".git").exists() && root.join("scripts").join("install.ps1").is_file()
}

/// `git status --porcelain --untracked-files=no` output means local changes.
fn has_tracked_changes(porcelain: &str) -> bool {
    porcelain.lines().any(|line| !line.trim().is_empty())
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(repo);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().context("Failed to run git (is it on PATH?)")?;
    if !output.status.success() {
        bail!(
            "`git {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn count(repo: &Path, range: &str) -> Result<usize> {
    git(repo, &["rev-list", "--count", range])?
        .parse()
        .with_context(|| format!("Unexpected output from `git rev-list --count {range}`"))
}

/// Fetch and compare the checked-out branch with its upstream.
pub fn inspect_repo(repo: &Path) -> Result<RepoState> {
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch == "HEAD" {
        bail!(
            "The OpenFrost checkout is on a detached HEAD; check out a branch (e.g. main) first."
        );
    }
    let upstream = git(repo, &["rev-parse", "--abbrev-ref", "@{u}"]).map_err(|_| {
        anyhow!(
            "Branch `{branch}` has no upstream. Run `git branch --set-upstream-to=origin/main` \
             in {} or check out `main`.",
            repo.display()
        )
    })?;
    git(repo, &["fetch", "--quiet"])?;
    Ok(RepoState {
        behind: count(repo, "HEAD..@{u}")?,
        ahead: count(repo, "@{u}..HEAD")?,
        branch,
        upstream,
    })
}

/// Print update availability. Returns `true` when a newer version exists.
pub fn run_check() -> Result<bool> {
    let home = runtime::resolve_home_dir()?;
    let repo = resolve_repo_root(&home)?;
    let state = inspect_repo(&repo)?;
    println!("Checkout: {}", repo.display());
    if state.behind == 0 {
        println!(
            "OpenFrost is up to date ({} @ {}).",
            state.branch, state.upstream
        );
        Ok(false)
    } else {
        println!(
            "Update available: {} is {} commit(s) behind {}. Run `openfrost update`.",
            state.branch, state.behind, state.upstream
        );
        Ok(true)
    }
}

/// Update the install in place. `origin` is the API origin used to stop and
/// restart the managed background API around the rebuild.
pub async fn run_update(origin: &str) -> Result<()> {
    let home = runtime::resolve_home_dir()?;
    let repo = resolve_repo_root(&home)?;
    println!("Checkout: {}", repo.display());

    if has_tracked_changes(&git(
        &repo,
        &["status", "--porcelain", "--untracked-files=no"],
    )?) {
        bail!(
            "The checkout has uncommitted changes; commit or stash them first ({}).",
            repo.display()
        );
    }
    let state = inspect_repo(&repo)?;
    if state.behind == 0 {
        println!(
            "Already up to date ({} @ {}). To force a rebuild, run `pnpm install:cli` in the repo.",
            state.branch, state.upstream
        );
        return Ok(());
    }
    println!(
        "Updating {}: {} new commit(s) from {}.",
        state.branch, state.behind, state.upstream
    );

    cleanup_stale_binary();
    let was_running = matches!(
        runtime::stop_api(origin, &home).await?,
        StopOutcome::Stopped { .. }
    );
    if was_running {
        println!("Stopped the running OpenFrost API for the update.");
    }

    let result = apply_update(&repo);

    if was_running {
        match runtime::ensure_api_running(origin, &home, false).await {
            Ok(EnsureOutcome::Started { pid, .. }) => {
                println!("Restarted OpenFrost API (PID {pid}).");
            }
            Ok(_) => {}
            Err(error) => eprintln!("Could not restart the API: {error:#}"),
        }
    }
    result?;

    println!();
    println!("OpenFrost updated. Run `openfrost` to start it.");
    Ok(())
}

fn apply_update(repo: &Path) -> Result<()> {
    println!("Pulling latest changes...");
    run_visible(repo, "git", &["pull", "--ff-only"])?;
    println!("Installing dependencies...");
    run_visible(repo, "pnpm", &["install", "--frozen-lockfile"])?;

    // Windows cannot overwrite a running .exe but can rename it, so move this
    // process's binary aside and let `cargo install --force` write a new one.
    let swap = stage_binary_swap(repo);
    let installer = if cfg!(windows) {
        run_visible(
            repo,
            "powershell",
            &[
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "scripts/install.ps1",
            ],
        )
    } else {
        Err(anyhow!(
            "`openfrost update` currently supports Windows only (it runs scripts/install.ps1)."
        ))
    };
    if let Some((exe, old)) = swap {
        if installer.is_err() && !exe.exists() {
            let _ = std::fs::rename(&old, &exe);
        }
    }
    installer
}

/// Run a tool with inherited stdio so progress is visible; `pnpm` is a `.cmd`
/// shim on Windows and must go through `cmd /C`.
fn run_visible(repo: &Path, program: &str, args: &[&str]) -> Result<()> {
    let mut cmd = if cfg!(windows) && program == "pnpm" {
        let mut c = Command::new("cmd");
        c.args(["/C", "pnpm"]);
        c
    } else {
        Command::new(program)
    };
    let status = cmd
        .args(args)
        .current_dir(repo)
        .status()
        .with_context(|| format!("Failed to run `{program}` (is it on PATH?)"))?;
    if !status.success() {
        bail!("`{program} {}` failed with {status}", args.join(" "));
    }
    Ok(())
}

fn old_binary_path(exe: &Path) -> PathBuf {
    let mut name = exe.as_os_str().to_os_string();
    name.push(".old");
    PathBuf::from(name)
}

/// Rename the running installed binary out of the way (Windows only). Skipped
/// for dev builds running from the repo's `target/` directory.
fn stage_binary_swap(repo: &Path) -> Option<(PathBuf, PathBuf)> {
    if !cfg!(windows) {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    if exe.starts_with(repo.join("target"))
        || exe.starts_with(repo.join("apps").join("tui").join("target"))
    {
        return None;
    }
    let old = old_binary_path(&exe);
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).ok()?;
    Some((exe, old))
}

/// Remove a `.old` binary left behind by a previous update (best effort).
fn cleanup_stale_binary() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(old_binary_path(&exe));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_checkout(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "openfrost_tui_update_{label}_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("scripts")).unwrap();
        fs::write(root.join("scripts").join("install.ps1"), "# installer").unwrap();
        root
    }

    #[test]
    fn repo_root_prefers_repo_root_then_falls_back_to_api_entry() {
        let root = make_checkout("root");
        let entry = root.join("apps").join("api").join("dist").join("main.js");

        let with_root = RuntimeConfig {
            api_entry: "missing/main.js".into(),
            node_path: None,
            repo_root: Some(root.display().to_string()),
        };
        assert_eq!(repo_root_from_config(Some(&with_root)), Some(root.clone()));

        let entry_only = RuntimeConfig {
            api_entry: entry.display().to_string(),
            node_path: None,
            repo_root: None,
        };
        assert_eq!(repo_root_from_config(Some(&entry_only)), Some(root.clone()));

        let stale = RuntimeConfig {
            api_entry: "nowhere/apps/api/dist/main.js".into(),
            node_path: None,
            repo_root: Some("nowhere".into()),
        };
        assert_eq!(repo_root_from_config(Some(&stale)), None);
        assert_eq!(repo_root_from_config(None), None);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn porcelain_output_detects_tracked_changes() {
        assert!(!has_tracked_changes(""));
        assert!(!has_tracked_changes("\n  \n"));
        assert!(has_tracked_changes(" M apps/tui/src/main.rs\n"));
        assert!(has_tracked_changes("D  README.md"));
    }

    #[test]
    fn old_binary_path_appends_suffix() {
        assert_eq!(
            old_binary_path(Path::new("C:\\bin\\openfrost.exe")),
            PathBuf::from("C:\\bin\\openfrost.exe.old")
        );
    }
}
