//! Terminal UI rendering with a cohesive Frost palette and a clean,
//! conversation-first workspace inspired by Claude Code & Codex CLI.

mod assistant;
mod dialogs;
mod mascot;
mod memory;
mod projects;
mod routines;
mod settings;
mod tasks;
pub(crate) mod theme;

use assistant::render_assistant;
use dialogs::{render_dialog, render_tab_picker};
use mascot::{
    mini_owl_spans, pulse_bar, render_frost_backdrop, shimmer_wordmark, splash_owl_lines,
};
use memory::render_memory;
use projects::render_projects;
use routines::render_routines;
use settings::render_settings;
use tasks::render_tasks;
use theme::{
    accent, accent_bold, approval, danger, frost_glow, hairline, hairline_style, muted, pill,
    success, warn, AMBER, FROST_GLOW, ICE_BRIGHT, ICE_DIM, ICE_MID, SURFACE_PILL, SURFACE_SEL,
    VIOLET,
};

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{App, Screen, Tab, ALL_TABS};
use crate::contracts::{TaskKind, TaskState};

pub(super) fn wrapped_line_count(line: &Line<'_>, width: u16) -> usize {
    let w = (width as usize).max(1);
    let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
    if text.is_empty() {
        return 1;
    }
    let mut rows = 0usize;
    let mut utf8_buf = [0u8; 4];
    for subline in text.split('\n') {
        rows += 1;
        if subline.is_empty() {
            continue;
        }
        let mut col = 0usize;
        for token in subline.split_inclusive(char::is_whitespace) {
            let token_w = Span::raw(token).width();
            if col > 0 && col + token_w > w {
                rows += 1;
                col = 0;
            }
            if token_w > w {
                for ch in token.chars() {
                    let ch_str = ch.encode_utf8(&mut utf8_buf);
                    let ch_w = Span::raw(&*ch_str).width();
                    if col + ch_w > w && col > 0 {
                        rows += 1;
                        col = 0;
                    }
                    col += ch_w;
                }
            } else {
                col += token_w;
            }
        }
    }
    rows.max(1)
}

pub(super) fn wrapped_lines_count(lines: &[Line<'_>], width: u16) -> usize {
    lines.iter().map(|l| wrapped_line_count(l, width)).sum()
}

fn kind_label(kind: &TaskKind) -> &'static str {
    match kind {
        TaskKind::ResearchBrief => "brief",
        TaskKind::ProjectUpdate => "update",
        TaskKind::ExportReport => "export",
        TaskKind::WeeklyPlan => "weekly plan",
    }
}

pub(crate) fn render(app: &mut App, frame: &mut Frame) {
    match app.screen {
        Screen::Connecting => render_connecting(app, frame),
        Screen::Main => render_main(app, frame),
    }
    if let Some(dialog) = &app.dialog {
        render_dialog(app, frame, dialog);
    }
    if let Some(selected) = app.tab_picker {
        render_tab_picker(frame, selected);
    }
}

