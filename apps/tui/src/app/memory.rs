use super::{truncate, App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent};
use crate::api::ApiError;
use crate::contracts::{
    ApproveMemoryProposalRequest, MemoryProposal, MemoryProposalState, MemoryScope, MemorySnapshot,
};

/// One selectable row in the memory tab, flattened from the snapshot.
/// `ProjectHeader` is a non-selectable section marker.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    /// Only pending proposals with non-empty text are actionable in the UI.
    /// Decided (`approved` / `rejected`) rows have `content: None` and must
    /// never appear as selectable proposals.
    pub(crate) fn is_actionable_pending(proposal: &MemoryProposal) -> bool {
        proposal.state == MemoryProposalState::Pending
            && proposal
                .content
                .as_deref()
                .is_some_and(|text| !text.trim().is_empty())
    }

    pub(crate) fn rebuild_rows(&mut self) {
        let mut rows = Vec::new();
        if let Some(snapshot) = &self.snapshot {
            for (index, proposal) in snapshot.proposals.iter().enumerate() {
                if Self::is_actionable_pending(proposal) {
                    rows.push(MemRow::Proposal(index));
                }
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

fn annotate_proposal_conflict(err: ApiError) -> ApiError {
    match err {
        ApiError::Response {
            status: 409,
            message,
        } => {
            let hint = if message.contains("reload") {
                message
            } else {
                format!("{message} — press R to reload")
            };
            ApiError::Response {
                status: 409,
                message: hint,
            }
        }
        other => other,
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
                    if !MemoryState::is_actionable_pending(proposal) {
                        self.set_notice(
                            "Proposal is already decided or empty; press R to reload",
                            true,
                        );
                        return;
                    }
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
                        api.approve_memory_proposal(&proposal_id, &input)
                            .await
                            .map_err(annotate_proposal_conflict)
                    });
                }
            }
            KeyCode::Char('x') => {
                let Some(snapshot) = self.memory.snapshot.clone() else {
                    return;
                };
                if let Some(MemRow::Proposal(index)) = self.memory.rows.get(self.memory.selected) {
                    if let Some(proposal) = snapshot.proposals.get(*index) {
                        if !MemoryState::is_actionable_pending(proposal) {
                            self.set_notice(
                                "Proposal is already decided or empty; press R to reload",
                                true,
                            );
                            return;
                        }
                        let proposal_id = proposal.id.clone();
                        let api = self.api.clone();
                        self.spawn_mutation("Memory proposal rejected", async move {
                            api.reject_memory_proposal(&proposal_id)
                                .await
                                .map_err(annotate_proposal_conflict)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::{Screen, Tab};
    use crate::contracts::{
        MemoryEntry, MemoryFileView, MemoryLimits, MemorySource, ProjectMemoryView,
    };
    use crossterm::event::{KeyEventKind, KeyEventState, KeyModifiers};
    use tokio::sync::mpsc;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    fn make_proposal(
        id: &str,
        state: MemoryProposalState,
        content: Option<&str>,
    ) -> MemoryProposal {
        MemoryProposal {
            id: id.to_string(),
            scope: MemoryScope::Global,
            projectId: None,
            content: content.map(str::to_string),
            source: MemorySource {
                kind: "task_run".to_string(),
                taskId: Some("task-1".to_string()),
                artifactId: None,
                label: "Brief".to_string(),
            },
            sourceRunId: Some("run-1".to_string()),
            state,
            proposedAt: "2026-11-25T00:00:00Z".to_string(),
            decidedAt: (state != MemoryProposalState::Pending)
                .then(|| "2026-11-25T01:00:00Z".to_string()),
            memoryEntryId: None,
            proposedContentSha256: "sha".to_string(),
            decidedContentSha256: None,
        }
    }

    fn make_entry(id: &str, scope: MemoryScope, project_id: Option<&str>) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            scope,
            projectId: project_id.map(str::to_string),
            content: format!("Entry {id}"),
            source: MemorySource {
                kind: "manual".to_string(),
                taskId: None,
                artifactId: None,
                label: "manual".to_string(),
            },
            createdAt: "2026-11-25T00:00:00Z".to_string(),
            updatedAt: "2026-11-25T00:00:00Z".to_string(),
        }
    }

    fn make_snapshot(proposals: Vec<MemoryProposal>) -> MemorySnapshot {
        MemorySnapshot {
            global: MemoryFileView {
                scope: MemoryScope::Global,
                projectId: None,
                path: "owner.md".to_string(),
                exists: true,
                sha256: Some("global-sha".to_string()),
                entries: vec![make_entry("g1", MemoryScope::Global, None)],
                problems: vec![],
                externalChange: false,
            },
            projects: vec![ProjectMemoryView {
                scope: MemoryScope::Project,
                projectId: "proj-1".to_string(),
                projectName: "Alpha".to_string(),
                path: "alpha.md".to_string(),
                exists: true,
                sha256: Some("proj-sha".to_string()),
                entries: vec![make_entry("p1", MemoryScope::Project, Some("proj-1"))],
                problems: vec![],
                externalChange: false,
            }],
            proposals,
            limits: MemoryLimits {
                contentMaxChars: 500,
                entriesPerFile: 50,
                contextMaxChars: 4000,
            },
        }
    }

    #[test]
    fn rebuild_rows_filters_out_decided_and_blank_proposals() {
        let mut state = MemoryState {
            snapshot: Some(make_snapshot(vec![
                make_proposal("p-approved", MemoryProposalState::Approved, None),
                make_proposal("p-rejected", MemoryProposalState::Rejected, None),
                make_proposal("p-none", MemoryProposalState::Pending, None),
                make_proposal("p-empty", MemoryProposalState::Pending, Some("   \n ")),
                make_proposal(
                    "p-valid",
                    MemoryProposalState::Pending,
                    Some("Prefer short bullet lists"),
                ),
            ])),
            ..Default::default()
        };
        state.rebuild_rows();

        assert_eq!(
            state.rows,
            vec![
                MemRow::Proposal(4),
                MemRow::GlobalEntry(0),
                MemRow::ProjectHeader,
                MemRow::ProjectEntry {
                    project: 0,
                    entry: 0
                },
            ]
        );
    }

    #[test]
    fn approve_or_reject_ignores_non_pending_proposals_safely() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Memory;
        app.memory.snapshot = Some(make_snapshot(vec![
            make_proposal("p-rejected", MemoryProposalState::Rejected, None),
            make_proposal("p-none", MemoryProposalState::Pending, None),
        ]));
        app.memory.rebuild_rows();
        // Selected row 0 is GlobalEntry(0) because no actionable proposals exist.
        assert_eq!(app.memory.rows.first(), Some(&MemRow::GlobalEntry(0)));

        app.handle_memory_key(key(KeyCode::Char('a')));
        app.handle_memory_key(key(KeyCode::Char('x')));
        assert!(app.notice.is_none());

        // Even if a stale row index pointed to a decided proposal, handle_memory_key refuses cleanly.
        app.memory.rows.insert(0, MemRow::Proposal(0));
        app.memory.selected = 0;
        app.handle_memory_key(key(KeyCode::Char('a')));
        assert!(app
            .notice
            .as_ref()
            .is_some_and(|n| n.is_error && n.message.contains("already decided")));
    }

    #[test]
    fn annotate_proposal_conflict_adds_reload_hint_on_409() {
        let err = annotate_proposal_conflict(ApiError::Response {
            status: 409,
            message: "Proposal is already decided".to_string(),
        });
        assert!(err.message().contains("409"));
        assert!(err.message().contains("press R to reload"));
    }
}
