//! OpenFrost Control Center TUI (S09). A thin client of the local loopback
//! API: session auth, task workflows, approvals, projects, memory, routines,
//! and settings. Closing the TUI never stops the runtime.

mod api;
mod app;
mod apply;
mod contracts;
mod dialog_forms;
mod event;
mod markdown;
mod refresh;
mod ui;

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
use event::{forward_input, forward_ticks, subscribe_events, AppEvent, AppRx, AppTx, Payload};

const DEFAULT_API_ORIGIN: &str = "http://127.0.0.1:8787";

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(error) = run().await {
        let _ = restore_terminal();
        eprintln!("OpenFrost TUI failed: {error:#}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
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

async fn run() -> Result<()> {
    let base_url =
        std::env::var("OPENFROST_API_ORIGIN").unwrap_or_else(|_| DEFAULT_API_ORIGIN.to_string());
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
