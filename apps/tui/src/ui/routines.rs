use super::tasks::{empty_state_lines, keybind_footer};
use super::theme::{
    accent_bold, frost_glow, muted, pill, rounded_block, section_rule, selected_style, AMBER,
    EMERALD, ICE_DIM, MUTED, SURFACE_PILL, SURFACE_SEL,
};
use super::{wrapped_line_count, wrapped_lines_count};
use crate::app::{truncate, App};
use crate::contracts::{RoutineOccurrenceState, RoutineSchedule, RoutineState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_routines(app: &mut App, frame: &mut Frame, area: Rect) {
    let vertical = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    if app.routines.detail_open {
        if let Some(detail) = &app.routines.detail {
            let inner_w = content_area.width.saturating_sub(2).max(1);
            let mut lines: Vec<Line> = Vec::new();
            let routine = &detail.view.routine;
            let (state_label, state_pill) = routine_state_pill(&routine.state);
            lines.push(Line::from(vec![
                Span::styled(
                    format!(" {}", routine.name),
                    frost_glow().add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(state_label, state_pill),
            ]));
            let schedule_str = match &routine.schedule {
                RoutineSchedule::Weekly { time, .. } => format!("weekly at {time}"),
                RoutineSchedule::Daily { time } => format!("daily at {time}"),
            };
            lines.push(Line::styled(
                format!(
                    " {}  ·  {}  ·  {}",
                    detail.view.projectName.as_deref().unwrap_or("global"),
                    schedule_str,
                    routine.timezone,
                ),
                muted(),
            ));
            lines.push(Line::from(vec![
                Span::styled(" Template: ", muted()),
                Span::styled(
                    routine.template.title.clone(),
                    frost_glow().add_modifier(Modifier::BOLD),
                ),
                Span::styled(" — ", muted()),
                Span::styled(routine.template.request.clone(), frost_glow()),
            ]));
            lines.push(Line::from(""));
            lines.push(section_rule("Recent occurrences", inner_w));

            let mut visual_rows = wrapped_lines_count(&lines, inner_w);
            let mut selected_range: Option<(usize, usize)> = None;

            for (index, occurrence) in detail.occurrences.iter().enumerate() {
                let is_sel = index == app.routines.occurrence_selected;
                let marker = if is_sel { " ▸ " } else { "   " };
                let (state_text, state_style) = match occurrence.state {
                    RoutineOccurrenceState::Scheduled => {
                        (" scheduled ", pill(ICE_DIM, SURFACE_PILL))
                    }
                    RoutineOccurrenceState::Missed => (" missed ", pill(AMBER, SURFACE_SEL)),
                    RoutineOccurrenceState::Skipped => (" skipped ", pill(MUTED, SURFACE_PILL)),
                };
                let task_part = occurrence
                    .taskId
                    .as_deref()
                    .map(|id| format!("  → task {id}"))
                    .unwrap_or_default();
                let line = Line::from(vec![
                    Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                    Span::styled(format!("{}  ", occurrence.occurrenceKey), frost_glow()),
                    Span::styled(state_text, state_style),
                    Span::styled(task_part, muted()),
                ]);
                let styled_line = if is_sel {
                    line.style(selected_style())
                } else {
                    line
                };
                let start_row = visual_rows;
                visual_rows += wrapped_line_count(&styled_line, inner_w);
                if is_sel {
                    selected_range = Some((start_row, visual_rows));
                }
                lines.push(styled_line);
            }
            if detail.occurrences.is_empty() {
                let empty_line = Line::styled("   (none yet)", muted());
                visual_rows += wrapped_line_count(&empty_line, inner_w);
                lines.push(empty_line);
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

            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .scroll((scroll_y, 0))
                    .block(rounded_block("Routine detail")),
                content_area,
            );
            frame.render_widget(
                keybind_footer(&[
                    ("b/Esc", "back"),
                    ("j/k", "occurrences"),
                    ("r", "run missed now"),
                    ("s", "skip missed"),
                ]),
                footer_area,
            );
        }
        return;
    }

    let title = format!("Routines ({})", app.routines.routines.len());
    let block = rounded_block(&title);

    if app.routines.routines.is_empty() {
        let lines = empty_state_lines(
            "No routines yet",
            "Routines schedule recurring weekly or daily planning runs.",
            Some("Press n to create a routine."),
        );
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block),
            content_area,
        );
    } else {
        let inner_w = content_area.width.saturating_sub(2) as usize;
        let items: Vec<ListItem> = app
            .routines
            .routines
            .iter()
            .enumerate()
            .map(|(index, view)| {
                let is_sel = index == app.routines.selected;
                let (state_label, state_pill) = routine_state_pill(&view.routine.state);
                let prefix_w = 3 + state_label.chars().count() + 1;
                let missed_pill =
                    (view.missedCount > 0).then(|| format!(" {} missed ", view.missedCount));
                let missed_w = missed_pill
                    .as_ref()
                    .map(|p| 2 + p.chars().count())
                    .unwrap_or(0);

                let full_next = format!(
                    "  ·  next: {}",
                    view.nextOccurrenceAt.as_deref().unwrap_or("—")
                );
                let short_next = view
                    .nextOccurrenceAt
                    .as_deref()
                    .map(|ts| format!("  ·  {}", ts.get(..10).unwrap_or(ts)))
                    .unwrap_or_default();

                let rem_after_missed = inner_w.saturating_sub(prefix_w + missed_w);
                let full_next_w = full_next.chars().count();
                let short_next_w = short_next.chars().count();
                let next_str = if rem_after_missed >= full_next_w + 14 {
                    Some(full_next)
                } else if !short_next.is_empty() && rem_after_missed >= short_next_w + 12 {
                    Some(short_next)
                } else {
                    None
                };
                let next_w = next_str.as_deref().map(|s| s.chars().count()).unwrap_or(0);
                let avail_title_proj = rem_after_missed.saturating_sub(next_w);

                let name_len = view.routine.name.chars().count();
                let (shown_name, shown_project) = match view.projectName.as_deref() {
                    Some(proj) => {
                        let proj_full_w = 5 + proj.chars().count();
                        if name_len + proj_full_w <= avail_title_proj {
                            (view.routine.name.clone(), Some(proj.to_string()))
                        } else {
                            let min_name = 12.min(avail_title_proj);
                            let name_budget =
                                (avail_title_proj * 2 / 3).max(min_name).min(name_len);
                            let proj_budget = avail_title_proj.saturating_sub(name_budget);
                            if proj_budget >= 9 {
                                let name_out = fit_text(&view.routine.name, name_budget);
                                let proj_out = fit_text(proj, proj_budget - 5);
                                (name_out, Some(proj_out))
                            } else {
                                (fit_text(&view.routine.name, avail_title_proj), None)
                            }
                        }
                    }
                    None => (fit_text(&view.routine.name, avail_title_proj), None),
                };

                let mut spans = vec![
                    Span::styled(
                        if is_sel { " ▸ " } else { "   " },
                        if is_sel { accent_bold() } else { muted() },
                    ),
                    Span::styled(state_label, state_pill),
                    Span::raw(" "),
                    Span::styled(shown_name, frost_glow()),
                ];
                if let Some(project) = shown_project {
                    spans.push(Span::styled(format!("  ·  {project}"), muted()));
                }
                if let Some(next) = next_str {
                    spans.push(Span::styled(next, Style::default().fg(ICE_DIM)));
                }
                if let Some(pill_text) = missed_pill {
                    spans.push(Span::raw("  "));
                    spans.push(Span::styled(pill_text, pill(AMBER, SURFACE_SEL)));
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
            app.routines
                .selected
                .min(app.routines.routines.len().saturating_sub(1)),
        ));
        frame.render_stateful_widget(List::new(items).block(block), content_area, &mut list_state);
    }

    frame.render_widget(
        keybind_footer(&[
            ("n", "new"),
            ("Enter", "detail"),
            ("E", "edit"),
            ("e", "pause/enable"),
            ("x", "remove"),
            ("j/k", "move"),
        ]),
        footer_area,
    );
}

fn fit_text(text: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        String::new()
    } else if text.chars().count() <= max_chars {
        text.to_string()
    } else if max_chars == 1 {
        "\u{2026}".to_string()
    } else {
        truncate(text, max_chars - 1)
    }
}

