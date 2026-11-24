use super::{accent, block, muted};
use crate::app::{App, ComposerField};
use crate::contracts::{Event, TaskKind, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_assistant(app: &mut App, frame: &mut Frame, area: Rect) {
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

pub(super) fn format_stream_event(event: &Event) -> Line<'static> {
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
