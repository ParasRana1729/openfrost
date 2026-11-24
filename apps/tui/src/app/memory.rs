use super::{truncate, App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent};
use crate::contracts::{ApproveMemoryProposalRequest, MemoryScope, MemorySnapshot};

/// One selectable row in the memory tab, flattened from the snapshot.
/// `ProjectHeader` is a non-selectable section marker.
#[derive(Debug, Clone)]
pub(crate) enum MemRow {
    Proposal(usize),
    GlobalEntry(usize),
    ProjectEntry { project: usize, entry: usize },
    ProjectHeader,
}

#[derive(Default)]
pub(crate) struct MemoryState {
    pub(crate) snapshot: Option<MemorySnapshot>,
    pub(crate) selected: usize,
    pub(crate) rows: Vec<MemRow>,
}

impl MemoryState {
    pub(crate) fn rebuild_rows(&mut self) {
        let mut rows = Vec::new();
        if let Some(snapshot) = &self.snapshot {
            for index in 0..snapshot.proposals.len() {
                rows.push(MemRow::Proposal(index));
            }
            for index in 0..snapshot.global.entries.len() {
                rows.push(MemRow::GlobalEntry(index));
            }
            for (project, memory) in snapshot.projects.iter().enumerate() {
                rows.push(MemRow::ProjectHeader);
                for entry in 0..memory.entries.len() {
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

impl App {
    pub(super) fn handle_memory_key(&mut self, key: KeyEvent) {
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
}
