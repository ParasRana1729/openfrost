//! Command-line parsing for the `openfrost` binary.
//!
//! Default invocation (`openfrost`) ensures the local loopback API is running
//! and opens the Control Center TUI. Lifecycle subcommands (`start`, `stop`,
//! `status`, `logs`) manage that same local runtime without opening the TUI.

use std::fmt;

pub const DEFAULT_LOG_LINES: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Tui {
        api_origin: Option<String>,
        no_spawn: bool,
    },
    Start {
        api_origin: Option<String>,
    },
    Stop {
        api_origin: Option<String>,
    },
    Status {
        api_origin: Option<String>,
    },
    Logs {
        lines: usize,
    },
    Update {
        api_origin: Option<String>,
        check: bool,
    },
    Help,
    Version,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliError {
    pub message: String,
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

impl CliError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

pub fn help_text() -> &'static str {
    concat!(
        "OpenFrost — local AI assistant Control Center\n",
        "\n",
        "USAGE:\n",
        "  openfrost [OPTIONS] [COMMAND]\n",
        "\n",
        "COMMANDS:\n",
        "  (default)        Ensure the local API is running and launch the TUI\n",
        "  start            Start the local API in the background\n",
        "  stop             Stop the managed background API\n",
        "  status           Show local API status, PID, and paths\n",
        "  logs             Print recent local API logs\n",
        "  update           Pull the latest source, rebuild, and reinstall openfrost\n",
        "\n",
        "OPTIONS:\n",
        "  --api <URL>      Override API origin (default: OPENFROST_API_ORIGIN or 127.0.0.1:8787)\n",
        "  --no-spawn       Attach to an existing API without auto-starting one (TUI mode)\n",
        "  --check          With `update`: only report whether a newer version is available\n",
        "  -n, --lines <N>  Number of log lines to print for `logs` (default: 50)\n",
        "  -h, --help       Show this help message\n",
        "  -V, --version    Show version\n",
        "\n",
        "ENVIRONMENT:\n",
        "  OPENFROST_HOME        Override data directory (default: %USERPROFILE%\\.openfrost)\n",
        "  OPENFROST_API_ORIGIN  Override local API origin\n",
        "  OPENFROST_API_ENTRY   Override path to apps/api/dist/main.js\n",
        "  OPENFROST_NODE_BIN    Override Node.js executable path\n",
    )
}

pub fn version_text() -> String {
    format!("openfrost {}", env!("CARGO_PKG_VERSION"))
}

/// Parse CLI arguments (excluding `argv[0]`).
pub fn parse_args<I, S>(args: I) -> Result<CliCommand, CliError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let items: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();

    let mut subcommand: Option<String> = None;
    let mut api_origin: Option<String> = None;
    let mut no_spawn = false;
    let mut check = false;
    let mut lines: Option<usize> = None;

    let mut idx = 0;
    while idx < items.len() {
        let arg = items[idx].as_str();
        match arg {
            "-h" | "--help" => return Ok(CliCommand::Help),
            "-V" | "--version" => return Ok(CliCommand::Version),
            "--no-spawn" => {
                no_spawn = true;
            }
            "--check" => {
                check = true;
            }
            "--api" => {
                idx += 1;
                let value = items
                    .get(idx)
                    .ok_or_else(|| CliError::new("missing value for --api"))?;
                if value.is_empty() {
                    return Err(CliError::new("--api value cannot be empty"));
                }
                api_origin = Some(value.clone());
            }
            _ if arg.starts_with("--api=") => {
                let value = &arg["--api=".len()..];
                if value.is_empty() {
                    return Err(CliError::new("--api value cannot be empty"));
                }
                api_origin = Some(value.to_string());
            }
            "-n" | "--lines" => {
                idx += 1;
                let value = items
                    .get(idx)
                    .ok_or_else(|| CliError::new("missing value for --lines"))?;
                lines = Some(parse_line_count(value)?);
            }
            _ if arg.starts_with("--lines=") => {
                let value = &arg["--lines=".len()..];
                lines = Some(parse_line_count(value)?);
            }
            _ if arg.starts_with('-') => {
                return Err(CliError::new(format!("unknown option: {arg}")));
            }
            _ => {
                if subcommand.is_none() {
                    subcommand = Some(arg.to_string());
                } else {
                    return Err(CliError::new(format!("unexpected argument: {arg}")));
                }
            }
        }
        idx += 1;
    }

    if check && subcommand.as_deref() != Some("update") {
        return Err(CliError::new(
            "--check is only valid with `openfrost update`",
        ));
    }

    match subcommand.as_deref() {
        None | Some("tui") => {
            if lines.is_some() {
                return Err(CliError::new("--lines is only valid with `openfrost logs`"));
            }
            Ok(CliCommand::Tui {
                api_origin,
                no_spawn,
            })
        }
        Some("start") => {
            if no_spawn {
                return Err(CliError::new(
                    "--no-spawn cannot be combined with `openfrost start`",
                ));
            }
            if lines.is_some() {
                return Err(CliError::new("--lines is only valid with `openfrost logs`"));
            }
            Ok(CliCommand::Start { api_origin })
        }
        Some("stop") => {
            if no_spawn {
                return Err(CliError::new(
                    "--no-spawn is only valid when launching the TUI",
                ));
            }
            if lines.is_some() {
                return Err(CliError::new("--lines is only valid with `openfrost logs`"));
            }
            Ok(CliCommand::Stop { api_origin })
        }
        Some("status") => {
            if no_spawn {
                return Err(CliError::new(
                    "--no-spawn is only valid when launching the TUI",
                ));
            }
            if lines.is_some() {
                return Err(CliError::new("--lines is only valid with `openfrost logs`"));
            }
            Ok(CliCommand::Status { api_origin })
        }
        Some("logs") => {
            if no_spawn {
                return Err(CliError::new(
                    "--no-spawn is only valid when launching the TUI",
                ));
            }
            if api_origin.is_some() {
                return Err(CliError::new("--api is not used by `openfrost logs`"));
            }
            Ok(CliCommand::Logs {
                lines: lines.unwrap_or(DEFAULT_LOG_LINES),
            })
        }
        Some("update") => {
            if no_spawn {
                return Err(CliError::new(
                    "--no-spawn is only valid when launching the TUI",
                ));
            }
            if lines.is_some() {
                return Err(CliError::new("--lines is only valid with `openfrost logs`"));
            }
            Ok(CliCommand::Update { api_origin, check })
        }
        Some("help") => Ok(CliCommand::Help),
        Some("version") => Ok(CliCommand::Version),
        Some(other) => Err(CliError::new(format!("unknown command: {other}"))),
    }
}

