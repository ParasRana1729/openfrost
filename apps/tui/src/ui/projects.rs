use super::theme::{
    accent_bold, frost_glow, ice_mid, muted, primary_bold, rounded_block, selected_style,
};
use crate::app::App;
use ratatui::layout::Rect;
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
                format!(" {}", project.name),
                frost_glow().add_modifier(ratatui::style::Modifier::BOLD),
            ),
            Line::styled(
                format!(
                    " {}",
                    project
                        .instructions
                        .clone()
                        .unwrap_or_else(|| "(no project instructions)".to_string())
                ),
                muted(),
            ),
            Line::from(""),
            Line::styled(" Granted folders", accent_bold()),
        ];
        for (index, grant) in project.grants.iter().enumerate() {
            let is_sel = index == app.projects.grant_selected;
            let marker = if is_sel { " ▸ " } else { "   " };
            lines.push(Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(
                    grant.path.clone(),
                    if is_sel { frost_glow() } else { primary_bold() },
                ),
            ]));
        }
        if project.grants.is_empty() {
            lines.push(Line::styled(
                "   (none — press g to grant a folder)",
                muted(),
            ));
        }
        lines.push(Line::from(""));
        lines.push(Line::styled(
            " b/Esc back • g grant folder • j/k select grant • x revoke".to_string(),
            muted(),
        ));
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(rounded_block("Project detail")),
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
            let is_sel = index == app.projects.selected;
            let line = Line::from(vec![
                Span::styled(
                    if is_sel { " ▸ " } else { "   " },
                    if is_sel { accent_bold() } else { muted() },
                ),
                Span::styled(project.name.clone(), frost_glow()),
                Span::styled(format!("  •  {} grant(s)", project.grants.len()), ice_mid()),
            ]);
            if is_sel {
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
        List::new(items).block(rounded_block("Projects  •  n new • Enter detail • e edit")),
        area,
        &mut list_state,
    );
}
