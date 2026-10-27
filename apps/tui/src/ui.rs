//! Rendering. Restrained, text-first layouts: no flash, high-contrast
//! monochrome with a small set of semantic colors.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Tabs, Wrap};
use ratatui::Frame;

use crate::app::{
    truncate, App, ComposerField, ConfirmAction, Dialog, Screen, Tab, TaskFilter, ALL_TABS,
};
use crate::contracts::{
    ApprovalState, Event, MemoryScope, RoutineOccurrenceState, RoutineState, RunState, TaskKind,
    TaskState,
};

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

pub fn render(app: &mut App, frame: &mut Frame) {
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

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

fn render_assistant(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.assistant.advanced_open {
        let chunks = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)])
            .split(area);
        render_composer(app, frame, chunks[0]);
        render_activity(app, frame, chunks[1]);
    } else {
        let vertical = Layout::vertical([Constraint::Min(8), Constraint::Length(5)]).split(area);
        render_assistant_stream(app, frame, vertical[0]);
        render_assistant_composer(app, frame, vertical[1]);
    }
}

fn format_stream_event(event: &Event) -> Line<'static> {
    let time = if event.createdAt.len() >= 19 {
        event.createdAt[11..19].to_string()
    } else {
        String::new()
    };

    match event.kind.as_str() {
        "task.queued" => Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(Color::Yellow)),
            Span::styled(format!("{time} "), muted()),
            Span::styled("Task queued", Style::default().fg(Color::White)),
            Span::styled(" (queued in runtime)", muted()),
        ]),
        "run.started" => Line::from(vec![
            Span::styled(" 🚀 ", Style::default().fg(Color::Cyan)),
            Span::styled(format!("{time} "), muted()),
            Span::styled(
                "Agent loop started",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" — initializing tools & context", muted()),
        ]),
        "tool.executed" => {
            let tool = event
                .payload
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("tool");
            let ok = event
                .payload
                .get("ok")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let duration = event.payload.get("durationMs").and_then(|v| v.as_i64());

            let (icon, label, detail_str) = match tool {
                "web_search" => {
                    let count = event
                        .payload
                        .get("count")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(1);
                    (
                        "🔍",
                        "web_search",
                        format!("searched online sources ({count} queries)"),
                    )
                }
                "fetch_page" => {
                    let dur = duration
                        .map(|d| format!("{d}ms"))
                        .unwrap_or_else(|| "done".to_string());
                    (
                        "🌐",
                        "fetch_page",
                        format!("retrieved source web page ({dur})"),
                    )
                }
                "read_project_file" => {
                    let dur = duration
                        .map(|d| format!("{d}ms"))
                        .unwrap_or_else(|| "done".to_string());
                    (
                        "📁",
                        "read_project_file",
                        format!("inspected granted project note ({dur})"),
                    )
                }
                "propose_memory" => (
                    "💾",
                    "propose_memory",
                    "suggested durable project preference".to_string(),
                ),
                other => (
                    "⚙ ",
                    other,
                    duration.map(|d| format!("{d}ms")).unwrap_or_default(),
                ),
            };

            let badge_style = if ok {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::Red)
            };

            Line::from(vec![
                Span::styled(format!(" {icon} "), badge_style),
                Span::styled(format!("{time} "), muted()),
                Span::styled(
                    format!("{label} "),
                    Style::default()
                        .fg(Color::LightYellow)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("— {detail_str}"), muted()),
            ])
        }
        "run.completed" => Line::from(vec![
            Span::styled(" ✔ ", Style::default().fg(Color::Green)),
            Span::styled(format!("{time} "), muted()),
            Span::styled(
                "Model execution finished",
                Style::default().fg(Color::Green),
            ),
        ]),
        "task.completed" => Line::from(vec![
            Span::styled(" ✔ ", Style::default().fg(Color::Green)),
            Span::styled(format!("{time} "), muted()),
            Span::styled(
                "Task completed",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" — artifact generated and saved", muted()),
        ]),
        "task.failed" | "run.failed" => Line::from(vec![
            Span::styled(" ✖ ", Style::default().fg(Color::Red)),
            Span::styled(format!("{time} "), muted()),
            Span::styled(
                "Task failed",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
        ]),
        "approval.requested" => {
            let filename = event
                .payload
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            Line::from(vec![
                Span::styled(" 🛡 ", Style::default().fg(Color::Yellow)),
                Span::styled(format!("{time} "), muted()),
                Span::styled(
                    format!("Approval requested: export {filename}"),
                    Style::default().fg(Color::Yellow),
                ),
            ])
        }
        "approval.granted" => Line::from(vec![
            Span::styled(" ✔ ", Style::default().fg(Color::Green)),
            Span::styled(format!("{time} "), muted()),
            Span::styled("Export approval granted", Style::default().fg(Color::Green)),
        ]),
        "approval.rejected" => Line::from(vec![
            Span::styled(" ✖ ", Style::default().fg(Color::Red)),
            Span::styled(format!("{time} "), muted()),
            Span::styled("Export approval rejected", Style::default().fg(Color::Red)),
        ]),
        "export.written" => {
            let file = event
                .payload
                .get("file")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            Line::from(vec![
                Span::styled(" 💾 ", Style::default().fg(Color::Green)),
                Span::styled(format!("{time} "), muted()),
                Span::styled(
                    format!("Export saved to {file}"),
                    Style::default().fg(Color::Green),
                ),
            ])
        }
        _ => Line::from(vec![
            Span::styled(" • ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{time} "), muted()),
            Span::styled(event.kind.clone(), muted()),
        ]),
    }
}

