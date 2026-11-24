use super::mascot::{braille_spinner, compact_owl_lines, frost_spinner, mini_owl_spans};
use super::theme::{
    accent, accent_bold, approval, danger, frost_glow, hairline, hairline_style, ice_mid, muted,
    pill, primary_bold, rounded_block, rounded_block_focused, section_rule, success, warn, AMBER,
    FROST_GLOW, ICE_BRIGHT, ICE_DIM, ICE_MID, SLATE_BORDER, SURFACE_PILL, SURFACE_SEL,
};
use crate::app::{App, ComposerField};
use crate::contracts::{Event, TaskKind, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_assistant(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.assistant.advanced_open {
        let chunks = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)])
            .split(area);
        render_composer(app, frame, chunks[0]);
        render_activity(app, frame, chunks[1]);
    } else {
        let prompt_lines = (app.assistant.request.lines().len() as u16).clamp(1, 5);
        // top hairline (1) + input lines (1..5) + bottom hairline (1)
        let composer_height = prompt_lines + 2;
        let vertical =
            Layout::vertical([Constraint::Min(6), Constraint::Length(composer_height)]).split(area);
        render_assistant_stream(app, frame, vertical[0]);
        render_assistant_composer(app, frame, vertical[1]);
        render_slash_autocomplete(app, frame, vertical[0]);
    }
}

