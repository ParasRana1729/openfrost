use super::{accent, block, muted, selected_style};
use crate::app::App;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_projects(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.projects.detail_open {
        let Some(project) = app.projects.projects.get(app.projects.selected) else {
            return;
        };
        let mut lines: Vec<Line> = vec![
            Line::styled(
                project.name.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Line::styled(
                project
                    .instructions
                    .clone()
                    .unwrap_or_else(|| "(no instructions)".to_string()),
                Style::default(),
            ),
            Line::from(""),
            Line::styled("Granted folders", accent().add_modifier(Modifier::BOLD)),
        ];
        for (index, grant) in project.grants.iter().enumerate() {
            let marker = if index == app.projects.grant_selected {
                " > "
            } else {
                "   "
            };
            lines.push(Line::from(format!("{marker}{}", grant.path)));
        }
        if project.grants.is_empty() {
            lines.push(Line::styled(
                "  (none \u{2014} press g to grant a folder)",
                muted(),
            ));
        }
        lines.push(Line::from(""));
        lines.push(Line::styled(
            " b/Esc back | g grant folder | j/k select grant | x revoke".to_string(),
            muted(),
        ));
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block("Project detail")),
            area,
        );
        return;
    }
    let items: Vec<ListItem> = app
        .projects
        .projects
        .iter()
        .enumerate()
        .map(|(index, project)| {
            let line = Line::from(vec![
                Span::raw(project.name.clone()),
                Span::styled(format!("  {} grant(s)", project.grants.len()), muted()),
            ]);
            if index == app.projects.selected {
                ListItem::new(line).style(selected_style())
            } else {
                ListItem::new(line)
            }
        })
        .collect();
    let mut list_state = ListState::default();
    list_state.select(Some(
        app.projects
            .selected
            .min(app.projects.projects.len().saturating_sub(1)),
    ));
    frame.render_stateful_widget(
        List::new(items).block(block("Projects (n new, Enter detail, e edit)")),
        area,
        &mut list_state,
    );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
