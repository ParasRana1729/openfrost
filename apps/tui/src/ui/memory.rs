use super::{accent, block, muted};
use crate::app::{truncate, App};
use crate::contracts::MemoryScope;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_memory(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(snapshot) = &app.memory.snapshot else {
        frame.render_widget(
            Paragraph::new("Loading memory\u{2026}").block(block("Memory")),
            area,
        );
        return;
    };
    let mut lines: Vec<Line> = Vec::new();
    let mut row_index = 0usize;

    lines.push(Line::styled(
        "Proposals awaiting decision",
        accent().add_modifier(Modifier::BOLD),
    ));
    if snapshot.proposals.is_empty() {
        lines.push(Line::styled("  (none)".to_string(), muted()));
        row_index += 1;
    }
    for proposal in &snapshot.proposals {
        let marker = row_marker(app, row_index);
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
            Span::raw(marker),
            Span::styled(
                " proposal ",
                Style::default().fg(Color::Black).bg(Color::Magenta),
            ),
            Span::styled(format!("({scope}) "), muted()),
            Span::raw(truncate(proposal.content.as_deref().unwrap_or(""), 90)),
        ]));
        if row_index == app.memory.selected {
            lines.push(Line::styled("   a approve | x reject".to_string(), muted()));
        }
        row_index += 1;
    }
    lines.push(Line::from(""));

    lines.push(Line::styled(
        "Global memory (owner.md)",
        accent().add_modifier(Modifier::BOLD),
    ));
    if snapshot.global.externalChange {
        lines.push(Line::styled(
            "  ! file changed outside OpenFrost \u{2014} press R to reload".to_string(),
            Style::default().fg(Color::Yellow),
        ));
    }
    for problem in &snapshot.global.problems {
        lines.push(Line::styled(
            format!("  ! {problem}"),
            Style::default().fg(Color::Red),
        ));
    }
    for (index, entry) in snapshot.global.entries.iter().enumerate() {
        let marker = row_marker(app, row_index);
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::raw(truncate(&entry.content, 100)),
        ]));
        if row_index == app.memory.selected {
            lines.push(Line::styled("   e edit | d delete".to_string(), muted()));
        }
        let _ = index;
        row_index += 1;
    }
    lines.push(Line::from(""));

    for (project_index, view) in snapshot.projects.iter().enumerate() {
        lines.push(Line::styled(
            format!("{} (project memory)", view.projectName),
            accent().add_modifier(Modifier::BOLD),
        ));
        let _ = project_index;
        if view.externalChange {
            lines.push(Line::styled(
                "  ! file changed outside OpenFrost \u{2014} press R to reload".to_string(),
                Style::default().fg(Color::Yellow),
            ));
        }
        for problem in &view.problems {
            lines.push(Line::styled(
                format!("  ! {problem}"),
                Style::default().fg(Color::Red),
            ));
        }
        for entry in &view.entries {
            let marker = row_marker(app, row_index);
            lines.push(Line::from(vec![
                Span::raw(marker),
                Span::raw(truncate(&entry.content, 100)),
            ]));
            if row_index == app.memory.selected {
                lines.push(Line::styled("   e edit | d delete".to_string(), muted()));
            }
            row_index += 1;
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::styled(
        " j/k move | a approve proposal | x reject proposal | e edit entry | d delete entry | R reload from disk".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block("Memory")),
        area,
    );
}

fn row_marker(app: &App, row_index: usize) -> &'static str {
    if row_index == app.memory.selected {
        " > "
    } else {
        "   "
    }
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------