fn parse_line_count(raw: &str) -> Result<usize, CliError> {
    let parsed: usize = raw
        .parse()
        .map_err(|_| CliError::new(format!("invalid line count: {raw}")))?;
    if parsed == 0 {
        return Err(CliError::new("line count must be at least 1"));
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_url(port: u16) -> String {
        format!("{}://127.0.0.1:{port}", "http")
    }

    #[test]
    fn default_invocation_opens_tui_with_autospawn() {
        assert_eq!(
            parse_args::<_, &str>([]).unwrap(),
            CliCommand::Tui {
                api_origin: None,
                no_spawn: false,
            }
        );
    }

    #[test]
    fn tui_flags_parse_both_space_and_equals_syntax() {
        let url_a = local_url(9999);
        assert_eq!(
            parse_args(["--no-spawn", "--api", &url_a]).unwrap(),
            CliCommand::Tui {
                api_origin: Some(url_a),
                no_spawn: true,
            }
        );
        let url_b = local_url(8788);
        let flag = format!("--api={url_b}");
        assert_eq!(
            parse_args(["tui", &flag]).unwrap(),
            CliCommand::Tui {
                api_origin: Some(url_b),
                no_spawn: false,
            }
        );
    }

    #[test]
    fn lifecycle_subcommands_parse() {
        assert_eq!(
            parse_args(["start"]).unwrap(),
            CliCommand::Start { api_origin: None }
        );
        let url = local_url(8787);
        assert_eq!(
            parse_args(["stop", "--api", &url]).unwrap(),
            CliCommand::Stop {
                api_origin: Some(url),
            }
        );
        assert_eq!(
            parse_args(["status"]).unwrap(),
            CliCommand::Status { api_origin: None }
        );
        assert_eq!(
            parse_args(["logs"]).unwrap(),
            CliCommand::Logs {
                lines: DEFAULT_LOG_LINES,
            }
        );
        assert_eq!(
            parse_args(["logs", "-n", "120"]).unwrap(),
            CliCommand::Logs { lines: 120 }
        );
        assert_eq!(
            parse_args(["logs", "--lines=25"]).unwrap(),
            CliCommand::Logs { lines: 25 }
        );
    }

    #[test]
    fn update_subcommand_parses_with_optional_check() {
        assert_eq!(
            parse_args(["update"]).unwrap(),
            CliCommand::Update {
                api_origin: None,
                check: false,
            }
        );
        assert_eq!(
            parse_args(["update", "--check"]).unwrap(),
            CliCommand::Update {
                api_origin: None,
                check: true,
            }
        );
        assert!(parse_args(["--check"]).is_err());
        assert!(parse_args(["status", "--check"]).is_err());
        assert!(parse_args(["update", "--no-spawn"]).is_err());
        assert!(parse_args(["update", "-n", "5"]).is_err());
    }

    #[test]
    fn help_and_version_work() {
        assert_eq!(parse_args(["--help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse_args(["-h"]).unwrap(), CliCommand::Help);
        assert_eq!(parse_args(["help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse_args(["--version"]).unwrap(), CliCommand::Version);
        assert_eq!(parse_args(["-V"]).unwrap(), CliCommand::Version);
    }

    #[test]
    fn invalid_combinations_and_flags_return_errors() {
        assert!(parse_args(["--unknown"]).is_err());
        assert!(parse_args(["bogus"]).is_err());
        assert!(parse_args(["--api"]).is_err());
        assert!(parse_args(["--api="]).is_err());
        assert!(parse_args(["start", "--no-spawn"]).is_err());
        assert!(parse_args(["logs", "--lines", "0"]).is_err());
        assert!(parse_args(["logs", "--lines", "abc"]).is_err());
        assert!(parse_args(["status", "-n", "10"]).is_err());
    }
}
