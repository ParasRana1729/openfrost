//! Refresh scheduling and the concurrent data loaders behind it.
//!
//! `SyncState` is a small, pure state machine (no I/O, no clock of its own:
//! time is the app's 80 ms tick counter) that decides *when* a tab refresh may
//! start:
//!
//! * SSE `activity` bursts are coalesced into one refresh per debounce window.
//! * While the SSE stream is connected there is no periodic polling at all;
//!   polling is only a fallback for a disconnected stream.
//! * A tab never has two refreshes in flight; a request that arrives while one
//!   is running is remembered and replayed once when it finishes, so a
//!   mutation's follow-up refresh is never lost to an older, overlapping one.
//!
//! The loaders fan independent read requests out with `tokio::join!` on a
//! shared, lock-free `ApiClient`.

use crate::api::ApiClient;
use crate::app::{Tab, ALL_TABS};
use crate::event::Payload;

/// Coalescing window for `Activity` bursts: 4 ticks x 80 ms = 320 ms.
pub const ACTIVITY_DEBOUNCE_TICKS: u64 = 4;
/// Fallback polling while SSE is disconnected and nothing is running (~4.8 s).
pub const POLL_IDLE_TICKS: u64 = 60;
/// Fallback polling while SSE is disconnected and a run is active (~1 s).
pub const POLL_BUSY_TICKS: u64 = 12;
/// A refresh that has not reported back after this long (~40 s, longer than
/// the 30 s request timeout) is treated as lost so a tab can never wedge.
pub const IN_FLIGHT_STALE_TICKS: u64 = 500;

#[derive(Debug, Default)]
pub struct SyncState {
    sse_connected: bool,
    /// Tick at which the current coalescing window opened.
    activity_since: Option<u64>,
    last_poll_tick: u64,
    in_flight: [Option<u64>; 6],
    dirty: [bool; 6],
    started: u64,
}

fn index(tab: Tab) -> usize {
    ALL_TABS.iter().position(|t| *t == tab).unwrap_or(0)
}

impl SyncState {
    #[cfg(test)]
    pub fn sse_connected(&self) -> bool {
        self.sse_connected
    }

    /// Record an SSE state report. Only a real transition matters (the
    /// stream reports `false` on every failed retry): a reconnect may have
    /// missed events and a disconnect hands over to polling, so either way
    /// one catch-up refresh is queued and the fallback poll clock restarts.
    pub fn set_sse_connected(&mut self, connected: bool, now: u64) {
        if self.sse_connected == connected {
            return;
        }
        self.sse_connected = connected;
        self.last_poll_tick = now;
        self.note_activity(now);
    }

    /// An `activity` ping arrived. The first one opens the window; the rest
    /// of the burst folds into it.
    pub fn note_activity(&mut self, now: u64) {
        if self.activity_since.is_none() {
            self.activity_since = Some(now);
        }
    }

    /// True exactly once per elapsed coalescing window. The window is anchored
    /// at its first event, so a continuous burst still refreshes every
    /// window instead of being starved.
    pub fn take_due_activity(&mut self, now: u64) -> bool {
        match self.activity_since {
            Some(start) if now.saturating_sub(start) >= ACTIVITY_DEBOUNCE_TICKS => {
                self.activity_since = None;
                true
            }
            _ => false,
        }
    }

    /// Fallback polling: never while SSE is connected.
    pub fn poll_due(&mut self, now: u64, busy: bool) -> bool {
        if self.sse_connected {
            return false;
        }
        let interval = if busy {
            POLL_BUSY_TICKS
        } else {
            POLL_IDLE_TICKS
        };
        if now.saturating_sub(self.last_poll_tick) >= interval {
            self.last_poll_tick = now;
            true
        } else {
            false
        }
    }

    /// Returns true if the caller may start a refresh of `tab`. If one is
    /// already running, remembers that another was wanted and returns false.
    pub fn begin_refresh(&mut self, tab: Tab, now: u64) -> bool {
        let i = index(tab);
        if let Some(start) = self.in_flight[i] {
            if now.saturating_sub(start) < IN_FLIGHT_STALE_TICKS {
                self.dirty[i] = true;
                return false;
            }
        }
        self.in_flight[i] = Some(now);
        self.dirty[i] = false;
        self.started += 1;
        true
    }