fn render_connecting(app: &App, frame: &mut Frame) {
    let area = frame.area();
    let card_width = 64u16.min(area.width.saturating_sub(2));
    let card_height = 15u16.min(area.height.saturating_sub(2));
    let card = Rect {
        x: area.x + area.width.saturating_sub(card_width) / 2,
        y: area.y + area.height.saturating_sub(card_height) / 2,
        width: card_width,
        height: card_height,
    };

    render_frost_backdrop(frame, area, card, app.ticks);

    let has_error = app.notice.as_ref().is_some_and(|n| n.is_error);
    let border_color = if has_error { AMBER } else { ICE_MID };

    let card_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border_color))
        .title(Line::from(vec![
            Span::styled(" ✦ ", accent()),
            Span::styled("OpenFrost ", frost_glow().add_modifier(Modifier::BOLD)),
        ]));

    let inner = card_block.inner(card);
    frame.render_widget(card_block, card);

    if inner.width < 24 || inner.height < 6 {
        frame.render_widget(
            Paragraph::new("Connecting to OpenFrost API…").style(muted()),
            inner,
        );
        return;
    }

    // Split inside card into left Frost Owl mascot & right boot status column.
    let cols = if inner.width >= 44 {
        Layout::horizontal([Constraint::Length(19), Constraint::Min(20)]).split(inner)
    } else {
        Layout::horizontal([Constraint::Length(0), Constraint::Min(10)]).split(inner)
    };

    if cols[0].width >= 17 {
        let owl_area = Rect {
            x: cols[0].x + 1,
            y: cols[0].y + cols[0].height.saturating_sub(8) / 2,
            width: 17.min(cols[0].width.saturating_sub(1)),
            height: 8.min(cols[0].height),
        };
        frame.render_widget(
            Paragraph::new(splash_owl_lines(app.ticks, has_error)),
            owl_area,
        );
    }

    let info_area = Rect {
        x: cols[1].x + 1,
        y: cols[1].y + 1,
        width: cols[1].width.saturating_sub(2),
        height: cols[1].height.saturating_sub(1),
    };

    let mut lines: Vec<Line<'static>> = vec![
        shimmer_wordmark(app.ticks),
        Line::styled(
            "Personal AI OS · Local Control Center",
            Style::default().fg(ICE_DIM),
        ),
        Line::from(""),
    ];

    if let Some(notice) = &app.notice {
        lines.push(Line::from(vec![
            Span::styled("▲ ", warn().add_modifier(Modifier::BOLD)),
            Span::styled("API offline", warn().add_modifier(Modifier::BOLD)),
            Span::styled(format!("  ({})", app.api_origin), muted()),
        ]));
        lines.push(Line::styled(notice.message.clone(), danger()));
        lines.push(Line::from(""));
        lines.push(Line::styled(
            "Retrying… run `openfrost start` or `pnpm dev` if needed.",
            muted(),
        ));
    } else {
        let stage = if app.auto_spawning {
            if app.ticks < 12 {
                "Starting local runtime…"
            } else {
                "Waiting for local API health…"
            }
        } else {
            "Connecting to local API…"
        };
        lines.push(Line::from(vec![
            Span::styled(
                format!("{} ", mascot::frost_spinner(app.ticks)),
                accent_bold(),
            ),
            Span::styled(stage, frost_glow().add_modifier(Modifier::BOLD)),
        ]));
        lines.push(Line::styled(
            format!("  endpoint  {}", app.api_origin),
            muted(),
        ));
        lines.push(Line::from(""));
        let bar_w = (info_area.width as usize).saturating_sub(2).min(28);
        lines.push(pulse_bar(app.ticks, bar_w));
        lines.push(Line::from(""));
        lines.push(Line::styled("Ctrl+C to cancel", muted()));
    }

    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), info_area);
}

fn render_main(app: &mut App, frame: &mut Frame) {
    let area = frame.area();
    let chunks = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(5),
        Constraint::Length(1),
    ])
    .split(area);
    let (header, body, status) = (chunks[0], chunks[1], chunks[2]);

    render_top_bar(app, frame, header);

    match app.tab {
        Tab::Assistant => render_assistant(app, frame, body),
        Tab::Tasks => render_tasks(app, frame, body),
        Tab::Projects => render_projects(app, frame, body),
        Tab::Memory => render_memory(app, frame, body),
        Tab::Routines => render_routines(app, frame, body),
        Tab::Settings => render_settings(app, frame, body),
    }

    render_status_bar(app, frame, status);
}