/// Formats an execution event into a clean tree-style line inspired by
/// Claude Code & Codex CLI tool call traces.
pub(super) fn format_stream_event_branch(event: &Event, is_last: bool) -> Line<'static> {
    let time = if event.createdAt.len() >= 19 {
        event.createdAt[11..19].to_string()
    } else {
        String::new()
    };
    let branch = if is_last { "  └─ " } else { "  ├─ " };

    match event.kind.as_str() {
        "task.queued" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("◌ ", warn()),
            Span::styled("queued", Style::default().fg(FROST_GLOW)),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "run.started" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("◆ ", accent_bold()),
            Span::styled("agent loop", accent_bold()),
            Span::styled("  initializing tools & context", muted()),
            Span::styled(format!("  {time}"), muted()),
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

            let detail_str = match tool {
                "web_search" => {
                    let count = event
                        .payload
                        .get("count")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(1);
                    format!("searched {count} online query(s)")
                }
                "fetch_page" => {
                    let dur = duration
                        .map(|d| format!("{d}ms"))
                        .unwrap_or_else(|| "done".to_string());
                    format!("fetched source page ({dur})")
                }
                "read_project_file" => {
                    let dur = duration
                        .map(|d| format!("{d}ms"))
                        .unwrap_or_else(|| "done".to_string());
                    format!("read granted project file ({dur})")
                }
                "propose_memory" => "proposed durable memory entry".to_string(),
                _ => duration.map(|d| format!("{d}ms")).unwrap_or_default(),
            };

            let (dot, dot_style) = if ok {
                ("● ", success())
            } else {
                ("✖ ", danger())
            };

            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled(dot, dot_style),
                Span::styled(
                    format!("{tool:<18}"),
                    Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
                ),
                Span::styled(detail_str, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "run.completed" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("✓ ", success()),
            Span::styled("synthesis finished", success()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "task.completed" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("✔ ", success().add_modifier(Modifier::BOLD)),
            Span::styled("completed", success().add_modifier(Modifier::BOLD)),
            Span::styled("  report saved", muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "task.failed" | "run.failed" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("✖ ", danger().add_modifier(Modifier::BOLD)),
            Span::styled("failed", danger().add_modifier(Modifier::BOLD)),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "approval.requested" => {
            let filename = event
                .payload
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("◈ ", approval().add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("approval requested: export {filename}"),
                    approval().add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "approval.granted" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("✔ ", success()),
            Span::styled("export approval granted", success()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "approval.rejected" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("✖ ", danger()),
            Span::styled("export approval rejected", danger()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "export.written" => {
            let file = event
                .payload
                .get("file")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("✔ ", success()),
                Span::styled(format!("exported → {file}"), success()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        _ => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("· ", muted()),
            Span::styled(event.kind.clone(), muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
    }
}

fn render_assistant_stream(app: &mut App, frame: &mut Frame, area: Rect) {
    if area.height < 2 || area.width < 10 {
        return;
    }

    // When idle (no active task detail), render the Claude/Codex welcome hero
    // with the Frost Owl mascot plus any actionable alerts or inline /help.
    if app.assistant.active_task_detail.is_none() {
        render_welcome_canvas(app, frame, area);
        return;
    }

    let mut lines: Vec<Line<'static>> = Vec::new();
    lines.push(Line::from(""));

    // Pending export approvals callout
    for approval_item in &app.assistant.approvals {
        lines.push(Line::from(vec![
            Span::raw("  "),
            Span::styled(
                " APPROVAL PENDING ",
                pill(FROST_GLOW, Color::Rgb(76, 29, 149)),
            ),
            Span::raw(" "),
            Span::styled(
                format!(
                    "{} → {}",
                    approval_item.approval.filename, approval_item.approval.destinationPath
                ),
                primary_bold(),
            ),
            Span::styled("  (/tasks to review)", muted()),
        ]));
        lines.push(Line::from(""));
    }

    // Missed routines callout
    for routine in app
        .assistant
        .routines
        .iter()
        .filter(|r| r.missedCount > 0)
        .take(2)
    {
        lines.push(Line::from(vec![
            Span::raw("  "),
            Span::styled(" MISSED ROUTINE ", pill(Color::Black, AMBER)),
            Span::raw(" "),
            Span::styled(routine.routine.name.clone(), primary_bold()),
            Span::styled(
                format!("  ({} missed • /routines)", routine.missedCount),
                muted(),
            ),
        ]));
        lines.push(Line::from(""));
    }

    if app.assistant.slash_help_open {
        append_slash_help_lines(&mut lines, area.width);
    }

    if let Some(detail) = &app.assistant.active_task_detail {
        let task = &detail.task;
        let spinner = braille_spinner(app.ticks);
        let (state_icon, state_label, state_style) = match task.state {
            TaskState::Queued => ("◌", "queued", warn()),
            TaskState::Running => (spinner, "running", accent_bold()),
            TaskState::AwaitingApproval => (
                "◈",
                "awaiting approval",
                approval().add_modifier(Modifier::BOLD),
            ),
            TaskState::Completed => ("✔", "completed", success().add_modifier(Modifier::BOLD)),
            TaskState::Failed => ("✖", "failed", danger().add_modifier(Modifier::BOLD)),
            TaskState::Canceled => ("⊘", "canceled", muted()),
            TaskState::Interrupted => ("⏸", "interrupted", warn()),
        };

        let project_name = task
            .projectId
            .as_deref()
            .and_then(|id| {
                app.assistant
                    .projects
                    .iter()
                    .find(|p| p.id == id)
                    .map(|p| p.name.as_str())
            })
            .unwrap_or("global scope");

        let kind_str = match task.kind {
            TaskKind::ResearchBrief => "research brief",
            TaskKind::ProjectUpdate => "project update",
            TaskKind::ExportReport => "export report",
            TaskKind::WeeklyPlan => "weekly plan",
        };

        // Claude/Codex-style user prompt header (`❯ ...`)
        let prompt_text = if !task.request.is_empty() {
            task.request.clone()
        } else {
            task.title.clone()
        };
        for (idx, prompt_line) in prompt_text.lines().enumerate() {
            if idx == 0 {
                lines.push(Line::from(vec![
                    Span::styled("  ❯ ", accent_bold()),
                    Span::styled(
                        prompt_line.to_string(),
                        frost_glow().add_modifier(Modifier::BOLD),
                    ),
                ]));
            } else {
                lines.push(Line::from(vec![
                    Span::raw("    "),
                    Span::styled(prompt_line.to_string(), frost_glow()),
                ]));
            }
        }
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(format!("{state_icon} {state_label}"), state_style),
            Span::styled(format!("  •  {kind_str}  •  {project_name}"), muted()),
        ]));

        // Live execution tree
        if !detail.events.is_empty() {
            lines.push(Line::from(""));
            let last_idx = detail.events.len().saturating_sub(1);
            for (idx, event) in detail.events.iter().enumerate() {
                let is_last = idx == last_idx && task.state != TaskState::Running;
                lines.push(format_stream_event_branch(event, is_last));
            }
        }

        // Rendered Markdown report
        if let Some(artifact) = &detail.artifact {
            lines.push(Line::from(""));
            lines.push(section_rule("Generated Report", area.width));
            lines.push(Line::from(""));
            lines.extend(crate::markdown::render_markdown(&artifact.markdown));
            lines.push(Line::from(""));
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
                    format!("Synthesizing brief with {provider_name} from {tool} evidence…")
                } else if last_event.kind == "run.started" {
                    format!("Evaluating tools & instructions with {provider_name}…")
                } else {
                    format!("Running agent loop with {provider_name}…")
                }
            } else {
                format!("Running agent loop with {provider_name}…")
            };

            lines.push(Line::from(""));
            let mut active_spans = vec![Span::raw("  ")];
            active_spans.extend(mini_owl_spans(app.ticks, true));
            active_spans.push(Span::styled(
                format!(" {} ", frost_spinner(app.ticks)),
                accent_bold(),
            ));
            active_spans.push(Span::styled(status_msg, accent_bold()));
            lines.push(Line::from(active_spans));
            lines.push(Line::styled(
                "          Evidence-first loop: bounded tools gather facts before synthesis (/cancel to abort)",
                muted(),
            ));
        } else if let Some(err) = &task.error {
            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled("  ✖ ", danger().add_modifier(Modifier::BOLD)),
                Span::styled(err.clone(), danger()),
            ]));
        }
    }

    let total_lines = lines.len();
    let visible_height = area.height as usize;
    let max_scroll = total_lines.saturating_sub(visible_height);
    let scroll_y = (app.assistant.stream_scroll as usize).min(max_scroll) as u16;
    app.assistant.stream_scroll = scroll_y;

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0)),
        area,
    );

    // Subtle scroll position badge in top-right when scrolled.
    if total_lines > visible_height && area.width > 20 {
        let badge = format!(" [{}/{}] ", scroll_y + 1, total_lines);
        let badge_w = badge.chars().count() as u16;
        let badge_area = Rect {
            x: area.x + area.width.saturating_sub(badge_w + 1),
            y: area.y,
            width: badge_w,
            height: 1,
        };
        frame.render_widget(Paragraph::new(Span::styled(badge, muted())), badge_area);
    }
}

