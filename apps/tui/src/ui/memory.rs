use super::tasks::keybind_footer;
use super::theme::{
    accent_bold, danger, frost_glow, muted, pill, rounded_block, section_rule, selected_style,
    warn, ICE_DIM, SURFACE_PILL, SURFACE_SEL, VIOLET,
};
use crate::app::{truncate, App, MemoryState};
use crate::contracts::{MemoryProposalState, MemoryScope};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_memory(app: &mut App, frame: &mut Frame, area: Rect) {
    let vertical = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    let Some(snapshot) = &app.memory.snapshot else {
        frame.render_widget(
            Paragraph::new("  Loading memory…")
                .style(muted())
                .block(rounded_block("Memory")),
            content_area,
        );
        frame.render_widget(keybind_footer(&[("R", "reload")]), footer_area);
        return;
    };

    let inner_w = content_area.width.saturating_sub(2);
    let mut lines: Vec<Line> = Vec::new();
    let mut row_index = 0usize;
    let mut selected_line: Option<usize> = None;

    let pending_proposals: Vec<_> = snapshot
        .proposals
        .iter()
        .filter(|proposal| MemoryState::is_actionable_pending(proposal))
        .collect();
    let decided_count = snapshot
        .proposals
        .iter()
        .filter(|proposal| proposal.state != MemoryProposalState::Pending)
        .count();

    lines.push(section_rule("Proposals awaiting decision", inner_w));
    if pending_proposals.is_empty() {
        let empty_msg = if decided_count > 0 {
            format!("   (no pending proposals · {decided_count} decided in history)")
        } else {
            "   (no pending proposals)".to_string()
        };
        lines.push(Line::styled(empty_msg, muted()));
    } else {
        for proposal in &pending_proposals {
            let is_sel = row_index == app.memory.selected;
            let marker = row_marker(is_sel);
            let scope = match proposal.scope {
                MemoryScope::Global => "global".to_string(),
                MemoryScope::Project => snapshot
                    .projects
                    .iter()
                    .find(|view| Some(&view.projectId) == proposal.projectId.as_ref())
                    .map(|view| view.projectName.clone())
                    .unwrap_or_else(|| "project".to_string()),
            };
            if is_sel {
                selected_line = Some(lines.len());
            }
            let line = Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(" proposal ", pill(VIOLET, SURFACE_SEL)),
                Span::raw(" "),
                Span::styled(format!(" {scope} "), pill(ICE_DIM, SURFACE_PILL)),
                Span::raw(" "),
                Span::styled(
                    truncate(proposal.content.as_deref().unwrap_or(""), 84),
                    frost_glow(),
                ),
            ]);
            lines.push(if is_sel {
                line.style(selected_style())
            } else {
                line
            });
            if is_sel {
                lines.push(Line::styled(
                    "     a approve · x reject",
                    Style::default().fg(ICE_DIM),
                ));
            }
            row_index += 1;
        }
    }
    lines.push(Line::from(""));

    lines.push(section_rule("Global memory · owner.md", inner_w));
    if snapshot.global.externalChange {
        lines.push(Line::styled(
            "   ▲ file changed outside OpenFrost — press R to reload",
            warn(),
        ));
    }
    for problem in &snapshot.global.problems {
        lines.push(Line::styled(format!("   × {problem}"), danger()));
    }
    if snapshot.global.entries.is_empty() && snapshot.global.problems.is_empty() {
        lines.push(Line::styled("   (no global memory entries)", muted()));
    }
    for entry in &snapshot.global.entries {
        let is_sel = row_index == app.memory.selected;
        let marker = row_marker(is_sel);
        if is_sel {
            selected_line = Some(lines.len());
        }
        let line = Line::from(vec![
            Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
            Span::styled(truncate(&entry.content, 100), frost_glow()),
        ]);
        lines.push(if is_sel {
            line.style(selected_style())
        } else {
            line
        });
        if is_sel {
            lines.push(Line::styled(
                "     e edit · d delete",
                Style::default().fg(ICE_DIM),
            ));
        }
        row_index += 1;
    }
    lines.push(Line::from(""));

    for view in &snapshot.projects {
        let is_header_sel = row_index == app.memory.selected;
        if is_header_sel {
            selected_line = Some(lines.len());
        }
        row_index += 1;

        lines.push(section_rule(
            &format!("{} · project memory", view.projectName),
            inner_w,
        ));
        if view.externalChange {
            lines.push(Line::styled(
                "   ▲ file changed outside OpenFrost — press R to reload",
                warn(),
            ));
        }
        for problem in &view.problems {
            lines.push(Line::styled(format!("   × {problem}"), danger()));
        }
        if view.entries.is_empty() && view.problems.is_empty() {
            lines.push(Line::styled("   (no entries)", muted()));
        }
        for entry in &view.entries {
            let is_sel = row_index == app.memory.selected;
            let marker = row_marker(is_sel);
            if is_sel {
                selected_line = Some(lines.len());
            }
            let line = Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(truncate(&entry.content, 100), frost_glow()),
            ]);
            lines.push(if is_sel {
                line.style(selected_style())
            } else {
                line
            });
            if is_sel {
                lines.push(Line::styled(
                    "     e edit · d delete",
                    Style::default().fg(ICE_DIM),
                ));
            }
            row_index += 1;
        }
        lines.push(Line::from(""));
    }

    let inner_height = content_area.height.saturating_sub(2) as usize;
    let max_scroll = lines.len().saturating_sub(inner_height);
    let scroll_y = selected_line
        .map(|idx| idx.saturating_sub(inner_height / 2).min(max_scroll))
        .unwrap_or(0) as u16;

    let project_entries: usize = snapshot.projects.iter().map(|p| p.entries.len()).sum();
    let title = if decided_count > 0 {
        format!(
            "Memory  ({} pending · {} decided · {} global · {} project)",
            pending_proposals.len(),
            decided_count,
            snapshot.global.entries.len(),
            project_entries
        )
    } else {
        format!(
            "Memory  ({} pending · {} global · {} project)",
            pending_proposals.len(),
            snapshot.global.entries.len(),
            project_entries
        )
    };

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0))
            .block(rounded_block(&title)),
        content_area,
    );
    let footer = if pending_proposals.is_empty() {
        keybind_footer(&[
            ("j/k", "move"),
            ("e", "edit"),
            ("d", "delete"),
            ("R", "reload"),
        ])
    } else {
        keybind_footer(&[
            ("j/k", "move"),
            ("a", "approve"),
            ("x", "reject"),
            ("e", "edit"),
            ("d", "delete"),
            ("R", "reload"),
        ])
    };
    frame.render_widget(footer, footer_area);
}

