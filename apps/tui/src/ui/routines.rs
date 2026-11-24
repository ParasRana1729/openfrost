use super::{accent, block, muted, selected_style};
use crate::app::{truncate, App};
use crate::contracts::{RoutineOccurrenceState, RoutineState};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_routines(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.routines.detail_open {
        if let Some(detail) = &app.routines.detail {
            let mut lines: Vec<Line> = Vec::new();
            let routine = &detail.view.routine;
            lines.push(Line::styled(
                routine.name.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ));
            lines.push(Line::styled(
                format!(
                    "{} \u{2014} {} \u{2014} {} \u{2014} {}",
                    detail.view.projectName.as_deref().unwrap_or("?"),
                    match &routine.schedule {
                        crate::contracts::RoutineSchedule::Weekly { time, .. } => {
                            format!("weekly at {time}")
                        }
                        crate::contracts::RoutineSchedule::Daily { time } =>
                            format!("daily at {time}"),
                    },
                    routine.timezone,
                    if routine.state == RoutineState::Active {
                        "active"
                    } else {
                        "paused"
                    }
                ),
                muted(),
            ));
            lines.push(Line::styled(
                format!(
                    "Template: {} \u{2014} {}",
                    routine.template.title,
                    truncate(&routine.template.request, 120)
                ),
                Style::default(),
            ));
            lines.push(Line::from(""));
            lines.push(Line::styled(
                "Recent occurrences",
                accent().add_modifier(Modifier::BOLD),
            ));
            for (index, occurrence) in detail.occurrences.iter().enumerate() {
                let marker = if index == app.routines.occurrence_selected {
                    " > "
                } else {
                    "   "
                };
                let state = match occurrence.state {
                    RoutineOccurrenceState::Scheduled => "scheduled",
                    RoutineOccurrenceState::Missed => "MISSED",
                    RoutineOccurrenceState::Skipped => "skipped",
                };
                let style = match occurrence.state {
                    RoutineOccurrenceState::Missed => Style::default().fg(Color::Yellow),
                    _ => muted(),
                };
                let task_part = occurrence
                    .taskId
                    .as_deref()
                    .map(|id| format!(" \u{2192} task {id}"))
                    .unwrap_or_default();
                lines.push(Line::from(vec![
                    Span::raw(marker),
                    Span::raw(format!("{} ", occurrence.occurrenceKey)),
                    Span::styled(state.to_string(), style),
                    Span::styled(task_part, muted()),
                ]));
            }
            if detail.occurrences.is_empty() {
                lines.push(Line::styled("  (none yet)".to_string(), muted()));
            }
            lines.push(Line::from(""));
            lines.push(Line::styled(
                " b/Esc back | j/k occurrences | r run missed once now | s skip missed".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(block("Routine detail")),
                area,
            );
        }
        return;
    }
    let items: Vec<ListItem> = app
        .routines
        .routines
        .iter()
        .enumerate()
        .map(|(index, view)| {
            let state = if view.routine.state == RoutineState::Active {
                "active"
            } else {
                "paused"
            };
            let mut spans = vec![
                Span::raw(view.routine.name.clone()),
                Span::styled(format!("  {state}"), muted()),
                Span::styled(
                    format!(
                        "  next: {}",
                        view.nextOccurrenceAt.as_deref().unwrap_or("\u{2014}")
                    ),
                    muted(),
                ),
            ];
            if view.missedCount > 0 {
                spans.push(Span::styled(
                    format!("  {} MISSED", view.missedCount),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
            }
            let line = Line::from(spans);
            if index == app.routines.selected {
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
    frame.render_stateful_widget(
        List::new(items).block(block(
            "Routines (n new, Enter detail, e enable/pause, x remove)",
        )),
        area,
        &mut list_state,
    );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
