//! Application state and key handling. The TUI is keyboard-first: global
//! shortcuts (Ctrl+P tab picker, Ctrl+C quit), per-tab navigation, and modal
//! dialogs for forms. Every mutation goes through the loopback API client.

mod assistant;
mod dialogs;
mod memory;
mod projects;
mod routines;
mod settings;
mod tasks;

pub(crate) use assistant::{AssistantState, ComposerField};
pub(crate) use dialogs::{ConfirmAction, Dialog, FormKind};
pub(crate) use memory::MemoryState;
pub(crate) use projects::ProjectsState;
pub(crate) use routines::RoutinesState;
pub(crate) use settings::SettingsState;
pub(crate) use tasks::{TaskDetailFocus, TaskDetailView, TaskFilter, TasksState};

use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::{mpsc, Notify};
use tui_textarea::TextArea;

use crate::api::ApiClient;
use crate::contracts::*;
use crate::dialog_forms::Form;
use crate::event::{spawn_payload, spawn_refresh, AppEvent, AppTx, Payload};
use crate::refresh::{
    load_assistant_data, load_settings_bundle, load_tasks, payload_failed, SyncState,
};

// ---------------------------------------------------------------------------
// Screens, tabs, notices
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Screen {
    /// Waiting for the initial session check.
    Connecting,
    /// First run: create the owner account.
    Onboarding,
    /// Owner exists; sign in.
    Login,
    Main,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tab {
    Assistant,
    Tasks,
    Projects,
    Memory,
    Routines,
    Settings,
}

pub(crate) const ALL_TABS: [Tab; 6] = [
    Tab::Assistant,
    Tab::Tasks,
    Tab::Projects,
    Tab::Memory,
    Tab::Routines,
    Tab::Settings,
];

impl Tab {
    pub(crate) fn title(self) -> &'static str {
        match self {
            Tab::Assistant => "Assistant",
            Tab::Tasks => "Tasks",
            Tab::Projects => "Projects",
            Tab::Memory => "Memory",
            Tab::Routines => "Routines",
            Tab::Settings => "Settings",
        }
    }
}

pub(crate) struct Notice {
    pub(crate) message: String,
    pub(crate) is_error: bool,
    pub(crate) ticks_left: u64,
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

// Private result channels preserve request identity without changing the shared
// event protocol. A refresh is applied atomically once its done event arrives.
struct PendingRead {
    rx: crate::event::AppRx,
    session: u64,
    detail_generation: u64,
    routine_detail_generation: u64,
    refresh: Option<(Tab, u64)>,
    payloads: Vec<Payload>,
}

pub(crate) struct App {
    pub(crate) tx: AppTx,
    /// Cheap-to-clone, lock-free API handle; every task gets its own clone.
    pub(crate) api: ApiClient,
    /// Refresh scheduling: SSE state, activity debounce, in-flight tabs.
    pub(crate) sync: SyncState,
    /// Wakes the SSE loop out of its reconnect backoff (login, onboarding).
    pub(crate) sse_wake: Arc<Notify>,
    pub(crate) screen: Screen,
    pub(crate) tab: Tab,
    pub(crate) quit: bool,
    pub(crate) auth: TextArea<'static>,
    pub(crate) auth_busy: bool,
    pub(crate) assistant: AssistantState,
    pub(crate) tasks: TasksState,
    pub(crate) projects: ProjectsState,
    pub(crate) memory: MemoryState,
    pub(crate) routines: RoutinesState,
    pub(crate) settings: SettingsState,
    pub(crate) dialog: Option<Dialog>,
    /// When set, the Ctrl+P tab picker is open; value is the highlighted index.
    pub(crate) tab_picker: Option<usize>,
    pub(crate) notice: Option<Notice>,
    pub(crate) ticks: u64,
    session_generation: u64,
    detail_generation: u64,
    routine_detail_generation: u64,
    detail_target: Option<String>,
    pending_reads: Vec<PendingRead>,
}

impl App {
    pub(crate) fn new(tx: AppTx, api: ApiClient) -> Self {
        let mut auth = TextArea::default();
        auth.set_mask_char('\u{2022}');
        Self {
            tx,
            api,
            sync: SyncState::default(),
            sse_wake: Arc::new(Notify::new()),
            screen: Screen::Connecting,
            tab: Tab::Assistant,
            quit: false,
            auth,
            auth_busy: false,
            assistant: AssistantState::default(),
            tasks: TasksState::default(),
            projects: ProjectsState::default(),
            memory: MemoryState::default(),
            routines: RoutinesState::default(),
            settings: SettingsState::default(),
            dialog: None,
            tab_picker: None,
            notice: None,
            ticks: 0,
            session_generation: 0,
            detail_generation: 0,
            routine_detail_generation: 0,
            detail_target: None,
            pending_reads: Vec::new(),
        }
    }

    pub(crate) fn set_notice(&mut self, message: impl Into<String>, is_error: bool) {
        self.notice = Some(Notice {
            message: message.into(),
            is_error,
            ticks_left: 60,
        });
    }

    // -- Data loading -------------------------------------------------------

    pub(crate) fn refresh_all(&mut self) {
        self.refresh(Tab::Assistant);
        self.refresh(Tab::Tasks);
        self.refresh(Tab::Projects);
        self.refresh(Tab::Memory);
        self.refresh(Tab::Routines);
        self.refresh(Tab::Settings);
    }

