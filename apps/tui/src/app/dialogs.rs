use super::{App, Form, KeyCode, KeyEvent, KeyModifiers};
use crate::contracts::{
    CreateExportRequest, CreateProjectRequest, CreateRoutineRequest, DeleteMemoryEntryRequest,
    RoutineSchedule, RoutineTemplate, SetProviderConfigRequest, SetProviderKeyRequest,
    UpdateMemoryEntryRequest, UpdateProjectRequest, UpdateRoutineRequest,
};

pub(crate) enum Dialog {
    Form(Form),
    Confirm {
        title: String,
        message: String,
        action: ConfirmAction,
    },
}

/// What a submitted form maps to; one variant per API call.
pub(crate) enum FormKind {
    CreateProject,
    EditProject {
        project_id: String,
    },
    GrantFolder {
        project_id: String,
    },
    AddDestination,
    SetProviderKey {
        provider: String,
    },
    EditModel {
        provider: String,
    },
    Export {
        artifact_id: String,
    },
    CreateRoutine,
    EditRoutine {
        routine_id: String,
        project_id: String,
    },
    EditMemoryEntry {
        entry_id: String,
        file_sha: String,
    },
}

#[derive(Clone)]
pub(crate) enum ConfirmAction {
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

impl App {
    pub(super) fn handle_dialog_key(&mut self, dialog: Dialog, key: KeyEvent) {
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
                if form.submitting {
                    // Esc pressed while submitting: dismiss dialog.
                    return;
                }
                // handle_key returned false: Esc closed, Ctrl+S submitted —
                // distinguish by re-checking the key.
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
                    form.error = None;
                    match self.submit_form(&form) {
                        Ok(()) => {
                            form.submitting = true;
                            self.dialog = Some(Dialog::Form(form));
                        }
                        Err(message) => {
                            form.error = Some(message);
                            self.dialog = Some(Dialog::Form(form));
                        }
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
            FormKind::EditModel { provider } => {
                let raw = values.first().cloned().unwrap_or_default();
                let trimmed = raw.trim().to_string();
                if trimmed.len() > 100 {
                    return Err("Model name must be 100 characters or fewer".into());
                }
                let provider = provider.clone();
                let api = self.api.clone();
                if trimmed.is_empty() {
                    let input = SetProviderConfigRequest::<Option<String>> {
                        provider: provider.clone(),
                        model: Some(None),
                    };
                    self.spawn_mutation(
                        format!("Model reset to default ({provider})"),
                        async move { api.set_provider_config(&input).await },
                    );
                } else {
                    let input = SetProviderConfigRequest {
                        provider: provider.clone(),
                        model: Some(trimmed.clone()),
                    };
                    self.spawn_mutation(
                        format!("Model set to {trimmed} ({provider})"),
                        async move { api.set_provider_config(&input).await },
                    );
                }
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
                let trimmed_filename = filename.trim();
                if destination_id.is_empty() {
                    return Err("Pick an export destination".into());
                }
                if !trimmed_filename.ends_with(".md") || trimmed_filename.len() < 5 {
                    return Err("Filename must be at least 5 characters and end in .md".into());
                }
                let input = CreateExportRequest {
                    artifactId: artifact_id.clone(),
                    destinationId: destination_id,
                    filename: trimmed_filename.to_string(),
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
                let cadence = form.select_index(3);
                let weekday = form.select_index(4);
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
                if !time.trim().contains(':') || time.trim().len() != 5 {
                    return Err("Time must be HH:mm (24h)".into());
                }
                // The select carries project names; resolve against the
                // project cache the form-opener refreshed.
                let selected_name = form
                    .fields
                    .get(1)
                    .map(|field| field.value())
                    .unwrap_or_default();
                if selected_name == "(loading projects\u{2026})" {
                    return Err("Projects are still loading; wait a moment and try again".into());
                }
                if selected_name == "(no projects yet \u{2014} create one first)" {
                    return Err("Create a project first".into());
                }
                let project_id = self
                    .projects
                    .projects
                    .iter()
                    .find(|project| project.name == selected_name)
                    .or_else(|| {
                        self.assistant
                            .projects
                            .iter()
                            .find(|project| project.name == selected_name)
                    })
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
                    FormKind::EditRoutine { routine_id, .. } => {
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