fn build_top_bar_tabs(
    app: &App,
    pending_approvals: usize,
    missed_routines: i64,
    compact_spacing: bool,
    active_title_only: bool,
) -> Vec<Span<'static>> {
    let mut left_spans: Vec<Span<'static>> = if compact_spacing {
        vec![
            Span::styled(" ✦ ", accent()),
            Span::styled("│ ", hairline_style()),
        ]
    } else {
        vec![
            Span::styled(" ✦ ", accent()),
            Span::styled("OpenFrost", frost_glow().add_modifier(Modifier::BOLD)),
            Span::styled(" │ ", hairline_style()),
        ]
    };

    for (index, tab) in ALL_TABS.iter().enumerate() {
        let active = *tab == app.tab;
        let num = index + 1;
        let num_text = if compact_spacing {
            format!("{num}")
        } else {
            format!(" {num} ")
        };
        let show_title = !active_title_only || active;
        if active {
            left_spans.push(Span::styled(
                if compact_spacing {
                    format!(" {num} ")
                } else {
                    num_text
                },
                Style::default()
                    .fg(ICE_BRIGHT)
                    .bg(SURFACE_SEL)
                    .add_modifier(Modifier::BOLD),
            ));
            left_spans.push(Span::styled(
                format!("{} ", tab.title()),
                pill(FROST_GLOW, SURFACE_SEL).add_modifier(Modifier::BOLD),
            ));
        } else {
            left_spans.push(Span::styled(
                if show_title {
                    format!("{num_text} ")
                } else {
                    format!("{num} ")
                },
                Style::default().fg(ICE_DIM),
            ));
            if show_title {
                left_spans.push(Span::styled(format!("{} ", tab.title()), muted()));
            }
        }

        if *tab == Tab::Tasks && pending_approvals > 0 {
            left_spans.push(Span::styled(
                format!("●{pending_approvals} "),
                approval().add_modifier(Modifier::BOLD),
            ));
        } else if *tab == Tab::Routines && missed_routines > 0 {
            left_spans.push(Span::styled(
                format!("●{missed_routines} "),
                warn().add_modifier(Modifier::BOLD),
            ));
        }
    }

    left_spans
}

fn render_top_bar(app: &App, frame: &mut Frame, area: Rect) {
    let rows = Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).split(area);

    let pending_approvals = app.assistant.approvals.len();
    let missed_routines: i64 = app.assistant.routines.iter().map(|r| r.missedCount).sum();

    let total_w = area.width as usize;
    // Reserve at least 8 cells for a truncated badge (" ◈ x… " + 1 gap) when choosing density.
    let min_badge_reserve = 8usize;

    let mut left_spans = build_top_bar_tabs(app, pending_approvals, missed_routines, false, false);
    let full_w: usize = left_spans.iter().map(|s| s.width()).sum();
    if full_w + min_badge_reserve > total_w {
        let compact = build_top_bar_tabs(app, pending_approvals, missed_routines, true, false);
        let compact_w: usize = compact.iter().map(|s| s.width()).sum();
        if compact_w + min_badge_reserve <= total_w {
            left_spans = compact;
        } else {
            left_spans = build_top_bar_tabs(app, pending_approvals, missed_routines, true, true);
        }
    }

    // Active project scope badge on the right when space permits (truncated when tight).
    let active_project = app
        .assistant
        .project_idx
        .and_then(|idx| app.assistant.projects.get(idx))
        .map(|p| p.name.clone());
    let (prefix_style, label_style, project_label) = match active_project {
        Some(name) => (
            Style::default().fg(ICE_BRIGHT).bg(SURFACE_PILL),
            Style::default().fg(FROST_GLOW).bg(SURFACE_PILL),
            name,
        ),
        None => (
            Style::default().fg(ICE_DIM).bg(SURFACE_PILL),
            Style::default().fg(ICE_DIM).bg(SURFACE_PILL),
            "global".to_string(),
        ),
    };

    let prefix_text = " ◈ ";
    let left_width: usize = left_spans.iter().map(|s| s.width()).sum();
    let avail_badge = total_w.saturating_sub(left_width + 1);
    let badge_overhead = 4usize; // " ◈ " (3) + trailing " " (1)
    if avail_badge > badge_overhead {
        let max_label = avail_badge - badge_overhead;
        let shown_label = if project_label.chars().count() <= max_label {
            project_label
        } else if max_label <= 1 {
            project_label.chars().take(max_label).collect()
        } else {
            crate::app::truncate(&project_label, max_label - 1)
        };
        let suffix_text = format!("{shown_label} ");
        let right_width = prefix_text.chars().count() + suffix_text.chars().count();
        let pad = total_w.saturating_sub(left_width + right_width);
        left_spans.push(Span::raw(" ".repeat(pad)));
        left_spans.push(Span::styled(prefix_text, prefix_style));
        left_spans.push(Span::styled(suffix_text, label_style));
    }

    frame.render_widget(Paragraph::new(Line::from(left_spans)), rows[0]);
    frame.render_widget(Paragraph::new(hairline(rows[1].width)), rows[1]);
}

