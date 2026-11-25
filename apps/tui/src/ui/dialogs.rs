use super::theme::{
    accent, accent_bold, danger, frost_glow, muted, rounded_block, selected_style, ICE_DIM,
    SURFACE_SEL,
};
use crate::app::{App, ConfirmAction, Dialog, ALL_TABS};
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_tab_picker(frame: &mut Frame, selected: usize) {
    let area = frame.area();
    let height = ALL_TABS.len() as u16 + 3;
    let popup = centered_rect(area, 42, height);
    frame.render_widget(Clear, popup);

    let label_width = (popup.width as usize).saturating_sub(8).max(16);
    let mut lines: Vec<Line> = Vec::new();
    for (index, tab) in ALL_TABS.iter().enumerate() {
        let is_sel = index == selected;
        let marker = if is_sel { " ▸ " } else { "   " };
        let marker_style = if is_sel {
            accent_bold().bg(SURFACE_SEL)
        } else {
            Style::default()
        };
        let num_style = if is_sel {
            accent().bg(SURFACE_SEL)
        } else {
            Style::default().fg(ICE_DIM)
        };
        let label_style = if is_sel {
            selected_style()
        } else {
            frost_glow()
        };
        lines.push(Line::from(vec![
            Span::styled(marker, marker_style),
            Span::styled(format!("{}. ", index + 1), num_style),
            Span::styled(
                format!("{:<width$}", tab.title(), width = label_width),
                label_style,
            ),
        ]));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(
        " ↑↓/j/k move · Enter open · Esc cancel".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines).block(rounded_block("Jump to view")),
        popup,
    );
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
    frame.render_widget(Clear, popup);
    match dialog {
        Dialog::Confirm {
            title,
            message,
            action,
        } => {
            let mut lines = vec![
                Line::from(""),
                Line::styled(format!(" {message}"), frost_glow()),
            ];
            if matches!(action, ConfirmAction::CancelTask { .. }) {
                lines.push(Line::styled(
                    " In-flight provider requests are aborted; already completed work is not undone."
                        .to_string(),
                    muted(),
                ));
            }
            lines.push(Line::from(""));
            lines.push(Line::styled(
                " Enter confirm · Esc cancel".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(rounded_block(title)),
                popup,
            );
        }
        Dialog::Form(form) => {
            let mut lines: Vec<Line> = Vec::new();
            for (index, field) in form.fields.iter().enumerate() {
                let focused = index == form.focus;
                let prefix = if focused { " ▸ " } else { "   " };
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
                        let mut value_spans = vec![
                            Span::styled(prefix, if focused { accent_bold() } else { muted() }),
                            Span::styled(
                                format!("{label}: "),
                                if focused {
                                    accent_bold()
                                } else {
                                    Style::default().fg(ICE_DIM)
                                },
                            ),
                            Span::styled(shown, frost_glow()),
                        ];
                        if focused {
                            value_spans.push(Span::styled("▏", accent()));
                        }
                        lines.push(Line::from(value_spans));
                        if let Some(hint) = hint {
                            lines.push(Line::styled(format!("     {hint}"), muted()));
                        }
                    }
                    crate::dialog_forms::Field::Select {
                        label,
                        options,
                        selected,
                    } => {
                        let value = options.get(*selected).cloned().unwrap_or_default();
                        lines.push(Line::from(vec![
                            Span::styled(prefix, if focused { accent_bold() } else { muted() }),
                            Span::styled(
                                format!("{label}: "),
                                if focused {
                                    accent_bold()
                                } else {
                                    Style::default().fg(ICE_DIM)
                                },
                            ),
                            Span::styled(value, if focused { accent() } else { frost_glow() }),
                            Span::styled(if focused { "  (h/l change)" } else { "" }, muted()),
                        ]));
                    }
                }
            }
            if let Some(error) = &form.error {
                lines.push(Line::styled(format!(" × {error}"), danger()));
            }
            lines.push(Line::from(""));
            lines.push(Line::styled(
                " Tab next field · Ctrl+S submit · Esc cancel".to_string(),
                muted(),
            ));
            frame.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(rounded_block(&form.title)),
                popup,
            );
        }
    }
}

fn centered_rect(area: Rect, percent_x: u16, height: u16) -> Rect {
    let popup_width = (area.width * percent_x / 100).max(36.min(area.width));
    Rect {
        x: area.x + (area.width.saturating_sub(popup_width)) / 2,
        y: area.y + area.height.saturating_sub(height + 2) / 2,
        width: popup_width.min(area.width),
        height: (height + 2).min(area.height),
    }
}
