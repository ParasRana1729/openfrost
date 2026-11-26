use super::theme::{
    accent, accent_bold, danger, frost_glow, muted, rounded_block, selected_style, ICE_DIM,
    SURFACE_SEL,
};
use super::{wrapped_line_count, wrapped_lines_count};
use crate::app::{App, ConfirmAction, Dialog, ALL_TABS};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_tab_picker(frame: &mut Frame, selected: usize) {
    let area = frame.area();
    if area.width < 4 || area.height < 4 {
        return;
    }

    let hint = " ↑↓/j/k move · Enter open · Esc cancel";
    let desired_w = (hint.chars().count() as u16).saturating_add(4);
    let popup_width = (area.width * 42 / 100)
        .max(desired_w.min(area.width))
        .min(area.width)
        .max(1);
    let inner_w = popup_width.saturating_sub(2).max(1);
    let label_width = (inner_w as usize).saturating_sub(6);

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
        let label = if label_width == 0 {
            String::new()
        } else if tab.title().chars().count() > label_width {
            crate::app::truncate(tab.title(), label_width.saturating_sub(1))
        } else {
            format!("{:<width$}", tab.title(), width = label_width)
        };
        lines.push(Line::from(vec![
            Span::styled(marker, marker_style),
            Span::styled(format!("{}. ", index + 1), num_style),
            Span::styled(label, label_style),
        ]));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(hint.to_string(), muted()));

    let content_h = wrapped_lines_count(&lines, inner_w) as u16;
    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
    let popup_h = content_h.saturating_add(2).min(area.height);
    let popup = Rect {
        x: area.x + area.width.saturating_sub(popup_width) / 2,
        y: area.y + area.height.saturating_sub(popup_h) / 2,
        width: popup_width,
        height: popup_h,
    };
    frame.render_widget(Clear, popup);
    frame.render_widget(paragraph.block(rounded_block("Jump to view")), popup);
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

