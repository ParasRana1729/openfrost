//! Application state and key handling. The TUI is keyboard-first: global
//! shortcuts (Ctrl+P tab picker, Ctrl+C quit), per-tab navigation, and modal
//! dialogs for forms. Every mutation goes through the loopback API client.

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
pub enum Screen {
    /// Waiting for the initial session check.
    Connecting,
    /// First run: create the owner account.
    Onboarding,
    /// Owner exists; sign in.
    Login,
    Main,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Assistant,
    Tasks,
    Projects,
    Memory,
    Routines,
    Settings,
}

pub const ALL_TABS: [Tab; 6] = [
    Tab::Assistant,
    Tab::Tasks,
    Tab::Projects,
    Tab::Memory,
    Tab::Routines,
    Tab::Settings,
];

impl Tab {
    pub fn title(self) -> &'static str {
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

pub struct Notice {
    pub message: String,
    pub is_error: bool,
    pub ticks_left: u64,
}

// ---------------------------------------------------------------------------
// Composer (Assistant tab)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ComposerField {
    #[default]
    Request,
    Kind,
    Project,
    Title,
    Constraints,
    StartingUrls,
}

#[derive(Default)]
pub struct AssistantState {
    pub request: TextArea<'static>,
    pub title: TextArea<'static>,
    pub constraints: TextArea<'static>,
    pub starting_urls: TextArea<'static>,
    /// false = research brief, true = project update.
    pub kind_project_update: bool,
    /// Index into the cached projects list; None = no project scope.
    pub project_idx: Option<usize>,
    pub advanced_open: bool,
    pub focus: ComposerField,
    pub projects: Vec<Project>,
    pub events: Vec<Event>,
    pub approvals: Vec<ApprovalView>,
    pub routines: Vec<RoutineView>,
    pub stream_scroll: u16,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,
    pub active_task_detail: Option<TaskDetail>,
    pub slash_help_open: bool,
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TaskFilter {
    #[default]
    All,
    Active,
    Queued,
    Done,
    Failed,
}

impl TaskFilter {
    pub fn next(self) -> Self {
        match self {
            TaskFilter::All => TaskFilter::Active,
            TaskFilter::Active => TaskFilter::Queued,
            TaskFilter::Queued => TaskFilter::Done,
            TaskFilter::Done => TaskFilter::Failed,
            TaskFilter::Failed => TaskFilter::All,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            TaskFilter::All => "All",
            TaskFilter::Active => "Active",
            TaskFilter::Queued => "Queued",
            TaskFilter::Done => "Done",
            TaskFilter::Failed => "Failed",
        }
    }

