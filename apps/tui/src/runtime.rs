//! Local API lifecycle management for the `openfrost` CLI.
//!
//! The TUI remains a thin client of the local loopback Fastify API. This
//! module lets `openfrost` start that API on demand in a detached background
//! process, inspect its status, read its logs, and stop the managed process.
//! Closing the TUI never stops the background runtime, and OS-boot autostart
//! is intentionally out of scope.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(150);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(100);
const DEFAULT_API_PORT: u16 = 8787;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub api_entry: String,
    #[serde(default)]
    pub node_path: Option<String>,
    #[serde(default)]
    pub repo_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PidRecord {
    pub pid: u32,
    pub origin: String,
    pub api_entry: String,
    pub started_at_epoch_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRuntime {
    pub api_entry: PathBuf,
    pub node_bin: PathBuf,
    pub working_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnsureOutcome {
    AlreadyRunning,
    Started { pid: u32, log_path: PathBuf },
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopOutcome {
    Stopped { pid: u32 },
    NotRunning { cleaned_stale_pid: bool },
    UnmanagedRunning,
}

#[derive(Debug, Clone)]
pub struct ApiStatus {
    pub origin: String,
    pub healthy: bool,
    pub managed_pid: Option<u32>,
    pub managed_pid_alive: bool,
    pub api_entry: Option<PathBuf>,
    pub log_path: PathBuf,
}

/// Resolve the OpenFrost home directory (`OPENFROST_HOME` or `%USERPROFILE%\.openfrost`).
pub fn resolve_home_dir() -> Result<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENFROST_HOME") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let user_home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| {
            anyhow!(
                "Could not determine home directory (USERPROFILE/HOME unset); set OPENFROST_HOME"
            )
        })?;
    Ok(PathBuf::from(user_home).join(".openfrost"))
}

pub fn runtime_config_path(home: &Path) -> PathBuf {
    home.join("runtime.json")
}

pub fn pid_file_path(home: &Path) -> PathBuf {
    home.join("api.pid")
}

pub fn log_file_path(home: &Path) -> PathBuf {
    home.join("logs").join("api.log")
}

/// Returns `(is_loopback, explicit_or_default_port)` for a valid HTTP(S) origin.
pub fn parse_origin(base_url: &str) -> Result<(bool, u16)> {
    let parsed = url::Url::parse(base_url).context("Invalid API origin URL")?;
    anyhow::ensure!(
        matches!(parsed.scheme(), "http" | "https"),
        "API origin must use http or https"
    );
    let is_loopback = match parsed.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    let port = parsed.port().unwrap_or(DEFAULT_API_PORT);
    Ok((is_loopback, port))
}

/// Resolve the Node.js binary and compiled `apps/api/dist/main.js` entrypoint.
pub fn resolve_runtime(home: &Path) -> Result<ResolvedRuntime> {
    let env_entry = non_empty_env("OPENFROST_API_ENTRY").map(PathBuf::from);
    let env_node = non_empty_env("OPENFROST_NODE_BIN").map(PathBuf::from);
    let cwd = std::env::current_dir().ok();
    let exe = std::env::current_exe().ok();
    resolve_runtime_from(
        env_entry.as_deref(),
        env_node.as_deref(),
        home,
        cwd.as_deref(),
        exe.as_deref(),
    )
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_runtime_from(
    env_entry: Option<&Path>,
    env_node: Option<&Path>,
    home: &Path,
    cwd: Option<&Path>,
    exe_path: Option<&Path>,
) -> Result<ResolvedRuntime> {
    let config = read_runtime_config(home);

    let api_entry = if let Some(explicit) = env_entry {
        if !explicit.is_file() {
            bail!(
                "OPENFROST_API_ENTRY points to a missing file: {}",
                explicit.display()
            );
        }
        explicit.to_path_buf()
    } else if let Some(entry) = config
        .as_ref()
        .map(|cfg| PathBuf::from(&cfg.api_entry))
        .filter(|path| path.is_file())
    {
        entry
    } else if let Some(entry) = discover_api_entry(cwd, exe_path) {
        entry
    } else {
        let stale_hint = config
            .as_ref()
            .map(|cfg| format!(" (runtime.json points to missing path: {})", cfg.api_entry))
            .unwrap_or_default();
        bail!(
            "Could not find the OpenFrost API build (apps/api/dist/main.js){stale_hint}. \
             Run .\\scripts\\install.ps1 (or `pnpm build`) from the OpenFrost repo, or set OPENFROST_API_ENTRY."
        );
    };

    let node_bin = if let Some(explicit_node) = env_node {
        explicit_node.to_path_buf()
    } else if let Some(configured_node) = config
        .as_ref()
        .and_then(|cfg| cfg.node_path.as_deref())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        configured_node
    } else {
        PathBuf::from("node")
    };

    let working_dir = infer_api_working_dir(&api_entry);

    Ok(ResolvedRuntime {
        api_entry,
        node_bin,
        working_dir,
    })
}