pub(super) fn render_dialog(_app: &App, frame: &mut Frame, dialog: &Dialog) {
    let area = frame.area();
    if area.width < 4 || area.height < 4 {
        return;
    }
    match dialog {
        Dialog::Confirm {
            title,
            message,
            action,
        } => {
            let popup_width = (area.width * 66 / 100)
                .max(36.min(area.width))
                .min(area.width)
                .max(1);
            let inner_w = popup_width.saturating_sub(2).max(1);

            let mut body_lines: Vec<Line<'static>> = vec![Line::from("")];
            let mut pushed_msg = false;
            for part in message.lines() {
                pushed_msg = true;
                body_lines.push(Line::styled(format!(" {part}"), frost_glow()));
            }
            if !pushed_msg {
                body_lines.push(Line::from(""));
            }
            if matches!(action, ConfirmAction::CancelTask { .. })
                && !message.contains("aborted")
                && !message.contains("not undone")
            {
                body_lines.push(Line::styled(
                    " In-flight provider requests are aborted; already completed work is not undone."
                        .to_string(),
                    muted(),
                ));
            }
            body_lines.push(Line::from(""));

            let footer_line = Line::styled(" Enter confirm · Esc cancel".to_string(), muted());
            let body_h = wrapped_lines_count(&body_lines, inner_w) as u16;
            let footer_h = (wrapped_line_count(&footer_line, inner_w) as u16).clamp(1, 2);

            let max_popup_h = if area.height >= 6 {
                area.height.saturating_sub(2)
            } else {
                area.height
            };
            let desired_inner_h = body_h.saturating_add(footer_h);
            let popup_h = desired_inner_h
                .saturating_add(2)
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

            let block = rounded_block(title);
            let inner = block.inner(popup);
            frame.render_widget(block, popup);

            let pinned_footer_h = footer_h.min(inner.height);
            let avail_body_h = inner.height.saturating_sub(pinned_footer_h);
            let sections = Layout::vertical([
                Constraint::Length(avail_body_h),
                Constraint::Length(pinned_footer_h),
            ])
            .split(inner);

            if avail_body_h > 0 {
                frame.render_widget(
                    Paragraph::new(body_lines).wrap(Wrap { trim: false }),
                    sections[0],
                );
            }
            if pinned_footer_h > 0 {
                frame.render_widget(
                    Paragraph::new(footer_line).wrap(Wrap { trim: false }),
                    sections[1],
                );
            }
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
                .as_deref()
                .map(|error| {
                    let mut lines = Vec::new();
                    for (idx, part) in error.lines().enumerate() {
                        let prefix = if idx == 0 { " × " } else { "   " };
                        lines.push(Line::styled(format!("{prefix}{part}"), danger()));
                    }
                    if lines.is_empty() {
                        lines.push(Line::styled(" × ".to_string(), danger()));
                    }
                    lines
                })
                .unwrap_or_default();
            let error_h = if error_lines.is_empty() {
                0u16
            } else {
                (error_lines
                    .iter()
                    .map(|l| wrapped_line_count(l, inner_w))
                    .sum::<usize>() as u16)
                    .clamp(1, 6)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::Screen;
    use crate::dialog_forms::Form;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use tokio::sync::mpsc;

    fn buffer_to_string(terminal: &Terminal<TestBackend>) -> String {
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect()
    }

    #[test]
    fn tab_picker_fits_footer_at_80_cols_and_narrow_width() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab_picker = Some(0);

        for (w, h) in [(80u16, 24u16), (30u16, 20u16)] {
            let backend = TestBackend::new(w, h);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal
                .draw(|frame| crate::ui::render(&mut app, frame))
                .unwrap();
            let rendered = buffer_to_string(&terminal);
            assert!(
                rendered.contains("Enter open"),
                "expected 'Enter open' at {w}x{h}, got:\n{rendered}"
            );
            assert!(
                rendered.contains("Esc cancel"),
                "expected 'Esc cancel' at {w}x{h}, got:\n{rendered}"
            );
        }
    }

    #[test]
    fn confirm_dialog_sizes_dynamically_and_deduplicates_cancel_warning() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;

        // Long confirmation message already containing abort warning should not duplicate it,
        // and must expand popup height so the footer hint is never clipped.
        app.dialog = Some(Dialog::Confirm {
            title: "Cancel task".into(),
            message: "Cancel \"Very long research brief title that wraps across multiple lines inside the confirmation modal dialog\"? In-flight requests are aborted; completed work is not undone.".into(),
            action: ConfirmAction::CancelTask {
                task_id: "t1".into(),
            },
        });
        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
        let rendered = buffer_to_string(&terminal);
        assert!(
            rendered.contains("Enter confirm · Esc cancel"),
            "expected footer hint on long Confirm dialog, got:\n{rendered}"
        );
        assert_eq!(
            rendered.matches("aborted").count(),
            1,
            "expected abort warning once without duplication, got:\n{rendered}"
        );

        // Short CancelTask message without warning gets the muted abort note once.
        app.dialog = Some(Dialog::Confirm {
            title: "Cancel task".into(),
            message: "Cancel \"Short task\"?".into(),
            action: ConfirmAction::CancelTask {
                task_id: "t2".into(),
            },
        });
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
        let rendered_short = buffer_to_string(&terminal);
        assert!(rendered_short.contains("In-flight provider requests are aborted"));
        assert!(rendered_short.contains("Enter confirm · Esc cancel"));
    }

    #[test]
    fn form_dialog_multiline_error_renders_all_lines() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;

        let mut form = Form::create_project();
        form.error =
            Some("First validation line\nSecond validation line\nThird validation line".into());
        app.dialog = Some(Dialog::Form(form));

        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
        let rendered = buffer_to_string(&terminal);
        assert!(rendered.contains("× First validation line"));
        assert!(rendered.contains("Second validation line"));
        assert!(rendered.contains("Third validation line"));
    }
}