const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

fn current_spinner(ticks: u64) -> &'static str {
    SPINNER_FRAMES[(ticks as usize) % SPINNER_FRAMES.len()]
}

fn render_assistant_stream(app: &mut App, frame: &mut Frame, area: Rect) {
    let mut lines: Vec<Line<'static>> = Vec::new();

    // Pending export approvals banner
    for approval in &app.assistant.approvals {
        lines.push(Line::from(vec![
            Span::styled(
                " ⚠ APPROVAL PENDING ",
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(
                format!(
                    "Export to {} ({})",
                    approval.approval.filename, approval.approval.destinationPath
                ),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(" — switch to Tasks (Tab 2 or /tasks) to review", muted()),
        ]));
        lines.push(Line::from(""));
    }

    // Missed routines banner
    for routine in app
        .assistant
        .routines
        .iter()
        .filter(|r| r.missedCount > 0)
        .take(2)
    {
        lines.push(Line::from(vec![
            Span::styled(
                " MISSED ROUTINE ",
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(
                routine.routine.name.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(
                    " ({} missed — switch to Routines /r to run/skip)",
                    routine.missedCount
                ),
                muted(),
            ),
        ]));
        lines.push(Line::from(""));
    }

    // Slash help reference when toggled
    if app.assistant.slash_help_open {
        lines.push(Line::styled(
            "── [Commands & Shortcuts] ─────────────────────────────────────────────",
            accent().add_modifier(Modifier::BOLD),
        ));
        lines.push(Line::from(vec![
            Span::styled(
                "  /project [name] ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "Switch active project scope (or cycle without args)",
                muted(),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /tasks          ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Open tasks list & run history (Tab 2)", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /settings       ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Configure providers & API keys (Tab 6)", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /memory         ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("View memory proposals & entries (Tab 4)", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /routines       ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Manage weekly planning routines (Tab 5)", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /clear          ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Clear session view & scroll offset", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  /cancel         ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Cancel the current running task", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  Enter           ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Submit prompt or execute slash command", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  Shift+Enter     ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Insert newline in prompt", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  Up / Down       ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Navigate previous prompt history", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  Tab             ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Quick-cycle project scope", muted()),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "  Ctrl+A          ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("Toggle advanced options (constraints, URLs)", muted()),
        ]));
        lines.push(Line::from(""));
    }

    // Active task detail OR Welcome / Idle guide
    if let Some(detail) = &app.assistant.active_task_detail {
        let task = &detail.task;
        let spinner = current_spinner(app.ticks);
        let (state_icon, state_label, state_style) = match task.state {
            TaskState::Queued => ("⏳", "queued", Style::default().fg(Color::Yellow)),
            TaskState::Running => (
                spinner,
                "running",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            TaskState::AwaitingApproval => (
                "⚠",
                "approval pending",
                Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
            ),
            TaskState::Completed => (
                "✔",
                "completed",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            TaskState::Failed => (
                "✖",
                "failed",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
            TaskState::Canceled => ("⊘", "canceled", Style::default().fg(Color::DarkGray)),
            TaskState::Interrupted => ("⏸", "interrupted", Style::default().fg(Color::Yellow)),
        };

        let project_name = task.projectId.as_deref().unwrap_or("no project scope");
        let kind_str = match task.kind {
            TaskKind::ResearchBrief => "research brief",
            TaskKind::ProjectUpdate => "project update",
            TaskKind::ExportReport => "export report",
            TaskKind::WeeklyPlan => "weekly plan",
        };

        // Task header banner
        lines.push(Line::from(vec![
            Span::styled(format!(" {state_icon} [{state_label}] "), state_style),
            Span::raw(" "),
            Span::styled(
                task.title.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(format!("  ({kind_str} • {project_name})"), muted()),
        ]));

        if !task.request.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("  Request: ", muted()),
                Span::styled(task.request.clone(), Style::default().fg(Color::White)),
            ]));
        }

        // Live execution events / tool steps (e.g. web search, file read)
        if !detail.events.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::styled(
                "── [Execution Progress] ────────────────────────────────────────────────",
                muted(),
            ));
            for event in &detail.events {
                lines.push(format_stream_event(event));
            }
        }

        // Rendered Artifact report in Rich Markdown!
        if let Some(artifact) = &detail.artifact {
            lines.push(Line::from(""));
            lines.push(Line::styled(
                "── [Generated Report] ──────────────────────────────────────────────────",
                accent().add_modifier(Modifier::BOLD),
            ));
            lines.extend(crate::markdown::render_markdown(&artifact.markdown));
        } else if task.state == TaskState::Running {
            let provider_name = app
                .settings
                .settings
                .as_ref()
                .map(|s| s.provider.clone())
                .unwrap_or_else(|| "openrouter".to_string());

            let status_msg = if let Some(last_event) = detail.events.last() {
                if last_event.kind == "tool.executed" {
                    let tool = last_event
                        .payload
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool");
                    format!("Synthesizing brief with {provider_name} from {tool} evidence...")
                } else if last_event.kind == "run.started" {
                    format!("Evaluating tools & instructions with {provider_name}...")
                } else {
                    format!("Agent loop running with {provider_name}...")
                }
            } else {
                format!("Agent loop running with {provider_name}...")
            };

            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled(
                    format!("  {spinner} "),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    status_msg,
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
            lines.push(Line::styled(
                "    (Evidence-based agent loop: tools execute first, then model synthesizes the report)",
                muted(),
            ));
        } else if let Some(err) = &task.error {
            lines.push(Line::from(""));
            lines.push(Line::styled(
                format!("  ✖ Error: {err}"),
                Style::default().fg(Color::Red),
            ));
        }
    } else {
        // Welcome and Idle state
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                "  OpenFrost",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                " — Personal AI OS Control Center",
                Style::default().add_modifier(Modifier::BOLD),
            ),
        ]));
        lines.push(Line::styled(
            "  Terminal-native assistant for research briefs, project updates, and weekly routines.",
            muted(),
        ));
        lines.push(Line::from(""));

        let provider_name = app
            .settings
            .settings
            .as_ref()
            .map(|s| s.provider.clone())
            .unwrap_or_else(|| "openrouter".to_string());
        let model_name = app
            .settings
            .settings
            .as_ref()
            .and_then(|s| s.model.clone())
            .unwrap_or_else(|| "openrouter/auto".to_string());
        lines.push(Line::from(vec![
            Span::styled("  Provider: ", muted()),
            Span::styled(provider_name, Style::default().fg(Color::Yellow)),
            Span::styled(" | Model: ", muted()),
            Span::styled(model_name, Style::default().fg(Color::LightCyan)),
        ]));
        lines.push(Line::from(""));

        lines.push(Line::styled(
            "  Quick Start:",
            Style::default().add_modifier(Modifier::BOLD),
        ));
        lines.push(Line::styled(
            "  • Type any research brief or project update prompt below and press Enter.",
            muted(),
        ));
        lines.push(Line::styled(
            "  • Use Shift+Enter (or Alt+Enter) to write multi-line prompts.",
            muted(),
        ));
        lines.push(Line::styled(
            "  • Press Tab to quick-cycle project scope; type /help for slash commands.",
            muted(),
        ));
        lines.push(Line::styled(
            "  • Use mouse wheel or PageUp/PageDown to scroll reports smoothly.",
            muted(),
        ));
    }

    let scroll_y = app.assistant.stream_scroll;
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0))
            .block(block(
                "Session Stream (scroll with mouse wheel, PageUp/Down, j/k)",
            )),
        area,
    );
}