fn render_welcome_canvas(app: &mut App, frame: &mut Frame, area: Rect) {
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
    let project_name = app
        .assistant
        .project_idx
        .and_then(|idx| app.assistant.projects.get(idx))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "no project (global)".to_string());
    let mode_name = if app.assistant.kind_project_update {
        "project update"
    } else {
        "research brief"
    };

    // Centered hero card inspired by Claude Code's welcome box.
    let card_width = 76u16.min(area.width.saturating_sub(4));
    let card_height = 9u16.min(area.height.saturating_sub(1));

    if card_width >= 36 && card_height >= 6 {
        let top_pad = if area.height > card_height + 6 && !app.assistant.slash_help_open {
            2
        } else {
            1
        };
        let card = Rect {
            x: area.x + 2,
            y: area.y + top_pad,
            width: card_width,
            height: card_height,
        };

        let hero_block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(SLATE_BORDER))
            .title(Span::styled(" ❄ OpenFrost v0.1 ", accent_bold()));
        let inner = hero_block.inner(card);
        frame.render_widget(hero_block, card);

        let cols = if inner.width >= 48 {
            Layout::horizontal([Constraint::Length(17), Constraint::Min(24)]).split(inner)
        } else {
            Layout::horizontal([Constraint::Length(0), Constraint::Min(10)]).split(inner)
        };

        if cols[0].width >= 15 {
            let owl_rect = Rect {
                x: cols[0].x + 1,
                y: cols[0].y + cols[0].height.saturating_sub(6) / 2,
                width: 15.min(cols[0].width.saturating_sub(1)),
                height: 6.min(cols[0].height),
            };
            frame.render_widget(Paragraph::new(compact_owl_lines(app.ticks)), owl_rect);
        }

        let info_rect = Rect {
            x: cols[1].x + 1,
            y: cols[1].y,
            width: cols[1].width.saturating_sub(2),
            height: cols[1].height,
        };
        let rule_w = (info_rect.width as usize).saturating_sub(1).min(48);
        let hero_lines = vec![
            Line::from(vec![
                Span::styled("Welcome back", frost_glow().add_modifier(Modifier::BOLD)),
                Span::styled("  •  Personal AI OS", muted()),
            ]),
            Line::from(vec![
                Span::styled("Provider  ", muted()),
                Span::styled(provider_name, warn().add_modifier(Modifier::BOLD)),
                Span::styled("  •  ", hairline_style()),
                Span::styled(model_name, accent()),
            ]),
            Line::from(vec![
                Span::styled("Scope     ", muted()),
                Span::styled(project_name, frost_glow()),
                Span::styled("  •  ", hairline_style()),
                Span::styled(mode_name, ice_mid()),
            ]),
            Line::styled("─".repeat(rule_w), hairline_style()),
            Line::from(vec![
                Span::styled("Type a request below, or ", muted()),
                Span::styled("/", accent_bold()),
                Span::styled(" for commands  •  ", muted()),
                Span::styled("Tab", accent()),
                Span::styled(" scope  •  ", muted()),
                Span::styled("Shift+Tab", accent()),
                Span::styled(" mode", muted()),
            ]),
            Line::from(vec![
                Span::styled("Shift+Enter", accent()),
                Span::styled(" newline  •  ", muted()),
                Span::styled("Ctrl+A", accent()),
                Span::styled(" constraints & URLs  •  ", muted()),
                Span::styled("Ctrl+P", accent()),
                Span::styled(" jump view", muted()),
            ]),
        ];
        frame.render_widget(
            Paragraph::new(hero_lines).wrap(Wrap { trim: false }),
            info_rect,
        );

        // Render below-hero alerts / slash help in the remaining stream area.
        let below_y = card.y + card.height + 1;
        if below_y < area.y + area.height {
            let below_area = Rect {
                x: area.x,
                y: below_y,
                width: area.width,
                height: (area.y + area.height).saturating_sub(below_y),
            };
            let mut extra_lines: Vec<Line<'static>> = Vec::new();
            for approval_item in &app.assistant.approvals {
                extra_lines.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled(
                        " APPROVAL PENDING ",
                        pill(FROST_GLOW, Color::Rgb(76, 29, 149)),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        format!(
                            "{} → {}",
                            approval_item.approval.filename, approval_item.approval.destinationPath
                        ),
                        primary_bold(),
                    ),
                    Span::styled("  (/tasks to review)", muted()),
                ]));
            }
            for routine in app
                .assistant
                .routines
                .iter()
                .filter(|r| r.missedCount > 0)
                .take(2)
            {
                extra_lines.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled(" MISSED ROUTINE ", pill(Color::Black, AMBER)),
                    Span::raw(" "),
                    Span::styled(routine.routine.name.clone(), primary_bold()),
                    Span::styled(
                        format!("  ({} missed • /routines)", routine.missedCount),
                        muted(),
                    ),
                ]));
            }
            if app.assistant.slash_help_open {
                append_slash_help_lines(&mut extra_lines, below_area.width);
            }
            if !extra_lines.is_empty() {
                let scroll_y = app.assistant.stream_scroll;
                frame.render_widget(
                    Paragraph::new(extra_lines)
                        .wrap(Wrap { trim: false })
                        .scroll((scroll_y, 0)),
                    below_area,
                );
            }
        }
    }
}

