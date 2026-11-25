use super::tasks::{empty_state_lines, keybind_footer};
use super::theme::{
    accent_bold, frost_glow, muted, pill, rounded_block, section_rule, selected_style, AMBER,
    EMERALD, ICE_DIM, MUTED, SURFACE_PILL, SURFACE_SEL,
};
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
            let inner_w = content_area.width.saturating_sub(2);
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
                Span::styled(truncate(&routine.template.request, 110), frost_glow()),
            ]));
            lines.push(Line::from(""));
            lines.push(section_rule("Recent occurrences", inner_w));
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
                lines.push(if is_sel {
                    line.style(selected_style())
                } else {
                    line
                });
            }
            if detail.occurrences.is_empty() {
                lines.push(Line::styled("   (none yet)", muted()));
            }

            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
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
        let items: Vec<ListItem> = app
            .routines
            .routines
            .iter()
            .enumerate()
            .map(|(index, view)| {
                let is_sel = index == app.routines.selected;
                let (state_label, state_pill) = routine_state_pill(&view.routine.state);
                let mut spans = vec![
                    Span::styled(
                        if is_sel { " ▸ " } else { "   " },
                        if is_sel { accent_bold() } else { muted() },
                    ),
                    Span::styled(state_label, state_pill),
                    Span::raw(" "),
                    Span::styled(view.routine.name.clone(), frost_glow()),
                ];
                if let Some(project) = view.projectName.as_deref() {
                    spans.push(Span::styled(format!("  ·  {project}"), muted()));
                }
                spans.push(Span::styled(
                    format!(
                        "  ·  next: {}",
                        view.nextOccurrenceAt.as_deref().unwrap_or("—")
                    ),
                    Style::default().fg(ICE_DIM),
                ));
                if view.missedCount > 0 {
                    spans.push(Span::raw("  "));
                    spans.push(Span::styled(
                        format!(" {} missed ", view.missedCount),
                        pill(AMBER, SURFACE_SEL),
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

fn routine_state_pill(state: &RoutineState) -> (&'static str, Style) {
    match state {
        RoutineState::Active => (" active ", pill(EMERALD, SURFACE_SEL)),
        RoutineState::Paused => (" paused ", pill(MUTED, SURFACE_PILL)),
    }
}
