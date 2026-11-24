//! Rendering. Restrained, text-first layouts: no flash, high-contrast
//! monochrome with a small set of semantic colors.

mod assistant;
mod dialogs;
mod memory;
mod projects;
mod routines;
mod settings;
mod tasks;

use assistant::render_assistant;
use dialogs::{render_dialog, render_tab_picker};
use memory::render_memory;
use projects::render_projects;
use routines::render_routines;
use settings::render_settings;
use tasks::render_tasks;

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Tabs, Wrap};
use ratatui::Frame;

use crate::app::{App, Screen, Tab, ALL_TABS};
use crate::contracts::{TaskKind, TaskState};

fn accent() -> Style {
    Style::default().fg(Color::Cyan)
}

fn muted() -> Style {
    Style::default().fg(Color::DarkGray)
}

fn selected_style() -> Style {
    Style::default()
        .bg(Color::DarkGray)
        .add_modifier(Modifier::BOLD)
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
        Screen::Login => render_auth(
            app,
            frame,
            "Sign in to OpenFrost",
            "Owner password (Enter to sign in)",
        ),
        Screen::Onboarding => render_auth(
            app,
            frame,
            "Welcome to OpenFrost",
            "Choose an owner password (min 8 chars; Enter to create the account)",
        ),
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
    let text = vec![
        Line::from("OpenFrost"),
        Line::from(""),
        Line::styled(
            "Connecting to the local API on 127.0.0.1:8787\u{2026}",
            muted(),
        ),
    ];
    if let Some(notice) = &app.notice {
        let mut lines = text;
        lines.push(Line::from(""));
        lines.push(Line::styled(
            notice.message.clone(),
            Style::default().fg(Color::Red),
        ));
        lines.push(Line::styled(
            "Retrying\u{2026} start the API with `pnpm dev` if it is not running.",
            muted(),
        ));
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block("OpenFrost")),
            area,
        );
    } else {
        frame.render_widget(
            Paragraph::new(text)
                .wrap(Wrap { trim: false })
                .block(block("OpenFrost")),
            area,
        );
    }
}

fn block(title: &str) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .title(Span::styled(title.to_string(), accent()))
}

fn render_auth(app: &mut App, frame: &mut Frame, title: &str, hint: &str) {
    let area = frame.area();
    let vertical =
        Layout::vertical([Constraint::Percentage(35), Constraint::Length(7)]).split(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "OpenFrost",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(
                "A local AI assistant for research briefs, project updates, and weekly planning.",
            ),
        ]),
        vertical[0],
    );
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .split(vertical[1]);
    app.auth.set_block(block(title));
    frame.render_widget(&app.auth, chunks[0]);
    frame.render_widget(
        Paragraph::new(Line::styled(hint.to_string(), muted())),
        chunks[1],
    );
    if app.auth_busy {
        frame.render_widget(
            Paragraph::new(Line::styled(
                "Checking with the API\u{2026}".to_string(),
                muted(),
            )),
            chunks[2],
        );
    }
}

fn render_main(app: &mut App, frame: &mut Frame) {
    let area = frame.area();
    let chunks = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(5),
        Constraint::Length(1),
    ])
    .split(area);
    let (header, body, status) = (chunks[0], chunks[1], chunks[2]);

    let tab_titles: Vec<Line> = ALL_TABS
        .iter()
        .enumerate()
        .map(|(index, tab)| Line::from(format!("{} {}", index + 1, tab.title())))
        .collect();
    let active_index = ALL_TABS.iter().position(|tab| *tab == app.tab).unwrap_or(0);
    frame.render_widget(
        Tabs::new(tab_titles)
            .select(active_index)
            .highlight_style(accent().add_modifier(Modifier::BOLD))
            .block(Block::default().borders(Borders::BOTTOM)),
        header,
    );

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

fn render_status_bar(app: &App, frame: &mut Frame, area: Rect) {
    let mut spans = Vec::new();
    match &app.tasks.executor {
        Some(executor) => {
            if executor.dispatchPaused {
                spans.push(Span::styled(
                    " DISPATCH PAUSED (resume from Tasks: press r on a failed task after review) ",
                    Style::default().fg(Color::Black).bg(Color::Yellow),
                ));
            }
            if executor.busy {
                spans.push(Span::styled(
                    " executor busy ",
                    Style::default().fg(Color::Black).bg(Color::Cyan),
                ));
            } else {
                spans.push(Span::styled(" executor idle ", muted()));
            }
            let queued = app
                .tasks
                .tasks
                .iter()
                .filter(|task| task.state == TaskState::Queued)
                .count();
            if queued > 0 {
                spans.push(Span::styled(format!(" queue: {queued} "), muted()));
            }
        }
        None => spans.push(Span::styled(" API status unknown ", muted())),
    }
    if let Some(notice) = &app.notice {
        let style = if notice.is_error {
            Style::default().fg(Color::Red)
        } else {
            Style::default().fg(Color::Green)
        };
        spans.push(Span::styled(format!(" {} ", notice.message), style));
    }
    let approvals = app.assistant.approvals.len();
    if approvals > 0 {
        spans.push(Span::styled(
            format!(" {approvals} approval(s) pending "),
            Style::default().fg(Color::Magenta),
        ));
    }
    spans.push(Span::styled("  Ctrl+P tabs | Ctrl+C quit", muted()));
    frame.render_widget(Line::from(spans), area);
}