pub(crate) fn read_runtime_config(home: &Path) -> Option<RuntimeConfig> {
    let path = runtime_config_path(home);
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim_start_matches('\u{feff}');
    serde_json::from_str::<RuntimeConfig>(trimmed).ok()
}

fn discover_api_entry(cwd: Option<&Path>, exe_path: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = cwd {
        candidates.push(dir.join("apps").join("api").join("dist").join("main.js"));
        // Also support running from inside `apps/tui` or `apps/api`.
        for ancestor in dir.ancestors().skip(1).take(3) {
            candidates.push(
                ancestor
                    .join("apps")
                    .join("api")
                    .join("dist")
                    .join("main.js"),
            );
        }
    }
    if let Some(exe) = exe_path {
        if let Some(exe_dir) = exe.parent() {
            // Packaged side-by-side runtime layout for future standalone releases.
            candidates.push(
                exe_dir
                    .join("runtime")
                    .join("api")
                    .join("dist")
                    .join("main.js"),
            );
            for ancestor in exe_dir.ancestors().take(6) {
                candidates.push(
                    ancestor
                        .join("apps")
                        .join("api")
                        .join("dist")
                        .join("main.js"),
                );
            }
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn infer_api_working_dir(api_entry: &Path) -> Option<PathBuf> {
    let parent = api_entry.parent()?;
    if parent
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("dist"))
    {
        return parent.parent().map(Path::to_path_buf);
    }
    Some(parent.to_path_buf())
}

fn build_probe_client() -> Result<Client> {
    Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_millis(1000))
        .build()
        .context("Failed to create health probe client")
}

/// Fast loopback `/health` probe (`GET <base_url>/health` -> `{"ok": true}`).
pub async fn probe_health(base_url: &str) -> bool {
    let Ok(client) = build_probe_client() else {
        return false;
    };
    probe_health_with_client(&client, base_url).await
}

async fn probe_health_with_client(client: &Client, base_url: &str) -> bool {
    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let Ok(response) = client.get(&url).send().await else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(text) = response.text().await else {
        return false;
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get("ok").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// Ensure the local API is reachable, starting it in the background if needed.
pub async fn ensure_api_running(
    base_url: &str,
    home: &Path,
    no_spawn: bool,
) -> Result<EnsureOutcome> {
    let (is_loopback, port) = parse_origin(base_url)?;
    let client = build_probe_client()?;

    if probe_health_with_client(&client, base_url).await {
        return Ok(EnsureOutcome::AlreadyRunning);
    }
    if no_spawn || !is_loopback {
        return Ok(EnsureOutcome::Skipped);
    }

    let runtime = resolve_runtime(home)?;
    let log_path = prepare_log_file(home)?;
    let log_stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("Failed to open API log file at {}", log_path.display()))?;
    let log_stderr = log_stdout
        .try_clone()
        .context("Failed to clone API log file handle")?;

    let mut command = Command::new(&runtime.node_bin);
    command
        .arg(&runtime.api_entry)
        .env("OPENFROST_API_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_stdout))
        .stderr(Stdio::from(log_stderr));

    if let Some(work_dir) = &runtime.working_dir {
        command.current_dir(work_dir);
    }
    if non_empty_env("OPENFROST_HOME").is_none() {
        command.env("OPENFROST_HOME", home);
    }

    #[cfg(windows)]
    {
        command.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().with_context(|| {
        format!(
            "Failed to launch OpenFrost API (`{} {}`). Verify Node.js is installed.",
            runtime.node_bin.display(),
            runtime.api_entry.display()
        )
    })?;

    let pid = child.id();
    let record = PidRecord {
        pid,
        origin: base_url.trim_end_matches('/').to_string(),
        api_entry: runtime.api_entry.display().to_string(),
        started_at_epoch_secs: now_epoch_secs(),
    };
    write_pid_record(home, &record)?;

    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .context("Failed while waiting for API process")?
        {
            remove_pid_record(home);
            let excerpt = read_log_tail(&log_path, 15)
                .ok()
                .flatten()
                .unwrap_or_default();
            if excerpt.trim().is_empty() {
                bail!(
                    "OpenFrost API exited immediately with {status}. See logs at {}",
                    log_path.display()
                );
            }
            bail!(
                "OpenFrost API exited immediately with {status}.\nRecent logs ({}):\n{excerpt}",
                log_path.display()
            );
        }
        if probe_health_with_client(&client, base_url).await {
            return Ok(EnsureOutcome::Started { pid, log_path });
        }
        tokio::time::sleep(STARTUP_POLL_INTERVAL).await;
    }

    let excerpt = read_log_tail(&log_path, 15)
        .ok()
        .flatten()
        .unwrap_or_default();
    if excerpt.trim().is_empty() {
        bail!(
            "Timed out waiting for OpenFrost API at {base_url} (PID {pid}). See logs at {}",
            log_path.display()
        );
    }
    bail!(
        "Timed out waiting for OpenFrost API at {base_url} (PID {pid}).\nRecent logs ({}):\n{excerpt}",
        log_path.display()
    );
}

/// Stop the managed background API recorded in `api.pid`.
pub async fn stop_api(base_url: &str, home: &Path) -> Result<StopOutcome> {
    let client = build_probe_client()?;
    let record = read_pid_record(home);

    let Some(record) = record else {
        if probe_health_with_client(&client, base_url).await {
            return Ok(StopOutcome::UnmanagedRunning);
        }
        return Ok(StopOutcome::NotRunning {
            cleaned_stale_pid: false,
        });
    };

    if !is_managed_node_process(record.pid) {
        remove_pid_record(home);
        if probe_health_with_client(&client, base_url).await {
            return Ok(StopOutcome::UnmanagedRunning);
        }
        return Ok(StopOutcome::NotRunning {
            cleaned_stale_pid: true,
        });
    }

    terminate_process(record.pid)?;

    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    while Instant::now() < deadline {
        if !probe_health_with_client(&client, base_url).await {
            break;
        }
        tokio::time::sleep(SHUTDOWN_POLL_INTERVAL).await;
    }

    remove_pid_record(home);
    Ok(StopOutcome::Stopped { pid: record.pid })
}

/// Inspect live health, managed PID, resolved runtime, and log path.
pub async fn inspect_status(base_url: &str, home: &Path) -> ApiStatus {
    let healthy = probe_health(base_url).await;
    let record = read_pid_record(home);
    let managed_pid = record.as_ref().map(|r| r.pid);
    let managed_pid_alive = managed_pid.is_some_and(is_managed_node_process);
    let api_entry = resolve_runtime(home).ok().map(|rt| rt.api_entry);
    ApiStatus {
        origin: base_url.trim_end_matches('/').to_string(),
        healthy,
        managed_pid,
        managed_pid_alive,
        api_entry,
        log_path: log_file_path(home),
    }
}

fn prepare_log_file(home: &Path) -> Result<PathBuf> {
    let log_path = log_file_path(home);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create log directory {}", parent.display()))?;
    }
    rotate_log_if_large(&log_path, MAX_LOG_BYTES);
    Ok(log_path)
}

fn rotate_log_if_large(log_path: &Path, max_bytes: u64) {
    let Ok(meta) = fs::metadata(log_path) else {
        return;
    };
    if meta.len() < max_bytes {
        return;
    }
    let backup = log_path.with_extension("log.1");
    let _ = fs::remove_file(&backup);
    let _ = fs::rename(log_path, backup);
}

pub fn read_log_tail(path: &Path, max_lines: usize) -> Result<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes =
        fs::read(path).with_context(|| format!("Failed to read log file {}", path.display()))?;
    let content = String::from_utf8_lossy(&bytes);
    let all_lines: Vec<&str> = content.lines().collect();
    let start = all_lines.len().saturating_sub(max_lines);
    Ok(Some(all_lines[start..].join("\n")))
}

fn write_pid_record(home: &Path, record: &PidRecord) -> Result<()> {
    fs::create_dir_all(home)
        .with_context(|| format!("Failed to create OpenFrost home {}", home.display()))?;
    let path = pid_file_path(home);
    let body = serde_json::to_string_pretty(record).context("Failed to serialize PID record")?;
    fs::write(&path, body)
        .with_context(|| format!("Failed to write PID file {}", path.display()))?;
    Ok(())
}

fn read_pid_record(home: &Path) -> Option<PidRecord> {
    let raw = fs::read_to_string(pid_file_path(home)).ok()?;
    serde_json::from_str::<PidRecord>(&raw).ok()
}

fn remove_pid_record(home: &Path) {
    let _ = fs::remove_file(pid_file_path(home));
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Verify the PID exists and belongs to a Node.js process so OS PID reuse
/// cannot cause `openfrost stop` to terminate an unrelated program.
#[cfg(windows)]
fn is_managed_node_process(pid: u32) -> bool {
    let mut cmd = Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW);
    let Ok(output) = cmd.output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    tasklist_csv_matches_node_pid(&stdout, pid)
}

#[cfg(not(windows))]
fn is_managed_node_process(pid: u32) -> bool {
    let Ok(output) = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let comm = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    comm.contains("node")
}

#[cfg(windows)]
fn terminate_process(pid: u32) -> Result<()> {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().context("Failed to invoke taskkill")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "Could not stop OpenFrost API (PID {pid}): {} {}",
            stdout.trim(),
            stderr.trim()
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn terminate_process(pid: u32) -> Result<()> {
    let status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .context("Failed to invoke kill")?;
    if !status.success() {
        bail!("Could not stop OpenFrost API (PID {pid})");
    }
    Ok(())
}

/// Parse `tasklist /FO CSV /NH` output and verify both image name (`node*`) and PID match.
#[cfg_attr(not(windows), allow(dead_code))]
fn tasklist_csv_matches_node_pid(stdout: &str, expected_pid: u32) -> bool {
    let expected_pid_str = expected_pid.to_string();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('"') {
            continue;
        }
        let mut fields = trimmed.split("\",\"").map(|f| f.trim_matches('"'));
        let Some(image) = fields.next() else {
            continue;
        };
        let Some(pid_field) = fields.next() else {
            continue;
        };
        if pid_field == expected_pid_str && image.to_ascii_lowercase().contains("node") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::MockServer;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(label: &str) -> PathBuf {
        let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "openfrost_tui_runtime_{label}_{}_{}",
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn url_with(scheme: &str, host_port: &str) -> String {
        format!("{scheme}://{host_port}")
    }

    #[test]
    fn parse_origin_identifies_loopback_and_ports() {
        assert_eq!(
            parse_origin(&url_with("http", "127.0.0.1:8787")).unwrap(),
            (true, 8787)
        );
        assert_eq!(
            parse_origin(&url_with("http", "localhost:9001")).unwrap(),
            (true, 9001)
        );
        assert_eq!(
            parse_origin(&url_with("http", "[::1]:8787")).unwrap(),
            (true, 8787)
        );
        assert_eq!(
            parse_origin(&url_with("https", "example.com:8443")).unwrap(),
            (false, 8443)
        );
        assert!(parse_origin("ftp://127.0.0.1:8787").is_err());
    }

    #[test]
    fn resolve_runtime_prefers_env_then_runtime_json_then_repo_discovery() {
        let root = temp_dir("resolve");
        let home = root.join("home");
        let repo = root.join("repo");
        let repo_entry = repo.join("apps").join("api").join("dist").join("main.js");
        fs::create_dir_all(repo_entry.parent().unwrap()).unwrap();
        fs::write(&repo_entry, "// repo").unwrap();

        let configured_entry = root.join("configured").join("dist").join("main.js");
        fs::create_dir_all(configured_entry.parent().unwrap()).unwrap();
        fs::write(&configured_entry, "// cfg").unwrap();

        let env_entry = root.join("env").join("dist").join("main.js");
        fs::create_dir_all(env_entry.parent().unwrap()).unwrap();
        fs::write(&env_entry, "// env").unwrap();

        // 1. Repo discovery works even without runtime.json.
        let discovered =
            resolve_runtime_from(None, None, &home, Some(&repo), None).expect("repo discovery");
        assert_eq!(discovered.api_entry, repo_entry);
        assert_eq!(discovered.node_bin, PathBuf::from("node"));
        assert_eq!(discovered.working_dir, Some(repo.join("apps").join("api")));

        // 2. runtime.json takes precedence over repo discovery.
        fs::create_dir_all(&home).unwrap();
        let cfg = RuntimeConfig {
            api_entry: configured_entry.display().to_string(),
            node_path: None,
            repo_root: Some(repo.display().to_string()),
        };
        fs::write(
            runtime_config_path(&home),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();
        let from_cfg =
            resolve_runtime_from(None, None, &home, Some(&repo), None).expect("runtime.json");
        assert_eq!(from_cfg.api_entry, configured_entry);

        // 3. Explicit OPENFROST_API_ENTRY wins over runtime.json.
        let from_env = resolve_runtime_from(
            Some(&env_entry),
            Some(Path::new("custom-node")),
            &home,
            Some(&repo),
            None,
        )
        .expect("env override");
        assert_eq!(from_env.api_entry, env_entry);
        assert_eq!(from_env.node_bin, PathBuf::from("custom-node"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_runtime_errors_cleanly_when_missing() {
        let root = temp_dir("missing");
        let err = resolve_runtime_from(None, None, &root.join("home"), Some(&root), None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("install.ps1"), "got: {err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pid_record_round_trips_and_cleans_up() {
        let home = temp_dir("pid");
        let rec = PidRecord {
            pid: 4242,
            origin: url_with("http", "127.0.0.1:8787"),
            api_entry: "C:\\openfrost\\apps\\api\\dist\\main.js".into(),
            started_at_epoch_secs: 1_760_000_000,
        };
        write_pid_record(&home, &rec).unwrap();
        assert_eq!(read_pid_record(&home), Some(rec));
        remove_pid_record(&home);
        assert_eq!(read_pid_record(&home), None);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn log_tail_and_rotation_work() {
        let home = temp_dir("logs");
        let path = log_file_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "line1\nline2\nline3\nline4\n").unwrap();

        assert_eq!(
            read_log_tail(&path, 2).unwrap().as_deref(),
            Some("line3\nline4")
        );
        assert_eq!(
            read_log_tail(&path, 10).unwrap().as_deref(),
            Some("line1\nline2\nline3\nline4")
        );

        rotate_log_if_large(&path, 5);
        assert!(!path.exists());
        assert!(path.with_extension("log.1").is_file());

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn tasklist_csv_parser_verifies_node_image_and_pid() {
        let matching = "\"node.exe\",\"12345\",\"Console\",\"1\",\"42,000 K\"\r\n";
        assert!(tasklist_csv_matches_node_pid(matching, 12345));
        assert!(!tasklist_csv_matches_node_pid(matching, 99999));

        let reused_pid = "\"chrome.exe\",\"12345\",\"Console\",\"1\",\"120,000 K\"\r\n";
        assert!(!tasklist_csv_matches_node_pid(reused_pid, 12345));

        let none = "INFO: No tasks are running which match the specified criteria.\r\n";
        assert!(!tasklist_csv_matches_node_pid(none, 12345));
    }

    #[tokio::test]
    async fn ensure_api_running_detects_already_running_server() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(httpmock::Method::GET).path("/health");
            then.status(200).body(r#"{ "ok": true }"#);
        });
        let home = temp_dir("healthy");
        let outcome = ensure_api_running(&server.base_url(), &home, false)
            .await
            .unwrap();
        assert_eq!(outcome, EnsureOutcome::AlreadyRunning);
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn ensure_api_running_respects_no_spawn_flag() {
        let home = temp_dir("nospawn");
        // Port 1 on loopback refuses connections immediately; --no-spawn skips launch.
        let outcome = ensure_api_running(&url_with("http", "127.0.0.1:1"), &home, true)
            .await
            .unwrap();
        assert_eq!(outcome, EnsureOutcome::Skipped);
        let _ = fs::remove_dir_all(&home);
    }
}
