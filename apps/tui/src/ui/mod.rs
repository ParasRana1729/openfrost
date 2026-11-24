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
    accent_bold, approval, danger, frost_glow, hairline_style, ice_mid, muted, pill, success, warn,
    AMBER, FROST_GLOW, ICE_BRIGHT, ICE_DIM, ICE_MID, SURFACE_PILL, SURFACE_SEL,
};

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{App, Screen, Tab, ALL_TABS};
use crate::contracts::{TaskKind, TaskState};

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
        .title(Span::styled(" ❄ OpenFrost ", accent_bold()));

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
        Line::styled("Personal AI OS • Local Control Center", muted()),
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

fn render_top_bar(app: &App, frame: &mut Frame, area: Rect) {
    let rows = Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).split(area);

    let pending_approvals = app.assistant.approvals.len();
    let missed_routines: i64 = app.assistant.routines.iter().map(|r| r.missedCount).sum();

    let mut left_spans: Vec<Span<'static>> = vec![
        Span::styled(" ❄ OpenFrost", accent_bold()),
        Span::styled("  │  ", hairline_style()),
    ];

    for (index, tab) in ALL_TABS.iter().enumerate() {
        let active = *tab == app.tab;
        let num = index + 1;
        if active {
            left_spans.push(Span::styled(
                format!(" {num} {} ", tab.title()),
                pill(FROST_GLOW, SURFACE_SEL),
            ));
        } else {
            left_spans.push(Span::styled(format!(" {num}·{} ", tab.title()), muted()));
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

    // Active project scope badge on the right when space permits.
    let project_label = app
        .assistant
        .project_idx
        .and_then(|idx| app.assistant.projects.get(idx))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "global".to_string());

    let right_text = format!(" ⌂ {project_label} ");
    let left_width: usize = left_spans.iter().map(|s| s.width()).sum();
    let right_width = right_text.chars().count();
    if (area.width as usize) > left_width + right_width + 2 {
        let pad = (area.width as usize) - left_width - right_width;
        left_spans.push(Span::raw(" ".repeat(pad)));
        left_spans.push(Span::styled(right_text, pill(ICE_BRIGHT, SURFACE_PILL)));
    }

    frame.render_widget(Paragraph::new(Line::from(left_spans)), rows[0]);
    frame.render_widget(
        Paragraph::new(Line::styled(
            "─".repeat(rows[1].width as usize),
            hairline_style(),
        )),
        rows[1],
    );
}

fn render_status_bar(app: &App, frame: &mut Frame, area: Rect) {
    let mut spans: Vec<Span<'static>> = vec![Span::raw(" ")];

    match &app.tasks.executor {
        Some(executor) => {
            if executor.dispatchPaused {
                spans.push(Span::styled(
                    " PAUSED (Tasks: r to resume) ",
                    pill(Color::Black, AMBER),
                ));
                spans.push(Span::raw(" "));
            }
            if executor.busy {
                spans.extend(mini_owl_spans(app.ticks, true));
                spans.push(Span::styled(" running ", accent_bold()));
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
                spans.push(Span::styled(format!("• {queued} queued "), ice_mid()));
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
            format!(" • {approvals} approval(s) "),
            pill(FROST_GLOW, Color::Rgb(76, 29, 149)),
        ));
    }

    if let Some(notice) = &app.notice {
        let style = if notice.is_error {
            danger().add_modifier(Modifier::BOLD)
        } else {
            success()
        };
        spans.push(Span::styled(format!(" │ {}", notice.message), style));
    }

    let hints = match app.tab {
        Tab::Assistant => "  / commands • Tab scope • Ctrl+P views • Ctrl+C quit",
        _ => "  Ctrl+P switch view • Ctrl+C quit",
    };
    let used_width: usize = spans.iter().map(|s| s.width()).sum();
    let hint_width = hints.chars().count();
    if (area.width as usize) > used_width + hint_width + 1 {
        let spacer = (area.width as usize) - used_width - hint_width;
        spans.push(Span::raw(" ".repeat(spacer)));
        spans.push(Span::styled(hints, Style::default().fg(ICE_DIM)));
    } else {
        spans.push(Span::styled(hints, muted()));
    }

    frame.render_widget(Line::from(spans), area);
}