fn fit_status_hints(segments: &[&str], max_width: usize) -> String {
    for len in (1..=segments.len()).rev() {
        let candidate = format!("  {}", segments[..len].join(" · "));
        if candidate.chars().count() <= max_width {
            return candidate;
        }
    }
    String::new()
}

fn render_status_bar(app: &App, frame: &mut Frame, area: Rect) {
    let mut spans: Vec<Span<'static>> = vec![Span::raw(" ")];

    match &app.tasks.executor {
        Some(executor) => {
            if executor.dispatchPaused {
                spans.push(Span::styled(
                    " ‖ PAUSED (Tasks: R to resume) ",
                    pill(AMBER, SURFACE_SEL).add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" "));
            }
            if executor.busy {
                spans.extend(mini_owl_spans(app.ticks, true));
                spans.push(Span::styled(" running ", accent()));
            } else {
                spans.extend(mini_owl_spans(app.ticks, false));
                spans.push(Span::styled(" idle ", muted()));
            }
            let queued = app
                .tasks
                .tasks
                .iter()
                .filter(|task| task.state == TaskState::Queued)
                .count();
            if queued > 0 {
                spans.push(Span::styled(
                    format!("· {queued} queued "),
                    Style::default().fg(ICE_DIM),
                ));
            }
        }
        None => {
            spans.extend(mini_owl_spans(app.ticks, false));
            spans.push(Span::styled(" connecting… ", muted()));
        }
    }

    let approvals = app.assistant.approvals.len();
    if approvals > 0 {
        spans.push(Span::styled(
            format!(" ● {approvals} approval(s) "),
            pill(VIOLET, SURFACE_SEL),
        ));
    }

    let hint_segments: &[&str] = match app.tab {
        Tab::Assistant => &["/ commands", "Tab scope", "Ctrl+P views", "Ctrl+C quit"],
        _ => &["Ctrl+P switch view", "Ctrl+C quit"],
    };

    let total_w = area.width as usize;
    let base_width: usize = spans.iter().map(|s| s.width()).sum();

    if let Some(notice) = &app.notice {
        let style = if notice.is_error {
            danger().add_modifier(Modifier::BOLD)
        } else {
            success()
        };
        let full_notice = format!(" │ {}", notice.message);
        let full_notice_w = full_notice.chars().count();
        let remaining_after_full = total_w.saturating_sub(base_width + full_notice_w);
        let hints_with_full = fit_status_hints(hint_segments, remaining_after_full);
        if base_width + full_notice_w <= total_w {
            spans.push(Span::styled(full_notice, style));
            if !hints_with_full.is_empty() {
                let used = base_width + full_notice_w;
                let spacer = total_w.saturating_sub(used + hints_with_full.chars().count());
                if spacer > 0 {
                    spans.push(Span::raw(" ".repeat(spacer)));
                }
                spans.push(Span::styled(hints_with_full, muted()));
            }
        } else {
            // Reserve space for at least the shortest clean hint when the bar is wide enough.
            let min_hint =
                fit_status_hints(&hint_segments[..1], total_w.saturating_sub(base_width));
            let min_hint_w = min_hint.chars().count();
            let notice_budget = if total_w >= base_width + min_hint_w + 14 {
                total_w.saturating_sub(base_width + min_hint_w)
            } else {
                total_w.saturating_sub(base_width)
            };
            if notice_budget >= 5 {
                let msg_budget = notice_budget - 3; // " │ "
                let shown_msg = if msg_budget <= 1 {
                    notice.message.chars().take(msg_budget).collect()
                } else {
                    crate::app::truncate(&notice.message, msg_budget - 1)
                };
                let notice_text = format!(" │ {shown_msg}");
                let notice_w = notice_text.chars().count();
                spans.push(Span::styled(notice_text, style));
                let rem = total_w.saturating_sub(base_width + notice_w);
                let hints = fit_status_hints(hint_segments, rem);
                if !hints.is_empty() {
                    let spacer = rem.saturating_sub(hints.chars().count());
                    if spacer > 0 {
                        spans.push(Span::raw(" ".repeat(spacer)));
                    }
                    spans.push(Span::styled(hints, muted()));
                }
            }
        }
    } else {
        let avail = total_w.saturating_sub(base_width);
        let hints = fit_status_hints(hint_segments, avail);
        if !hints.is_empty() {
            let spacer = avail.saturating_sub(hints.chars().count());
            if spacer > 0 {
                spans.push(Span::raw(" ".repeat(spacer)));
            }
            spans.push(Span::styled(hints, muted()));
        }
    }

    frame.render_widget(Line::from(spans), area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::contracts::ExecutorStatus;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use tokio::sync::mpsc;

    #[test]
    fn status_bar_paused_hint_uses_uppercase_r() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tasks.executor = Some(ExecutorStatus {
            busy: false,
            activeTaskId: None,
            dispatchPaused: true,
        });

        let backend = TestBackend::new(100, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| render(&mut app, frame)).unwrap();

        let content: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            content.contains("PAUSED (Tasks: R to resume)"),
            "expected uppercase R resume hint in status bar, got: {content}"
        );
        assert!(!content.contains("Tasks: r to resume"));
    }

    #[test]
    fn top_bar_truncates_long_project_badge_instead_of_dropping() {
        use crate::contracts::Project;

        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.assistant.projects = vec![Project {
            id: "p1".into(),
            name: "VeryLongActiveProjectScopeNameThatExceedsWidth".into(),
            instructions: None,
            grants: vec![],
            createdAt: "2026-11-25T00:00:00Z".into(),
            updatedAt: "2026-11-25T00:00:00Z".into(),
        }];
        app.assistant.project_idx = Some(0);

        for width in [100u16, 80u16] {
            let backend = TestBackend::new(width, 20);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal.draw(|frame| render(&mut app, frame)).unwrap();
            let top_row: String = (0..width)
                .map(|x| terminal.backend().buffer().cell((x, 0)).unwrap().symbol())
                .collect();
            assert!(
                top_row.contains("◈ Very"),
                "expected truncated project badge at width {width}, got: '{top_row}'"
            );
            assert!(
                top_row.contains('…'),
                "expected ellipsis in truncated project badge at width {width}, got: '{top_row}'"
            );
        }
    }

    #[test]
    fn status_bar_narrow_width_truncates_notice_and_avoids_mid_word_hint_clip() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Assistant;
        app.tasks.executor = Some(ExecutorStatus {
            busy: false,
            activeTaskId: None,
            dispatchPaused: false,
        });
        app.set_notice(
            "This is a very long status notice that would otherwise push hints past the edge",
            false,
        );

        let backend = TestBackend::new(80, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| render(&mut app, frame)).unwrap();

        let status_row: String = (0..80)
            .map(|x| terminal.backend().buffer().cell((x, 19)).unwrap().symbol())
            .collect();
        assert!(
            status_row.contains("/ commands"),
            "expected clean '/ commands' hint at 80 cols, got: '{status_row}'"
        );
        assert!(
            status_row.contains('…'),
            "expected notice truncation ellipsis at 80 cols, got: '{status_row}'"
        );
        assert!(
            !status_row.contains("Ctrl+P vi"),
            "did not expect mid-word clipped hint, got: '{status_row}'"
        );

        // Without notice on a narrow 50-col terminal, hints drop cleanly at separator boundaries.
        app.notice = None;
        let backend_narrow = TestBackend::new(50, 20);
        let mut terminal_narrow = Terminal::new(backend_narrow).unwrap();
        terminal_narrow
            .draw(|frame| render(&mut app, frame))
            .unwrap();
        let narrow_row: String = (0..50)
            .map(|x| {
                terminal_narrow
                    .backend()
                    .buffer()
                    .cell((x, 19))
                    .unwrap()
                    .symbol()
            })
            .collect();
        assert!(narrow_row.contains("/ commands · Tab scope"));
        assert!(!narrow_row.contains("Ctrl+P vi"));
    }
}
