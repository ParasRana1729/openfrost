use super::tasks::keybind_footer;
use super::theme::{
    accent_bold, danger, frost_glow, muted, pill, rounded_block, section_rule, selected_style,
    warn, ICE_DIM, SURFACE_PILL, SURFACE_SEL, VIOLET,
};
use crate::app::{truncate, App};
use crate::contracts::MemoryScope;
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

    lines.push(section_rule("Proposals awaiting decision", inner_w));
    if snapshot.proposals.is_empty() {
        lines.push(Line::styled("   (no pending proposals)", muted()));
    } else {
        for proposal in &snapshot.proposals {
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
    let title = format!(
        "Memory  ({} pending · {} global · {} project)",
        snapshot.proposals.len(),
        snapshot.global.entries.len(),
        project_entries
    );

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0))
            .block(rounded_block(&title)),
        content_area,
    );
    frame.render_widget(
        keybind_footer(&[
            ("j/k", "move"),
            ("a", "approve"),
            ("x", "reject"),
            ("e", "edit"),
            ("d", "delete"),
            ("R", "reload"),
        ]),
        footer_area,
    );
}

fn row_marker(is_sel: bool) -> &'static str {
    if is_sel {
        " ▸ "
    } else {
        "   "
    }
}
