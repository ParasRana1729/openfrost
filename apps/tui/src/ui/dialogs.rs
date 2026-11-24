use super::{accent, block, muted};
use crate::app::{App, ConfirmAction, Dialog, ALL_TABS};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_tab_picker(frame: &mut Frame, selected: usize) {
    let area = frame.area();
    let height = ALL_TABS.len() as u16 + 4;
    let popup = centered_rect(area, 40, height);
    frame.render_widget(ratatui::widgets::Clear, popup);

    let mut lines: Vec<Line> = Vec::new();
    for (index, tab) in ALL_TABS.iter().enumerate() {
        let marker = if index == selected { ">" } else { " " };
        let style = if index == selected {
            accent().add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        };
        lines.push(Line::from(Span::styled(
            format!(" {marker} {}. {}", index + 1, tab.title()),
            style,
        )));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(
        " \u{2191}\u{2193}/j/k move | Enter open | Esc cancel".to_string(),
        muted(),
    ));
    frame.render_widget(Paragraph::new(lines).block(block("Go to tab")), popup);
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

pub(super) fn render_dialog(_app: &App, frame: &mut Frame, dialog: &Dialog) {
    let area = frame.area();
    let popup = centered_rect(
        area,
        66,
        match dialog {
            Dialog::Confirm { .. } => 8,
            Dialog::Form(form) => (form.fields.len() as u16) * 3 + 6,
        },
    );
    frame.render_widget(ratatui::widgets::Clear, popup);
    match dialog {
        Dialog::Confirm {
            title,
            message,
            action,
        } => {
            let mut lines = vec![
                Line::from(""),
                Line::styled(message.clone(), Style::default()),
            ];
            if matches!(action, ConfirmAction::CancelTask { .. }) {
                lines.push(Line::styled(
                    "In-flight provider requests are aborted; already completed work is not undone.".to_string(),
                    muted(),
                ));
            }
            lines.push(Line::from(""));
            lines.push(Line::styled(
                " Enter confirm | Esc cancel".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(block(title)),
                popup,
            );
        }
        Dialog::Form(form) => {
            let mut lines: Vec<Line> = Vec::new();
            for (index, field) in form.fields.iter().enumerate() {
                let focused = index == form.focus;
                match field {
                    crate::dialog_forms::Field::Text {
                        label,
                        masked,
                        hint,
                        ..
                    } => {
                        let shown = if *masked {
                            crate::dialog_forms::format_masked_input(&form.fields[index].value())
                        } else {
                            form.fields[index]
                                .value()
                                .lines()
                                .next()
                                .unwrap_or("")
                                .to_string()
                        };
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("{label}: "),
                                if focused {
                                    accent().add_modifier(Modifier::BOLD)
                                } else {
                                    Style::default().add_modifier(Modifier::BOLD)
                                },
                            ),
                            Span::raw(if focused { format!("{shown}_") } else { shown }),
                        ]));
                        if let Some(hint) = hint {
                            lines.push(Line::styled(format!("   {hint}"), muted()));
                        }
                    }
                    crate::dialog_forms::Field::Select {
                        label,
                        options,
                        selected,
                    } => {
                        let value = options.get(*selected).cloned().unwrap_or_default();
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("{label}: "),
                                if focused {
                                    accent().add_modifier(Modifier::BOLD)
                                } else {
                                    Style::default().add_modifier(Modifier::BOLD)
                                },
                            ),
                            Span::styled(value, if focused { accent() } else { Style::default() }),
                            Span::styled(if focused { "  (h/l change)" } else { "" }, muted()),
                        ]));
                    }
                }
            }
            if let Some(error) = &form.error {
                lines.push(Line::styled(
                    format!(" ! {error}"),
                    Style::default().fg(Color::Red),
                ));
            }
            lines.push(Line::styled(
                " Tab next field | Ctrl+S submit | Esc cancel".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(block(&form.title)),
                popup,
            );
        }
    }
}

fn centered_rect(area: Rect, percent_x: u16, height: u16) -> Rect {
    let popup_width = area.width * percent_x / 100;
    Rect {
        x: area.x + (area.width.saturating_sub(popup_width)) / 2,
        y: area.y + area.height.saturating_sub(height + 2) / 2,
        width: popup_width.min(area.width),
        height: (height + 2).min(area.height),
    }
}