fn render_assistant_composer(app: &mut App, frame: &mut Frame, area: Rect) {
    let project_name = app
        .assistant
        .project_idx
        .and_then(|idx| app.assistant.projects.get(idx))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "no project".to_string());

    let kind_name = if app.assistant.kind_project_update {
        "project update"
    } else {
        "research brief"
    };

    let title = format!(
        "Prompt (Enter send | Shift+Enter newline | Tab scope: {} | {})",
        project_name, kind_name
    );
    app.assistant.request.set_block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(accent().add_modifier(Modifier::BOLD))
            .title(Span::styled(title, accent().add_modifier(Modifier::BOLD))),
    );
    frame.render_widget(&app.assistant.request, area);
}

fn composer_row(frame: &mut Frame, area: Rect, label: &str, focused: bool) {
    let style = if focused {
        accent().add_modifier(Modifier::BOLD)
    } else {
        muted()
    };
    let label_area = Rect {
        width: (label.len() as u16).min(area.width),
        ..area
    };
    frame.render_widget(
        Paragraph::new(Line::styled(label.to_string(), style)),
        label_area,
    );
}

fn render_composer(app: &mut App, frame: &mut Frame, area: Rect) {
    let kind_value = if app.assistant.kind_project_update {
        "project update"
    } else {
        "research brief"
    };
    let project_value = app
        .assistant
        .project_idx
        .and_then(|index| app.assistant.projects.get(index))
        .map(|project| project.name.clone())
        .unwrap_or_else(|| "(no project)".to_string());

    let mut constraints = Vec::new();
    // Request, kind, project always; advanced fields when open.
    constraints.push(Constraint::Min(4)); // request
    constraints.push(Constraint::Length(1)); // kind
    constraints.push(Constraint::Length(1)); // project
    if app.assistant.advanced_open {
        constraints.push(Constraint::Length(1)); // title
        constraints.push(Constraint::Length(2)); // constraints
        constraints.push(Constraint::Length(1)); // urls
    }
    constraints.push(Constraint::Length(1)); // footer
    let rows = Layout::vertical(constraints).split(area);

    let focus = app.assistant.focus;
    let mut row = 0usize;

    let focused_block = |base: Block<'static>, focused: bool| {
        if focused {
            base.border_style(accent())
        } else {
            base
        }
    };

    // Request textarea.
    app.assistant.request.set_block(focused_block(
        block("Request (Ctrl+S queue, Tab next, Ctrl+A advanced)"),
        focus == ComposerField::Request,
    ));
    frame.render_widget(&app.assistant.request, rows[row]);
    row += 1;

    // Kind row.
    render_select_row(
        frame,
        rows[row],
        "Kind",
        kind_value,
        focus == ComposerField::Kind,
    );
    row += 1;

    render_select_row(
        frame,
        rows[row],
        "Project",
        &project_value,
        focus == ComposerField::Project,
    );
    row += 1;

    if app.assistant.advanced_open {
        app.assistant.title.set_block(focused_block(
            block("Title (optional)"),
            focus == ComposerField::Title,
        ));
        frame.render_widget(&app.assistant.title, rows[row]);
        row += 1;

        app.assistant.constraints.set_block(focused_block(
            block("Constraints (optional)"),
            focus == ComposerField::Constraints,
        ));
        frame.render_widget(&app.assistant.constraints, rows[row]);
        row += 1;

        app.assistant.starting_urls.set_block(focused_block(
            block("Starting URLs (optional, space/comma separated)"),
            focus == ComposerField::StartingUrls,
        ));
        frame.render_widget(&app.assistant.starting_urls, rows[row]);
        row += 1;
    }

    let hint = if app.assistant.advanced_open {
        "Ctrl+A hide advanced"
    } else {
        "Ctrl+A show advanced (title, constraints, starting URLs)"
    };
    composer_row(frame, rows[row], hint, false);
}

