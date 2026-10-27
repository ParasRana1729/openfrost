//! Event plumbing: terminal input and background results arrive on one
//! channel; the main loop consumes it and drives app state.

use crossterm::event::{Event as CEvent, EventStream, KeyEvent, KeyEventKind};
use futures::StreamExt;
use tokio::sync::mpsc;

/// Everything that can change app state, delivered from background tasks.
#[derive(Debug)]
pub enum AppEvent {
    Key(KeyEvent),
    /// Mouse events are received but intentionally ignored; the UI is
    /// keyboard-first.
    Mouse,
    /// Terminal resize; ratatui picks up the new size on the next draw.
    Resize,
    Api(Box<Payload>),
    /// SSE `activity` ping or polling nudge; triggers a refresh of visible data.
    Activity,
    Tick,
}

/// Results from background API calls, errors pre-formatted for display.
// TaskDetail carries the full run/event/artifact payload; boxing every other
// variant to satisfy the size lint is not worth the churn.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum Payload {
    Session(Result<crate::contracts::SessionResponse, String>),
    Auth(Result<(), String>),
    Tasks(Result<crate::contracts::TasksResponse, String>),
    TaskDetail(Result<crate::contracts::TaskDetail, String>),
    Projects(Result<Vec<crate::contracts::Project>, String>),
    Memory(Result<crate::contracts::MemorySnapshot, String>),
    Routines(Result<Vec<crate::contracts::RoutineView>, String>),
    RoutineDetail(Result<crate::api::RoutineDetail, String>),
    Destinations(Result<Vec<crate::contracts::ExportDestination>, String>),
    /// Everything the Assistant tab needs in one round of requests.
    AssistantData {
        events: Result<Vec<crate::contracts::Event>, String>,
        approvals: Result<Vec<crate::contracts::ApprovalView>, String>,
        routines: Result<Vec<crate::contracts::RoutineView>, String>,
        projects: Result<Vec<crate::contracts::Project>, String>,
    },
    /// Settings plus export destinations in one round of requests.
    SettingsBundle {
        settings: Result<crate::contracts::AssistantSettings, String>,
        destinations: Result<Vec<crate::contracts::ExportDestination>, String>,
    },
    /// A completed mutation with a label for the notice line.
    Mutation {
        label: String,
        result: Result<(), String>,
    },
    LoggedOut(Result<(), String>),
}

pub type AppTx = mpsc::UnboundedSender<AppEvent>;
pub type AppRx = mpsc::UnboundedReceiver<AppEvent>;

/// Forward terminal input into the app channel.
pub async fn forward_input(tx: AppTx) {
    let mut reader = EventStream::new();
    while let Some(event) = reader.next().await {
        let handled = match event {
            Ok(CEvent::Key(key)) => {
                // Windows terminals emit Press and Release; react to Press only.
                if key.kind == KeyEventKind::Press {
                    tx.send(AppEvent::Key(key)).is_ok()
                } else {
                    true
                }
            }
            Ok(CEvent::Mouse(_)) => tx.send(AppEvent::Mouse).is_ok(),
            Ok(CEvent::Resize(..)) => tx.send(AppEvent::Resize).is_ok(),
            Ok(CEvent::FocusGained | CEvent::FocusLost | CEvent::Paste(_)) => true,
            Err(_) => false,
        };
        if !handled {
            break;
        }
    }
}

/// Periodic tick for elapsed timers and the polling fallback.
pub async fn forward_ticks(tx: AppTx, period_ms: u64) {
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(period_ms));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if tx.send(AppEvent::Tick).is_err() {
            break;
        }
    }
}

/// Run a future on the runtime and deliver its typed payload.
pub fn spawn_payload<T, F, M>(tx: &AppTx, future: F, map: M)
where
    T: Send + 'static,
    F: std::future::Future<Output = T> + Send + 'static,
    M: FnOnce(T) -> Payload + Send + 'static,
{
    let tx = tx.clone();
    tokio::spawn(async move {
        let payload = map(future.await);
        let _ = tx.send(AppEvent::Api(Box::new(payload)));
    });
}
