//! Event plumbing: terminal input and background results arrive on one
//! channel; the main loop consumes it and drives app state.

use std::sync::Arc;
use std::time::Duration;

use crossterm::event::{Event as CEvent, EventStream, KeyEvent, KeyEventKind, MouseEvent};
use futures::StreamExt;
use reqwest_eventsource::{Event as EsEvent, EventSource};
use tokio::sync::{mpsc, Notify};

use crate::app::Tab;

/// Everything that can change app state, delivered from background tasks.
#[derive(Debug)]
pub enum AppEvent {
    Key(KeyEvent),
    /// Mouse events (wheel scrolling, clicks).
    Mouse(MouseEvent),
    /// Terminal resize; ratatui picks up the new size on the next draw.
    Resize,
    Api(Box<Payload>),
    /// SSE `activity` ping; bursts are debounced into one refresh of the
    /// visible tab.
    Activity,
    /// The SSE stream opened (`true`) or dropped/failed (`false`). While it is
    /// connected the app does not poll.
    SseConnection(bool),
    /// A tab refresh finished (every payload it produced has been sent).
    RefreshDone(Tab),
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
        tasks: Result<crate::contracts::TasksResponse, String>,
        latest_task: Option<crate::contracts::TaskDetail>,
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
            Ok(CEvent::Mouse(mouse)) => tx.send(AppEvent::Mouse(mouse)).is_ok(),
            Ok(CEvent::Resize(..)) => tx.send(AppEvent::Resize).is_ok(),
            Ok(CEvent::FocusGained | CEvent::FocusLost | CEvent::Paste(_)) => true,
            Err(_) => false,
        };
        if !handled {
            break;
        }
    }
}

/// Periodic tick for elapsed timers, the activity debounce, and the polling
/// fallback.
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

/// Run a tab refresh: deliver every payload it produces, then report the
/// refresh as done so the app can release the tab's in-flight slot.
pub fn spawn_refresh<F>(tx: &AppTx, tab: Tab, future: F)
where
    F: std::future::Future<Output = Vec<Payload>> + Send + 'static,
{
    let tx = tx.clone();
    tokio::spawn(async move {
        for payload in future.await {
            let _ = tx.send(AppEvent::Api(Box::new(payload)));
        }
        let _ = tx.send(AppEvent::RefreshDone(tab));
    });
}

// ---------------------------------------------------------------------------
// SSE subscription
// ---------------------------------------------------------------------------

pub const SSE_INITIAL_BACKOFF_MS: u64 = 1_000;
pub const SSE_MAX_BACKOFF_MS: u64 = 30_000;

/// Exponential reconnect delay: 1 s, 2 s, 4 s ... capped at 30 s.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backoff {
    next_ms: u64,
}

impl Backoff {
    pub fn new() -> Self {
        Self {
            next_ms: SSE_INITIAL_BACKOFF_MS,
        }
    }

    pub fn reset(&mut self) {
        self.next_ms = SSE_INITIAL_BACKOFF_MS;
    }

