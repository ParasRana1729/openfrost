use super::tasks::{empty_state_lines, keybind_footer};
use super::theme::{
    accent_bold, frost_glow, ice_mid, muted, rounded_block, section_rule, selected_style, ICE_DIM,
};
use crate::app::{truncate, App};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_projects(app: &mut App, frame: &mut Frame, area: Rect) {
    let vertical = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    if app.projects.detail_open {
        let Some(project) = app.projects.projects.get(app.projects.selected) else {
            return;
        };
        let inner_w = content_area.width.saturating_sub(2);
        let grant_count = project.grants.len();
        let grant_word = if grant_count == 1 { "grant" } else { "grants" };
        let mut lines: Vec<Line> = vec![
            Line::from(vec![
                Span::styled(
                    format!(" {}", project.name),
                    frost_glow().add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  ·  {grant_count} {grant_word}"), muted()),
            ]),
            Line::from(""),
            section_rule("Instructions", inner_w),
            Line::styled(
                format!(
                    "  {}",
                    project
                        .instructions
                        .clone()
                        .filter(|text| !text.trim().is_empty())
                        .unwrap_or_else(|| "(no project instructions)".to_string())
                ),
                if project
                    .instructions
                    .as_deref()
                    .is_some_and(|text| !text.trim().is_empty())
                {
                    frost_glow()
                } else {
                    muted()
                },
            ),
            Line::from(""),
            section_rule("Granted folders", inner_w),
        ];
        for (index, grant) in project.grants.iter().enumerate() {
            let is_sel = index == app.projects.grant_selected;
            let marker = if is_sel { " ▸ " } else { "   " };
            let line = Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(grant.path.clone(), frost_glow()),
            ]);
            lines.push(if is_sel {
                line.style(selected_style())
            } else {
                line
            });
        }
        if project.grants.is_empty() {
            lines.push(Line::styled(
                "   (none — press g to grant read access to a folder)",
                muted(),
            ));
        }

        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(rounded_block("Project detail")),
            content_area,
        );
        frame.render_widget(
            keybind_footer(&[
                ("b/Esc", "back"),
                ("g", "grant folder"),
                ("j/k", "select grant"),
                ("x", "revoke"),
            ]),
            footer_area,
        );
        return;
    }

    let title = format!("Projects ({})", app.projects.projects.len());
    let block = rounded_block(&title);

    if app.projects.projects.is_empty() {
        let lines = empty_state_lines(
            "No projects yet",
            "Projects scope instructions, granted folders, and project memory.",
            Some("Press n to create your first project."),
        );
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block),
            content_area,
        );
    } else {
        let items: Vec<ListItem> = app
            .projects
            .projects
            .iter()
            .enumerate()
            .map(|(index, project)| {
                let is_sel = index == app.projects.selected;
                let grant_count = project.grants.len();
                let grant_label = if grant_count == 1 {
                    "1 grant".to_string()
                } else {
                    format!("{grant_count} grants")
                };
                let mut spans = vec![
                    Span::styled(
                        if is_sel { " ▸ " } else { "   " },
                        if is_sel { accent_bold() } else { muted() },
                    ),
                    Span::styled(project.name.clone(), frost_glow()),
                    Span::styled(
                        format!("  ·  {grant_label}"),
                        if grant_count > 0 {
                            ice_mid()
                        } else {
                            Style::default().fg(ICE_DIM)
                        },
                    ),
                ];
                if let Some(first_line) = project
                    .instructions
                    .as_deref()
                    .and_then(|text| text.lines().map(str::trim).find(|line| !line.is_empty()))
                {
                    spans.push(Span::styled(
                        format!("  ·  {}", truncate(first_line, 44)),
                        muted(),
                    ));
                }
                let line = Line::from(spans);
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
        frame.render_stateful_widget(List::new(items).block(block), content_area, &mut list_state);
    }

    frame.render_widget(
        keybind_footer(&[
            ("n", "new"),
            ("Enter", "detail"),
            ("e", "edit"),
            ("j/k", "move"),
        ]),
        footer_area,
    );
}
