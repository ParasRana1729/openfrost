use super::tasks::{empty_state_lines, keybind_footer};
use super::theme::{
    accent_bold, frost_glow, ice_mid, muted, rounded_block, section_rule, selected_style, ICE_DIM,
};
use super::{wrapped_line_count, wrapped_lines_count};
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
        let inner_w = content_area.width.saturating_sub(2).max(1);
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
        ];
        if let Some(instructions) = project
            .instructions
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            for inst_line in instructions.lines() {
                if inst_line.is_empty() {
                    lines.push(Line::from(""));
                } else {
                    lines.push(Line::styled(format!("  {inst_line}"), frost_glow()));
                }
            }
        } else {
            lines.push(Line::styled("  (no project instructions)", muted()));
        }
        lines.push(Line::from(""));
        lines.push(section_rule("Granted folders", inner_w));

        let mut visual_rows: usize = wrapped_lines_count(&lines, inner_w);
        let mut selected_grant_range: Option<(usize, usize)> = None;

        for (index, grant) in project.grants.iter().enumerate() {
            let is_sel = index == app.projects.grant_selected;
            let marker = if is_sel { " ▸ " } else { "   " };
            let line = Line::from(vec![
                Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                Span::styled(grant.path.clone(), frost_glow()),
            ]);
            let styled_line = if is_sel {
                line.style(selected_style())
            } else {
                line
            };
            let start_row = visual_rows;
            visual_rows += wrapped_line_count(&styled_line, inner_w);
            if is_sel {
                selected_grant_range = Some((start_row, visual_rows));
            }
            lines.push(styled_line);
        }
        if project.grants.is_empty() {
            let empty_line = Line::styled(
                "   (none — press g to grant read access to a folder)",
                muted(),
            );
            visual_rows += wrapped_line_count(&empty_line, inner_w);
            lines.push(empty_line);
        }

        let inner_height = content_area.height.saturating_sub(2) as usize;
        let max_scroll = visual_rows.saturating_sub(inner_height);
        let scroll_y = match selected_grant_range {
            Some((start, end)) => {
                let mut s = start.saturating_sub(inner_height / 2);
                if end.saturating_sub(start) <= inner_height && end > s + inner_height {
                    s = end.saturating_sub(inner_height);
                }
                s.min(max_scroll)
            }
            None => 0,
        } as u16;

        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .scroll((scroll_y, 0))
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
        let inner_w = content_area.width.saturating_sub(2) as usize;
        let items: Vec<ListItem> =
            app.projects
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
                    let prefix_len =
                        3 + project.name.chars().count() + 5 + grant_label.chars().count();
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
                    let avail_snippet = inner_w.saturating_sub(prefix_len + 5);
                    if avail_snippet >= 8 {
                        if let Some(first_line) = project.instructions.as_deref().and_then(|text| {
                            text.lines().map(str::trim).find(|line| !line.is_empty())
                        }) {
                            spans.push(Span::styled(
                                format!(
                                    "  ·  {}",
                                    truncate(first_line, avail_snippet.saturating_sub(1))
                                ),
                                muted(),
                            ));
                        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::{Screen, Tab};
    use crate::contracts::Project;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use tokio::sync::mpsc;

    #[test]
    fn project_detail_preserves_left_padding_on_every_instruction_line() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Projects;
        app.projects.detail_open = true;
        app.projects.projects = vec![Project {
            id: "p1".into(),
            name: "Alpha".into(),
            instructions: Some(
                "First instruction line\nSecond instruction line\nThird line".into(),
            ),
            grants: vec![],
            createdAt: "2026-11-25T00:00:00Z".into(),
            updatedAt: "2026-11-25T00:00:00Z".into(),
        }];

        let backend = TestBackend::new(80, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();

        let buf = terminal.backend().buffer();
        let rows: Vec<String> = (0..20)
            .map(|y| {
                (0..80)
                    .map(|x| buf.cell((x, y)).unwrap().symbol())
                    .collect::<String>()
            })
            .collect();

        for expected in [
            "First instruction line",
            "Second instruction line",
            "Third line",
        ] {
            let row = rows
                .iter()
                .find(|r| r.contains(expected))
                .unwrap_or_else(|| panic!("missing '{expected}' in:\n{}", rows.join("\n")));
            assert!(
                row.contains(&format!("│  {expected}")),
                "expected 2-space left padding after border for '{expected}', got: '{row}'"
            );
        }
    }
}