    /// A refresh finished. Returns true if the tab should refresh once more
    /// because a request arrived while it was running.
    pub fn finish_refresh(&mut self, tab: Tab) -> bool {
        let i = index(tab);
        self.in_flight[i] = None;
        std::mem::take(&mut self.dirty[i])
    }

    #[cfg(test)]
    pub fn is_in_flight(&self, tab: Tab) -> bool {
        self.in_flight[index(tab)].is_some()
    }

    #[cfg(test)]
    pub fn is_dirty(&self, tab: Tab) -> bool {
        self.dirty[index(tab)]
    }

    #[cfg(test)]
    pub fn refreshes_started(&self) -> u64 {
        self.started
    }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/// Everything the Assistant tab needs. The five independent reads run
/// concurrently; the latest task's detail depends on the task list, so it
/// follows, and only when the list returned a task.
pub async fn load_assistant_data(api: &ApiClient) -> Payload {
    let (events, approvals, routines, projects, tasks) = tokio::join!(
        async { api.events(15).await.map_err(|e| e.message()) },
        async { api.pending_approvals().await.map_err(|e| e.message()) },
        async { api.routines().await.map_err(|e| e.message()) },
        async { api.projects().await.map_err(|e| e.message()) },
        async { api.tasks().await.map_err(|e| e.message()) },
    );
    let latest_task = match tasks.as_ref().ok().and_then(|res| res.tasks.first()) {
        Some(task) => api.task_detail(&task.id).await.ok(),
        None => None,
    };
    Payload::AssistantData {
        events,
        approvals,
        routines,
        projects,
        tasks,
        latest_task,
    }
}

/// Settings plus export destinations, fetched concurrently.
pub async fn load_settings_bundle(api: &ApiClient) -> Payload {
    let (settings, destinations) = tokio::join!(
        async { api.settings().await.map_err(|e| e.message()) },
        async { api.destinations().await.map_err(|e| e.message()) },
    );
    Payload::SettingsBundle {
        settings,
        destinations,
    }
}

/// The task list and, when a detail view is open, that task's detail.
pub async fn load_tasks(api: &ApiClient, open_task_id: Option<String>) -> Vec<Payload> {
    let (tasks, detail) = tokio::join!(
        async { api.tasks().await.map_err(|e| e.message()) },
        async {
            match &open_task_id {
                Some(id) => Some(api.task_detail(id).await.map_err(|e| e.message())),
                None => None,
            }
        },
    );
    let mut payloads = vec![Payload::Tasks(tasks)];
    if let Some(detail) = detail {
        payloads.push(Payload::TaskDetail(detail));
    }
    payloads
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_burst_coalesces_into_one_refresh_per_window() {
        let mut sync = SyncState::default();
        for _ in 0..50 {
            sync.note_activity(10);
        }
        // Nothing fires inside the window, however many pings arrived.
        for now in 10..(10 + ACTIVITY_DEBOUNCE_TICKS) {
            assert!(!sync.take_due_activity(now), "fired early at tick {now}");
        }
        assert!(sync.take_due_activity(10 + ACTIVITY_DEBOUNCE_TICKS));
        // The whole burst produced exactly one refresh.
        assert!(!sync.take_due_activity(10 + ACTIVITY_DEBOUNCE_TICKS + 1));
    }

    #[test]
    fn continuous_burst_still_refreshes_every_window() {
        let mut sync = SyncState::default();
        let mut fired = 0;
        for now in 0..40u64 {
            sync.note_activity(now); // a ping on every single tick
            if sync.take_due_activity(now) {
                fired += 1;
            }
        }
        assert_eq!(fired, 40 / (ACTIVITY_DEBOUNCE_TICKS + 1));
        assert!(fired > 0, "a debounce must not starve a steady stream");
    }

    #[test]
    fn debounce_window_is_within_the_250_to_400ms_target() {
        let ms = ACTIVITY_DEBOUNCE_TICKS * 80;
        assert!((250..=400).contains(&ms), "window is {ms} ms");
    }

    #[test]
    fn no_polling_while_sse_is_connected() {
        let mut sync = SyncState::default();
        sync.set_sse_connected(true, 0);
        for now in 0..2_000u64 {
            assert!(!sync.poll_due(now, true), "busy poll at {now}");
            assert!(!sync.poll_due(now, false), "idle poll at {now}");
        }
    }

    #[test]
    fn fallback_polling_runs_when_disconnected_and_is_faster_when_busy() {
        let mut idle = SyncState::default();
        assert!(!idle.poll_due(POLL_IDLE_TICKS - 1, false));
        assert!(idle.poll_due(POLL_IDLE_TICKS, false));
        assert!(!idle.poll_due(POLL_IDLE_TICKS + 1, false));

        let mut busy = SyncState::default();
        assert!(busy.poll_due(POLL_BUSY_TICKS, true));
        assert!(!busy.poll_due(POLL_BUSY_TICKS + 1, true));
        // The busy fallback is deliberately not the old 400 ms (5-tick) storm.
        const { assert!(POLL_BUSY_TICKS * 80 > 400) };
    }

    #[test]
    fn sse_transitions_queue_one_catch_up_and_restart_the_poll_clock() {
        let mut sync = SyncState::default();
        sync.set_sse_connected(true, 100);
        assert!(sync.sse_connected());
        assert!(sync.take_due_activity(100 + ACTIVITY_DEBOUNCE_TICKS));

        // Repeated `false` reports from failed retries are not transitions.
        sync.set_sse_connected(false, 500);
        assert!(sync.take_due_activity(500 + ACTIVITY_DEBOUNCE_TICKS));
        for now in 501..520 {
            sync.set_sse_connected(false, now);
            assert!(!sync.take_due_activity(now + ACTIVITY_DEBOUNCE_TICKS));
        }
        // The poll clock restarted at the disconnect (tick 500), not at 0.
        assert!(!sync.poll_due(500 + POLL_IDLE_TICKS - 1, false));
        assert!(sync.poll_due(500 + POLL_IDLE_TICKS, false));
    }

    #[test]
    fn a_tab_never_has_two_refreshes_in_flight() {
        let mut sync = SyncState::default();
        assert!(sync.begin_refresh(Tab::Assistant, 0));
        assert!(!sync.begin_refresh(Tab::Assistant, 1));
        assert!(!sync.begin_refresh(Tab::Assistant, 2));
        assert_eq!(sync.refreshes_started(), 1);
        // Other tabs are independent.
        assert!(sync.begin_refresh(Tab::Tasks, 2));
        assert_eq!(sync.refreshes_started(), 2);
    }

    #[test]
    fn overlapping_request_replays_exactly_once_after_completion() {
        let mut sync = SyncState::default();
        assert!(sync.begin_refresh(Tab::Tasks, 0));
        assert!(!sync.begin_refresh(Tab::Tasks, 1));
        assert!(!sync.begin_refresh(Tab::Tasks, 2));
        assert!(sync.is_dirty(Tab::Tasks));
        // Two skipped requests collapse into a single trailing rerun.
        assert!(sync.finish_refresh(Tab::Tasks));
        assert!(!sync.is_in_flight(Tab::Tasks));
        assert!(sync.begin_refresh(Tab::Tasks, 3));
        assert!(!sync.finish_refresh(Tab::Tasks));
    }

    #[test]
    fn a_lost_refresh_cannot_wedge_a_tab() {
        let mut sync = SyncState::default();
        assert!(sync.begin_refresh(Tab::Memory, 0));
        assert!(!sync.begin_refresh(Tab::Memory, IN_FLIGHT_STALE_TICKS - 1));
        assert!(sync.begin_refresh(Tab::Memory, IN_FLIGHT_STALE_TICKS));
    }
}
