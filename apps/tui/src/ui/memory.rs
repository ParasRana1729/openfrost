use super::tasks::keybind_footer;
use super::theme::{
    accent_bold, danger, frost_glow, hairline_style, muted, pill, rounded_block, section_rule,
    selected_style, warn, ICE_DIM, SURFACE_PILL, SURFACE_SEL, VIOLET,
};
use super::wrapped_line_count;
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

    let inner_w = content_area.width.saturating_sub(2).max(1);
    let inner_w_usize = inner_w as usize;
    let mut lines: Vec<Line> = Vec::new();
    let mut visual_rows: usize = 0;
    let mut row_index = 0usize;
    let mut selected_range: Option<(usize, usize)> = None;

    let push_line = |lines: &mut Vec<Line<'_>>, visual_rows: &mut usize, line: Line<'static>| {
        *visual_rows += line_visual_rows(&line, inner_w);
        lines.push(line);
    };

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

    push_line(
        &mut lines,
        &mut visual_rows,
        section_rule("Proposals awaiting decision", inner_w),
    );
    if pending_proposals.is_empty() {
        let empty_msg = if decided_count > 0 {
            format!("   (no pending proposals · {decided_count} decided in history)")
        } else {
            "   (no pending proposals)".to_string()
        };
        push_line(
            &mut lines,
            &mut visual_rows,
            Line::styled(empty_msg, muted()),
        );
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
            let sel_start = visual_rows;
            let content_text = proposal.content.as_deref().unwrap_or("");
            let prefix_w = 3 + 10 + 1 + scope.chars().count() + 2 + 1;
            let first_w = inner_w_usize.saturating_sub(prefix_w);
            let cont_w = inner_w_usize.saturating_sub(5).max(8);

            let badge_spans = vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(" proposal ", pill(VIOLET, SURFACE_SEL)),
                Span::raw(" "),
                Span::styled(format!(" {scope} "), pill(ICE_DIM, SURFACE_PILL)),
            ];

            if first_w >= 12 {
                let wrapped = wrap_text_lines(content_text, first_w, cont_w);
                for (chunk_idx, chunk) in wrapped.into_iter().enumerate() {
                    let line = if chunk_idx == 0 {
                        let mut spans = badge_spans.clone();
                        spans.push(Span::raw(" "));
                        spans.push(Span::styled(chunk, frost_glow()));
                        Line::from(spans)
                    } else {
                        Line::from(vec![Span::raw("     "), Span::styled(chunk, frost_glow())])
                    };
                    push_line(
                        &mut lines,
                        &mut visual_rows,
                        if is_sel {
                            line.style(selected_style())
                        } else {
                            line
                        },
                    );
                }
            } else {
                let header_line = Line::from(badge_spans);
                push_line(
                    &mut lines,
                    &mut visual_rows,
                    if is_sel {
                        header_line.style(selected_style())
                    } else {
                        header_line
                    },
                );
                let body_w = inner_w_usize.saturating_sub(3).max(8);
                for chunk in wrap_text_lines(content_text, body_w, body_w) {
                    let line =
                        Line::from(vec![Span::raw("   "), Span::styled(chunk, frost_glow())]);
                    push_line(
                        &mut lines,
                        &mut visual_rows,
                        if is_sel {
                            line.style(selected_style())
                        } else {
                            line
                        },
                    );
                }
            }
            if is_sel {
                push_line(
                    &mut lines,
                    &mut visual_rows,
                    Line::styled("     a approve · x reject", Style::default().fg(ICE_DIM)),
                );
                selected_range = Some((sel_start, visual_rows));
            }
            row_index += 1;
        }
    }
    push_line(&mut lines, &mut visual_rows, Line::from(""));

    push_line(
        &mut lines,
        &mut visual_rows,
        section_rule("Global memory · owner.md", inner_w),
    );
    if snapshot.global.externalChange {
        push_line(
            &mut lines,
            &mut visual_rows,
            Line::styled(
                "   ▲ file changed outside OpenFrost — press R to reload",
                warn(),
            ),
        );
    }
    for problem in &snapshot.global.problems {
        push_line(
            &mut lines,
            &mut visual_rows,
            Line::styled(format!("   × {problem}"), danger()),
        );
    }
    if snapshot.global.entries.is_empty() && snapshot.global.problems.is_empty() {
        push_line(
            &mut lines,
            &mut visual_rows,
            Line::styled("   (no global memory entries)", muted()),
        );
    }
    for entry in &snapshot.global.entries {
        let is_sel = row_index == app.memory.selected;
        let sel_start = visual_rows;
        push_entry_lines(
            &mut lines,
            &mut visual_rows,
            &entry.content,
            is_sel,
            inner_w,
        );
        if is_sel {
            push_line(
                &mut lines,
                &mut visual_rows,
                Line::styled("     e edit · d delete", Style::default().fg(ICE_DIM)),
            );
            selected_range = Some((sel_start, visual_rows));
        }
        row_index += 1;
    }
    push_line(&mut lines, &mut visual_rows, Line::from(""));

    for view in &snapshot.projects {
        let is_header_sel = row_index == app.memory.selected;
        let header_start = visual_rows;
        row_index += 1;

        let raw_label = format!("{} · project memory", view.projectName);
        let max_label = inner_w_usize.saturating_sub(8).max(8);
        let header_label = if raw_label.chars().count() > max_label {
            truncate(&raw_label, max_label.saturating_sub(1))
        } else {
            raw_label
        };

        if is_header_sel {
            let prefix_len = 3 + header_label.chars().count() + 1;
            let fill = inner_w_usize.saturating_sub(prefix_len + 2);
            push_line(
                &mut lines,
                &mut visual_rows,
                Line::from(vec![
                    Span::styled(" ▸ ", accent_bold()),
                    Span::styled(header_label, accent_bold()),
                    Span::styled(" ", hairline_style()),
                    Span::styled("─".repeat(fill), hairline_style()),
                ])
                .style(selected_style()),
            );
            selected_range = Some((header_start, visual_rows));
        } else {
            push_line(
                &mut lines,
                &mut visual_rows,
                section_rule(&header_label, inner_w),
            );
        }

        if view.externalChange {
            push_line(
                &mut lines,
                &mut visual_rows,
                Line::styled(
                    "   ▲ file changed outside OpenFrost — press R to reload",
                    warn(),
                ),
            );
        }
        for problem in &view.problems {
            push_line(
                &mut lines,
                &mut visual_rows,
                Line::styled(format!("   × {problem}"), danger()),
            );
        }
        if view.entries.is_empty() && view.problems.is_empty() {
            push_line(
                &mut lines,
                &mut visual_rows,
                Line::styled("   (no entries)", muted()),
            );
        }
        for entry in &view.entries {
            let is_sel = row_index == app.memory.selected;
            let sel_start = visual_rows;
            push_entry_lines(
                &mut lines,
                &mut visual_rows,
                &entry.content,
                is_sel,
                inner_w,
            );
            if is_sel {
                push_line(
                    &mut lines,
                    &mut visual_rows,
                    Line::styled("     e edit · d delete", Style::default().fg(ICE_DIM)),
                );
                selected_range = Some((sel_start, visual_rows));
            }
            row_index += 1;
        }
        push_line(&mut lines, &mut visual_rows, Line::from(""));
    }

    let inner_height = content_area.height.saturating_sub(2) as usize;
    let max_scroll = visual_rows.saturating_sub(inner_height);
    let scroll_y = match selected_range {
        Some((start, end)) => {
            let mut s = start.saturating_sub(inner_height / 2);
            if end.saturating_sub(start) <= inner_height && end > s + inner_height {
                s = end.saturating_sub(inner_height);
            }
            s.min(max_scroll)
        }
        None => 0,
    } as u16;

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