    /// Refresh one tab's data in the background. A tab never has two
    /// refreshes in flight: a request that arrives mid-refresh is replayed
    /// once when the running one finishes (see `SyncState`).
    pub(crate) fn refresh(&mut self, tab: Tab) {
        if !self.sync.begin_refresh(tab, self.ticks) {
            return;
        }
        let api = self.api.clone();
        let tx = self.read_channel(Some((tab, self.sync.generation(tab))));
        match tab {
            Tab::Assistant => {
                spawn_refresh(
                    &tx,
                    tab,
                    async move { vec![load_assistant_data(&api).await] },
                );
            }
            Tab::Tasks => {
                let open_task_id = if self.tab == Tab::Tasks && self.tasks.detail_open {
                    self.tasks
                        .detail
                        .as_ref()
                        .filter(|d| self.detail_target.as_ref() == Some(&d.task.id))
                        .map(|d| d.task.id.clone())
                } else {
                    None
                };
                spawn_refresh(
                    &tx,
                    tab,
                    async move { load_tasks(&api, open_task_id).await },
                );
            }
            Tab::Projects => {
                spawn_refresh(&tx, tab, async move {
                    vec![Payload::Projects(
                        api.projects().await.map_err(|e| e.message()),
                    )]
                });
            }
            Tab::Memory => {
                spawn_refresh(&tx, tab, async move {
                    vec![Payload::Memory(api.memory().await.map_err(|e| e.message()))]
                });
            }
            Tab::Routines => {
                spawn_refresh(&tx, tab, async move {
                    vec![Payload::Routines(
                        api.routines().await.map_err(|e| e.message()),
                    )]
                });
            }
            Tab::Settings => {
                spawn_refresh(
                    &tx,
                    tab,
                    async move { vec![load_settings_bundle(&api).await] },
                );
            }
        }
    }

    /// True while an agent run is active or the executor reports busy.
    pub(crate) fn is_busy(&self) -> bool {
        self.assistant
            .active_task_detail
            .as_ref()
            .is_some_and(|d| d.task.state == TaskState::Running)
            || self.tasks.executor.as_ref().is_some_and(|e| e.busy)
    }

    /// An SSE `activity` ping: coalesced, not an immediate refresh.
    pub(crate) fn on_activity(&mut self) {
        if self.screen == Screen::Main {
            self.sync.note_activity(self.ticks);
        }
    }

    pub(crate) fn on_sse_connection(&mut self, connected: bool) {
        self.sync.set_sse_connected(connected, self.ticks);
    }

    pub(crate) fn on_refresh_done(&mut self, tab: Tab) {
        if self.sync.finish_refresh(tab) && self.screen == Screen::Main {
            self.refresh(tab);
        }
    }

    /// Apply completed reads, then run debounced activity, failed-read retries,
    /// or the polling fallback (only due while SSE is disconnected).
    pub(crate) fn pump_sync(&mut self) {
        self.drain_reads();
        if self.screen != Screen::Main {
            return;
        }
        let busy = self.is_busy();
        let activity_due = self.sync.take_due_activity(self.ticks);
        let poll_due = self.sync.poll_due(self.ticks, busy);
        if activity_due || poll_due {
            self.refresh(self.tab);
        }
        for tab in ALL_TABS {
            if self.sync.take_due_retry(tab, self.ticks) {
                self.refresh(tab);
            }
        }
    }

    fn read_channel(&mut self, refresh: Option<(Tab, u64)>) -> AppTx {
        let (tx, rx) = mpsc::unbounded_channel();
        self.pending_reads.push(PendingRead {
            rx,
            session: self.session_generation,
            detail_generation: self.detail_generation,
            routine_detail_generation: self.routine_detail_generation,
            refresh,
            payloads: Vec::new(),
        });
        tx
    }

    fn drain_reads(&mut self) {
        for mut read in std::mem::take(&mut self.pending_reads) {
            let mut done = false;
            loop {
                match read.rx.try_recv() {
                    Ok(AppEvent::Api(payload)) => read.payloads.push(*payload),
                    Ok(AppEvent::RefreshDone(_)) => {
                        done = true;
                        break;
                    }
                    Err(mpsc::error::TryRecvError::Disconnected) => {
                        done = true;
                        break;
                    }
                    Err(mpsc::error::TryRecvError::Empty) => break,
                    Ok(_) => {}
                }
            }
            if !done {
                self.pending_reads.push(read);
                continue;
            }
            if read.session != self.session_generation || self.screen != Screen::Main {
                continue;
            }
            if read
                .refresh
                .is_some_and(|(tab, generation)| !self.sync.is_current(tab, generation))
            {
                continue;
            }
            let mut failed = read.payloads.is_empty();
            for payload in read.payloads {
                if matches!(payload, Payload::TaskDetail(_))
                    && (read.detail_generation != self.detail_generation || self.tab != Tab::Tasks)
                {
                    continue;
                }
                if matches!(payload, Payload::RoutineDetail(_))
                    && (read.routine_detail_generation != self.routine_detail_generation
                        || self.tab != Tab::Routines)
                {
                    continue;
                }
                failed |= payload_failed(&payload);
                crate::apply::apply_payload(self, payload);
            }
            if let Some((tab, _)) = read.refresh {
                self.sync.record_outcome(tab, failed, self.ticks);
                self.on_refresh_done(tab);
            }
        }
    }

    /// Invalidate old-session reads and retry timers before starting a new
    /// session's refreshes, or when the current session ends.
    pub(crate) fn reset_read_session(&mut self) {
        self.session_generation += 1;
        self.detail_generation += 1;
        self.routine_detail_generation += 1;
        self.pending_reads.clear();
        self.sync = SyncState::default();
        self.detail_target = None;
        self.tasks.detail = None;
        self.tasks.detail_open = false;
        self.routines.detail = None;
        self.routines.detail_open = false;
        self.routines.occurrence_selected = 0;
    }

