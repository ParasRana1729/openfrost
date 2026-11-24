use super::theme::{accent_bold, danger, frost_glow, muted, pill, rounded_block, warn, FROST_GLOW};
use crate::app::{truncate, App};
use crate::contracts::MemoryScope;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_memory(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(snapshot) = &app.memory.snapshot else {
        frame.render_widget(
            Paragraph::new(" Loading memory…")
                .style(muted())
                .block(rounded_block("Memory")),
            area,
        );
        return;
    };
    let mut lines: Vec<Line> = Vec::new();
    let mut row_index = 0usize;

    lines.push(Line::styled(" Proposals awaiting decision", accent_bold()));
    if snapshot.proposals.is_empty() {
        lines.push(Line::styled("   (none)".to_string(), muted()));
        row_index += 1;
    }
    for proposal in &snapshot.proposals {
        let is_sel = row_index == app.memory.selected;
        let marker = row_marker(is_sel);
        let scope = match proposal.scope {
            MemoryScope::Global => "global".to_string(),
            MemoryScope::Project => format!(
                "project {}",
                snapshot
                    .projects
                    .iter()
                    .find(|view| Some(&view.projectId) == proposal.projectId.as_ref())
                    .map(|view| view.projectName.as_str())
                    .unwrap_or("?")
            ),
        };
        lines.push(Line::from(vec![
            Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
            Span::styled(" proposal ", pill(FROST_GLOW, Color::Rgb(76, 29, 149))),
            Span::styled(format!(" ({scope}) "), muted()),
            Span::styled(
                truncate(proposal.content.as_deref().unwrap_or(""), 90),
                frost_glow(),
            ),
        ]));
        if is_sel {
            lines.push(Line::styled(
                "     a approve • x reject".to_string(),
                muted(),
            ));
        }
        row_index += 1;
    }
    lines.push(Line::from(""));

    lines.push(Line::styled(" Global memory (owner.md)", accent_bold()));
    if snapshot.global.externalChange {
        lines.push(Line::styled(
            "   ▲ file changed outside OpenFrost — press R to reload".to_string(),
            warn(),
        ));
    }
    for problem in &snapshot.global.problems {
        lines.push(Line::styled(format!("   ✖ {problem}"), danger()));
    }
    for (index, entry) in snapshot.global.entries.iter().enumerate() {
        let is_sel = row_index == app.memory.selected;
        let marker = row_marker(is_sel);
        lines.push(Line::from(vec![
            Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
            Span::styled(truncate(&entry.content, 100), frost_glow()),
        ]));
        if is_sel {
            lines.push(Line::styled("     e edit • d delete".to_string(), muted()));
        }
        let _ = index;
        row_index += 1;
    }
    lines.push(Line::from(""));

    for (project_index, view) in snapshot.projects.iter().enumerate() {
        lines.push(Line::styled(
            format!(" {} (project memory)", view.projectName),
            accent_bold(),
        ));
        let _ = project_index;
        if view.externalChange {
            lines.push(Line::styled(
                "   ▲ file changed outside OpenFrost — press R to reload".to_string(),
                warn(),
            ));
        }
        for problem in &view.problems {
            lines.push(Line::styled(format!("   ✖ {problem}"), danger()));
        }
        for entry in &view.entries {
            let is_sel = row_index == app.memory.selected;
            let marker = row_marker(is_sel);
            lines.push(Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(truncate(&entry.content, 100), frost_glow()),
            ]));
            if is_sel {
                lines.push(Line::styled("     e edit • d delete".to_string(), muted()));
            }
            row_index += 1;
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::styled(
        " j/k move • a approve • x reject • e edit • d delete • R reload from disk".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(rounded_block("Memory")),
        area,
    );
}

fn row_marker(is_sel: bool) -> &'static str {
    if is_sel {
        " ▸ "
    } else {
        "   "
    }
}