fn routine_state_pill(state: &RoutineState) -> (&'static str, Style) {
    match state {
        RoutineState::Active => (" active ", pill(EMERALD, SURFACE_SEL)),
        RoutineState::Paused => (" paused ", pill(MUTED, SURFACE_PILL)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::{Screen, Tab};
    use crate::contracts::{Routine, RoutineTemplate, RoutineView};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use tokio::sync::mpsc;

    #[test]
    fn routines_list_keeps_missed_pill_visible_on_80_cols() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Routines;
        app.routines.routines = vec![RoutineView {
            routine: Routine {
                id: "r1".into(),
                projectId: "p1".into(),
                name: "Very Long Weekly Engineering Planning And Triage Routine Name".into(),
                schedule: RoutineSchedule::Weekly {
                    weekday: 1,
                    time: "09:00".into(),
                },
                timezone: "UTC".into(),
                template: RoutineTemplate {
                    title: "Weekly plan".into(),
                    request: "Plan the week".into(),
                    constraints: None,
                },
                state: RoutineState::Active,
                windowStartAt: "2026-11-01T00:00:00Z".into(),
                lastOccurrenceKey: None,
                lastOccurrenceAt: None,
                createdAt: "2026-11-01T00:00:00Z".into(),
                updatedAt: "2026-11-01T00:00:00Z".into(),
            },
            projectName: Some("OpenFrost Core Platform".into()),
            missedCount: 3,
            nextOccurrenceAt: Some("2026-11-30T09:00:00Z".into()),
            nextOccurrenceKey: Some("2026-11-30".into()),
        }];

        let backend = TestBackend::new(80, 16);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();

        let content: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            content.contains("3 missed"),
            "expected '3 missed' pill to remain visible at 80 cols, got:\n{content}"
        );
    }
}