fn append_slash_help_lines(lines: &mut Vec<Line<'static>>, width: u16) {
    lines.push(section_rule("Commands & Shortcuts", width));
    let items = [
        (
            "/project [name]",
            "Switch active project scope (or cycle without args)",
        ),
        (
            "/mode [brief|update]",
            "Toggle research brief or project update mode",
        ),
        ("/tasks", "Open tasks list & run history (Tab 2)"),
        ("/projects", "Manage projects & folder grants (Tab 3)"),
        (
            "/memory",
            "View memory proposals & Markdown entries (Tab 4)",
        ),
        ("/routines", "Manage weekly planning routines (Tab 5)"),
        (
            "/settings",
            "Configure providers, DPAPI key & export folders (Tab 6)",
        ),
        ("/clear", "Clear session stream & scroll offset"),
        ("/cancel", "Cancel the currently running task"),
        ("Shift+Enter", "Insert newline in prompt"),
        (
            "Tab / Shift+Tab",
            "Cycle project scope / toggle brief vs update",
        ),
        (
            "Ctrl+A",
            "Toggle advanced composer (constraints & starting URLs)",
        ),
    ];
    for (cmd, desc) in items {
        lines.push(Line::from(vec![
            Span::styled(
                format!("  {cmd:<22}"),
                Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(desc, muted()),
        ]));
    }
    lines.push(Line::from(""));
}

/// Renders the Claude Code / Codex CLI hairline prompt input at the bottom.
fn render_assistant_composer(app: &mut App, frame: &mut Frame, area: Rect) {
    if area.height < 3 || area.width < 8 {
        return;
    }

    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(area);

    // Top hairline rule
    frame.render_widget(Paragraph::new(hairline(rows[0].width)), rows[0]);

    // Input row: ` ❯ ` gutter + borderless TextArea
    let input_cols = Layout::horizontal([Constraint::Length(4), Constraint::Min(4)]).split(rows[1]);
    let prompt_gutter = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled("❯", accent_bold()),
        Span::raw(" "),
    ]));
    frame.render_widget(prompt_gutter, input_cols[0]);

    app.assistant.request.set_block(Block::default());
    app.assistant
        .request
        .set_cursor_line_style(Style::default());
    app.assistant
        .request
        .set_placeholder_text("Ask anything, or type / for commands…");
    app.assistant
        .request
        .set_placeholder_style(Style::default().fg(ICE_DIM));
    frame.render_widget(&app.assistant.request, input_cols[1]);

    // Bottom hairline rule with right-aligned mode/scope pill
    let project_name = app
        .assistant
        .project_idx
        .and_then(|idx| app.assistant.projects.get(idx))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "global".to_string());
    let mode_name = if app.assistant.kind_project_update {
        "project update"
    } else {
        "research brief"
    };
    let badge = format!(" {mode_name} • {project_name} • Ctrl+A options ");
    let badge_w = badge.chars().count();
    let total_w = rows[2].width as usize;

    if total_w > badge_w + 4 {
        let rule_len = total_w - badge_w - 1;
        let line = Line::from(vec![
            Span::styled("─".repeat(rule_len), hairline_style()),
            Span::styled(badge, pill(ICE_BRIGHT, SURFACE_PILL)),
            Span::styled("─", hairline_style()),
        ]);
        frame.render_widget(Paragraph::new(line), rows[2]);
    } else {
        frame.render_widget(Paragraph::new(hairline(rows[2].width)), rows[2]);
    }
}

