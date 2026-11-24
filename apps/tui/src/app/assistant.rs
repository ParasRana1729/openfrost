use super::{truncate, App, KeyCode, KeyEvent, KeyModifiers, Tab, TextArea};
use crate::contracts::{
    ApprovalView, CreateTaskRequest, Event, Project, RoutineView, TaskDetail, TaskKind,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum ComposerField {
    #[default]
    Request,
    Kind,
    Project,
    Title,
    Constraints,
    StartingUrls,
}

#[derive(Default)]
pub(crate) struct AssistantState {
    pub(crate) request: TextArea<'static>,
    pub(crate) title: TextArea<'static>,
    pub(crate) constraints: TextArea<'static>,
    pub(crate) starting_urls: TextArea<'static>,
    /// false = research brief, true = project update.
    pub(crate) kind_project_update: bool,
    /// Index into the cached projects list; None = no project scope.
    pub(crate) project_idx: Option<usize>,
    pub(crate) advanced_open: bool,
    pub(crate) focus: ComposerField,
    pub(crate) projects: Vec<Project>,
    pub(crate) events: Vec<Event>,
    pub(crate) approvals: Vec<ApprovalView>,
    pub(crate) routines: Vec<RoutineView>,
    pub(crate) stream_scroll: u16,
    pub(crate) history: Vec<String>,
    pub(crate) history_idx: Option<usize>,
    pub(crate) active_task_detail: Option<TaskDetail>,
    pub(crate) slash_help_open: bool,
}

impl App {
    pub(super) fn handle_assistant_key(&mut self, key: KeyEvent) {
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

    pub(crate) fn submit_task(&mut self) {
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
}

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
