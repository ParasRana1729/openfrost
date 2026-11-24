use super::{
    spawn_payload, App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent, Payload, TextArea,
};
use crate::contracts::{ApprovalState, ExecutorStatus, Task, TaskDetail, TaskState};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum TaskFilter {
    #[default]
    All,
    Active,
    Queued,
    Done,
    Failed,
}

impl TaskFilter {
    pub(crate) fn next(self) -> Self {
        match self {
            TaskFilter::All => TaskFilter::Active,
            TaskFilter::Active => TaskFilter::Queued,
            TaskFilter::Queued => TaskFilter::Done,
            TaskFilter::Done => TaskFilter::Failed,
            TaskFilter::Failed => TaskFilter::All,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            TaskFilter::All => "All",
            TaskFilter::Active => "Active",
            TaskFilter::Queued => "Queued",
            TaskFilter::Done => "Done",
            TaskFilter::Failed => "Failed",
        }
    }

    pub(crate) fn matches(self, task: &Task) -> bool {
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
pub(crate) enum TaskDetailFocus {
    #[default]
    Report,
    Log,
}

impl TaskDetailFocus {
    pub(crate) fn toggle(self) -> Self {
        match self {
            Self::Report => Self::Log,
            Self::Log => Self::Report,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum TaskDetailView {
    #[default]
    Auto,
    ReportOnly,
    LogOnly,
}

impl TaskDetailView {
    pub(crate) fn next(self) -> Self {
        match self {
            Self::Auto => Self::ReportOnly,
            Self::ReportOnly => Self::LogOnly,
            Self::LogOnly => Self::Auto,
        }
    }
}

#[derive(Default)]
pub(crate) struct TasksState {
    pub(crate) tasks: Vec<Task>,
    pub(crate) executor: Option<ExecutorStatus>,
    pub(crate) filter: TaskFilter,
    pub(crate) search: TextArea<'static>,
    pub(crate) searching: bool,
    pub(crate) selected: usize,
    pub(crate) detail: Option<TaskDetail>,
    pub(crate) artifact_scroll: u16,
    pub(crate) log_scroll: u16,
    pub(crate) detail_focus: TaskDetailFocus,
    pub(crate) detail_view: TaskDetailView,
    pub(crate) detail_open: bool,
}

impl TasksState {
    pub(crate) fn visible(&self) -> Vec<&Task> {
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

impl App {
    pub(crate) fn open_task_detail(&mut self, task_id: String) {
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

    pub(crate) fn scroll_task_detail(&mut self, delta: i32) {
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

    pub(super) fn handle_tasks_key(&mut self, key: KeyEvent) {
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

    pub(super) fn handle_task_detail_key(&mut self, key: KeyEvent) {
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
}