fn render_select_row(frame: &mut Frame, area: Rect, label: &str, value: &str, focused: bool) {
    let label_style = if focused {
        accent().add_modifier(Modifier::BOLD)
    } else {
        muted()
    };
    let line = Line::from(vec![
        Span::styled(format!("{label}: "), label_style),
        Span::styled(
            value.to_string(),
            if focused { accent() } else { Style::default() },
        ),
        if focused {
            Span::styled("  (h/l change)", muted())
        } else {
            Span::raw("")
        },
    ]);
    frame.render_widget(Paragraph::new(line), area);
}

fn render_activity(app: &mut App, frame: &mut Frame, area: Rect) {
    let chunks = Layout::vertical([
        Constraint::Length(app.assistant.approvals.len().min(3) as u16 * 2 + 1),
        Constraint::Length(
            app.assistant
                .routines
                .iter()
                .map(|r| r.missedCount)
                .sum::<i64>()
                .min(3) as u16
                + 1,
        ),
        Constraint::Min(3),
    ])
    .split(area);
    let (approval_area, routine_area, activity_area) = (chunks[0], chunks[1], chunks[2]);

    // Pending export approvals.
    let mut approval_lines: Vec<Line> = Vec::new();
    for approval in app.assistant.approvals.iter().take(3) {
        approval_lines.push(Line::from(vec![
            Span::styled(
                " approval ",
                Style::default().fg(Color::Black).bg(Color::Magenta),
            ),
            Span::raw(" "),
            Span::styled(
                format!(
                    "{} \u{2192} {} ({})",
                    approval.taskTitle.as_deref().unwrap_or("export"),
                    approval.approval.filename,
                    approval.approval.destinationPath
                ),
                Style::default(),
            ),
        ]));
        approval_lines.push(Line::styled(
            "   open it in Tasks \u{2192} Enter \u{2192} g grant / d reject".to_string(),
            muted(),
        ));
    }
    if approval_lines.is_empty() {
        approval_lines.push(Line::styled(
            "No pending export approvals.".to_string(),
            muted(),
        ));
    }
    frame.render_widget(
        Paragraph::new(approval_lines).block(block("Approvals")),
        approval_area,
    );

    // Missed routines.
    let mut routine_lines: Vec<Line> = Vec::new();
    for routine in app
        .assistant
        .routines
        .iter()
        .filter(|r| r.missedCount > 0)
        .take(3)
    {
        routine_lines.push(Line::from(vec![
            Span::styled(
                " missed ",
                Style::default().fg(Color::Black).bg(Color::Yellow),
            ),
            Span::raw(" "),
            Span::raw(routine.routine.name.clone()),
            Span::styled(
                format!(
                    "  ({} occurrence(s) \u{2014} review in Routines)",
                    routine.missedCount
                ),
                muted(),
            ),
        ]));
    }
    if routine_lines.is_empty() {
        routine_lines.push(Line::styled(
            "No missed routine occurrences.".to_string(),
            muted(),
        ));
    }
    frame.render_widget(
        Paragraph::new(routine_lines).block(block("Routines")),
        routine_area,
    );

    // Recent activity.
    let activity: Vec<Line> = app
        .assistant
        .events
        .iter()
        .map(|event| {
            let task_part = event
                .taskId
                .as_deref()
                .map(|id| format!(" [{id}]"))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(
                    format!("{} ", &event.createdAt[11..19.min(event.createdAt.len())]),
                    muted(),
                ),
                Span::styled(event.kind.clone(), accent()),
                Span::raw(task_part),
            ])
        })
        .collect();
    frame.render_widget(
        Paragraph::new(activity)
            .wrap(Wrap { trim: false })
            .block(block("Recent activity")),
        activity_area,
    );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

