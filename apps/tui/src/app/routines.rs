use super::{spawn_payload, App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent, Payload};
use crate::contracts::{RoutineOccurrenceState, RoutineState, RoutineView};

#[derive(Default)]
pub(crate) struct RoutinesState {
    pub(crate) routines: Vec<RoutineView>,
    pub(crate) selected: usize,
    pub(crate) detail: Option<crate::api::RoutineDetail>,
    pub(crate) occurrence_selected: usize,
    pub(crate) detail_open: bool,
}

impl App {
    pub(crate) fn open_routine_detail(&mut self, routine_id: String) {
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

    pub(super) fn handle_routines_key(&mut self, key: KeyEvent) {
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
}
