use super::theme::{
    accent, accent_bold, danger, frost_glow, muted, rounded_block, selected_style, ICE_DIM,
    SURFACE_SEL,
};
use crate::app::{App, ConfirmAction, Dialog, ALL_TABS};
use ratatui::layout::{Constraint, Layout, Rect};
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
    match dialog {
        Dialog::Confirm {
            title,
            message,
            action,
        } => {
            let popup = centered_rect(area, 66, 8);
            frame.render_widget(Clear, popup);
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
            let popup_width = (area.width * 66 / 100)
                .max(36.min(area.width))
                .min(area.width);
            let inner_w = popup_width.saturating_sub(2).max(1);

            let mut field_lines: Vec<Line<'static>> = Vec::new();
            let mut field_ranges: Vec<(usize, usize)> = Vec::with_capacity(form.fields.len());
            let mut total_field_rows: usize = 0;

            for (index, field) in form.fields.iter().enumerate() {
                let start_row = total_field_rows;
                let is_current = index == form.focus;
                let show_cursor = is_current && !form.submitting;
                let prefix = if is_current { " ▸ " } else { "   " };
                let mut pushed: Vec<Line<'static>> = Vec::new();
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
                            Span::styled(prefix, if is_current { accent_bold() } else { muted() }),
                            Span::styled(
                                format!("{label}: "),
                                if is_current {
                                    accent_bold()
                                } else {
                                    Style::default().fg(ICE_DIM)
                                },
                            ),
                            Span::styled(shown, frost_glow()),
                        ];
                        if show_cursor {
                            value_spans.push(Span::styled("▏", accent()));
                        }
                        pushed.push(Line::from(value_spans));
                        if let Some(hint) = hint {
                            pushed.push(Line::styled(format!("     {hint}"), muted()));
                        }
                    }
                    crate::dialog_forms::Field::Select {
                        label,
                        options,
                        selected,
                    } => {
                        let value = options.get(*selected).cloned().unwrap_or_default();
                        pushed.push(Line::from(vec![
                            Span::styled(prefix, if is_current { accent_bold() } else { muted() }),
                            Span::styled(
                                format!("{label}: "),
                                if is_current {
                                    accent_bold()
                                } else {
                                    Style::default().fg(ICE_DIM)
                                },
                            ),
                            Span::styled(value, if is_current { accent() } else { frost_glow() }),
                            Span::styled(if show_cursor { "  (h/l change)" } else { "" }, muted()),
                        ]));
                    }
                }
                for line in pushed {
                    let line_rows = wrapped_line_count(&line, inner_w);
                    total_field_rows += line_rows;
                    field_lines.push(line);
                }
                field_ranges.push((start_row, total_field_rows));
            }

            let error_lines: Vec<Line<'static>> = form
                .error
                .as_ref()
                .map(|error| vec![Line::styled(format!(" × {error}"), danger())])
                .unwrap_or_default();
            let error_h = if error_lines.is_empty() {
                0u16
            } else {
                (error_lines
                    .iter()
                    .map(|l| wrapped_line_count(l, inner_w))
                    .sum::<usize>() as u16)
                    .clamp(1, 4)
            };

            let footer_line = if form.submitting {
                Line::from(vec![
                    Span::styled(" Saving… ", accent_bold()),
                    Span::styled("· Esc cancel", muted()),
                ])
            } else {
                Line::styled(
                    " Tab next field · Ctrl+S submit · Esc cancel".to_string(),
                    muted(),
                )
            };
            let footer_h = (wrapped_line_count(&footer_line, inner_w) as u16).clamp(1, 2);

            let max_popup_h = if area.height >= 6 {
                area.height.saturating_sub(2)
            } else {
                area.height
            };
            let desired_inner_h = (total_field_rows as u16)
                .saturating_add(error_h)
                .saturating_add(footer_h)
                .saturating_add(1);
            let popup_h = (desired_inner_h.saturating_add(2))
                .min(max_popup_h)
                .max(6.min(area.height))
                .min(area.height);

            let popup = Rect {
                x: area.x + area.width.saturating_sub(popup_width) / 2,
                y: area.y + area.height.saturating_sub(popup_h) / 2,
                width: popup_width,
                height: popup_h,
            };
            frame.render_widget(Clear, popup);

            let mut block = rounded_block(&form.title);
            let inner = block.inner(popup);

            let avail_h = inner.height;
            let pinned_footer_h = footer_h.min(avail_h);
            let remaining_after_footer = avail_h.saturating_sub(pinned_footer_h);
            let pinned_error_h = error_h.min(remaining_after_footer.saturating_sub(1));
            let fields_h = remaining_after_footer.saturating_sub(pinned_error_h) as usize;

            let clipped = fields_h > 0 && total_field_rows > fields_h;
            let scroll_y = if !clipped {
                0usize
            } else {
                let (focus_start, focus_end) =
                    field_ranges.get(form.focus).copied().unwrap_or((0, 0));
                let max_scroll = total_field_rows.saturating_sub(fields_h);
                if focus_end <= fields_h {
                    0
                } else {
                    (focus_end + 1)
                        .saturating_sub(fields_h)
                        .min(focus_start)
                        .min(max_scroll)
                }
            };

            if clipped {
                let visible_start = scroll_y + 1;
                let visible_end = (scroll_y + fields_h).min(total_field_rows);
                let arrows = match (scroll_y > 0, visible_end < total_field_rows) {
                    (true, true) => "↑↓",
                    (true, false) => "↑",
                    (false, true) => "↓",
                    (false, false) => "",
                };
                block = block.title_bottom(
                    Line::styled(
                        format!(" {arrows} {visible_start}–{visible_end}/{total_field_rows} "),
                        muted(),
                    )
                    .right_aligned(),
                );
            }

            frame.render_widget(block, popup);

            let sections = Layout::vertical([
                Constraint::Length(fields_h as u16),
                Constraint::Length(pinned_error_h),
                Constraint::Length(pinned_footer_h),
            ])
            .split(inner);

            frame.render_widget(
                Paragraph::new(field_lines)
                    .wrap(Wrap { trim: false })
                    .scroll((scroll_y as u16, 0)),
                sections[0],
            );
            if pinned_error_h > 0 {
                frame.render_widget(
                    Paragraph::new(error_lines).wrap(Wrap { trim: false }),
                    sections[1],
                );
            }
            if pinned_footer_h > 0 {
                frame.render_widget(
                    Paragraph::new(footer_line).wrap(Wrap { trim: false }),
                    sections[2],
                );
            }
        }
    }
}

fn wrapped_line_count(line: &Line<'_>, width: u16) -> usize {
    let w = (width as usize).max(1);
    let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
    if text.is_empty() {
        return 1;
    }
    let mut rows = 1usize;
    let mut col = 0usize;
    for word in text.split_inclusive(' ') {
        let word_len = word.chars().count();
        if col > 0 && col + word_len > w {
            rows += 1;
            col = 0;
        }
        if word_len > w {
            rows += (col + word_len).saturating_sub(1) / w;
            col = (col + word_len) % w;
            if col == 0 {
                col = w;
            }
        } else {
            col += word_len;
        }
    }
    rows
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