fn render_tasks(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.tasks.searching {
        let chunks = Layout::vertical([Constraint::Length(3), Constraint::Min(3)]).split(area);
        app.tasks
            .search
            .set_block(block("Search (/ to focus, Enter apply, Esc clear)"));
        frame.render_widget(&app.tasks.search, chunks[0]);
        render_task_list(app, frame, chunks[1]);
        return;
    }
    if app.tasks.detail_open {
        render_task_detail(app, frame, area);
        return;
    }
    render_task_list(app, frame, area);
}

fn render_task_list(app: &mut App, frame: &mut Frame, area: Rect) {
    let visible = app.tasks.visible();
    let items: Vec<ListItem> = visible
        .iter()
        .enumerate()
        .map(|(index, task)| {
            let mut spans = vec![
                Span::styled(
                    format!(" {:<9} ", task_state_short(&task.state)),
                    task_state_style(&task.state),
                ),
                Span::raw(truncate(&task.title, 44)),
                Span::styled(format!("  {}", kind_label(&task.kind)), muted()),
            ];
            if let Some(error) = &task.error {
                spans.push(Span::styled(
                    format!("  {}", truncate(error, 40)),
                    Style::default().fg(Color::Red),
                ));
            }
            if index == app.tasks.selected {
                return ListItem::new(Line::from(spans)).style(selected_style());
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let filter_counts = |filter: TaskFilter| {
        app.tasks
            .tasks
            .iter()
            .filter(|task| filter.matches(task))
            .count()
    };
    let title = format!(
        "Tasks \u{2014} {} (f filter, / search, Enter detail, c cancel, r retry) [{} all / {} active / {} done / {} failed]",
        app.tasks.filter.label(),
        filter_counts(TaskFilter::All),
        filter_counts(TaskFilter::Active),
        filter_counts(TaskFilter::Done),
        filter_counts(TaskFilter::Failed),
    );
    let mut list_state = ListState::default();
    list_state.select(Some(
        app.tasks.selected.min(visible.len().saturating_sub(1)),
    ));
    frame.render_stateful_widget(List::new(items).block(block(&title)), area, &mut list_state);
}

fn task_state_short(state: &TaskState) -> &'static str {
    match state {
        TaskState::Queued => "queued",
        TaskState::Running => "running",
        TaskState::AwaitingApproval => "approval",
        TaskState::Completed => "done",
        TaskState::Failed => "failed",
        TaskState::Canceled => "canceled",
        TaskState::Interrupted => "intrpt",
    }
}

fn task_state_style(state: &TaskState) -> Style {
    match state {
        TaskState::Queued => Style::default().fg(Color::Yellow),
        TaskState::Running => Style::default().fg(Color::Cyan),
        TaskState::AwaitingApproval => Style::default().fg(Color::Magenta),
        TaskState::Completed => Style::default().fg(Color::Green),
        TaskState::Failed => Style::default().fg(Color::Red),
        TaskState::Canceled | TaskState::Interrupted => muted(),
    }
}

fn render_task_detail(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(detail) = &app.tasks.detail else {
        frame.render_widget(
            Paragraph::new("Loading\u{2026}").block(block("Task detail")),
            area,
        );
        return;
    };
    let task = &detail.task;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![
        Span::styled(
            format!(" {} ", task_state_short(&task.state)),
            task_state_style(&task.state),
        ),
        Span::raw(" "),
        Span::styled(
            task.title.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(
                "  {}  attempts: {}",
                kind_label(&task.kind),
                task.attemptCount
            ),
            muted(),
        ),
    ]));
    lines.push(Line::styled(
        format!("Request: {}", truncate(&task.request, 160)),
        Style::default(),
    ));
    if let Some(error) = &task.error {
        lines.push(Line::styled(
            format!("Error: {error}"),
            Style::default().fg(Color::Red),
        ));
    }
    if let Some(project) = task.projectId.as_deref() {
        lines.push(Line::styled(format!("Project: {project}"), muted()));
    }
    lines.push(Line::from(""));

    lines.push(Line::styled("Runs", accent().add_modifier(Modifier::BOLD)));
    for run in &detail.runs {
        let usage = run
            .usage
            .as_ref()
            .map(|usage| {
                format!(
                    " steps {} in {} out {}",
                    usage.steps, usage.inputChars, usage.outputChars
                )
            })
            .unwrap_or_default();
        let failure = run
            .failure
            .as_ref()
            .map(|failure| format!(" \u{2013} {} ({})", failure.code, failure.message))
            .unwrap_or_default();
        lines.push(Line::from(vec![
            Span::styled(format!(" attempt {} ", run.attempt), muted()),
            Span::styled(run_state_label(&run.state), run_state_style(&run.state)),
            Span::raw(usage),
            Span::styled(failure, Style::default().fg(Color::Red)),
        ]));
    }
    lines.push(Line::from(""));

    if let Some(approval) = &detail.approval {
        lines.push(Line::styled(
            "Export approval",
            accent().add_modifier(Modifier::BOLD),
        ));
        lines.push(Line::from(vec![
            Span::styled(
                format!(" {} ", approval_state_label(&approval.state)),
                approval_state_style(&approval.state),
            ),
            Span::raw(format!(
                "write \"{}\" into {} (risk: {:?})",
                approval.filename, approval.destinationPath, approval.riskTier
            )),
        ]));
        if approval.state == ApprovalState::Pending {
            lines.push(Line::styled(
                " g grant (approves the exact content and destination) | d reject".to_string(),
                muted(),
            ));
        }
        if let Some(outcome) = &approval.outcome {
            lines.push(Line::styled(
                format!(
                    " wrote {} bytes in {} ms \u{2192} {}",
                    outcome.bytes, outcome.ms, outcome.file
                ),
                Style::default().fg(Color::Green),
            ));
        }
        if let Some(reason) = &approval.refusalReason {
            lines.push(Line::styled(
                format!(" refused: {reason}"),
                Style::default().fg(Color::Red),
            ));
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::styled(
        "Events",
        accent().add_modifier(Modifier::BOLD),
    ));
    for event in &detail.events {
        lines.push(format_stream_event(event));
    }
    lines.push(Line::from(""));

    if let Some(artifact) = &detail.artifact {
        lines.push(Line::styled(
            "── [Saved Report] ────────────────────────────────────────────────────────",
            accent().add_modifier(Modifier::BOLD),
        ));
        let rendered = crate::markdown::render_markdown(&artifact.markdown);
        let skip = app.tasks.artifact_scroll as usize;
        for line in rendered.into_iter().skip(skip) {
            lines.push(line);
        }
    } else if task.resultArtifactId.is_none() && task.state == TaskState::Completed {
        lines.push(Line::styled("(no saved artifact)", muted()));
    }

    lines.push(Line::from(""));
    lines.push(Line::styled(
        " b/Esc back | c cancel | r retry | e export | j/k, PageUp/Down or mouse scroll"
            .to_string(),
        muted(),
    ));

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((0, 0))
            .block(block("Task detail")),
        area,
    );
}

