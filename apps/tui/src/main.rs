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
mod ui;

#[cfg(test)]
mod api_tests;

use std::io::{self, Stdout};
use std::process::ExitCode;
use std::sync::Arc;

use anyhow::{Context, Result};
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use futures::StreamExt;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use reqwest_eventsource::{Event as EsEvent, EventSource};
use tokio::sync::{mpsc, Mutex};

use api::ApiClient;
use app::App;
use contracts::TaskState;
use event::{forward_input, forward_ticks, AppEvent, AppRx, AppTx, Payload};

const DEFAULT_API_ORIGIN: &str = "http://127.0.0.1:8787";
const POLL_TICKS: u64 = 60; // ~4.8s at an 80ms tick rate

type SharedApi = Arc<Mutex<ApiClient>>;

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
    let client = ApiClient::new(&base_url).context("Invalid API origin")?;
    let http = client.http();
    let api: SharedApi = Arc::new(Mutex::new(client));

    let (tx, mut rx): (AppTx, AppRx) = mpsc::unbounded_channel();

    // Initial session check decides login vs onboarding vs main.
    {
        let api = api.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            let result = {
                let api = api.lock().await;
                api.session().await.map_err(|error| error.message())
            };
            let _ = tx.send(AppEvent::Api(Box::new(Payload::Session(result))));
        });
    }

    // Terminal input, periodic ticks, and the SSE activity stream.
    tokio::spawn(forward_input(tx.clone()));
    tokio::spawn(forward_ticks(tx.clone(), 80));
    tokio::spawn(subscribe_events(base_url.clone(), http, tx.clone()));

    let mut terminal = setup_terminal()?;
    let mut app = App::new(tx, api);

    let result = event_loop(&mut terminal, &mut app, &mut rx).await;
    restore_terminal()?;
    result
}

/// SSE subscription to the API activity stream with a polling fallback via
/// ticks; reconnects are handled by the eventsource crate.
async fn subscribe_events(base_url: String, http: reqwest::Client, tx: AppTx) {
    let url = format!("{base_url}/api/events/stream");
    let mut backoff_ms = 1000u64;
    loop {
        let request = http.get(&url);
        let mut es = match EventSource::new(request) {
            Ok(es) => es,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                continue;
            }
        };
        while let Some(event) = es.next().await {
            match event {
                Ok(EsEvent::Open) => {
                    backoff_ms = 1000;
                }
                Ok(EsEvent::Message(message)) => {
                    if message.event == "activity" && tx.send(AppEvent::Activity).is_err() {
                        return;
                    }
                }
                Err(_error) => {
                    // The stream requires an active session; retry on next loop iteration.
                    if tx.send(AppEvent::Activity).is_err() {
                        return;
                    }
                    es.close();
                    break;
                }
            }
        }
        if tx.is_closed() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms * 2).min(30_000);
    }
}

async fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    app: &mut App,
    rx: &mut AppRx,
) -> Result<()> {
    let mut last_poll_tick = 0u64;
    while !app.quit {
        // Block until something happens; every state change arrives here.
        if let Some(event) = rx.recv().await {
            handle_event(app, event);
        }
        while let Ok(event) = rx.try_recv() {
            handle_event(app, event);
        }
        // Adaptive polling: when an agent run is active or running, poll rapidly
        // (every 400ms = 2 ticks) to ensure real-time feedback; when idle, poll
        // every 5 seconds (25 ticks).
        let is_busy = app
            .assistant
            .active_task_detail
            .as_ref()
            .map(|d| d.task.state == TaskState::Running)
            .unwrap_or(false)
            || app
                .tasks
                .executor
                .as_ref()
                .map(|e| e.busy)
                .unwrap_or(false);
        let poll_interval = if is_busy { 5 } else { POLL_TICKS };

        if app.screen == app::Screen::Main
            && app.ticks.saturating_sub(last_poll_tick) >= poll_interval
        {
            last_poll_tick = app.ticks;
            app.refresh(app.tab);
        }
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
        AppEvent::Activity => {
            if app.screen == app::Screen::Main {
                app.refresh(app.tab);
            }
        }
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
