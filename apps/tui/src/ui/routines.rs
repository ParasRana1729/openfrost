use super::theme::{
    accent_bold, frost_glow, ice_mid, muted, primary_bold, rounded_block, selected_style, success,
    warn,
};
use crate::app::{truncate, App};
use crate::contracts::{RoutineOccurrenceState, RoutineState};
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_routines(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.routines.detail_open {
        if let Some(detail) = &app.routines.detail {
            let mut lines: Vec<Line> = Vec::new();
            let routine = &detail.view.routine;
            lines.push(Line::styled(
                format!(" {}", routine.name),
                frost_glow().add_modifier(ratatui::style::Modifier::BOLD),
            ));
            lines.push(Line::styled(
                format!(
                    " {}  •  {}  •  {}  •  {}",
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
                    " Template: {} — {}",
                    routine.template.title,
                    truncate(&routine.template.request, 120)
                ),
                primary_bold(),
            ));
            lines.push(Line::from(""));
            lines.push(Line::styled(" Recent occurrences", accent_bold()));
            for (index, occurrence) in detail.occurrences.iter().enumerate() {
                let is_sel = index == app.routines.occurrence_selected;
                let marker = if is_sel { " ▸ " } else { "   " };
                let state = match occurrence.state {
                    RoutineOccurrenceState::Scheduled => "scheduled",
                    RoutineOccurrenceState::Missed => "MISSED",
                    RoutineOccurrenceState::Skipped => "skipped",
                };
                let style = match occurrence.state {
                    RoutineOccurrenceState::Missed => {
                        warn().add_modifier(ratatui::style::Modifier::BOLD)
                    }
                    _ => muted(),
                };
                let task_part = occurrence
                    .taskId
                    .as_deref()
                    .map(|id| format!(" → task {id}"))
                    .unwrap_or_default();
                lines.push(Line::from(vec![
                    Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
                    Span::styled(format!("{} ", occurrence.occurrenceKey), frost_glow()),
                    Span::styled(state.to_string(), style),
                    Span::styled(task_part, muted()),
                ]));
            }
            if detail.occurrences.is_empty() {
                lines.push(Line::styled("   (none yet)".to_string(), muted()));
            }
            lines.push(Line::from(""));
            lines.push(Line::styled(
                " b/Esc back • j/k occurrences • r run missed once now • s skip missed".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(rounded_block("Routine detail")),
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
            let is_sel = index == app.routines.selected;
            let (state_label, state_style) = if view.routine.state == RoutineState::Active {
                ("active", success())
            } else {
                ("paused", muted())
            };
            let mut spans = vec![
                Span::styled(
                    if is_sel { " ▸ " } else { "   " },
                    if is_sel { accent_bold() } else { muted() },
                ),
                Span::styled(view.routine.name.clone(), frost_glow()),
                Span::styled(format!("  •  {state_label}"), state_style),
                Span::styled(
                    format!(
                        "  •  next: {}",
                        view.nextOccurrenceAt.as_deref().unwrap_or("—")
                    ),
                    ice_mid(),
                ),
            ];
            if view.missedCount > 0 {
                spans.push(Span::styled(
                    format!("  •  {} MISSED", view.missedCount),
                    warn().add_modifier(ratatui::style::Modifier::BOLD),
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
    frame.render_stateful_widget(
        List::new(items).block(rounded_block(
            "Routines  •  n new • Enter detail • e enable/pause • x remove",
        )),
        area,
        &mut list_state,
    );
}