/// Floating popup above the composer when typing `/...`.
fn render_slash_autocomplete(app: &App, frame: &mut Frame, stream_area: Rect) {
    let matches = app.assistant.matching_slash_commands();
    if matches.is_empty() || stream_area.height < 5 || stream_area.width < 28 {
        return;
    }

    let max_visible = matches.len().min(7);
    let popup_height = (max_visible as u16) + 3; // top/bottom border + footer hint
    let popup_width = 68u16.min(stream_area.width.saturating_sub(4));
    let popup = Rect {
        x: stream_area.x + 2,
        y: (stream_area.y + stream_area.height).saturating_sub(popup_height),
        width: popup_width,
        height: popup_height,
    };

    frame.render_widget(Clear, popup);

    let selected = app
        .assistant
        .slash_selected
        .min(matches.len().saturating_sub(1));
    let start = selected.saturating_sub(max_visible.saturating_sub(1));
    let end = (start + max_visible).min(matches.len());

    let mut lines: Vec<Line<'static>> = Vec::with_capacity(max_visible + 1);
    for (offset, spec) in matches[start..end].iter().enumerate() {
        let idx = start + offset;
        let is_sel = idx == selected;
        let marker = if is_sel { " ▸ " } else { "   " };
        let row_bg = if is_sel {
            Style::default().bg(SURFACE_SEL)
        } else {
            Style::default()
        };
        let cmd_style = if is_sel {
            accent_bold().bg(SURFACE_SEL)
        } else {
            accent()
        };
        let args_style = if is_sel {
            Style::default().fg(ICE_DIM).bg(SURFACE_SEL)
        } else {
            Style::default().fg(ICE_DIM)
        };
        let desc_style = if is_sel {
            frost_glow().bg(SURFACE_SEL)
        } else {
            muted()
        };

        let cmd_col = format!("{:<10}", spec.name);
        let args_col = format!("{:<15}", spec.args_hint);
        lines.push(Line::from(vec![
            Span::styled(marker, cmd_style),
            Span::styled(cmd_col, cmd_style),
            Span::styled(args_col, args_style),
            Span::styled(spec.description, desc_style),
            Span::styled(" ", row_bg),
        ]));
    }

    lines.push(Line::styled(
        "  ↑↓ select • Tab complete • Enter run • Esc close",
        muted(),
    ));

    let popup_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(ICE_MID))
        .title(Span::styled(" Commands ", accent_bold()));

    frame.render_widget(Paragraph::new(lines).block(popup_block), popup);
}