fn row_marker(is_sel: bool) -> &'static str {
    if is_sel {
        " ▸ "
    } else {
        "   "
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::{Screen, Tab};
    use crate::contracts::{
        MemoryEntry, MemoryFileView, MemoryLimits, MemoryProposal, MemoryProposalState,
        MemorySnapshot, MemorySource,
    };
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use tokio::sync::mpsc;

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
                label: "Research brief".to_string(),
            },
            sourceRunId: Some("run-1".to_string()),
            state,
            proposedAt: "2026-11-25T00:00:00Z".to_string(),
            decidedAt: (state != MemoryProposalState::Pending)
                .then(|| "2026-11-25T01:00:00Z".to_string()),
            memoryEntryId: None,
            proposedContentSha256: "abc".to_string(),
            decidedContentSha256: None,
        }
    }

    fn make_snapshot(proposals: Vec<MemoryProposal>, global_entries: Vec<&str>) -> MemorySnapshot {
        MemorySnapshot {
            global: MemoryFileView {
                scope: MemoryScope::Global,
                projectId: None,
                path: "owner.md".to_string(),
                exists: true,
                sha256: Some("sha-global".to_string()),
                entries: global_entries
                    .into_iter()
                    .enumerate()
                    .map(|(i, text)| MemoryEntry {
                        id: format!("entry-{i}"),
                        scope: MemoryScope::Global,
                        projectId: None,
                        content: text.to_string(),
                        source: MemorySource {
                            kind: "manual".to_string(),
                            taskId: None,
                            artifactId: None,
                            label: "manual".to_string(),
                        },
                        createdAt: "2026-11-25T00:00:00Z".to_string(),
                        updatedAt: "2026-11-25T00:00:00Z".to_string(),
                    })
                    .collect(),
                problems: vec![],
                externalChange: false,
            },
            projects: vec![],
            proposals,
            limits: MemoryLimits {
                contentMaxChars: 500,
                entriesPerFile: 50,
                contextMaxChars: 4000,
            },
        }
    }

    fn render_memory_to_string(snapshot: MemorySnapshot) -> String {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Memory;
        app.memory.snapshot = Some(snapshot);
        app.memory.rebuild_rows();

        let backend = TestBackend::new(100, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();

        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect()
    }

    #[test]
    fn render_memory_hides_decided_proposals_and_shows_zero_pending() {
        let snapshot = make_snapshot(
            vec![
                make_proposal("p1", MemoryProposalState::Approved, None),
                make_proposal("p2", MemoryProposalState::Rejected, None),
                make_proposal("p3", MemoryProposalState::Rejected, None),
                make_proposal("p4", MemoryProposalState::Pending, Some("   ")),
            ],
            vec!["Keep briefs concise"],
        );
        let rendered = render_memory_to_string(snapshot);
        assert!(rendered.contains("0 pending"));
        assert!(rendered.contains("3 decided"));
        assert!(rendered.contains("(no pending proposals · 3 decided in history)"));
        assert!(rendered.contains("Keep briefs concise"));
        assert!(!rendered.contains("3 pending"));
        assert!(!rendered.contains("4 pending"));
        assert!(!rendered.contains("a approve · x reject"));
        assert!(!rendered.contains(" proposal "));
    }

    #[test]
    fn render_memory_shows_only_pending_proposals_when_mixed() {
        let snapshot = make_snapshot(
            vec![
                make_proposal("p1", MemoryProposalState::Rejected, None),
                make_proposal(
                    "p2",
                    MemoryProposalState::Pending,
                    Some("Include release dates in summaries"),
                ),
                make_proposal("p3", MemoryProposalState::Approved, None),
            ],
            vec![],
        );
        let rendered = render_memory_to_string(snapshot);
        assert!(rendered.contains("1 pending"));
        assert!(rendered.contains("2 decided"));
        assert!(rendered.contains("Include release dates in summaries"));
        assert!(rendered.contains("a approve · x reject"));
        assert!(!rendered.contains("3 pending"));
    }
}
