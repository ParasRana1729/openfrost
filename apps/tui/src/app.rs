//! Application state and key handling. The TUI is keyboard-first: global
//! shortcuts (Ctrl+P tab picker, Ctrl+C quit), per-tab navigation, and modal
//! dialogs for forms. Every mutation goes through the loopback API client.

use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::Mutex;
use tui_textarea::TextArea;

use crate::api::ApiClient;
use crate::contracts::*;
use crate::dialog_forms::Form;
use crate::event::{spawn_payload, AppEvent, AppTx, Payload};

pub type SharedApi = Arc<Mutex<ApiClient>>;

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

pub struct App {
    pub tx: AppTx,
    pub api: SharedApi,
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
}

impl App {
    pub fn new(tx: AppTx, api: SharedApi) -> Self {
        let mut auth = TextArea::default();
        auth.set_mask_char('\u{2022}');
        Self {
            tx,
            api,
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
        }
    }

    pub fn set_notice(&mut self, message: impl Into<String>, is_error: bool) {
        self.notice = Some(Notice {
            message: message.into(),
            is_error,
            ticks_left: 24,
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

    pub fn refresh(&mut self, tab: Tab) {
        let api = self.api.clone();
        let tx = self.tx.clone();
        match tab {
            Tab::Assistant => {
                spawn_payload(
                    &tx,
                    async move {
                        let api = api.lock().await;
                        let events = api.events(15).await.map_err(|e| e.message());
                        let approvals = api.pending_approvals().await.map_err(|e| e.message());
                        let routines = api.routines().await.map_err(|e| e.message());
                        let projects = api.projects().await.map_err(|e| e.message());
                        (events, approvals, routines, projects)
                    },
                    |(events, approvals, routines, projects)| Payload::AssistantData {
                        events,
                        approvals,
                        routines,
                        projects,
                    },
                );
            }
            Tab::Tasks => {
                spawn_payload(
                    &tx,
                    async move { api.lock().await.tasks().await.map_err(|e| e.message()) },
                    Payload::Tasks,
                );
            }
            Tab::Projects => {
                spawn_payload(
                    &tx,
                    async move { api.lock().await.projects().await.map_err(|e| e.message()) },
                    Payload::Projects,
                );
            }
            Tab::Memory => {
                spawn_payload(
                    &tx,
                    async move { api.lock().await.memory().await.map_err(|e| e.message()) },
                    Payload::Memory,
                );
            }
            Tab::Routines => {
                spawn_payload(
                    &tx,
                    async move { api.lock().await.routines().await.map_err(|e| e.message()) },
                    Payload::Routines,
                );
            }
            Tab::Settings => {
                spawn_payload(
                    &tx,
                    async move {
                        let api = api.lock().await;
                        let settings = api.settings().await.map_err(|e| e.message());
                        let destinations = api.destinations().await.map_err(|e| e.message());
                        (settings, destinations)
                    },
                    |(settings, destinations)| Payload::SettingsBundle {
                        settings,
                        destinations,
                    },
                );
            }
        }
    }

    pub fn open_task_detail(&mut self, task_id: String) {
        let api = self.api.clone();
        let tx = self.tx.clone();
        spawn_payload(
            &tx,
            async move {
                api.lock()
                    .await
                    .task_detail(&task_id)
                    .await
                    .map_err(|e| e.message())
            },
            Payload::TaskDetail,
        );
    }

    pub fn open_routine_detail(&mut self, routine_id: String) {
        let api = self.api.clone();
        let tx = self.tx.clone();
        spawn_payload(
            &tx,
            async move {
                api.lock()
                    .await
                    .routine_detail(&routine_id)
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
                let result = {
                    let mut api = api.lock().await;
                    api.logout().await.map_err(|e| e.message())
                };
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
                    let mut api = api.lock().await;
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
                    api.lock().await.remove_provider_key(&provider).await
                });
            }
            ConfirmAction::RemoveDestination { destination_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Destination removed", async move {
                    api.lock().await.remove_destination(&destination_id).await
                });
            }
            ConfirmAction::RevokeGrant {
                project_id,
                grant_id,
            } => {
                let api = self.api.clone();
                self.spawn_mutation("Folder grant revoked", async move {
                    api.lock().await.revoke_folder(&project_id, &grant_id).await
                });
            }
            ConfirmAction::DeleteMemoryEntry { entry_id, file_sha } => {
                let api = self.api.clone();
                self.spawn_mutation("Memory entry deleted", async move {
                    let input = DeleteMemoryEntryRequest {
                        fileSha256: file_sha,
                    };
                    api.lock()
                        .await
                        .delete_memory_entry(&entry_id, &input)
                        .await
                });
            }
            ConfirmAction::DeleteRoutine { routine_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Routine removed", async move {
                    api.lock().await.delete_routine(&routine_id).await
                });
            }
            ConfirmAction::RejectApproval { approval_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Export rejected", async move {
                    api.lock()
                        .await
                        .decide_approval(&approval_id, "rejected")
                        .await
                        .map(|_| ())
                });
            }
            ConfirmAction::CancelTask { task_id } => {
                let api = self.api.clone();
                self.spawn_mutation("Cancel requested", async move {
                    api.lock().await.cancel_task(&task_id).await.map(|_| ())
                });
            }
        }
    }

    // Assistant tab -----------------------------------------------------------

    fn handle_assistant_key(&mut self, key: KeyEvent) {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            self.submit_task();
            return;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('a') {
            self.assistant.advanced_open = !self.assistant.advanced_open;
            return;
        }
        match key.code {
            KeyCode::Tab => {
                self.assistant.focus =
                    next_composer_field(self.assistant.focus, self.assistant.advanced_open, false);
            }
            KeyCode::BackTab => {
                self.assistant.focus =
                    next_composer_field(self.assistant.focus, self.assistant.advanced_open, true);
            }
            _ => match self.assistant.focus {
                ComposerField::Request => {
                    let _ = self.assistant.request.input(key);
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
            api.lock().await.create_task(&input).await.map(|_| ())
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
            KeyCode::Char('f') => {
                self.tasks.filter = self.tasks.filter.next();
                self.tasks.clamp_selection();
            }
            KeyCode::Char('/') => {
                self.tasks.searching = true;
            }
            KeyCode::Char('R') => {
                let api = self.api.clone();
                self.spawn_mutation("Dispatch resumed", async move {
                    api.lock().await.resume_dispatch().await
                });
            }
            KeyCode::Char('j') | KeyCode::Down if count > 0 => {
                self.tasks.selected = (self.tasks.selected + 1).min(count - 1);
            }
            KeyCode::Char('k') | KeyCode::Up if count > 0 => {
                self.tasks.selected = self.tasks.selected.saturating_sub(1);
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
                            api.lock().await.retry_task(&task_id).await.map(|_| ())
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn handle_task_detail_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc | KeyCode::Char('b') => {
                self.tasks.detail_open = false;
                self.tasks.detail = None;
                self.tasks.artifact_scroll = 0;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                self.tasks.artifact_scroll = self.tasks.artifact_scroll.saturating_add(1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.tasks.artifact_scroll = self.tasks.artifact_scroll.saturating_sub(1);
            }
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
                            api.lock().await.retry_task(&task_id).await.map(|_| ())
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
                        api.lock()
                            .await
                            .decide_approval(&approval_id, "granted")
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
                        async move {
                            api.lock()
                                .await
                                .destinations()
                                .await
                                .map_err(|e| e.message())
                        },
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
                    api.lock().await.reload_memory().await
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
                        api.lock()
                            .await
                            .approve_memory_proposal(&proposal_id, &input)
                            .await
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
                            api.lock().await.reject_memory_proposal(&proposal_id).await
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
                                    api.lock()
                                        .await
                                        .run_occurrence_now(&routine_id, &occurrence_key)
                                        .await
                                        .map(|_| ())
                                } else {
                                    api.lock()
                                        .await
                                        .skip_occurrence(&routine_id, &occurrence_key)
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
            KeyCode::Char('n') => {
                let api = self.api.clone();
                let tx = self.tx.clone();
                spawn_payload(
                    &tx,
                    async move { api.lock().await.projects().await.map_err(|e| e.message()) },
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
                        async move { api.lock().await.projects().await.map_err(|e| e.message()) },
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
                            api.lock()
                                .await
                                .enable_routine(&routine_id)
                                .await
                                .map(|_| ())
                        } else {
                            api.lock()
                                .await
                                .pause_routine(&routine_id)
                                .await
                                .map(|_| ())
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
                    api.lock().await.set_provider(&input).await
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
                    api.lock().await.create_project(&input).await.map(|_| ())
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
                    api.lock()
                        .await
                        .update_project(&project_id, &input)
                        .await
                        .map(|_| ())
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
                    api.lock()
                        .await
                        .grant_folder(&project_id, path.trim())
                        .await
                        .map(|_| ())
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
                    api.lock()
                        .await
                        .add_destination(path.trim())
                        .await
                        .map(|_| ())
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
                    api.lock().await.set_provider_key(&input).await
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
                    api.lock().await.request_export(&input).await.map(|_| ())
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
                            api.lock().await.create_routine(&input).await.map(|_| ())
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
                            api.lock()
                                .await
                                .update_routine(&routine_id, &input)
                                .await
                                .map(|_| ())
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
                    api.lock()
                        .await
                        .update_memory_entry(&entry_id, &input)
                        .await
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