fn run_state_label(state: &RunState) -> &'static str {
    match state {
        RunState::Running => "running",
        RunState::Completed => "completed",
        RunState::Failed => "failed",
        RunState::Canceled => "canceled",
        RunState::Interrupted => "interrupted",
    }
}

fn run_state_style(state: &RunState) -> Style {
    match state {
        RunState::Running => Style::default().fg(Color::Cyan),
        RunState::Completed => Style::default().fg(Color::Green),
        RunState::Failed => Style::default().fg(Color::Red),
        RunState::Canceled | RunState::Interrupted => muted(),
    }
}

fn approval_state_label(state: &ApprovalState) -> &'static str {
    match state {
        ApprovalState::Pending => "pending",
        ApprovalState::Granted => "granted",
        ApprovalState::Rejected => "rejected",
        ApprovalState::Canceled => "canceled",
        ApprovalState::Expired => "expired",
        ApprovalState::Executed => "executed",
    }
}

fn approval_state_style(state: &ApprovalState) -> Style {
    match state {
        ApprovalState::Pending => Style::default().fg(Color::Magenta),
        ApprovalState::Granted => Style::default().fg(Color::Cyan),
        ApprovalState::Executed => Style::default().fg(Color::Green),
        ApprovalState::Rejected | ApprovalState::Canceled | ApprovalState::Expired => muted(),
    }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

fn render_projects(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.projects.detail_open {
        let Some(project) = app.projects.projects.get(app.projects.selected) else {
            return;
        };
        let mut lines: Vec<Line> = vec![
            Line::styled(
                project.name.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Line::styled(
                project
                    .instructions
                    .clone()
                    .unwrap_or_else(|| "(no instructions)".to_string()),
                Style::default(),
            ),
            Line::from(""),
            Line::styled("Granted folders", accent().add_modifier(Modifier::BOLD)),
        ];
        for (index, grant) in project.grants.iter().enumerate() {
            let marker = if index == app.projects.grant_selected {
                " > "
            } else {
                "   "
            };
            lines.push(Line::from(format!("{marker}{}", grant.path)));
        }
        if project.grants.is_empty() {
            lines.push(Line::styled(
                "  (none \u{2014} press g to grant a folder)",
                muted(),
            ));
        }
        lines.push(Line::from(""));
        lines.push(Line::styled(
            " b/Esc back | g grant folder | j/k select grant | x revoke".to_string(),
            muted(),
        ));
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block("Project detail")),
            area,
        );
        return;
    }
    let items: Vec<ListItem> = app
        .projects
        .projects
        .iter()
        .enumerate()
        .map(|(index, project)| {
            let line = Line::from(vec![
                Span::raw(project.name.clone()),
                Span::styled(format!("  {} grant(s)", project.grants.len()), muted()),
            ]);
            if index == app.projects.selected {
                ListItem::new(line).style(selected_style())
            } else {
                ListItem::new(line)
            }
        })
        .collect();
    let mut list_state = ListState::default();
    list_state.select(Some(
        app.projects
            .selected
            .min(app.projects.projects.len().saturating_sub(1)),
    ));
    frame.render_stateful_widget(
        List::new(items).block(block("Projects (n new, Enter detail, e edit)")),
        area,
        &mut list_state,
    );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

fn render_memory(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(snapshot) = &app.memory.snapshot else {
        frame.render_widget(
            Paragraph::new("Loading memory\u{2026}").block(block("Memory")),
            area,
        );
        return;
    };
    let mut lines: Vec<Line> = Vec::new();
    let mut row_index = 0usize;

    lines.push(Line::styled(
        "Proposals awaiting decision",
        accent().add_modifier(Modifier::BOLD),
    ));
    if snapshot.proposals.is_empty() {
        lines.push(Line::styled("  (none)".to_string(), muted()));
        row_index += 1;
    }
    for proposal in &snapshot.proposals {
        let marker = row_marker(app, row_index);
        let scope = match proposal.scope {
            MemoryScope::Global => "global".to_string(),
            MemoryScope::Project => format!(
                "project {}",
                snapshot
                    .projects
                    .iter()
                    .find(|view| Some(&view.projectId) == proposal.projectId.as_ref())
                    .map(|view| view.projectName.as_str())
                    .unwrap_or("?")
            ),
        };
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::styled(
                " proposal ",
                Style::default().fg(Color::Black).bg(Color::Magenta),
            ),
            Span::styled(format!("({scope}) "), muted()),
            Span::raw(truncate(proposal.content.as_deref().unwrap_or(""), 90)),
        ]));
        if row_index == app.memory.selected {
            lines.push(Line::styled("   a approve | x reject".to_string(), muted()));
        }
        row_index += 1;
    }
    lines.push(Line::from(""));

    lines.push(Line::styled(
        "Global memory (owner.md)",
        accent().add_modifier(Modifier::BOLD),
    ));
    if snapshot.global.externalChange {
        lines.push(Line::styled(
            "  ! file changed outside OpenFrost \u{2014} press R to reload".to_string(),
            Style::default().fg(Color::Yellow),
        ));
    }
    for problem in &snapshot.global.problems {
        lines.push(Line::styled(
            format!("  ! {problem}"),
            Style::default().fg(Color::Red),
        ));
    }
    for (index, entry) in snapshot.global.entries.iter().enumerate() {
        let marker = row_marker(app, row_index);
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::raw(truncate(&entry.content, 100)),
        ]));
        if row_index == app.memory.selected {
            lines.push(Line::styled("   e edit | d delete".to_string(), muted()));
        }
        let _ = index;
        row_index += 1;
    }
    lines.push(Line::from(""));

    for (project_index, view) in snapshot.projects.iter().enumerate() {
        lines.push(Line::styled(
            format!("{} (project memory)", view.projectName),
            accent().add_modifier(Modifier::BOLD),
        ));
        let _ = project_index;
        if view.externalChange {
            lines.push(Line::styled(
                "  ! file changed outside OpenFrost \u{2014} press R to reload".to_string(),
                Style::default().fg(Color::Yellow),
            ));
        }
        for problem in &view.problems {
            lines.push(Line::styled(
                format!("  ! {problem}"),
                Style::default().fg(Color::Red),
            ));
        }
        for entry in &view.entries {
            let marker = row_marker(app, row_index);
            lines.push(Line::from(vec![
                Span::raw(marker),
                Span::raw(truncate(&entry.content, 100)),
            ]));
            if row_index == app.memory.selected {
                lines.push(Line::styled("   e edit | d delete".to_string(), muted()));
            }
            row_index += 1;
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::styled(
        " j/k move | a approve proposal | x reject proposal | e edit entry | d delete entry | R reload from disk".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block("Memory")),
        area,
    );
}