fn composer_row(frame: &mut Frame, area: Rect, label: &str, focused: bool) {
    let style = if focused { accent_bold() } else { muted() };
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

    app.assistant.request.set_block(rounded_block_focused(
        "Request (Ctrl+S queue, Tab next, Ctrl+A close)",
        focus == ComposerField::Request,
    ));
    frame.render_widget(&app.assistant.request, rows[row]);
    row += 1;

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
        app.assistant.title.set_block(rounded_block_focused(
            "Title (optional)",
            focus == ComposerField::Title,
        ));
        frame.render_widget(&app.assistant.title, rows[row]);
        row += 1;

        app.assistant.constraints.set_block(rounded_block_focused(
            "Constraints (optional)",
            focus == ComposerField::Constraints,
        ));
        frame.render_widget(&app.assistant.constraints, rows[row]);
        row += 1;

        app.assistant.starting_urls.set_block(rounded_block_focused(
            "Starting URLs (optional, space/comma separated)",
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
    let label_style = if focused { accent_bold() } else { muted() };
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
        Constraint::Length(app.assistant.approvals.len().min(3) as u16 * 2 + 2),
        Constraint::Length(
            app.assistant
                .routines
                .iter()
                .map(|r| r.missedCount)
                .sum::<i64>()
                .min(3) as u16
                + 2,
        ),
        Constraint::Min(3),
    ])
    .split(area);
    let (approval_area, routine_area, activity_area) = (chunks[0], chunks[1], chunks[2]);

    // Pending export approvals.
    let mut approval_lines: Vec<Line> = Vec::new();
    for approval_item in app.assistant.approvals.iter().take(3) {
        approval_lines.push(Line::from(vec![
            Span::styled(" approval ", pill(FROST_GLOW, Color::Rgb(76, 29, 149))),
            Span::raw(" "),
            Span::styled(
                format!(
                    "{} → {} ({})",
                    approval_item.taskTitle.as_deref().unwrap_or("export"),
                    approval_item.approval.filename,
                    approval_item.approval.destinationPath
                ),
                Style::default(),
            ),
        ]));
        approval_lines.push(Line::styled(
            "   open in Tasks → Enter → g grant / d reject".to_string(),
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
        Paragraph::new(approval_lines).block(rounded_block("Approvals")),
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
            Span::styled(" missed ", pill(Color::Black, AMBER)),
            Span::raw(" "),
            Span::raw(routine.routine.name.clone()),
            Span::styled(
                format!(
                    "  ({} occurrence(s) — review in Routines)",
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
        Paragraph::new(routine_lines).block(rounded_block("Routines")),
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
            .block(rounded_block("Recent activity")),
        activity_area,
    );
}
