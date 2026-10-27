//! Applying background API results to app state.

use crate::app::{App, Dialog, Screen};
use crate::event::Payload;

pub fn apply_payload(app: &mut App, payload: Payload) {
    match payload {
        Payload::Session(result) => match result {
            Ok(session) => {
                if session.authenticated {
                    app.screen = Screen::Main;
                    app.refresh_all();
                } else if session.ownerCreated {
                    app.screen = Screen::Login;
                } else {
                    app.screen = Screen::Onboarding;
                }
            }
            Err(message) => {
                // API unreachable: stay on the connecting screen with the
                // error visible; the poller retries.
                app.set_notice(format!("API unreachable: {message}"), true);
            }
        },
        Payload::Auth(result) => {
            app.auth_busy = false;
            match result {
                Ok(()) => {
                    app.screen = Screen::Main;
                    app.auth = masking_area();
                    app.refresh_all();
                }
                Err(message) => {
                    app.set_notice(message, true);
                }
            }
        }
        Payload::Tasks(result) => match result {
            Ok(response) => {
                app.tasks.executor = Some(response.executor);
                app.tasks.tasks = response.tasks;
                let len = app.tasks.visible().len();
                if app.tasks.selected >= len {
                    app.tasks.selected = len.saturating_sub(1);
                }
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::TaskDetail(result) => match result {
            Ok(detail) => {
                app.tasks.detail = Some(detail);
                app.tasks.detail_open = true;
                app.tasks.artifact_scroll = 0;
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::AssistantData {
            events,
            approvals,
            routines,
            projects,
        } => {
            if let Ok(events) = events {
                app.assistant.events = events;
            }
            if let Ok(approvals) = approvals {
                app.assistant.approvals = approvals;
            }
            if let Ok(routines) = routines {
                app.assistant.routines = routines;
            }
            if let Ok(projects) = projects {
                let count = projects.len();
                app.assistant.projects = projects;
                if let Some(index) = app.assistant.project_idx {
                    if index >= count {
                        app.assistant.project_idx = None;
                    }
                }
            }
        }
        Payload::Projects(result) => match result {
            Ok(projects) => {
                // Feed the routine-creation dialog's project select before
                // caching the list on the projects tab state.
                if let Some(Dialog::Form(form)) = &mut app.dialog {
                    if matches!(
                        form.kind,
                        crate::app::FormKind::CreateRoutine
                            | crate::app::FormKind::EditRoutine { .. }
                    ) {
                        let names: Vec<String> = projects
                            .iter()
                            .map(|project| project.name.clone())
                            .collect();
                        if names.is_empty() {
                            form.set_options(
                                1,
                                vec!["(no projects yet \u{2014} create one first)".into()],
                            );
                        } else {
                            form.set_options(1, names);
                        }
                    }
                }
                let selected = app.projects.selected;
                app.projects.projects = projects;
                if selected >= app.projects.projects.len() {
                    app.projects.selected = app.projects.projects.len().saturating_sub(1);
                }
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::Memory(result) => match result {
            Ok(snapshot) => {
                app.memory.snapshot = Some(snapshot);
                app.memory.rebuild_rows();
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::Routines(result) => match result {
            Ok(routines) => {
                app.routines.routines = routines;
                if app.routines.selected >= app.routines.routines.len() {
                    app.routines.selected = app.routines.routines.len().saturating_sub(1);
                }
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::RoutineDetail(result) => match result {
            Ok(detail) => {
                app.routines.detail = Some(detail);
                app.routines.detail_open = true;
                app.routines.occurrence_selected = 0;
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::Destinations(result) => match result {
            Ok(destinations) => {
                if let Some(Dialog::Form(form)) = &mut app.dialog {
                    if matches!(form.kind, crate::app::FormKind::Export { .. }) {
                        let options: Vec<String> = destinations
                            .iter()
                            .map(|destination| {
                                format!("{} \u{2014} {}", destination.id, destination.path)
                            })
                            .collect();
                        if options.is_empty() {
                            form.set_options(
                                0,
                                vec!["(no destinations \u{2014} add one in Settings)".into()],
                            );
                        } else {
                            form.set_options(0, options);
                        }
                    }
                }
                app.settings.destinations = destinations;
            }
            Err(message) => app.set_notice(message, true),
        },
        Payload::SettingsBundle {
            settings,
            destinations,
        } => {
            if let Ok(settings) = settings {
                app.settings.settings = Some(settings);
            }
            if let Ok(destinations) = destinations {
                app.settings.destinations = destinations;
            }
        }
        Payload::Mutation { label, result } => match result {
            Ok(()) => {
                app.set_notice(label, false);
                app.refresh_all();
            }
            Err(message) => app.set_notice(format!("{label} failed: {message}"), true),
        },
        Payload::LoggedOut(result) => {
            if let Ok(()) = result {
                app.screen = Screen::Login;
                app.auth = masking_area();
            }
        }
    }
}

fn masking_area() -> tui_textarea::TextArea<'static> {
    let mut area = tui_textarea::TextArea::default();
    area.set_mask_char('\u{2022}');
    area
}