fn row_marker(app: &App, row_index: usize) -> &'static str {
    if row_index == app.memory.selected {
        " > "
    } else {
        "   "
    }
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

fn render_routines(app: &mut App, frame: &mut Frame, area: Rect) {
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

fn render_settings(app: &mut App, frame: &mut Frame, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();
    let selected = app.settings.selected;

    let settings = app.settings.settings.as_ref();
    let provider = settings.map(|s| s.provider.clone()).unwrap_or_default();
    let model = settings
        .and_then(|s| s.model.clone())
        .unwrap_or_else(|| "\u{2014}".to_string());
    let has_key = settings.map(|s| s.hasProviderKey).unwrap_or(false);

    lines.push(row_line(
        0 == selected,
        "Provider",
        &format!("{provider}  (model: {model})"),
    ));
    lines.push(Line::styled(
        "     Enter/l to cycle openai \u{2192} gemini \u{2192} openrouter".to_string(),
        muted(),
    ));
    lines.push(row_line(
        1 == selected,
        "Provider key",
        &if has_key {
            "configured (stored with Windows DPAPI)".to_string()
        } else {
            "not set".to_string()
        },
    ));
    lines.push(Line::styled(
        "     Enter to set a key (masked input); the key is never shown again".to_string(),
        muted(),
    ));
    lines.push(Line::from(""));

    lines.push(Line::styled(
        "Export destinations",
        accent().add_modifier(Modifier::BOLD),
    ));
    for (index, destination) in app.settings.destinations.iter().enumerate() {
        let row = 2 + index;
        let marker = if row == selected { " > " } else { "   " };
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::raw(destination.path.clone()),
            Span::styled("  (x remove)", muted()),
        ]));
    }
    if app.settings.destinations.is_empty() {
        lines.push(Line::styled(
            "   (none \u{2014} press a to add a folder exports may write into)".to_string(),
            muted(),
        ));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(
        " j/k move | Enter activate | a add destination | x remove destination".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block("Settings")),
        area,
    );
}

fn row_line(active: bool, label: &str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::raw(if active { " > " } else { "   " }),
        Span::styled(
            format!("{label}: "),
            if active {
                accent().add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            },
        ),
        Span::raw(value.to_string()),
    ])
}

// ---------------------------------------------------------------------------
// Tab picker (Ctrl+P)
// ---------------------------------------------------------------------------

fn render_tab_picker(frame: &mut Frame, selected: usize) {
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

fn render_dialog(_app: &App, frame: &mut Frame, dialog: &Dialog) {
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