    fn spawn_mutation(
        &self,
        label: impl Into<String> + Send + 'static,
        future: impl std::future::Future<Output = Result<(), crate::api::ApiError>> + Send + 'static,
    ) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = future.await.map(|_| ()).map_err(|e| e.message());
            let _ = tx.send(AppEvent::Api(Box::new(Payload::Mutation {
                label: label.into(),
                result,
            })));
        });
    }

    // -- Key routing ----------------------------------------------------------

    pub(crate) fn on_key(&mut self, key: KeyEvent) {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.quit = true;
            return;
        }
        if self.screen == Screen::Main
            && key.modifiers.contains(KeyModifiers::CONTROL)
            && matches!(key.code, KeyCode::Char('p') | KeyCode::Char('P'))
        {
            if self.tab_picker.is_some() {
                self.tab_picker = None;
            } else {
                let index = ALL_TABS
                    .iter()
                    .position(|tab| *tab == self.tab)
                    .unwrap_or(0);
                self.tab_picker = Some(index);
            }
            return;
        }
        // Alt+X signs out; the session stays server-side until TTL.
        if self.screen == Screen::Main
            && key.modifiers.contains(KeyModifiers::ALT)
            && key.code == KeyCode::Char('x')
        {
            let api = self.api.clone();
            let tx = self.tx.clone();
            tokio::spawn(async move {
                let result = api.logout().await.map_err(|e| e.message());
                let _ = tx.send(AppEvent::Api(Box::new(Payload::LoggedOut(result))));
            });
            return;
        }
        if self.screen != Screen::Main {
            self.handle_auth_key(key);
            return;
        }
        if let Some(selected) = self.tab_picker {
            self.handle_tab_picker_key(selected, key);
            return;
        }
        if let Some(dialog) = self.dialog.take() {
            self.handle_dialog_key(dialog, key);
            return;
        }
        match self.tab {
            Tab::Assistant => self.handle_assistant_key(key),
            Tab::Tasks => self.handle_tasks_key(key),
            Tab::Projects => self.handle_projects_key(key),
            Tab::Memory => self.handle_memory_key(key),
            Tab::Routines => self.handle_routines_key(key),
            Tab::Settings => self.handle_settings_key(key),
        }
    }

    pub(crate) fn on_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
        use crossterm::event::{MouseButton, MouseEventKind};
        if self.screen == Screen::Main && self.tab == Tab::Tasks && self.tasks.detail_open {
            if let Some(detail) = &self.tasks.detail {
                if detail.artifact.is_some() && self.tasks.detail_view == TaskDetailView::Auto {
                    let is_left = mouse.column < 46;
                    let target_focus = if is_left {
                        TaskDetailFocus::Log
                    } else {
                        TaskDetailFocus::Report
                    };
                    match mouse.kind {
                        MouseEventKind::Down(MouseButton::Left) => {
                            self.tasks.detail_focus = target_focus;
                            return;
                        }
                        MouseEventKind::ScrollDown => {
                            let prev = self.tasks.detail_focus;
                            self.tasks.detail_focus = target_focus;
                            self.scroll_task_detail(3);
                            self.tasks.detail_focus = prev;
                            return;
                        }
                        MouseEventKind::ScrollUp => {
                            let prev = self.tasks.detail_focus;
                            self.tasks.detail_focus = target_focus;
                            self.scroll_task_detail(-3);
                            self.tasks.detail_focus = prev;
                            return;
                        }
                        _ => {}
                    }
                }
            }
        }

        match mouse.kind {
            MouseEventKind::ScrollDown => {
                self.scroll_down(3);
            }
            MouseEventKind::ScrollUp => {
                self.scroll_up(3);
            }
            _ => {}
        }
    }

    pub(crate) fn scroll_down(&mut self, lines: u16) {
        if self.screen != Screen::Main {
            return;
        }
        match self.tab {
            Tab::Assistant => {
                self.assistant.stream_scroll = self.assistant.stream_scroll.saturating_add(lines);
            }
            Tab::Tasks => {
                if self.tasks.detail_open {
                    self.scroll_task_detail(lines as i32);
                } else if !self.tasks.tasks.is_empty() {
                    let max = self.tasks.tasks.len().saturating_sub(1);
                    self.tasks.selected = (self.tasks.selected + lines as usize).min(max);
                }
            }
            Tab::Projects => {
                if !self.projects.projects.is_empty() {
                    let max = self.projects.projects.len().saturating_sub(1);
                    self.projects.selected = (self.projects.selected + lines as usize).min(max);
                }
            }
            Tab::Memory => {
                self.memory.selected = self.memory.selected.saturating_add(lines as usize);
            }
            Tab::Routines => {
                if !self.routines.routines.is_empty() {
                    let max = self.routines.routines.len().saturating_sub(1);
                    self.routines.selected = (self.routines.selected + lines as usize).min(max);
                }
            }
            Tab::Settings => {
                let max = 1 + self.settings.destinations.len();
                self.settings.selected = (self.settings.selected + lines as usize).min(max);
            }
        }
    }

    pub(crate) fn scroll_up(&mut self, lines: u16) {
        if self.screen != Screen::Main {
            return;
        }
        match self.tab {
            Tab::Assistant => {
                self.assistant.stream_scroll = self.assistant.stream_scroll.saturating_sub(lines);
            }
            Tab::Tasks => {
                if self.tasks.detail_open {
                    self.scroll_task_detail(-(lines as i32));
                } else {
                    self.tasks.selected = self.tasks.selected.saturating_sub(lines as usize);
                }
            }
            Tab::Projects => {
                self.projects.selected = self.projects.selected.saturating_sub(lines as usize);
            }
            Tab::Memory => {
                self.memory.selected = self.memory.selected.saturating_sub(lines as usize);
            }
            Tab::Routines => {
                self.routines.selected = self.routines.selected.saturating_sub(lines as usize);
            }
            Tab::Settings => {
                self.settings.selected = self.settings.selected.saturating_sub(lines as usize);
            }
        }
    }

    fn handle_tab_picker_key(&mut self, selected: usize, key: KeyEvent) {
        let last = ALL_TABS.len().saturating_sub(1);
        match key.code {
            KeyCode::Esc => {
                self.tab_picker = None;
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.tab_picker = Some(selected.saturating_sub(1));
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.tab_picker = Some((selected + 1).min(last));
            }
            KeyCode::Enter => {
                self.tab_picker = None;
                self.switch_tab(ALL_TABS[selected]);
            }
            _ => {}
        }
    }

    pub(crate) fn switch_tab(&mut self, tab: Tab) {
        if self.tab != tab {
            self.detail_generation += 1;
            self.routine_detail_generation += 1;
        }
        self.tab = tab;
        self.refresh(tab);
    }

    fn handle_auth_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Enter if !self.auth_busy && !self.auth.is_empty() => {
                let password = self.auth.lines().join("\n");
                self.auth_busy = true;
                self.auth = {
                    let mut area = TextArea::default();
                    area.set_mask_char('\u{2022}');
                    area
                };
                let api = self.api.clone();
                let tx = self.tx.clone();
                let onboarding = self.screen == Screen::Onboarding;
                tokio::spawn(async move {
                    let result = if onboarding {
                        api.setup(&password)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.message())
                    } else {
                        api.login(&password)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.message())
                    };
                    let _ = tx.send(AppEvent::Api(Box::new(Payload::Auth(result))));
                });
            }
            _ => {
                let _ = self.auth.input(key);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let cut: String = text.chars().take(max_chars).collect();
        format!("{cut}\u{2026}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{Task, TaskDetail, TaskDetailArtifact, TaskKind, TaskState};
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};
    use tokio::sync::mpsc;

    fn dummy_app() -> App {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = crate::api::ApiClient::new("http://127.0.0.1:0").unwrap();
        App::new(tx, api)
    }

    use crate::event::Payload;
    use crate::refresh::{ACTIVITY_DEBOUNCE_TICKS, POLL_IDLE_TICKS};
    use std::time::Duration;

    fn main_app() -> App {
        let mut app = dummy_app();
        app.screen = Screen::Main;
        app
    }

    /// Advance the app clock one tick at a time, pumping the scheduler, and
    /// report each refresh as finished right away (as a fast API would).
    fn run_ticks(app: &mut App, from: u64, to: u64) {
        for now in from..to {
            app.ticks = now;
            app.pump_sync();
            app.on_refresh_done(Tab::Assistant);
        }
    }

    #[tokio::test]
    async fn activity_burst_starts_one_refresh_after_the_debounce_window() {
        let mut app = main_app();
        for _ in 0..100 {
            app.on_activity();
        }
        for now in 0..ACTIVITY_DEBOUNCE_TICKS {
            app.ticks = now;
            app.pump_sync();
            assert_eq!(app.sync.refreshes_started(), 0, "refreshed early at {now}");
        }
        app.ticks = ACTIVITY_DEBOUNCE_TICKS;
        app.pump_sync();
        assert_eq!(app.sync.refreshes_started(), 1);
        assert!(app.sync.is_in_flight(Tab::Assistant));
        // The burst is spent: no second refresh on the following ticks.
        run_ticks(
            &mut app,
            ACTIVITY_DEBOUNCE_TICKS + 1,
            ACTIVITY_DEBOUNCE_TICKS + 30,
        );
        assert_eq!(app.sync.refreshes_started(), 1);
    }

    #[tokio::test]
    async fn activity_during_a_running_refresh_replays_once_after_it_finishes() {
        let mut app = main_app();
        app.on_activity();
        app.ticks = ACTIVITY_DEBOUNCE_TICKS;
        app.pump_sync();
        assert_eq!(app.sync.refreshes_started(), 1);

        // A second burst lands while the first refresh is still in flight.
        for _ in 0..10 {
            app.on_activity();
        }
        app.ticks = 2 * ACTIVITY_DEBOUNCE_TICKS + 1;
        app.pump_sync();
        assert_eq!(
            app.sync.refreshes_started(),
            1,
            "overlapping refresh started"
        );
        assert!(app.sync.is_dirty(Tab::Assistant));

        app.on_refresh_done(Tab::Assistant);
        assert_eq!(app.sync.refreshes_started(), 2, "trailing rerun missing");
        app.on_refresh_done(Tab::Assistant);
        assert_eq!(app.sync.refreshes_started(), 2);
    }

    #[tokio::test]
    async fn no_polling_while_sse_is_connected_but_fallback_resumes_when_it_drops() {
        let mut app = main_app();
        app.on_sse_connection(true);
        // One catch-up refresh for the (re)connect, then silence: neither the
        // idle nor the busy cadence ever polls a connected stream.
        run_ticks(&mut app, 0, 1_000);
        assert_eq!(app.sync.refreshes_started(), 1);

        app.tasks.executor = Some(ExecutorStatus {
            busy: true,
            activeTaskId: Some("t".into()),
            dispatchPaused: false,
        });
        assert!(app.is_busy());
        run_ticks(&mut app, 1_000, 2_000);
        assert_eq!(app.sync.refreshes_started(), 1, "busy run polled over SSE");

        // The stream drops at tick 2000: one catch-up, then fallback polling.
        app.ticks = 2_000;
        app.on_sse_connection(false);
        run_ticks(&mut app, 2_000, 2_000 + 2 * POLL_IDLE_TICKS);
        assert!(
            app.sync.refreshes_started() > 1,
            "fallback polling never resumed"
        );
    }

    #[tokio::test]
    async fn login_and_onboarding_wake_the_sse_loop_but_failures_do_not() {
        let mut app = main_app();
        let wake = app.sse_wake.clone();

        crate::apply::apply_payload(&mut app, Payload::Auth(Err("bad password".into())));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), wake.notified())
                .await
                .is_err(),
            "a failed login must not wake the stream"
        );

        crate::apply::apply_payload(&mut app, Payload::Auth(Ok(())));
        assert!(
            tokio::time::timeout(Duration::from_millis(500), wake.notified())
                .await
                .is_ok(),
            "a successful login must wake the stream immediately"
        );
    }

    fn send_detail(tx: AppTx, id: &str) {
        let mut detail = sample_task(false);
        detail.task.id = id.into();
        tx.send(AppEvent::Api(Box::new(Payload::TaskDetail(Ok(detail)))))
            .unwrap();
    }

    fn pending_detail(app: &mut App, id: &str) -> AppTx {
        // Drive the real request setup, but control completion order without
        // timing or network dependencies for these state-machine tests.
        app.open_task_detail(id.into());
        let (tx, rx) = mpsc::unbounded_channel();
        app.pending_reads.last_mut().unwrap().rx = rx;
        tx
    }

    fn sample_routine(id: &str) -> crate::api::RoutineDetail {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": id, "projectId": "p1", "timezone": "UTC",
            "schedule": { "kind": "daily", "time": "09:00" },
            "template": { "title": "Plan", "request": "Draft priorities", "constraints": null },
            "state": "active", "windowStartAt": "2026-11-01T00:00:00Z",
            "lastOccurrenceKey": null, "lastOccurrenceAt": null,
            "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-01T00:00:00Z",
            "nextOccurrenceAt": null, "nextOccurrenceKey": null,
            "missedCount": 2, "projectName": "Demo",
            "occurrences": (["2026-11-20", "2026-11-21"].map(|key| serde_json::json!({
                "id": format!("{id}-{key}"), "routineId": id, "occurrenceKey": key,
                "scheduledFor": "2026-11-20T09:00:00Z", "state": "missed",
                "taskId": null, "reason": null, "decidedAt": null,
                "createdAt": "2026-11-20T09:00:00Z", "updatedAt": "2026-11-20T09:00:00Z"
            })))
        }))
        .unwrap()
    }

    fn pending_routine_detail(app: &mut App, id: &str) -> AppTx {
        app.open_routine_detail(id.into());
        let (tx, rx) = mpsc::unbounded_channel();
        app.pending_reads.last_mut().unwrap().rx = rx;
        tx
    }

    fn send_routine_detail(tx: AppTx, id: &str) {
        tx.send(AppEvent::Api(Box::new(Payload::RoutineDetail(Ok(
            sample_routine(id),
        )))))
        .unwrap();
    }

    #[tokio::test]
    async fn latest_routine_detail_wins_reverse_order_without_resetting_occurrence_selection() {
        let mut app = main_app();
        app.tab = Tab::Routines;
        let a = pending_routine_detail(&mut app, "a");
        let b = pending_routine_detail(&mut app, "b");
        send_routine_detail(b, "b");
        app.drain_reads();
        assert_eq!(app.routines.detail.as_ref().unwrap().view.routine.id, "b");
        app.routines.occurrence_selected = 1;
        send_routine_detail(a, "a");
        app.drain_reads();
        assert_eq!(app.routines.detail.as_ref().unwrap().view.routine.id, "b");
        assert_eq!(app.routines.occurrence_selected, 1);
    }

    #[tokio::test]
    async fn routine_occurrence_actions_keep_the_current_id_after_a_stale_response() {
        use httpmock::{Method::POST, MockServer};
        let server = MockServer::start();
        let current = server.mock(|when, then| {
            when.method(POST)
                .path_contains("/api/routines/b/occurrences/2026-11-21/");
            // Only the request target matters here; prevent follow-up refreshes.
            then.status(503).body(r#"{"error":"observed"}"#);
        });
        let stale = server.mock(|when, then| {
            when.method(POST)
                .path_contains("/api/routines/a/occurrences/");
            then.status(503);
        });
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut app = App::new(tx, ApiClient::new(&server.base_url()).unwrap());
        app.screen = Screen::Main;
        app.tab = Tab::Routines;
        let a = pending_routine_detail(&mut app, "a");
        let b = pending_routine_detail(&mut app, "b");
        send_routine_detail(b, "b");
        app.drain_reads();
        app.routines.occurrence_selected = 1;
        send_routine_detail(a, "a");
        app.drain_reads();
        for key in ['r', 's'] {
            app.on_key(KeyEvent::new(KeyCode::Char(key), KeyModifiers::NONE));
            let event = tokio::time::timeout(Duration::from_secs(3), rx.recv())
                .await
                .unwrap();
            assert!(matches!(event, Some(AppEvent::Api(payload))
                if matches!(*payload, Payload::Mutation { result: Err(_), .. })));
        }
        current.assert_hits(2);
        stale.assert_hits(0);
    }

    #[tokio::test]
    async fn stale_routine_detail_errors_do_not_replace_the_current_notice() {
        let mut app = main_app();
        app.tab = Tab::Routines;
        let a = pending_routine_detail(&mut app, "a");
        let b = pending_routine_detail(&mut app, "b");
        send_routine_detail(b, "b");
        app.drain_reads();
        app.set_notice("current", false);
        a.send(AppEvent::Api(Box::new(Payload::RoutineDetail(Err(
            "stale".into(),
        )))))
        .unwrap();
        drop(a);
        app.drain_reads();
        assert_eq!(app.notice.as_ref().unwrap().message, "current");
        assert_eq!(app.routines.detail.as_ref().unwrap().view.routine.id, "b");
    }

    #[tokio::test]
    async fn closing_or_cancelling_routine_detail_prevents_late_reopening() {
        for key in [KeyCode::Esc, KeyCode::Char('b')] {
            let mut app = main_app();
            app.tab = Tab::Routines;
            let pending = pending_routine_detail(&mut app, "a");
            app.on_key(KeyEvent::new(key, KeyModifiers::NONE));
            send_routine_detail(pending, "a");
            app.drain_reads();
            assert!(!app.routines.detail_open);
            assert!(app.routines.detail.is_none());

            let pending = pending_routine_detail(&mut app, "a");
            send_routine_detail(pending, "a");
            app.drain_reads();
            assert!(app.routines.detail_open);
            let pending = pending_routine_detail(&mut app, "b");
            app.on_key(KeyEvent::new(key, KeyModifiers::NONE));
            send_routine_detail(pending, "b");
            app.drain_reads();
            assert!(!app.routines.detail_open);
            assert!(app.routines.detail.is_none());
            assert_eq!(app.routines.occurrence_selected, 0);
        }
    }

    #[tokio::test]
    async fn navigating_away_and_back_invalidates_pending_routine_detail() {
        let mut app = main_app();
        app.tab = Tab::Routines;
        let pending = pending_routine_detail(&mut app, "a");
        app.switch_tab(Tab::Projects);
        send_routine_detail(pending, "a");
        app.drain_reads();
        assert!(!app.routines.detail_open);

        app.switch_tab(Tab::Routines);
        let pending = pending_routine_detail(&mut app, "b");
        app.switch_tab(Tab::Projects);
        app.switch_tab(Tab::Routines);
        send_routine_detail(pending, "b");
        app.drain_reads();
        assert!(!app.routines.detail_open);
        assert!(app.routines.detail.is_none());
    }

    #[tokio::test]
    async fn logout_clears_open_routine_and_discards_old_session_success_and_error() {
        let mut app = main_app();
        app.tab = Tab::Routines;
        let opened = pending_routine_detail(&mut app, "a");
        send_routine_detail(opened, "a");
        app.drain_reads();
        app.routines.occurrence_selected = 1;
        let pending = pending_routine_detail(&mut app, "b");
        let error = pending_routine_detail(&mut app, "c");
        // Already queued results must also be discarded by the session reset.
        send_routine_detail(pending, "b");
        error
            .send(AppEvent::Api(Box::new(Payload::RoutineDetail(Err(
                "old session".into(),
            )))))
            .unwrap();
        crate::apply::apply_payload(&mut app, Payload::LoggedOut(Ok(())));
        assert!(!app.routines.detail_open);
        assert!(app.routines.detail.is_none());
        assert_eq!(app.routines.occurrence_selected, 0);
        crate::apply::apply_payload(&mut app, Payload::Auth(Ok(())));
        assert!(error
            .send(AppEvent::Api(Box::new(Payload::RoutineDetail(Ok(
                sample_routine("c")
            )))))
            .is_err());
        drop(error);
        app.drain_reads();
        assert!(!app.routines.detail_open);
        assert!(app.routines.detail.is_none());
        assert!(app.notice.is_none());
    }

    #[tokio::test]
    async fn latest_detail_request_wins_even_when_responses_arrive_in_reverse() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let a = pending_detail(&mut app, "a");
        let b = pending_detail(&mut app, "b");
        send_detail(b, "b");
        app.drain_reads();
        assert_eq!(app.tasks.detail.as_ref().unwrap().task.id, "b");
        app.tasks.log_scroll = 42;
        send_detail(a, "a");
        app.drain_reads();
        assert_eq!(app.tasks.detail.as_ref().unwrap().task.id, "b");
        assert_eq!(app.tasks.log_scroll, 42);
    }

    #[tokio::test]
    async fn stale_detail_errors_do_not_replace_the_current_notice() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let a = pending_detail(&mut app, "a");
        let b = pending_detail(&mut app, "b");
        send_detail(b, "b");
        app.drain_reads();
        app.set_notice("current", false);
        a.send(AppEvent::Api(Box::new(Payload::TaskDetail(Err(
            "stale".into()
        )))))
        .unwrap();
        drop(a);
        app.drain_reads();
        assert_eq!(app.notice.as_ref().unwrap().message, "current");
    }

    #[tokio::test]
    async fn refresh_detail_cannot_overwrite_a_subsequently_requested_task() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let a = pending_detail(&mut app, "a");
        send_detail(a, "a");
        app.drain_reads();
        assert!(app.sync.begin_refresh(Tab::Tasks, 0));
        let refresh = app.read_channel(Some((Tab::Tasks, app.sync.generation(Tab::Tasks))));
        let b = pending_detail(&mut app, "b");
        send_detail(b, "b");
        app.drain_reads();
        send_detail(refresh, "a");
        app.drain_reads();
        assert_eq!(app.tasks.detail.as_ref().unwrap().task.id, "b");
        assert!(!app.sync.is_in_flight(Tab::Tasks));
    }

    #[tokio::test]
    async fn leaving_detail_or_cancelling_a_pending_open_prevents_reopening() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let pending = pending_detail(&mut app, "a");
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        send_detail(pending, "a");
        app.drain_reads();
        assert!(!app.tasks.detail_open);
        assert!(app.tasks.detail.is_none());

        let pending = pending_detail(&mut app, "a");
        send_detail(pending, "a");
        app.drain_reads();
        assert!(app.sync.begin_refresh(Tab::Tasks, 0));
        let refresh = app.read_channel(Some((Tab::Tasks, app.sync.generation(Tab::Tasks))));
        app.on_key(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::NONE));
        send_detail(refresh, "a");
        app.drain_reads();
        assert!(!app.tasks.detail_open);
        assert!(app.tasks.detail.is_none());
    }

    #[tokio::test]
    async fn navigating_away_and_back_invalidates_pending_detail() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let pending = pending_detail(&mut app, "a");
        app.switch_tab(Tab::Projects);
        app.switch_tab(Tab::Tasks);
        send_detail(pending, "a");
        app.drain_reads();
        assert!(!app.tasks.detail_open);
    }

    #[tokio::test]
    async fn logout_and_relogin_discard_old_reads_and_retry_state() {
        let mut app = main_app();
        app.tab = Tab::Tasks;
        let pending = pending_detail(&mut app, "a");
        app.sync.record_outcome(Tab::Tasks, true, 0);
        crate::apply::apply_payload(&mut app, Payload::LoggedOut(Ok(())));
        let sent = pending.send(AppEvent::Api(Box::new(Payload::TaskDetail(Ok(
            sample_task(false),
        )))));
        assert!(sent.is_err());
        crate::apply::apply_payload(&mut app, Payload::Auth(Ok(())));
        app.drain_reads();
        assert!(!app.tasks.detail_open);
        assert!(app.tasks.detail.is_none());
        assert!(!app.sync.take_due_retry(Tab::Tasks, 10_000));
    }

    #[tokio::test]
    async fn obsolete_refresh_completion_cannot_release_a_newer_flight() {
        let mut app = main_app();
        assert!(app.sync.begin_refresh(Tab::Projects, 0));
        let old = app.read_channel(Some((Tab::Projects, app.sync.generation(Tab::Projects))));
        assert!(app
            .sync
            .begin_refresh(Tab::Projects, crate::refresh::IN_FLIGHT_STALE_TICKS));
        old.send(AppEvent::Api(Box::new(Payload::Projects(
            Err("old".into()),
        ))))
        .unwrap();
        drop(old);
        app.drain_reads();
        assert!(app.sync.is_in_flight(Tab::Projects));
        assert!(app.notice.is_none());
    }

    #[test]
    fn missing_latest_detail_is_a_failure_but_successful_detail_is_not() {
        let mut payload = Payload::AssistantData {
            events: Ok(vec![]),
            approvals: Ok(vec![]),
            routines: Ok(vec![]),
            projects: Ok(vec![]),
            tasks: Ok(TasksResponse {
                tasks: vec![sample_task(false).task],
                executor: ExecutorStatus {
                    busy: false,
                    activeTaskId: None,
                    dispatchPaused: false,
                },
            }),
            latest_task: None,
        };
        assert!(payload_failed(&payload));
        if let Payload::AssistantData { latest_task, .. } = &mut payload {
            *latest_task = Some(sample_task(false));
        }
        assert!(!payload_failed(&payload));
    }

    #[tokio::test]
    async fn refresh_started_while_another_detail_is_loading_does_not_refetch_old_task() {
        use httpmock::{Method::GET, MockServer};
        let server = MockServer::start();
        let list = server.mock(|when, then| {
            when.method(GET).path("/api/tasks");
            then.status(200).json_body(serde_json::json!({
                "tasks": [], "executor": { "busy": false, "activeTaskId": null, "dispatchPaused": false }
            }));
        });
        let old = server.mock(|when, then| {
            when.method(GET).path("/api/tasks/task-1");
            then.status(500);
        });
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut app = App::new(tx, ApiClient::new(&server.base_url()).unwrap());
        app.screen = Screen::Main;
        app.tab = Tab::Tasks;
        app.tasks.detail = Some(sample_task(false));
        app.tasks.detail_open = true;
        let b = pending_detail(&mut app, "b");
        app.refresh(Tab::Tasks);
        send_detail(b, "b");
        wait_for_refresh(&mut app, Tab::Tasks).await;
        assert_eq!(app.tasks.detail.as_ref().unwrap().task.id, "b");
        list.assert_hits(1);
        old.assert_hits(0);
    }

    async fn wait_for_refresh(app: &mut App, tab: Tab) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while app.sync.is_in_flight(tab) {
                app.drain_reads();
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("refresh did not finish");
    }

    #[tokio::test]
    async fn failed_final_sse_refresh_recovers_without_activity_and_then_stops() {
        use crate::refresh::RETRY_INITIAL_TICKS;
        use httpmock::{Method::GET, MockServer};
        let server = MockServer::start();
        let mut failed = server.mock(|when, then| {
            when.method(GET).path("/api/projects");
            then.status(503).body(r#"{"error":"transient"}"#);
        });
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut app = App::new(tx, ApiClient::new(&server.base_url()).unwrap());
        app.screen = Screen::Main;
        app.tab = Tab::Projects;
        app.on_sse_connection(true);
        app.ticks = ACTIVITY_DEBOUNCE_TICKS;
        app.pump_sync();
        wait_for_refresh(&mut app, Tab::Projects).await;
        failed.assert_hits(1);
        failed.delete();
        let recovered = server.mock(|when, then| {
            when.method(GET).path("/api/projects");
            then.status(200)
                .json_body(serde_json::json!({"projects": []}));
        });
        // No new activity or stream transition arrives after the failure.
        app.ticks += RETRY_INITIAL_TICKS - 1;
        app.pump_sync();
        assert_eq!(app.sync.refreshes_started(), 1);
        app.ticks += 1;
        app.pump_sync();
        app.pump_sync();
        assert_eq!(app.sync.refreshes_started(), 2);
        assert!(!app.sync.is_dirty(Tab::Projects));
        wait_for_refresh(&mut app, Tab::Projects).await;
        recovered.assert_hits(1);
        for now in app.ticks..app.ticks + 2_000 {
            app.ticks = now;
            app.pump_sync();
        }
        assert_eq!(app.sync.refreshes_started(), 2);
        recovered.assert_hits(1);
    }

    fn sample_task(has_artifact: bool) -> TaskDetail {
        TaskDetail {
            task: Task {
                id: "task-1".into(),
                state: TaskState::Completed,
                kind: TaskKind::ResearchBrief,
                title: "Test Task".into(),
                request: "Draw a bird".into(),
                constraints: None,
                startingUrls: None,
                projectId: None,
                attemptCount: 1,
                error: None,
                exportArgs: None,
                routineId: None,
                lastRunId: None,
                resultArtifactId: if has_artifact {
                    Some("art-1".into())
                } else {
                    None
                },
                createdAt: "2026-10-27T10:00:00Z".into(),
                updatedAt: "2026-10-27T10:01:00Z".into(),
            },
            runs: vec![],
            events: vec![],
            artifact: if has_artifact {
                Some(TaskDetailArtifact {
                    id: "art-1".into(),
                    markdown: "# Bird ASCII\n/'-'\\\n|( o )|\n".into(),
                })
            } else {
                None
            },
            approval: None,
        }
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    #[test]
    fn test_task_detail_focus_and_view_transitions() {
        assert_eq!(TaskDetailFocus::Report.toggle(), TaskDetailFocus::Log);
        assert_eq!(TaskDetailFocus::Log.toggle(), TaskDetailFocus::Report);

        assert_eq!(TaskDetailView::Auto.next(), TaskDetailView::ReportOnly);
        assert_eq!(TaskDetailView::ReportOnly.next(), TaskDetailView::LogOnly);
        assert_eq!(TaskDetailView::LogOnly.next(), TaskDetailView::Auto);
    }

    #[test]
    fn test_scroll_task_detail_with_artifact() {
        let mut app = dummy_app();
        app.tasks.detail = Some(sample_task(true));
        app.tasks.detail_focus = TaskDetailFocus::Report;
        app.tasks.detail_view = TaskDetailView::Auto;

        app.scroll_task_detail(5);
        assert_eq!(app.tasks.artifact_scroll, 5);
        assert_eq!(app.tasks.log_scroll, 0);

        app.scroll_task_detail(-2);
        assert_eq!(app.tasks.artifact_scroll, 3);

        app.scroll_task_detail(-10);
        assert_eq!(app.tasks.artifact_scroll, 0);

        // Switch to Log
        app.tasks.detail_focus = TaskDetailFocus::Log;
        app.scroll_task_detail(4);
        assert_eq!(app.tasks.log_scroll, 4);
        assert_eq!(app.tasks.artifact_scroll, 0);

        // View mode override: ReportOnly scrolls artifact even if focus was Log
        app.tasks.detail_view = TaskDetailView::ReportOnly;
        app.scroll_task_detail(7);
        assert_eq!(app.tasks.artifact_scroll, 7);
        assert_eq!(app.tasks.log_scroll, 4);
    }

    #[test]
    fn test_scroll_task_detail_without_artifact() {
        let mut app = dummy_app();
        app.tasks.detail = Some(sample_task(false));
        app.tasks.detail_focus = TaskDetailFocus::Report; // default before check
        app.tasks.detail_view = TaskDetailView::Auto;

        // When no artifact exists, scrolling must always route to log_scroll
        app.scroll_task_detail(6);
        assert_eq!(app.tasks.log_scroll, 6);
        assert_eq!(app.tasks.artifact_scroll, 0);
    }

    #[test]
    fn test_task_detail_key_navigation() {
        let mut app = dummy_app();
        app.tab = Tab::Tasks;
        app.tasks.detail_open = true;
        app.tasks.detail = Some(sample_task(true));
        app.tasks.detail_focus = TaskDetailFocus::Report;
        app.tasks.detail_view = TaskDetailView::Auto;

        // Tab toggles focus between Report and Log
        app.handle_task_detail_key(key(KeyCode::Tab));
        assert_eq!(app.tasks.detail_focus, TaskDetailFocus::Log);
        app.handle_task_detail_key(key(KeyCode::Tab));
        assert_eq!(app.tasks.detail_focus, TaskDetailFocus::Report);

        // 'h' focuses Log, 'l' focuses Report
        app.handle_task_detail_key(key(KeyCode::Char('h')));
        assert_eq!(app.tasks.detail_focus, TaskDetailFocus::Log);
        app.handle_task_detail_key(key(KeyCode::Char('l')));
        assert_eq!(app.tasks.detail_focus, TaskDetailFocus::Report);

        // 'v' cycles view
        app.handle_task_detail_key(key(KeyCode::Char('v')));
        assert_eq!(app.tasks.detail_view, TaskDetailView::ReportOnly);
        app.handle_task_detail_key(key(KeyCode::Char('v')));
        assert_eq!(app.tasks.detail_view, TaskDetailView::LogOnly);
        app.handle_task_detail_key(key(KeyCode::Char('v')));
        assert_eq!(app.tasks.detail_view, TaskDetailView::Auto);

        // 'j' and 'k' scroll
        app.handle_task_detail_key(key(KeyCode::Char('j')));
        assert_eq!(app.tasks.artifact_scroll, 1);
        app.handle_task_detail_key(key(KeyCode::Char('k')));
        assert_eq!(app.tasks.artifact_scroll, 0);

        // Esc closes detail and resets state
        app.tasks.artifact_scroll = 10;
        app.tasks.log_scroll = 8;
        app.handle_task_detail_key(key(KeyCode::Esc));
        assert!(!app.tasks.detail_open);
        assert!(app.tasks.detail.is_none());
        assert_eq!(app.tasks.artifact_scroll, 0);
        assert_eq!(app.tasks.log_scroll, 0);
    }

    #[test]
    fn test_render_task_detail_wide_and_narrow() {
        use ratatui::backend::TestBackend;
        use ratatui::Terminal;

        let mut app = dummy_app();
        app.screen = Screen::Main;
        app.tab = Tab::Tasks;
        app.tasks.detail_open = true;
        app.tasks.detail = Some(sample_task(true));

        // Wide terminal (120x30)
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| {
                crate::ui::render(&mut app, frame);
            })
            .unwrap();

        let buffer = terminal.backend().buffer();
        let content: String = buffer.content().iter().map(|c| c.symbol()).collect();
        assert!(content.contains("Task detail"));
        assert!(content.contains("Saved Report"));

        // Narrow terminal (80x25)
        let backend = TestBackend::new(80, 25);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| {
                crate::ui::render(&mut app, frame);
            })
            .unwrap();

        // Maximized report view
        app.tasks.detail_view = TaskDetailView::ReportOnly;
        terminal
            .draw(|frame| {
                crate::ui::render(&mut app, frame);
            })
            .unwrap();

        // Maximized log view
        app.tasks.detail_view = TaskDetailView::LogOnly;
        terminal
            .draw(|frame| {
                crate::ui::render(&mut app, frame);
            })
            .unwrap();

        // Task with no artifact
        app.tasks.detail = Some(sample_task(false));
        app.tasks.detail_view = TaskDetailView::Auto;
        terminal
            .draw(|frame| {
                crate::ui::render(&mut app, frame);
            })
            .unwrap();
    }
}
