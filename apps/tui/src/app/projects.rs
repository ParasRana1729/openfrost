use super::{App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent};
use crate::contracts::Project;

#[derive(Default)]
pub(crate) struct ProjectsState {
    pub(crate) projects: Vec<Project>,
    pub(crate) selected: usize,
    pub(crate) grant_selected: usize,
    pub(crate) detail_open: bool,
}

impl App {
    pub(super) fn handle_projects_key(&mut self, key: KeyEvent) {
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
}