    /// The delay to wait now; the following one doubles.
    pub fn next_delay(&mut self) -> Duration {
        let delay = Duration::from_millis(self.next_ms);
        self.next_ms = (self.next_ms * 2).min(SSE_MAX_BACKOFF_MS);
        delay
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryWake {
    /// The full backoff delay elapsed.
    Elapsed,
    /// `wake` fired (login, onboarding): retry now.
    Woken,
}

/// Sleep out a reconnect delay, or return early when `wake` fires.
pub async fn wait_before_retry(delay: Duration, wake: &Notify) -> RetryWake {
    tokio::select! {
        _ = tokio::time::sleep(delay) => RetryWake::Elapsed,
        _ = wake.notified() => RetryWake::Woken,
    }
}

/// SSE subscription to the API activity stream. The stream needs an owner
/// session, so it fails until the owner signs in; `wake` is notified on login
/// or onboarding so it reconnects at once instead of waiting out the
/// (up to 30 s) exponential backoff, and also replaces a stream that was
/// opened under a previous session. Connection state is reported as
/// `AppEvent::SseConnection`; the app polls only while it is `false`.
pub async fn subscribe_events(
    base_url: String,
    http: reqwest::Client,
    tx: AppTx,
    wake: Arc<Notify>,
) {
    let url = format!("{base_url}/api/events/stream");
    let mut backoff = Backoff::new();
    loop {
        let mut woken = false;
        if let Ok(mut es) = EventSource::new(http.get(&url)) {
            loop {
                tokio::select! {
                    _ = wake.notified() => {
                        woken = true;
                        break;
                    }
                    next = es.next() => match next {
                        Some(Ok(EsEvent::Open)) => {
                            backoff.reset();
                            if tx.send(AppEvent::SseConnection(true)).is_err() {
                                return;
                            }
                        }
                        Some(Ok(EsEvent::Message(message))) => {
                            if message.event == "activity"
                                && tx.send(AppEvent::Activity).is_err()
                            {
                                return;
                            }
                        }
                        // Error (e.g. 401 before login) or the server ended
                        // the stream: back off and reconnect.
                        Some(Err(_)) | None => break,
                    }
                }
            }
            es.close();
        }
        if tx.send(AppEvent::SseConnection(false)).is_err() {
            return;
        }
        if woken {
            backoff.reset();
            continue;
        }
        if wait_before_retry(backoff.next_delay(), &wake).await == RetryWake::Woken {
            backoff.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::MockServer;

    #[test]
    fn backoff_doubles_up_to_the_cap_and_resets() {
        let mut backoff = Backoff::new();
        let secs: Vec<u64> = (0..8).map(|_| backoff.next_delay().as_secs()).collect();
        assert_eq!(secs, vec![1, 2, 4, 8, 16, 30, 30, 30]);
        backoff.reset();
        assert_eq!(backoff.next_delay(), Duration::from_secs(1));
    }

    #[tokio::test(start_paused = true)]
    async fn full_delay_elapses_without_a_wake() {
        let wake = Notify::new();
        let outcome = wait_before_retry(Duration::from_secs(30), &wake).await;
        assert_eq!(outcome, RetryWake::Elapsed);
    }

    #[tokio::test(start_paused = true)]
    async fn wake_cuts_a_long_backoff_short() {
        let wake = Arc::new(Notify::new());
        let waiter = {
            let wake = wake.clone();
            tokio::spawn(async move { wait_before_retry(Duration::from_secs(30), &wake).await })
        };
        tokio::task::yield_now().await;
        let started = tokio::time::Instant::now();
        wake.notify_one();
        assert_eq!(waiter.await.unwrap(), RetryWake::Woken);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test(start_paused = true)]
    async fn a_wake_sent_just_before_the_wait_is_not_lost() {
        let wake = Notify::new();
        wake.notify_one();
        let outcome = wait_before_retry(Duration::from_secs(30), &wake).await;
        assert_eq!(outcome, RetryWake::Woken);
    }

    async fn recv(rx: &mut AppRx, within_ms: u64) -> Option<AppEvent> {
        tokio::time::timeout(Duration::from_millis(within_ms), rx.recv())
            .await
            .ok()
            .flatten()
    }

    #[tokio::test]
    async fn stream_reports_open_activity_and_disconnect() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/api/events/stream");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body("event: activity\ndata: {}\n\nevent: heartbeat\ndata: {}\n\n");
        });
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = tokio::spawn(subscribe_events(
            server.base_url(),
            reqwest::Client::new(),
            tx,
            Arc::new(Notify::new()),
        ));

        assert!(matches!(
            recv(&mut rx, 2_000).await,
            Some(AppEvent::SseConnection(true))
        ));
        // Only `activity` messages surface; the heartbeat is ignored.
        assert!(matches!(
            recv(&mut rx, 2_000).await,
            Some(AppEvent::Activity)
        ));
        assert!(matches!(
            recv(&mut rx, 2_000).await,
            Some(AppEvent::SseConnection(false))
        ));
        handle.abort();
    }

    #[tokio::test]
    async fn login_wake_reconnects_without_waiting_out_the_backoff() {
        let server = MockServer::start();
        // Before login the stream is refused.
        let mut refused = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/api/events/stream");
            then.status(401)
                .body(r#"{ "error": "Authentication required" }"#);
        });
        let (tx, mut rx) = mpsc::unbounded_channel();
        let wake = Arc::new(Notify::new());
        let handle = tokio::spawn(subscribe_events(
            server.base_url(),
            reqwest::Client::new(),
            tx,
            wake.clone(),
        ));

        // The refused attempt reports disconnected, then the loop sleeps its
        // 1 s backoff.
        assert!(matches!(
            recv(&mut rx, 2_000).await,
            Some(AppEvent::SseConnection(false))
        ));
        refused.delete();
        server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/api/events/stream");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body("event: activity\ndata: {}\n\n");
        });

        // Owner signs in: wake. Well under the 1 s backoff, it is connected.
        let woke_at = tokio::time::Instant::now();
        wake.notify_one();
        assert!(matches!(
            recv(&mut rx, 900).await,
            Some(AppEvent::SseConnection(true))
        ));
        assert!(woke_at.elapsed() < Duration::from_millis(900));
        handle.abort();
    }
}