fn line_visual_rows(line: &Line<'_>, width: u16) -> usize {
    wrapped_line_count(line, width)
}

fn wrap_text_lines(text: &str, first_w: usize, cont_w: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut first = true;
    for raw_line in text.lines() {
        let max_w = if first { first_w } else { cont_w }.max(1);
        let mut current = String::new();
        let mut current_w = 0usize;
        for word in raw_line.split_whitespace() {
            let word_w = word.chars().count();
            if current_w == 0 {
                if word_w <= max_w {
                    current.push_str(word);
                    current_w = word_w;
                } else {
                    for ch in word.chars() {
                        let line_limit = if first && out.is_empty() {
                            first_w
                        } else {
                            cont_w
                        }
                        .max(1);
                        if current_w >= line_limit {
                            out.push(std::mem::take(&mut current));
                            current_w = 0;
                            first = false;
                        }
                        current.push(ch);
                        current_w += 1;
                    }
                }
            } else {
                let line_limit = if first && out.is_empty() {
                    first_w
                } else {
                    cont_w
                }
                .max(1);
                if current_w + 1 + word_w <= line_limit {
                    current.push(' ');
                    current.push_str(word);
                    current_w += 1 + word_w;
                } else {
                    out.push(std::mem::take(&mut current));
                    first = false;
                    let next_limit = cont_w.max(1);
                    if word_w <= next_limit {
                        current.push_str(word);
                        current_w = word_w;
                    } else {
                        current_w = 0;
                        for ch in word.chars() {
                            if current_w >= next_limit {
                                out.push(std::mem::take(&mut current));
                                current_w = 0;
                            }
                            current.push(ch);
                            current_w += 1;
                        }
                    }
                }
            }
        }
        if !current.is_empty() || raw_line.is_empty() {
            out.push(current);
            first = false;
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

fn push_entry_lines(
    lines: &mut Vec<Line<'static>>,
    visual_rows: &mut usize,
    content: &str,
    is_sel: bool,
    inner_w: u16,
) {
    let body_w = (inner_w as usize).saturating_sub(3).max(8);
    let marker = row_marker(is_sel);
    for (idx, chunk) in wrap_text_lines(content, body_w, body_w)
        .into_iter()
        .enumerate()
    {
        let line = if idx == 0 {
            Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(chunk, frost_glow()),
            ])
        } else {
            Line::from(vec![Span::raw("   "), Span::styled(chunk, frost_glow())])
        };
        let styled = if is_sel {
            line.style(selected_style())
        } else {
            line
        };
        *visual_rows += line_visual_rows(&styled, inner_w);
        lines.push(styled);
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

    #[test]
    fn render_memory_scrolls_to_bottom_when_entries_wrap_and_highlights_project_header() {
        use crate::contracts::ProjectMemoryView;

        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Memory;

        let long_entries: Vec<&str> = vec![
            "First wrapped memory entry with plenty of words so that it wraps across multiple visual rows on a narrow terminal",
            "Second wrapped memory entry with plenty of words so that it wraps across multiple visual rows on a narrow terminal",
            "Third wrapped memory entry with plenty of words so that it wraps across multiple visual rows on a narrow terminal",
            "Fourth wrapped memory entry with plenty of words so that it wraps across multiple visual rows on a narrow terminal",
        ];
        let mut snapshot = make_snapshot(vec![], long_entries);
        snapshot.projects.push(ProjectMemoryView {
            scope: MemoryScope::Project,
            projectId: "proj-1".into(),
            projectName: "Alpha".into(),
            path: "alpha.md".into(),
            exists: true,
            sha256: Some("sha-proj".into()),
            entries: vec![MemoryEntry {
                id: "pe-1".into(),
                scope: MemoryScope::Project,
                projectId: Some("proj-1".into()),
                content: "Final project entry at the very bottom".into(),
                source: MemorySource {
                    kind: "manual".into(),
                    taskId: None,
                    artifactId: None,
                    label: "manual".into(),
                },
                createdAt: "2026-11-25T00:00:00Z".into(),
                updatedAt: "2026-11-25T00:00:00Z".into(),
            }],
            problems: vec![],
            externalChange: false,
        });
        app.memory.snapshot = Some(snapshot);
        app.memory.rebuild_rows();

        // Select the last entry (ProjectEntry) in a short 60x14 viewport where earlier items wrap.
        app.memory.selected = app.memory.rows.len() - 1;
        let backend = TestBackend::new(60, 14);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();

        let rendered: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            rendered.contains("Final project entry at the very bottom"),
            "expected wrapped scroll to reach final entry, got:\n{rendered}"
        );
        assert!(
            rendered.contains("e edit · d delete"),
            "expected action hint for final entry, got:\n{rendered}"
        );

        // Now select MemRow::ProjectHeader (right before the final ProjectEntry) and verify visible marker.
        let header_idx = app.memory.rows.len() - 2;
        app.memory.selected = header_idx;
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
        let header_rendered: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            header_rendered.contains("▸ Alpha · project memory"),
            "expected visible '▸' indicator on selected ProjectHeader, got:\n{header_rendered}"
        );
    }

    #[test]
    fn render_memory_does_not_truncate_long_entries_at_100_cols() {
        let long_text = "Prefer concise engineering summaries with explicit metrics, reproducible verification commands, and clear risk callouts at the very end TAIL_MARKER_VISIBLE";
        let snapshot = make_snapshot(
            vec![make_proposal(
                "p1",
                MemoryProposalState::Pending,
                Some(long_text),
            )],
            vec![long_text],
        );
        let rendered = render_memory_to_string(snapshot);
        assert!(
            rendered.contains("TAIL_MARKER_VISIBLE"),
            "expected full wrapped text without hardcoded 84/100 char truncation, got:\n{rendered}"
        );
    }
}
