//! OpenFrost Control Center TUI (S09). A thin client of the local loopback
//! API: session auth, task workflows, approvals, projects, memory, routines,
//! and settings. Closing the TUI never stops the runtime.

mod api;
mod app;
mod apply;
mod cli;
mod contracts;
mod dialog_forms;
mod event;
mod markdown;
mod refresh;
mod runtime;
mod ui;
mod update;

#[cfg(test)]
mod api_tests;

use std::io::{self, Stdout};
use std::process::ExitCode;

use anyhow::{Context, Result};
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use tokio::sync::mpsc;

use api::ApiClient;
use app::App;
use cli::CliCommand;
use event::{forward_input, forward_ticks, subscribe_events, AppEvent, AppRx, AppTx, Payload};
use runtime::{EnsureOutcome, StopOutcome};

const DEFAULT_API_ORIGIN: &str = "http://127.0.0.1:8787";

#[tokio::main]
async fn main() -> ExitCode {
    let command = match cli::parse_args(std::env::args().skip(1)) {
        Ok(cmd) => cmd,
        Err(error) => {
            eprintln!("openfrost: {error}");
            eprintln!("Run `openfrost --help` for usage.");
            return ExitCode::from(2);
        }
    };

    match command {
        CliCommand::Help => {
            print!("{}", cli::help_text());
            ExitCode::SUCCESS
        }
        CliCommand::Version => {
            println!("{}", cli::version_text());
            ExitCode::SUCCESS
        }
        CliCommand::Logs { lines } => match run_logs(lines) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("openfrost logs failed: {error:#}");
                ExitCode::from(1)
            }
        },
        CliCommand::Status { api_origin } => match run_status(api_origin).await {
            Ok(healthy) => {
                if healthy {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(1)
                }
            }
            Err(error) => {
                eprintln!("openfrost status failed: {error:#}");
                ExitCode::from(1)
            }
        },
        CliCommand::Start { api_origin } => match run_start(api_origin).await {
            Ok(code) => code,
            Err(error) => {
                eprintln!("openfrost start failed: {error:#}");
                ExitCode::from(1)
            }
        },
        CliCommand::Stop { api_origin } => match run_stop(api_origin).await {
            Ok(code) => code,
            Err(error) => {
                eprintln!("openfrost stop failed: {error:#}");
                ExitCode::from(1)
            }
        },
        CliCommand::Update { api_origin, check } => {
            let result = if check {
                update::run_check().map(|_| ())
            } else {
                update::run_update(&resolve_api_origin(api_origin)).await
            };
            match result {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("openfrost update failed: {error:#}");
                    ExitCode::from(1)
                }
            }
        }
        CliCommand::Tui {
            api_origin,
            no_spawn,
        } => {
            if let Err(error) = run_tui(api_origin, no_spawn).await {
                let _ = restore_terminal();
                eprintln!("OpenFrost TUI failed: {error:#}");
                return ExitCode::from(1);
            }
            ExitCode::SUCCESS
        }
    }
}