    pub fn matches(self, task: &Task) -> bool {
        match self {
            TaskFilter::All => true,
            TaskFilter::Active => {
                matches!(task.state, TaskState::Running | TaskState::AwaitingApproval)
            }
            TaskFilter::Queued => task.state == TaskState::Queued,
            TaskFilter::Done => task.state == TaskState::Completed,
            TaskFilter::Failed => matches!(
                task.state,
                TaskState::Failed | TaskState::Canceled | TaskState::Interrupted
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskDetailFocus {
    #[default]
    Report,
    Log,
}

impl TaskDetailFocus {
    pub fn toggle(self) -> Self {
        match self {
            Self::Report => Self::Log,
            Self::Log => Self::Report,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskDetailView {
    #[default]
    Auto,
    ReportOnly,
    LogOnly,
}

impl TaskDetailView {
    pub fn next(self) -> Self {
        match self {
            Self::Auto => Self::ReportOnly,
            Self::ReportOnly => Self::LogOnly,
            Self::LogOnly => Self::Auto,
        }
    }
}

#[derive(Default)]
pub struct TasksState {
    pub tasks: Vec<Task>,
    pub executor: Option<ExecutorStatus>,
    pub filter: TaskFilter,
    pub search: TextArea<'static>,
    pub searching: bool,
    pub selected: usize,
    pub detail: Option<TaskDetail>,
    pub artifact_scroll: u16,
    pub log_scroll: u16,
    pub detail_focus: TaskDetailFocus,
    pub detail_view: TaskDetailView,
    pub detail_open: bool,
}

impl TasksState {
    pub fn visible(&self) -> Vec<&Task> {
        let query = self
            .search
            .lines()
            .first()
            .map(String::as_str)
            .unwrap_or("")
            .to_lowercase();
        self.tasks
            .iter()
            .filter(|task| self.filter.matches(task))
            .filter(|task| {
                query.is_empty()
                    || task.title.to_lowercase().contains(&query)
                    || task.request.to_lowercase().contains(&query)
                    || task
                        .error
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&query)
            })
            .collect()
    }

    fn clamp_selection(&mut self) {
        let len = self.visible().len();
        if self.selected >= len {
            self.selected = len.saturating_sub(1);
        }
    }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct ProjectsState {
    pub projects: Vec<Project>,
    pub selected: usize,
    pub grant_selected: usize,
    pub detail_open: bool,
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/// One selectable row in the memory tab, flattened from the snapshot.
/// `ProjectHeader` is a non-selectable section marker.
#[derive(Debug, Clone)]
pub enum MemRow {
    Proposal(usize),
    GlobalEntry(usize),
    ProjectEntry { project: usize, entry: usize },
    ProjectHeader,
}

#[derive(Default)]
pub struct MemoryState {
    pub snapshot: Option<MemorySnapshot>,
    pub selected: usize,
    pub rows: Vec<MemRow>,
}

impl MemoryState {
    pub fn rebuild_rows(&mut self) {
        let mut rows = Vec::new();
        if let Some(snapshot) = &self.snapshot {
            for index in 0..snapshot.proposals.len() {
                rows.push(MemRow::Proposal(index));
            }
            for index in 0..snapshot.global.entries.len() {
                rows.push(MemRow::GlobalEntry(index));
            }
            for project in 0..snapshot.projects.len() {
                rows.push(MemRow::ProjectHeader);
                for entry in 0..snapshot.projects[project].entries.len() {
                    rows.push(MemRow::ProjectEntry { project, entry });
                }
            }
        }
        self.rows = rows;
        if self.selected >= self.rows.len() {
            self.selected = self.rows.len().saturating_sub(1);
        }
    }
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct RoutinesState {
    pub routines: Vec<RoutineView>,
    pub selected: usize,
    pub detail: Option<crate::api::RoutineDetail>,
    pub occurrence_selected: usize,
    pub detail_open: bool,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct SettingsState {
    pub settings: Option<AssistantSettings>,
    pub destinations: Vec<ExportDestination>,
    /// Rows before destinations: 0 provider, 1 provider key.
    pub selected: usize,
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

pub enum Dialog {
    Form(Form),
    Confirm {
        title: String,
        message: String,
        action: ConfirmAction,
    },
}

/// What a submitted form maps to; one variant per API call.
pub enum FormKind {
    CreateProject,
    EditProject { project_id: String },
    GrantFolder { project_id: String },
    AddDestination,
    SetProviderKey { provider: String },
    Export { artifact_id: String },
    CreateRoutine,
    EditRoutine { routine_id: String },
    EditMemoryEntry { entry_id: String, file_sha: String },
}

#[derive(Clone)]
pub enum ConfirmAction {
    RemoveProviderKey {
        provider: String,
    },
    RemoveDestination {
        destination_id: String,
    },
    RevokeGrant {
        project_id: String,
        grant_id: String,
    },
    DeleteMemoryEntry {
        entry_id: String,
        file_sha: String,
    },
    DeleteRoutine {
        routine_id: String,
    },
    RejectApproval {
        approval_id: String,
    },
    CancelTask {
        task_id: String,
    },
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

pub struct App {
    pub tx: AppTx,
    /// Cheap-to-clone, lock-free API handle; every task gets its own clone.
    pub api: ApiClient,
    /// Refresh scheduling: SSE state, activity debounce, in-flight tabs.
    pub sync: SyncState,
    /// Wakes the SSE loop out of its reconnect backoff (login, onboarding).
    pub sse_wake: Arc<Notify>,
    pub screen: Screen,
    pub tab: Tab,
    pub quit: bool,
    pub auth: TextArea<'static>,
    pub auth_busy: bool,
    pub assistant: AssistantState,
    pub tasks: TasksState,
    pub projects: ProjectsState,
    pub memory: MemoryState,
    pub routines: RoutinesState,
    pub settings: SettingsState,
    pub dialog: Option<Dialog>,
    /// When set, the Ctrl+P tab picker is open; value is the highlighted index.
    pub tab_picker: Option<usize>,
    pub notice: Option<Notice>,
    pub ticks: u64,
    session_generation: u64,
    detail_generation: u64,
    routine_detail_generation: u64,
    detail_target: Option<String>,
    pending_reads: Vec<PendingRead>,
}

impl App {
    pub fn new(tx: AppTx, api: ApiClient) -> Self {
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

    pub fn set_notice(&mut self, message: impl Into<String>, is_error: bool) {
        self.notice = Some(Notice {
            message: message.into(),
            is_error,
            ticks_left: 60,
        });
    }

    // -- Data loading -------------------------------------------------------

    pub fn refresh_all(&mut self) {
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
    pub fn refresh(&mut self, tab: Tab) {
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
    pub fn is_busy(&self) -> bool {
        self.assistant
            .active_task_detail
            .as_ref()
            .is_some_and(|d| d.task.state == TaskState::Running)
            || self.tasks.executor.as_ref().is_some_and(|e| e.busy)
    }

    /// An SSE `activity` ping: coalesced, not an immediate refresh.
    pub fn on_activity(&mut self) {
        if self.screen == Screen::Main {
            self.sync.note_activity(self.ticks);
        }
    }

    pub fn on_sse_connection(&mut self, connected: bool) {
        self.sync.set_sse_connected(connected, self.ticks);
    }

    pub fn on_refresh_done(&mut self, tab: Tab) {
        if self.sync.finish_refresh(tab) && self.screen == Screen::Main {
            self.refresh(tab);
        }
    }

    /// Apply completed reads, then run debounced activity, failed-read retries,
    /// or the polling fallback (only due while SSE is disconnected).
    pub fn pump_sync(&mut self) {
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

    pub fn open_task_detail(&mut self, task_id: String) {
        self.detail_generation += 1;
        self.detail_target = Some(task_id.clone());
        let api = self.api.clone();
        let tx = self.read_channel(None);
        spawn_payload(
            &tx,
            async move { api.task_detail(&task_id).await.map_err(|e| e.message()) },
            Payload::TaskDetail,
        );
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
    pub fn reset_read_session(&mut self) {
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

    pub fn open_routine_detail(&mut self, routine_id: String) {
        self.routine_detail_generation += 1;
        let api = self.api.clone();
        let tx = self.read_channel(None);
        spawn_payload(
            &tx,
            async move {
                api.routine_detail(&routine_id)
                    .await
                    .map_err(|e| e.message())
            },
            Payload::RoutineDetail,
        );
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

    pub fn on_key(&mut self, key: KeyEvent) {
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

    pub fn scroll_task_detail(&mut self, delta: i32) {
        let has_artifact = self
            .tasks
            .detail
            .as_ref()
            .and_then(|d| d.artifact.as_ref())
            .is_some();
        let target = match self.tasks.detail_view {
            TaskDetailView::ReportOnly => TaskDetailFocus::Report,
            TaskDetailView::LogOnly => TaskDetailFocus::Log,
            TaskDetailView::Auto => {
                if has_artifact {
                    self.tasks.detail_focus
                } else {
                    TaskDetailFocus::Log
                }
            }
        };
        match target {
            TaskDetailFocus::Report => {
                if delta > 0 {
                    self.tasks.artifact_scroll =
                        self.tasks.artifact_scroll.saturating_add(delta as u16);
                } else {
                    self.tasks.artifact_scroll =
                        self.tasks.artifact_scroll.saturating_sub((-delta) as u16);
                }
            }
            TaskDetailFocus::Log => {
                if delta > 0 {
                    self.tasks.log_scroll = self.tasks.log_scroll.saturating_add(delta as u16);
                } else {
                    self.tasks.log_scroll = self.tasks.log_scroll.saturating_sub((-delta) as u16);
                }
            }
        }
    }

    pub fn on_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
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

    pub fn scroll_down(&mut self, lines: u16) {
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

    pub fn scroll_up(&mut self, lines: u16) {
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

    pub fn switch_tab(&mut self, tab: Tab) {
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

    // -- Dialog handling --------------------------------------------------------

    fn handle_dialog_key(&mut self, dialog: Dialog, key: KeyEvent) {
        match dialog {
            Dialog::Confirm {
                title,
                message,
                action,
            } => match key.code {
                KeyCode::Enter => {
                    self.run_confirm(action);
                    // dialog intentionally dropped (closed)
                }
                _ => {
                    // Any other key keeps the dialog open.
                    self.dialog = Some(Dialog::Confirm {
                        title,
                        message,
                        action,
                    });
                }
            },
            Dialog::Form(mut form) => {
                if form.handle_key(key) {
                    self.dialog = Some(Dialog::Form(form));
                    return;
                }
                // handle_key returned false: Esc closed, Ctrl+S submitted —
                // distinguish by re-checking the key.
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
                    if let Err(message) = self.submit_form(&form) {
                        form.error = Some(message);
                        self.dialog = Some(Dialog::Form(form));
                    }
                }
                // Esc: dialog closed without submitting.
            }
        }
    }

    fn run_confirm(&mut self, action: ConfirmAction) {
        match action {
            ConfirmAction::RemoveProviderKey { provider } => {
                let api = self.api.clone();
                let shown = provider.clone();
                self.spawn_mutation(format!("Key removed ({shown})"), async move {
                    api.remove_provider_key(&provider).await
                });
            }
            ConfirmAction::RemoveDestination { destination_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Destination removed", async move {
                    api.remove_destination(&destination_id).await
                });
            }
            ConfirmAction::RevokeGrant {
                project_id,
                grant_id,
            } => {
                let api = self.api.clone();
                self.spawn_mutation("Folder grant revoked", async move {
                    api.revoke_folder(&project_id, &grant_id).await
                });
            }
            ConfirmAction::DeleteMemoryEntry { entry_id, file_sha } => {
                let api = self.api.clone();
                self.spawn_mutation("Memory entry deleted", async move {
                    let input = DeleteMemoryEntryRequest {
                        fileSha256: file_sha,
                    };
                    api.delete_memory_entry(&entry_id, &input).await
                });
            }
            ConfirmAction::DeleteRoutine { routine_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Routine removed", async move {
                    api.delete_routine(&routine_id).await
                });
            }
            ConfirmAction::RejectApproval { approval_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Export rejected", async move {
                    api.decide_approval(&approval_id, "rejected")
                        .await
                        .map(|_| ())
                });
            }
            ConfirmAction::CancelTask { task_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Cancel requested", async move {
                    api.cancel_task(&task_id).await.map(|_| ())
                });
            }
        }
    }

    // Assistant tab -----------------------------------------------------------

    fn handle_assistant_key(&mut self, key: KeyEvent) {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            self.submit_or_command();
            return;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('a') {
            self.assistant.advanced_open = !self.assistant.advanced_open;
            return;
        }
        match key.code {
            KeyCode::PageUp => {
                self.scroll_up(10);
            }
            KeyCode::PageDown => {
                self.scroll_down(10);
            }
            KeyCode::Tab => {
                if !self.assistant.advanced_open && self.assistant.focus == ComposerField::Request {
                    self.cycle_select(1);
                    let name = self
                        .assistant
                        .project_idx
                        .and_then(|i| self.assistant.projects.get(i))
                        .map(|p| p.name.as_str())
                        .unwrap_or("no project scope");
                    self.set_notice(format!("Scope: {name}"), false);
                } else {
                    self.assistant.focus = next_composer_field(
                        self.assistant.focus,
                        self.assistant.advanced_open,
                        false,
                    );
                }
            }
            KeyCode::BackTab => {
                if !self.assistant.advanced_open && self.assistant.focus == ComposerField::Request {
                    self.assistant.kind_project_update = !self.assistant.kind_project_update;
                    let k = if self.assistant.kind_project_update {
                        "project update"
                    } else {
                        "research brief"
                    };
                    self.set_notice(format!("Task kind: {k}"), false);
                } else {
                    self.assistant.focus = next_composer_field(
                        self.assistant.focus,
                        self.assistant.advanced_open,
                        true,
                    );
                }
            }
            _ => match self.assistant.focus {
                ComposerField::Request => {
                    if key.code == KeyCode::Enter {
                        if key.modifiers.contains(KeyModifiers::SHIFT)
                            || key.modifiers.contains(KeyModifiers::ALT)
                        {
                            self.assistant.request.insert_newline();
                        } else {
                            self.submit_or_command();
                        }
                    } else if key.code == KeyCode::Up && self.assistant.request.cursor().0 == 0 {
                        self.history_prev();
                    } else if key.code == KeyCode::Down
                        && self.assistant.request.cursor().0 + 1
                            >= self.assistant.request.lines().len()
                    {
                        self.history_next();
                    } else {
                        let _ = self.assistant.request.input(key);
                    }
                }
                ComposerField::Constraints => {
                    let _ = self.assistant.constraints.input(key);
                }
                ComposerField::Title => {
                    let _ = self.assistant.title.input(key);
                }
                ComposerField::StartingUrls => {
                    let _ = self.assistant.starting_urls.input(key);
                }
                ComposerField::Kind | ComposerField::Project => match key.code {
                    KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') => self.cycle_select(1),
                    KeyCode::Left | KeyCode::Char('h') => self.cycle_select(-1),
                    _ => {}
                },
            },
        }
    }

    fn submit_or_command(&mut self) {
        let text = self.assistant.request.lines().join("\n").trim().to_string();
        if text.is_empty() {
            self.set_notice("Type a request or /command", true);
            return;
        }
        if text.starts_with('/') {
            self.execute_slash_command(&text);
            return;
        }
        if self.assistant.history.last().map(|s| s.as_str()) != Some(&text) {
            self.assistant.history.push(text.clone());
        }
        self.assistant.history_idx = None;
        self.assistant.stream_scroll = 0;
        self.submit_task();
    }

    fn execute_slash_command(&mut self, text: &str) {
        let parts: Vec<&str> = text.split_whitespace().collect();
        let cmd = parts.first().copied().unwrap_or("");
        let arg = if parts.len() > 1 {
            parts[1..].join(" ")
        } else {
            String::new()
        };

        self.assistant.request = TextArea::default();

        match cmd {
            "/help" | "/?" => {
                self.assistant.slash_help_open = !self.assistant.slash_help_open;
            }
            "/project" | "/p" => {
                if arg.is_empty() {
                    self.cycle_select(1);
                    let name = self
                        .assistant
                        .project_idx
                        .and_then(|i| self.assistant.projects.get(i))
                        .map(|p| p.name.as_str())
                        .unwrap_or("no project scope");
                    self.set_notice(format!("Scope: {name}"), false);
                } else {
                    let needle = arg.to_lowercase();
                    if let Some(pos) = self
                        .assistant
                        .projects
                        .iter()
                        .position(|p| p.name.to_lowercase().contains(&needle))
                    {
                        self.assistant.project_idx = Some(pos);
                        let name = &self.assistant.projects[pos].name;
                        self.set_notice(format!("Scope switched to: {name}"), false);
                    } else if arg == "none" || arg == "clear" {
                        self.assistant.project_idx = None;
                        self.set_notice("Scope cleared (no project)", false);
                    } else {
                        self.set_notice(format!("Project matching '{arg}' not found"), true);
                    }
                }
            }
            "/tasks" | "/t" => {
                self.switch_tab(Tab::Tasks);
            }
            "/settings" | "/s" => {
                self.switch_tab(Tab::Settings);
            }
            "/memory" | "/m" => {
                self.switch_tab(Tab::Memory);
            }
            "/routines" | "/r" => {
                self.switch_tab(Tab::Routines);
            }
            "/clear" => {
                self.assistant.stream_scroll = 0;
                self.assistant.active_task_detail = None;
                self.set_notice("Session stream cleared", false);
            }
            "/cancel" => {
                if let Some(detail) = &self.assistant.active_task_detail {
                    let task_id = detail.task.id.clone();
                    let api = self.api.clone();
                    self.spawn_mutation("Task cancellation requested", async move {
                        api.cancel_task(&task_id).await.map(|_| ())
                    });
                } else {
                    self.set_notice("No active task to cancel", true);
                }
            }
            _ => {
                self.set_notice(
                    format!("Unknown command: {cmd}. Type /help for available commands."),
                    true,
                );
            }
        }
    }

    fn history_prev(&mut self) {
        if self.assistant.history.is_empty() {
            return;
        }
        let next_idx = match self.assistant.history_idx {
            None => self.assistant.history.len().saturating_sub(1),
            Some(idx) => idx.saturating_sub(1),
        };
        self.assistant.history_idx = Some(next_idx);
        let entry = self.assistant.history[next_idx].clone();
        self.assistant.request = TextArea::new(entry.lines().map(str::to_string).collect());
    }

    fn history_next(&mut self) {
        if let Some(idx) = self.assistant.history_idx {
            if idx + 1 < self.assistant.history.len() {
                let next_idx = idx + 1;
                self.assistant.history_idx = Some(next_idx);
                let entry = self.assistant.history[next_idx].clone();
                self.assistant.request = TextArea::new(entry.lines().map(str::to_string).collect());
            } else {
                self.assistant.history_idx = None;
                self.assistant.request = TextArea::default();
            }
        }
    }

    fn cycle_select(&mut self, delta: i32) {
        if self.assistant.focus == ComposerField::Kind {
            self.assistant.kind_project_update = !self.assistant.kind_project_update;
            return;
        }
        if self.assistant.projects.is_empty() {
            return;
        }
        let len = self.assistant.projects.len() as i32;
        let current = self
            .assistant
            .project_idx
            .map(|index| index as i32)
            .unwrap_or(-1);
        let mut next = current + delta;
        if next < -1 {
            next = len - 1;
        }
        if next >= len {
            next = -1;
        }
        self.assistant.project_idx = if next < 0 { None } else { Some(next as usize) };
    }

    pub fn submit_task(&mut self) {
        let request = self.assistant.request.lines().join("\n").trim().to_string();
        if request.is_empty() {
            self.set_notice("Describe the request first", true);
            return;
        }
        let kind = if self.assistant.kind_project_update {
            TaskKind::ProjectUpdate
        } else {
            TaskKind::ResearchBrief
        };
        let project_id = if kind == TaskKind::ProjectUpdate {
            match self
                .assistant
                .project_idx
                .and_then(|index| self.assistant.projects.get(index))
            {
                Some(project) => Some(project.id.clone()),
                None => {
                    self.set_notice(
                        "A project update needs a project — pick one in the Project field",
                        true,
                    );
                    return;
                }
            }
        } else {
            self.assistant
                .project_idx
                .and_then(|index| self.assistant.projects.get(index))
                .map(|project| project.id.clone())
        };
        let title_input = self
            .assistant
            .title
            .lines()
            .first()
            .cloned()
            .unwrap_or_default();
        let title = if title_input.trim().is_empty() {
            let first_line = request.lines().next().unwrap_or("Untitled task").trim();
            if first_line.is_empty() {
                "Untitled task".to_string()
            } else {
                truncate(first_line, 80)
            }
        } else {
            title_input.trim().to_string()
        };
        let constraints = self
            .assistant
            .constraints
            .lines()
            .join("\n")
            .trim()
            .to_string();
        let urls_raw = self.assistant.starting_urls.lines().join(" ");
        let starting_urls: Vec<String> = urls_raw
            .split(|c: char| c == ',' || c.is_whitespace())
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .map(str::to_string)
            .collect();
        let input = CreateTaskRequest {
            title: Some(title),
            request,
            constraints: if constraints.is_empty() {
                None
            } else {
                Some(constraints)
            },
            startingUrls: if starting_urls.is_empty() {
                None
            } else {
                Some(starting_urls)
            },
            projectId: project_id,
            kind: Some(kind),
        };
        let api = self.api.clone();
        self.spawn_mutation("Task queued", async move {
            api.create_task(&input).await.map(|_| ())
        });
        self.assistant.request = TextArea::default();
        self.assistant.title = TextArea::default();
        self.assistant.constraints = TextArea::default();
        self.assistant.starting_urls = TextArea::default();
        self.assistant.focus = ComposerField::Request;
    }

    // Tasks tab ---------------------------------------------------------------

    fn handle_tasks_key(&mut self, key: KeyEvent) {
        if self.tasks.searching {
            match key.code {
                KeyCode::Esc => {
                    self.tasks.searching = false;
                    self.tasks.search = TextArea::default();
                }
                KeyCode::Enter => self.tasks.searching = false,
                _ => {
                    let _ = self.tasks.search.input(key);
                    self.tasks.selected = 0;
                }
            }
            return;
        }
        if self.tasks.detail_open {
            self.handle_task_detail_key(key);
            return;
        }
        let count = self.tasks.visible().len();
        match key.code {
            KeyCode::Esc => self.detail_generation += 1,
            KeyCode::Char('f') => {
                self.tasks.filter = self.tasks.filter.next();
                self.tasks.clamp_selection();
            }
            KeyCode::Char('/') => {
                self.tasks.searching = true;
            }
            KeyCode::Char('R') => {
                let api = self.api.clone();
                self.spawn_mutation(
                    "Dispatch resumed",
                    async move { api.resume_dispatch().await },
                );
            }
            KeyCode::Char('j') | KeyCode::Down if count > 0 => {
                self.tasks.selected = (self.tasks.selected + 1).min(count - 1);
            }
            KeyCode::Char('k') | KeyCode::Up if count > 0 => {
                self.tasks.selected = self.tasks.selected.saturating_sub(1);
            }
            KeyCode::PageDown => {
                self.scroll_down(10);
            }
            KeyCode::PageUp => {
                self.scroll_up(10);
            }
            KeyCode::Enter if count > 0 => {
                if let Some(task) = self.tasks.visible().get(self.tasks.selected) {
                    let task_id = task.id.clone();
                    self.open_task_detail(task_id);
                }
            }
            KeyCode::Char('c') if count > 0 => {
                if let Some(task) = self.tasks.visible().get(self.tasks.selected) {
                    if matches!(
                        task.state,
                        TaskState::Queued
                            | TaskState::Running
                            | TaskState::AwaitingApproval
                            | TaskState::Interrupted
                    ) {
                        self.dialog = Some(Dialog::Confirm {
                            title: "Cancel task".into(),
                            message: format!(
                                "Cancel \"{}\"? In-flight requests are aborted; completed work is not undone.",
                                task.title
                            ),
                            action: ConfirmAction::CancelTask { task_id: task.id.clone() },
                        });
                    }
                }
            }
            KeyCode::Char('r') if count > 0 => {
                if let Some(task) = self.tasks.visible().get(self.tasks.selected) {
                    if matches!(
                        task.state,
                        TaskState::Failed | TaskState::Canceled | TaskState::Interrupted
                    ) {
                        let task_id = task.id.clone();
                        let api = self.api.clone();
                        self.spawn_mutation("Task requeued", async move {
                            api.retry_task(&task_id).await.map(|_| ())
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn handle_task_detail_key(&mut self, key: KeyEvent) {
        let has_artifact = self
            .tasks
            .detail
            .as_ref()
            .and_then(|d| d.artifact.as_ref())
            .is_some();
        match key.code {
            KeyCode::Esc | KeyCode::Char('b') => {
                self.detail_generation += 1;
                self.tasks.detail_open = false;
                self.tasks.detail = None;
                self.tasks.artifact_scroll = 0;
                self.tasks.log_scroll = 0;
                self.tasks.detail_focus = TaskDetailFocus::Report;
                self.tasks.detail_view = TaskDetailView::Auto;
            }
            KeyCode::Tab => {
                if has_artifact {
                    match self.tasks.detail_view {
                        TaskDetailView::Auto => {
                            self.tasks.detail_focus = self.tasks.detail_focus.toggle();
                        }
                        TaskDetailView::ReportOnly => {
                            self.tasks.detail_view = TaskDetailView::LogOnly;
                            self.tasks.detail_focus = TaskDetailFocus::Log;
                        }
                        TaskDetailView::LogOnly => {
                            self.tasks.detail_view = TaskDetailView::ReportOnly;
                            self.tasks.detail_focus = TaskDetailFocus::Report;
                        }
                    }
                }
            }
            KeyCode::Char('v') | KeyCode::Char('m') => {
                if has_artifact {
                    self.tasks.detail_view = self.tasks.detail_view.next();
                }
            }
            KeyCode::Left | KeyCode::Char('h')
                if has_artifact && self.tasks.detail_view == TaskDetailView::Auto =>
            {
                self.tasks.detail_focus = TaskDetailFocus::Log;
            }
            KeyCode::Right | KeyCode::Char('l')
                if has_artifact && self.tasks.detail_view == TaskDetailView::Auto =>
            {
                self.tasks.detail_focus = TaskDetailFocus::Report;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                self.scroll_task_detail(1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.scroll_task_detail(-1);
            }
            KeyCode::PageDown => {
                self.scroll_task_detail(15);
            }
            KeyCode::PageUp => {
                self.scroll_task_detail(-15);
            }
            KeyCode::Home => match self.tasks.detail_focus {
                TaskDetailFocus::Report => self.tasks.artifact_scroll = 0,
                TaskDetailFocus::Log => self.tasks.log_scroll = 0,
            },
            KeyCode::End => match self.tasks.detail_focus {
                TaskDetailFocus::Report => self.tasks.artifact_scroll = u16::MAX,
                TaskDetailFocus::Log => self.tasks.log_scroll = u16::MAX,
            },
            KeyCode::Char('c') => {
                if let Some(detail) = &self.tasks.detail {
                    if matches!(
                        detail.task.state,
                        TaskState::Queued
                            | TaskState::Running
                            | TaskState::AwaitingApproval
                            | TaskState::Interrupted
                    ) {
                        self.dialog = Some(Dialog::Confirm {
                            title: "Cancel task".into(),
                            message: format!("Cancel \"{}\"?", detail.task.title),
                            action: ConfirmAction::CancelTask {
                                task_id: detail.task.id.clone(),
                            },
                        });
                    }
                }
            }
            KeyCode::Char('r') => {
                if let Some(detail) = &self.tasks.detail {
                    if matches!(
                        detail.task.state,
                        TaskState::Failed | TaskState::Canceled | TaskState::Interrupted
                    ) {
                        let task_id = detail.task.id.clone();
                        let api = self.api.clone();
                        self.spawn_mutation("Task requeued", async move {
                            api.retry_task(&task_id).await.map(|_| ())
                        });
                    }
                }
            }
            KeyCode::Char('g') | KeyCode::Char('d') => {
                let Some(detail) = &self.tasks.detail else {
                    return;
                };
                let Some(approval) = &detail.approval else {
                    return;
                };
                if approval.state != ApprovalState::Pending {
                    return;
                }
                if key.code == KeyCode::Char('g') {
                    let approval_id = approval.id.clone();
                    let api = self.api.clone();
                    self.spawn_mutation("Export approved", async move {
                        api.decide_approval(&approval_id, "granted")
                            .await
                            .map(|_| ())
                    });
                } else {
                    self.dialog = Some(Dialog::Confirm {
                        title: "Reject export".into(),
                        message: format!(
                            "Reject writing \"{}\" to {}?",
                            approval.filename, approval.destinationPath
                        ),
                        action: ConfirmAction::RejectApproval {
                            approval_id: approval.id.clone(),
                        },
                    });
                }
            }
            KeyCode::Char('e') => {
                let Some(detail) = &self.tasks.detail else {
                    return;
                };
                if let Some(artifact_id) = detail.task.resultArtifactId.clone() {
                    let api = self.api.clone();
                    let tx = self.tx.clone();
                    spawn_payload(
                        &tx,
                        async move { api.destinations().await.map_err(|e| e.message()) },
                        Payload::Destinations,
                    );
                    self.dialog = Some(Dialog::Form(Form::export(artifact_id)));
                }
            }
            _ => {}
        }
    }

    // Projects tab ---------------------------------------------------------------

    fn handle_projects_key(&mut self, key: KeyEvent) {
        if self.projects.detail_open {
            let grant_count = self
                .projects
                .projects
                .get(self.projects.selected)
                .map(|project| project.grants.len())
                .unwrap_or(0);
            match key.code {
                KeyCode::Esc | KeyCode::Char('b') => {
                    self.projects.detail_open = false;
                    self.projects.grant_selected = 0;
                }
                KeyCode::Char('j') | KeyCode::Down if grant_count > 0 => {
                    self.projects.grant_selected =
                        (self.projects.grant_selected + 1).min(grant_count - 1);
                }
                KeyCode::Char('k') | KeyCode::Up if grant_count > 0 => {
                    self.projects.grant_selected = self.projects.grant_selected.saturating_sub(1);
                }
                KeyCode::Char('g') => {
                    if let Some(project) = self.projects.projects.get(self.projects.selected) {
                        self.dialog = Some(Dialog::Form(Form::grant_folder(project.id.clone())));
                    }
                }
                KeyCode::Char('x') if grant_count > 0 => {
                    if let Some(project) = self.projects.projects.get(self.projects.selected) {
                        if let Some(grant) = project.grants.get(self.projects.grant_selected) {
                            self.dialog = Some(Dialog::Confirm {
                                title: "Revoke folder grant".into(),
                                message: format!("Revoke access to {}?", grant.path),
                                action: ConfirmAction::RevokeGrant {
                                    project_id: project.id.clone(),
                                    grant_id: grant.id.clone(),
                                },
                            });
                        }
                    }
                }
                _ => {}
            }
            return;
        }
        let count = self.projects.projects.len();
        match key.code {
            KeyCode::Char('n') => {
                self.dialog = Some(Dialog::Form(Form::create_project()));
            }
            KeyCode::Char('j') | KeyCode::Down if count > 0 => {
                self.projects.selected = (self.projects.selected + 1).min(count - 1);
            }
            KeyCode::Char('k') | KeyCode::Up if count > 0 => {
                self.projects.selected = self.projects.selected.saturating_sub(1);
            }
            KeyCode::Enter if count > 0 => {
                self.projects.detail_open = true;
                self.projects.grant_selected = 0;
            }
            KeyCode::Char('e') if count > 0 => {
                if let Some(project) = self.projects.projects.get(self.projects.selected) {
                    self.dialog = Some(Dialog::Form(Form::edit_project(project)));
                }
            }
            _ => {}
        }
    }

    // Memory tab --------------------------------------------------------------

    fn handle_memory_key(&mut self, key: KeyEvent) {
        let count = self.memory.rows.len();
        match key.code {
            KeyCode::Char('j') | KeyCode::Down if count > 0 => {
                self.memory.selected = (self.memory.selected + 1).min(count - 1);
            }
            KeyCode::Char('k') | KeyCode::Up if count > 0 => {
                self.memory.selected = self.memory.selected.saturating_sub(1);
            }
            KeyCode::Char('R') => {
                let api = self.api.clone();
                self.spawn_mutation("Memory reloaded from disk", async move {
                    api.reload_memory().await
                });
            }
            KeyCode::Char('a') => {
                let Some(snapshot) = self.memory.snapshot.clone() else {
                    return;
                };
                if let Some(MemRow::Proposal(index)) = self.memory.rows.get(self.memory.selected) {
                    let Some(proposal) = snapshot.proposals.get(*index) else {
                        return;
                    };
                    let file_sha = if proposal.scope == MemoryScope::Global {
                        snapshot.global.sha256.clone()
                    } else {
                        snapshot
                            .projects
                            .iter()
                            .find(|view| Some(&view.projectId) == proposal.projectId.as_ref())
                            .and_then(|view| view.sha256.clone())
                    };
                    let input = ApproveMemoryProposalRequest {
                        content: None,
                        fileSha256: file_sha,
                    };
                    let proposal_id = proposal.id.clone();
                    let api = self.api.clone();
                    self.spawn_mutation("Memory approved", async move {
                        api.approve_memory_proposal(&proposal_id, &input).await
                    });
                }
            }
            KeyCode::Char('x') => {
                let Some(snapshot) = self.memory.snapshot.clone() else {
                    return;
                };
                if let Some(MemRow::Proposal(index)) = self.memory.rows.get(self.memory.selected) {
                    if let Some(proposal) = snapshot.proposals.get(*index) {
                        let proposal_id = proposal.id.clone();
                        let api = self.api.clone();
                        self.spawn_mutation("Memory proposal rejected", async move {
                            api.reject_memory_proposal(&proposal_id).await
                        });
                    }
                }
            }
            KeyCode::Char('e') => {
                let Some(snapshot) = self.memory.snapshot.clone() else {
                    return;
                };
                match self.memory.rows.get(self.memory.selected) {
                    Some(MemRow::GlobalEntry(index)) => {
                        if let Some(entry) = snapshot.global.entries.get(*index) {
                            if let Some(sha) = &snapshot.global.sha256 {
                                self.dialog = Some(Dialog::Form(Form::edit_memory_entry(
                                    &entry.id,
                                    sha,
                                    &entry.content,
                                )));
                            }
                        }
                    }
                    Some(MemRow::ProjectEntry { project, entry }) => {
                        if let Some(view) = snapshot.projects.get(*project) {
                            if let Some(entry) = view.entries.get(*entry) {
                                if let Some(sha) = &view.sha256 {
                                    self.dialog = Some(Dialog::Form(Form::edit_memory_entry(
                                        &entry.id,
                                        sha,
                                        &entry.content,
                                    )));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            KeyCode::Char('d') => {
                let Some(snapshot) = self.memory.snapshot.clone() else {
                    return;
                };
                let target = match self.memory.rows.get(self.memory.selected) {
                    Some(MemRow::GlobalEntry(index)) => {
                        snapshot.global.entries.get(*index).map(|entry| {
                            (
                                entry.id.clone(),
                                entry.content.clone(),
                                snapshot.global.sha256.clone(),
                            )
                        })
                    }
                    Some(MemRow::ProjectEntry { project, entry }) => {
                        snapshot.projects.get(*project).and_then(|view| {
                            view.entries.get(*entry).map(|entry| {
                                (entry.id.clone(), entry.content.clone(), view.sha256.clone())
                            })
                        })
                    }
                    _ => None,
                };
                if let Some((entry_id, content, file_sha)) = target {
                    let Some(file_sha) = file_sha else {
                        self.set_notice(
                            "The memory file has no recorded version; reload first",
                            true,
                        );
                        return;
                    };
                    self.dialog = Some(Dialog::Confirm {
                        title: "Delete memory entry".into(),
                        message: format!(
                            "Delete \"{}\"? It leaves future context; source reports are untouched.",
                            truncate(&content, 60)
                        ),
                        action: ConfirmAction::DeleteMemoryEntry { entry_id, file_sha },
                    });
                }
            }
            _ => {}
        }
    }

    // Routines tab ---------------------------------------------------------------

    fn handle_routines_key(&mut self, key: KeyEvent) {
        if self.routines.detail_open {
            let occurrence_count = self
                .routines
                .detail
                .as_ref()
                .map(|detail| detail.occurrences.len())
                .unwrap_or(0);
            match key.code {
                KeyCode::Esc | KeyCode::Char('b') => {
                    self.routine_detail_generation += 1;
                    self.routines.detail_open = false;
                    self.routines.detail = None;
                    self.routines.occurrence_selected = 0;
                }
                KeyCode::Char('j') | KeyCode::Down if occurrence_count > 0 => {
                    self.routines.occurrence_selected =
                        (self.routines.occurrence_selected + 1).min(occurrence_count - 1);
                }
                KeyCode::Char('k') | KeyCode::Up if occurrence_count > 0 => {
                    self.routines.occurrence_selected =
                        self.routines.occurrence_selected.saturating_sub(1);
                }
                KeyCode::Char('r') | KeyCode::Char('s') => {
                    let detail = self.routines.detail.clone();
                    let Some(detail) = detail else {
                        return;
                    };
                    if let Some(occurrence) =
                        detail.occurrences.get(self.routines.occurrence_selected)
                    {
                        if occurrence.state == RoutineOccurrenceState::Missed {
                            let routine_id = detail.view.routine.id.clone();
                            let occurrence_key = occurrence.occurrenceKey.clone();
                            let run_now = key.code == KeyCode::Char('r');
                            let api = self.api.clone();
                            let label = if run_now {
                                "Occurrence queued to run now"
                            } else {
                                "Occurrence skipped"
                            };
                            self.spawn_mutation(label, async move {
                                if run_now {
                                    api.run_occurrence_now(&routine_id, &occurrence_key)
                                        .await
                                        .map(|_| ())
                                } else {
                                    api.skip_occurrence(&routine_id, &occurrence_key)
                                        .await
                                        .map(|_| ())
                                }
                            });
                        }
                    }
                }
                _ => {}
            }
            return;
        }
        let count = self.routines.routines.len();
        match key.code {
            KeyCode::Esc | KeyCode::Char('b') => self.routine_detail_generation += 1,
            KeyCode::Char('n') => {
                let api = self.api.clone();
                let tx = self.tx.clone();
                spawn_payload(
                    &tx,
                    async move { api.projects().await.map_err(|e| e.message()) },
                    Payload::Projects,
                );
                self.dialog = Some(Dialog::Form(Form::create_routine()));
            }
            KeyCode::Char('E') if count > 0 => {
                if let Some(routine) = self.routines.routines.get(self.routines.selected) {
                    let api = self.api.clone();
                    let tx = self.tx.clone();
                    spawn_payload(
                        &tx,
                        async move { api.projects().await.map_err(|e| e.message()) },
                        Payload::Projects,
                    );
                    self.dialog = Some(Dialog::Form(Form::edit_routine(&routine.routine)));
                }
            }
            KeyCode::Char('j') | KeyCode::Down if count > 0 => {
                self.routines.selected = (self.routines.selected + 1).min(count - 1);
            }
            KeyCode::Char('k') | KeyCode::Up if count > 0 => {
                self.routines.selected = self.routines.selected.saturating_sub(1);
            }
            KeyCode::Enter if count > 0 => {
                if let Some(routine) = self.routines.routines.get(self.routines.selected) {
                    let routine_id = routine.routine.id.clone();
                    self.open_routine_detail(routine_id);
                }
            }
            KeyCode::Char('e') if count > 0 => {
                if let Some(routine) = self.routines.routines.get(self.routines.selected) {
                    let enable = routine.routine.state == RoutineState::Paused;
                    let routine_id = routine.routine.id.clone();
                    let api = self.api.clone();
                    let label = if enable {
                        "Routine enabled"
                    } else {
                        "Routine paused"
                    };
                    self.spawn_mutation(label, async move {
                        if enable {
                            api.enable_routine(&routine_id).await.map(|_| ())
                        } else {
                            api.pause_routine(&routine_id).await.map(|_| ())
                        }
                    });
                }
            }
            KeyCode::Char('x') if count > 0 => {
                if let Some(routine) = self.routines.routines.get(self.routines.selected) {
                    self.dialog = Some(Dialog::Confirm {
                        title: "Remove routine".into(),
                        message: format!(
                            "Remove \"{}\"? Scheduled future work stops; saved tasks stay.",
                            routine.routine.name
                        ),
                        action: ConfirmAction::DeleteRoutine {
                            routine_id: routine.routine.id.clone(),
                        },
                    });
                }
            }
            _ => {}
        }
    }

    // Settings tab ---------------------------------------------------------------

    fn handle_settings_key(&mut self, key: KeyEvent) {
        let total_rows = 2 + self.settings.destinations.len();
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                self.settings.selected =
                    (self.settings.selected + 1).min(total_rows.saturating_sub(1));
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.settings.selected = self.settings.selected.saturating_sub(1);
            }
            KeyCode::Enter => {
                self.settings_activate();
            }
            KeyCode::Char('a') => {
                self.dialog = Some(Dialog::Form(Form::add_destination()));
            }
            KeyCode::Char('x') if self.settings.selected == 1 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                if settings.provider == "fake" || !settings.hasProviderKey {
                    return;
                }
                self.dialog = Some(Dialog::Confirm {
                    title: "Remove provider key".into(),
                    message: format!(
                        "Remove the stored key for {}? Tasks fail until a key is set again.",
                        settings.provider
                    ),
                    action: ConfirmAction::RemoveProviderKey {
                        provider: settings.provider.clone(),
                    },
                });
            }
            KeyCode::Char('x') if self.settings.selected >= 2 => {
                let index = self.settings.selected - 2;
                if let Some(destination) = self.settings.destinations.get(index) {
                    self.dialog = Some(Dialog::Confirm {
                        title: "Remove export destination".into(),
                        message: format!("Remove {} as an export destination?", destination.path),
                        action: ConfirmAction::RemoveDestination {
                            destination_id: destination.id.clone(),
                        },
                    });
                }
            }
            _ => {}
        }
    }

    fn settings_activate(&mut self) {
        match self.settings.selected {
            0 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                let order = ["openai", "gemini", "openrouter"];
                let current = order
                    .iter()
                    .position(|provider| *provider == settings.provider);
                let next = match current {
                    Some(index) => (index + 1) % order.len(),
                    None => 0,
                };
                let provider = order[next].to_string();
                let input = SetProviderConfigRequest {
                    provider: provider.clone(),
                    model: None,
                };
                let api = self.api.clone();
                self.spawn_mutation(format!("Provider switched to {provider}"), async move {
                    api.set_provider(&input).await
                });
            }
            1 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                if settings.provider == "fake" {
                    self.set_notice("The fake provider hook does not take a key", true);
                    return;
                }
                self.dialog = Some(Dialog::Form(Form::set_provider_key(
                    &settings.provider,
                    settings.hasProviderKey,
                )));
            }
            _ => {}
        }
    }

    // -- Form submissions ---------------------------------------------------------

    fn submit_form(&mut self, form: &Form) -> Result<(), String> {
        let values = form.values();
        match &form.kind {
            FormKind::CreateProject => {
                let name = values.first().cloned().unwrap_or_default();
                if name.trim().is_empty() {
                    return Err("Name is required".into());
                }
                let instructions = values.get(1).cloned().unwrap_or_default();
                let input = CreateProjectRequest {
                    name: name.trim().to_string(),
                    instructions: if instructions.trim().is_empty() {
                        None
                    } else {
                        Some(instructions.trim().to_string())
                    },
                };
                let api = self.api.clone();
                self.spawn_mutation("Project created", async move {
                    api.create_project(&input).await.map(|_| ())
                });
                Ok(())
            }
            FormKind::EditProject { project_id } => {
                let name = values.first().cloned().unwrap_or_default();
                if name.trim().is_empty() {
                    return Err("Name is required".into());
                }
                let instructions = values.get(1).cloned().unwrap_or_default();
                let input = UpdateProjectRequest {
                    name: Some(name.trim().to_string()),
                    instructions: Some(instructions.trim().to_string()),
                };
                let project_id = project_id.clone();
                let api = self.api.clone();
                self.spawn_mutation("Project updated", async move {
                    api.update_project(&project_id, &input).await.map(|_| ())
                });
                Ok(())
            }
            FormKind::GrantFolder { project_id } => {
                let path = values.first().cloned().unwrap_or_default();
                if path.trim().is_empty() {
                    return Err("Folder path is required".into());
                }
                let project_id = project_id.clone();
                let api = self.api.clone();
                self.spawn_mutation("Folder granted", async move {
                    api.grant_folder(&project_id, path.trim()).await.map(|_| ())
                });
                Ok(())
            }
            FormKind::AddDestination => {
                let path = values.first().cloned().unwrap_or_default();
                if path.trim().is_empty() {
                    return Err("Folder path is required".into());
                }
                let api = self.api.clone();
                self.spawn_mutation("Destination granted", async move {
                    api.add_destination(path.trim()).await.map(|_| ())
                });
                Ok(())
            }
            FormKind::SetProviderKey { provider } => {
                let key = values.first().cloned().unwrap_or_default();
                if key.trim().len() < 10 {
                    return Err("That key looks too short (min 10 characters)".into());
                }
                let provider = provider.clone();
                let input = SetProviderKeyRequest {
                    provider: provider.clone(),
                    key: key.trim().to_string(),
                };
                let api = self.api.clone();
                self.spawn_mutation(format!("Key stored ({provider})"), async move {
                    api.set_provider_key(&input).await
                });
                Ok(())
            }
            FormKind::Export { artifact_id } => {
                let destination_id = {
                    let form = &form;
                    let index = form.select_index(0);
                    match &form.fields[0] {
                        crate::dialog_forms::Field::Select { options, .. } => {
                            // Options carry "id — path" labels; recover the id.
                            options
                                .get(index)
                                .and_then(|label| label.split(" \u{2014} ").next())
                                .map(str::to_string)
                                .unwrap_or_default()
                        }
                        _ => String::new(),
                    }
                };
                let filename = values.get(1).cloned().unwrap_or_default();
                if destination_id.is_empty() {
                    return Err("Pick an export destination".into());
                }
                if !filename.ends_with(".md") || filename.trim().len() < 5 {
                    return Err("Filename must be at least 5 characters and end in .md".into());
                }
                let input = CreateExportRequest {
                    artifactId: artifact_id.clone(),
                    destinationId: destination_id,
                    filename: filename.trim().to_string(),
                };
                let api = self.api.clone();
                self.spawn_mutation("Export queued for approval", async move {
                    api.request_export(&input).await.map(|_| ())
                });
                Ok(())
            }
            FormKind::CreateRoutine | FormKind::EditRoutine { .. } => {
                let name = values.first().cloned().unwrap_or_default();
                let project_index = form.select_index(1);
                let timezone = values.get(2).cloned().unwrap_or_default();
                let cadence = form.select_index(2);
                let weekday = form.select_index(3);
                let time = values.get(5).cloned().unwrap_or_default();
                let title = values.get(6).cloned().unwrap_or_default();
                let request = values.get(7).cloned().unwrap_or_default();
                for (value, what) in [
                    (&name, "Name"),
                    (&timezone, "Time zone"),
                    (&time, "Time"),
                    (&title, "Task title"),
                    (&request, "Request"),
                ] {
                    if value.trim().is_empty() {
                        return Err(format!("{what} is required"));
                    }
                }
                if !time.contains(':') || time.len() != 5 {
                    return Err("Time must be HH:mm (24h)".into());
                }
                // The select carries project names; resolve against the
                // project cache the form-opener refreshed.
                let selected_name = form
                    .fields
                    .get(1)
                    .map(|field| field.value())
                    .unwrap_or_default();
                let project_id = self
                    .projects
                    .projects
                    .iter()
                    .find(|project| project.name == selected_name)
                    .or_else(|| self.assistant.projects.get(project_index))
                    .map(|project| project.id.clone())
                    .ok_or_else(|| "Pick a project".to_string())?;
                let schedule = if cadence == 0 {
                    RoutineSchedule::Weekly {
                        weekday: weekday as i64,
                        time: time.trim().to_string(),
                    }
                } else {
                    RoutineSchedule::Daily {
                        time: time.trim().to_string(),
                    }
                };
                match &form.kind {
                    FormKind::CreateRoutine => {
                        let input = CreateRoutineRequest {
                            name: name.trim().to_string(),
                            projectId: project_id,
                            timezone: timezone.trim().to_string(),
                            schedule,
                            template: RoutineTemplate {
                                title: title.trim().to_string(),
                                request: request.trim().to_string(),
                                constraints: None,
                            },
                        };
                        let api = self.api.clone();
                        self.spawn_mutation("Routine created (paused draft)", async move {
                            api.create_routine(&input).await.map(|_| ())
                        });
                    }
                    FormKind::EditRoutine { routine_id } => {
                        let input = UpdateRoutineRequest {
                            name: Some(name.trim().to_string()),
                            projectId: Some(project_id),
                            timezone: Some(timezone.trim().to_string()),
                            schedule: Some(schedule),
                            template: Some(RoutineTemplate {
                                title: title.trim().to_string(),
                                request: request.trim().to_string(),
                                constraints: None,
                            }),
                        };
                        let routine_id = routine_id.clone();
                        let api = self.api.clone();
                        self.spawn_mutation("Routine updated", async move {
                            api.update_routine(&routine_id, &input).await.map(|_| ())
                        });
                    }
                    _ => unreachable!("routine form kinds only"),
                }
                Ok(())
            }
            FormKind::EditMemoryEntry { entry_id, file_sha } => {
                let content = values.first().cloned().unwrap_or_default();
                if content.trim().is_empty() {
                    return Err("Content is required".into());
                }
                let input = UpdateMemoryEntryRequest {
                    content: content.trim().to_string(),
                    fileSha256: file_sha.clone(),
                };
                let entry_id = entry_id.clone();
                let api = self.api.clone();
                self.spawn_mutation("Memory entry updated", async move {
                    api.update_memory_entry(&entry_id, &input).await
                });
                Ok(())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn next_composer_field(
    current: ComposerField,
    advanced_open: bool,
    backwards: bool,
) -> ComposerField {
    let mut order = vec![
        ComposerField::Request,
        ComposerField::Kind,
        ComposerField::Project,
    ];
    if advanced_open {
        order.extend([
            ComposerField::Title,
            ComposerField::Constraints,
            ComposerField::StartingUrls,
        ]);
    }
    let position = order
        .iter()
        .position(|field| *field == current)
        .unwrap_or(0);
    let next = if backwards {
        (position + order.len() - 1) % order.len()
    } else {
        (position + 1) % order.len()
    };
    order[next]
}

pub fn truncate(text: &str, max_chars: usize) -> String {
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