fn resolve_api_origin(override_origin: Option<String>) -> String {
    override_origin
        .or_else(|| {
            std::env::var("OPENFROST_API_ORIGIN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| DEFAULT_API_ORIGIN.to_string())
}

fn run_logs(lines: usize) -> Result<()> {
    let home = runtime::resolve_home_dir()?;
    let log_path = runtime::log_file_path(&home);
    match runtime::read_log_tail(&log_path, lines)? {
        Some(content) if !content.is_empty() => println!("{content}"),
        Some(_) => println!("API log file is empty ({}).", log_path.display()),
        None => println!("No API logs found at {}.", log_path.display()),
    }
    Ok(())
}

async fn run_status(api_origin: Option<String>) -> Result<bool> {
    let origin = resolve_api_origin(api_origin);
    let home = runtime::resolve_home_dir()?;
    let status = runtime::inspect_status(&origin, &home).await;
    let state = if status.healthy { "running" } else { "stopped" };
    println!("OpenFrost API: {state} ({})", status.origin);
    match (status.managed_pid, status.managed_pid_alive) {
        (Some(pid), true) => println!("Managed PID:   {pid}"),
        (Some(pid), false) => println!("Managed PID:   {pid} (stale)"),
        (None, _) => println!("Managed PID:   none"),
    }
    if let Some(entry) = status.api_entry {
        println!("API entry:     {}", entry.display());
    } else {
        println!("API entry:     not found (run .\\scripts\\install.ps1 or `pnpm build`)");
    }
    println!("Logs:          {}", status.log_path.display());
    Ok(status.healthy)
}

async fn run_start(api_origin: Option<String>) -> Result<ExitCode> {
    let origin = resolve_api_origin(api_origin);
    let home = runtime::resolve_home_dir()?;
    match runtime::ensure_api_running(&origin, &home, false).await? {
        EnsureOutcome::AlreadyRunning => {
            println!("OpenFrost API is already running at {origin}.");
            Ok(ExitCode::SUCCESS)
        }
        EnsureOutcome::Started { pid, log_path } => {
            println!("Started OpenFrost API at {origin} (PID {pid}).");
            println!("Logs: {}", log_path.display());
            Ok(ExitCode::SUCCESS)
        }
        EnsureOutcome::Skipped => {
            eprintln!("Cannot auto-start a non-loopback API origin: {origin}");
            Ok(ExitCode::from(1))
        }
    }
}

async fn run_stop(api_origin: Option<String>) -> Result<ExitCode> {
    let origin = resolve_api_origin(api_origin);
    let home = runtime::resolve_home_dir()?;
    match runtime::stop_api(&origin, &home).await? {
        StopOutcome::Stopped { pid } => {
            println!("Stopped OpenFrost API (PID {pid}).");
            Ok(ExitCode::SUCCESS)
        }
        StopOutcome::NotRunning { cleaned_stale_pid } => {
            if cleaned_stale_pid {
                println!("OpenFrost API is not running (cleaned up stale PID file).");
            } else {
                println!("OpenFrost API is not running.");
            }
            Ok(ExitCode::SUCCESS)
        }
        StopOutcome::UnmanagedRunning => {
            eprintln!(
                "OpenFrost API is running at {origin}, but was not started by `openfrost` \
                 (no active managed PID). Stop it where it was launched."
            );
            Ok(ExitCode::from(1))
        }
    }
}

fn restore_terminal() -> Result<()> {
    disable_raw_mode()?;
    io::stdout().execute(LeaveAlternateScreen)?;
    let _ = io::stdout().execute(DisableMouseCapture);
    Ok(())
}

fn setup_terminal() -> Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    stdout.execute(EnterAlternateScreen)?;
    stdout.execute(EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    Ok(Terminal::new(backend)?)
}

async fn run_tui(api_origin: Option<String>, no_spawn: bool) -> Result<()> {
    let base_url = resolve_api_origin(api_origin);
    if !no_spawn {
        let home = runtime::resolve_home_dir()?;
        if !runtime::probe_health(&base_url).await {
            let (is_loopback, _) = runtime::parse_origin(&base_url)?;
            if is_loopback {
                eprintln!("Starting local OpenFrost API...");
            }
            runtime::ensure_api_running(&base_url, &home, false).await?;
        }
    }
    // `ApiClient` is a cheap clone (shared connection pool, cookie jar, and
    // CSRF token); no lock is held across any HTTP round-trip.
    let api = ApiClient::new(&base_url).context("Invalid API origin")?;
    let stream_http = api.stream_http();

    let (tx, mut rx): (AppTx, AppRx) = mpsc::unbounded_channel();
    let mut app = App::new(tx.clone(), api.clone());

    // Initial session check decides login vs onboarding vs main.
    {
        let api = api.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            let result = api.session().await.map_err(|error| error.message());
            let _ = tx.send(AppEvent::Api(Box::new(Payload::Session(result))));
        });
    }

    // Terminal input, periodic ticks, and the SSE activity stream. Signing in
    // or finishing onboarding notifies `sse_wake` so the stream reconnects
    // immediately instead of waiting out its backoff.
    tokio::spawn(forward_input(tx.clone()));
    tokio::spawn(forward_ticks(tx.clone(), 80));
    tokio::spawn(subscribe_events(
        base_url,
        stream_http,
        tx.clone(),
        app.sse_wake.clone(),
    ));

    let mut terminal = setup_terminal()?;

    let result = event_loop(&mut terminal, &mut app, &mut rx).await;
    restore_terminal()?;
    result
}

async fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    app: &mut App,
    rx: &mut AppRx,
) -> Result<()> {
    while !app.quit {
        // Block until something happens; every state change arrives here.
        if let Some(event) = rx.recv().await {
            handle_event(app, event);
        }
        while let Ok(event) = rx.try_recv() {
            handle_event(app, event);
        }
        // Refreshes are push-driven: debounced SSE activity, with a polling
        // fallback that only runs while the SSE stream is disconnected.
        app.pump_sync();
        terminal.draw(|frame| ui::render(app, frame))?;
    }
    Ok(())
}

fn handle_event(app: &mut App, event: AppEvent) {
    match event {
        AppEvent::Key(key) => app.on_key(key),
        AppEvent::Mouse(mouse) => app.on_mouse(mouse),
        AppEvent::Resize => {}
        AppEvent::Api(payload) => apply::apply_payload(app, *payload),
        AppEvent::Activity => app.on_activity(),
        AppEvent::SseConnection(connected) => app.on_sse_connection(connected),
        AppEvent::RefreshDone(tab) => app.on_refresh_done(tab),
        AppEvent::Tick => {
            app.ticks = app.ticks.wrapping_add(1);
            if let Some(notice) = &mut app.notice {
                notice.ticks_left = notice.ticks_left.saturating_sub(1);
                if notice.ticks_left == 0 {
                    app.notice = None;
                }
            }
        }
    }
}
