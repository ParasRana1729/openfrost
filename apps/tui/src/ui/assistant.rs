use super::mascot::{braille_spinner, compact_owl_lines, frost_spinner, mini_owl_spans};
use super::theme::{
    accent, accent_bold, approval, danger, frost_glow, hairline, hairline_style, ice_mid, muted,
    pill, primary_bold, rounded_block, rounded_block_focused, section_rule, success, warn, AMBER,
    FROST_GLOW, ICE_BRIGHT, ICE_DIM, ICE_MID, SLATE_BORDER, SURFACE_PILL, SURFACE_SEL, VIOLET,
};
use crate::app::{App, ComposerField};
use crate::contracts::{Event, TaskKind, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
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

fn humanize_token(raw: &str) -> String {
    raw.replace(['_', '.'], " ")
}

fn wrap_text_lines(text: &str, max_width: usize) -> Vec<String> {
    let width = max_width.max(12);
    let mut out = Vec::new();
    for raw_line in text.lines() {
        if raw_line.is_empty() {
            out.push(String::new());
            continue;
        }
        let mut current = String::new();
        let mut current_chars = 0usize;
        for word in raw_line.split_inclusive(' ') {
            let w_chars = word.chars().count();
            if current_chars > 0 && current_chars + w_chars > width {
                out.push(current.trim_end().to_string());
                current.clear();
                current_chars = 0;
            }
            if w_chars > width && current_chars == 0 {
                for ch in word.chars() {
                    if current_chars >= width {
                        out.push(std::mem::take(&mut current));
                        current_chars = 0;
                    }
                    current.push(ch);
                    current_chars += 1;
                }
            } else {
                current.push_str(word);
                current_chars += w_chars;
            }
        }
        if !current.is_empty() || out.is_empty() {
            out.push(current.trim_end().to_string());
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Coalesces back-to-back `run.*` + `task.*` terminal events (`run.failed`
/// followed immediately by `task.failed`, and similarly for `canceled` /
/// `interrupted`) so the stream never shows redundant duplicate lines.
fn coalesce_stream_events(events: &[Event]) -> Vec<&Event> {
    let mut out = Vec::with_capacity(events.len());
    for (idx, event) in events.iter().enumerate() {
        let next_kind = events.get(idx + 1).map(|e| e.kind.as_str());
        let redundant = matches!(
            (event.kind.as_str(), next_kind),
            ("run.failed", Some("task.failed"))
                | ("run.canceled", Some("task.canceled"))
                | ("run.interrupted", Some("task.interrupted"))
        );
        if !redundant {
            out.push(event);
        }
    }
    out
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
        "task.created" => {
            let kind_detail = event
                .payload
                .get("kind")
                .and_then(|v| v.as_str())
                .map(|k| format!("  ({})", humanize_token(k)))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("· ", ice_mid()),
                Span::styled("task created", Style::default().fg(ICE_DIM)),
                Span::styled(kind_detail, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "task.queued" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("◌ ", warn()),
            Span::styled("queued", frost_glow()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "task.requeued" => {
            let from_state = event
                .payload
                .get("fromState")
                .and_then(|v| v.as_str())
                .map(|s| format!("  (from {})", humanize_token(s)))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("◌ ", warn()),
                Span::styled("requeued", warn()),
                Span::styled(from_state, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "run.started" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("◆ ", accent_bold()),
            Span::styled("agent loop", accent_bold()),
            Span::styled("  initializing tools & context", muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "memory.used" => {
            let global_entries = event.payload.get("globalEntries").and_then(|v| v.as_i64());
            let project_entries = event.payload.get("projectEntries").and_then(|v| v.as_i64());
            let entry_count = event.payload.get("entryCount").and_then(|v| v.as_i64());
            let scope = event.payload.get("scope").and_then(|v| v.as_str());
            let truncated = event
                .payload
                .get("truncated")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let problems_count = event
                .payload
                .get("problems")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);

            let mut detail = if let Some(count) = entry_count {
                let noun = if count == 1 { "entry" } else { "entries" };
                let scope_part = scope.map(|s| format!(" ({s})")).unwrap_or_default();
                format!("  {count} {noun}{scope_part}")
            } else if global_entries.is_some() || project_entries.is_some() {
                let g = global_entries.unwrap_or(0);
                let p = project_entries.unwrap_or(0);
                if g > 0 && p > 0 {
                    format!("  {g} global, {p} project")
                } else {
                    let total = g + p;
                    let noun = if total == 1 { "entry" } else { "entries" };
                    format!("  {total} {noun}")
                }
            } else {
                " loaded".to_string()
            };

            if truncated {
                detail.push_str(" · truncated");
            }
            if problems_count > 0 {
                let noun = if problems_count == 1 {
                    "warning"
                } else {
                    "warnings"
                };
                detail.push_str(&format!(" · {problems_count} {noun}"));
            }

            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("◈ ", ice_mid()),
                Span::styled("memory context", frost_glow()),
                Span::styled(detail, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "memory.proposed" => {
            let scope = event
                .payload
                .get("scope")
                .and_then(|v| v.as_str())
                .map(|s| format!("  ({s})"))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("◈ ", ice_mid()),
                Span::styled("memory proposed", ice_mid()),
                Span::styled(scope, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "memory.proposal_blocked" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("× ", warn()),
            Span::styled("memory proposal blocked", warn()),
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
                "propose_memory" => {
                    if ok {
                        "proposed durable memory entry".to_string()
                    } else {
                        "memory proposal blocked".to_string()
                    }
                }
                _ => duration.map(|d| format!("{d}ms")).unwrap_or_default(),
            };

            let (dot, dot_style) = if ok {
                ("● ", success())
            } else {
                ("× ", danger())
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
        "run.limit_reached" => {
            let limit_detail = event
                .payload
                .get("limitHit")
                .and_then(|v| v.as_str())
                .map(|limit| {
                    let label = match limit {
                        "max_steps" => "max steps".to_string(),
                        "wall_clock" => "wall clock".to_string(),
                        "max_input" => "input limit".to_string(),
                        "max_output" => "output limit".to_string(),
                        other => humanize_token(other),
                    };
                    format!("  ({label})")
                })
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("× ", warn().add_modifier(Modifier::BOLD)),
                Span::styled("run limit reached", warn().add_modifier(Modifier::BOLD)),
                Span::styled(limit_detail, muted()),
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
            Span::styled("✓ ", success().add_modifier(Modifier::BOLD)),
            Span::styled("completed", success().add_modifier(Modifier::BOLD)),
            Span::styled("  report saved", muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "run.failed" => {
            let reason = event
                .payload
                .get("code")
                .or_else(|| event.payload.get("reason"))
                .and_then(|v| v.as_str())
                .map(|s| format!("  ({})", humanize_token(s)))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("× ", danger()),
                Span::styled("run stopped", danger()),
                Span::styled(reason, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "task.failed" => {
            let code = event
                .payload
                .get("code")
                .and_then(|v| v.as_str())
                .map(|s| format!("  ({})", humanize_token(s)))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("× ", danger().add_modifier(Modifier::BOLD)),
                Span::styled("task failed", danger().add_modifier(Modifier::BOLD)),
                Span::styled(code, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "run.canceled" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("⊘ ", muted()),
            Span::styled("run canceled", muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "task.canceled" => {
            let reason = event
                .payload
                .get("reason")
                .and_then(|v| v.as_str())
                .map(|s| format!("  ({})", humanize_token(s)))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(branch, hairline_style()),
                Span::styled("⊘ ", muted()),
                Span::styled("task canceled", muted()),
                Span::styled(reason, muted()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        "run.interrupted" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("‖ ", warn()),
            Span::styled("run interrupted", warn()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "task.interrupted" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("‖ ", warn()),
            Span::styled("task interrupted", warn()),
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
            Span::styled("✓ ", success()),
            Span::styled("export approval granted", success()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "approval.rejected" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("× ", danger()),
            Span::styled("export approval rejected", danger()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "approval.canceled" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("⊘ ", muted()),
            Span::styled("export approval canceled", muted()),
            Span::styled(format!("  {time}"), muted()),
        ]),
        "approval.expired" => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("◌ ", warn()),
            Span::styled("export approval expired", warn()),
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
                Span::styled("✓ ", success()),
                Span::styled(format!("exported → {file}"), success()),
                Span::styled(format!("  {time}"), muted()),
            ])
        }
        _ => Line::from(vec![
            Span::styled(branch, hairline_style()),
            Span::styled("· ", muted()),
            Span::styled(humanize_token(&event.kind), muted()),
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
            Span::styled(" APPROVAL PENDING ", pill(VIOLET, SURFACE_SEL)),
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
            Span::styled(" MISSED ROUTINE ", pill(AMBER, SURFACE_SEL)),
            Span::raw(" "),
            Span::styled(routine.routine.name.clone(), primary_bold()),
            Span::styled(
                format!("  ({} missed · /routines)", routine.missedCount),
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
            TaskState::Completed => ("✓", "completed", success().add_modifier(Modifier::BOLD)),
            TaskState::Failed => ("×", "failed", danger().add_modifier(Modifier::BOLD)),
            TaskState::Canceled => ("⊘", "canceled", muted()),
            TaskState::Interrupted => ("‖", "interrupted", warn()),
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

        // Claude/Codex-style user prompt header with left accent rail + surface band
        let prompt_text = if !task.request.is_empty() {
            task.request.as_str()
        } else {
            task.title.as_str()
        };
        let band_width = (area.width as usize).saturating_sub(4).max(20);
        let content_width = band_width.saturating_sub(4).max(12);
        let wrapped_prompt = wrap_text_lines(prompt_text, content_width);
        let band_bg = Style::default().bg(SURFACE_PILL);
        for (idx, prompt_line) in wrapped_prompt.into_iter().enumerate() {
            let prefix = if idx == 0 { " ❯ " } else { "   " };
            let text_style = if idx == 0 {
                frost_glow().add_modifier(Modifier::BOLD).bg(SURFACE_PILL)
            } else {
                frost_glow().bg(SURFACE_PILL)
            };
            let prefix_style = if idx == 0 {
                accent_bold().bg(SURFACE_PILL)
            } else {
                band_bg
            };
            let used = 3 + prompt_line.chars().count();
            let pad = band_width.saturating_sub(used);
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled("▌", accent()),
                Span::styled(prefix, prefix_style),
                Span::styled(prompt_line, text_style),
                Span::styled(" ".repeat(pad), band_bg),
            ]));
        }
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(format!("{state_icon} {state_label}"), state_style),
            Span::styled(format!("  ·  {kind_str}  ·  {project_name}"), muted()),
        ]));

        // Live execution tree (with redundant run.* + task.* pairs coalesced)
        let visible_events = coalesce_stream_events(&detail.events);
        if !visible_events.is_empty() {
            lines.push(Line::from(""));
            let last_idx = visible_events.len().saturating_sub(1);
            for (idx, event) in visible_events.iter().enumerate() {
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
            let err_width = (area.width as usize).saturating_sub(8).max(20);
            for (idx, err_line) in wrap_text_lines(err, err_width).into_iter().enumerate() {
                if idx == 0 {
                    lines.push(Line::from(vec![
                        Span::styled("  │ ", danger()),
                        Span::styled("× ", danger().add_modifier(Modifier::BOLD)),
                        Span::styled(err_line, danger()),
                    ]));
                } else {
                    lines.push(Line::from(vec![
                        Span::styled("  │   ", danger()),
                        Span::styled(err_line, danger()),
                    ]));
                }
            }
            if is_openrouter_credits_error(err) {
                lines.push(Line::from(vec![
                    Span::styled("  │   ", hairline_style()),
                    Span::styled(
                        "Tip: press Tab 6 (Settings) -> m to switch to openrouter/free or check credits",
                        muted(),
                    ),
                ]));
            }
            lines.push(Line::from(""));
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
    let card_height = 10u16.min(area.height.saturating_sub(1));

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
            .title(Span::styled(" ✦ OpenFrost v0.1 ", accent_bold()));
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
            y: cols[1].y + usize::from(inner.height >= 8) as u16,
            width: cols[1].width.saturating_sub(2),
            height: cols[1]
                .height
                .saturating_sub(usize::from(inner.height >= 8) as u16),
        };
        let rule_w = (info_rect.width as usize).saturating_sub(1).min(52);
        let hero_lines = vec![
            Line::from(vec![
                Span::styled("Welcome back", frost_glow().add_modifier(Modifier::BOLD)),
                Span::styled("  ·  Personal AI OS", muted()),
            ]),
            Line::from(vec![
                Span::styled("Provider  ", muted()),
                Span::styled(provider_name, frost_glow().add_modifier(Modifier::BOLD)),
                Span::styled("  ·  ", hairline_style()),
                Span::styled(model_name, ice_mid()),
            ]),
            Line::from(vec![
                Span::styled("Scope     ", muted()),
                Span::styled(project_name, frost_glow()),
                Span::styled("  ·  ", hairline_style()),
                Span::styled(mode_name, accent()),
            ]),
            Line::styled("─".repeat(rule_w), hairline_style()),
            Line::from(vec![
                Span::styled("Type below, or ", muted()),
                Span::styled("/", accent_bold()),
                Span::styled(" commands  ·  ", muted()),
                Span::styled("Tab", accent()),
                Span::styled(" scope  ·  ", muted()),
                Span::styled("Shift+Tab", accent()),
                Span::styled(" mode", muted()),
            ]),
            Line::from(vec![
                Span::styled("Shift+Enter", accent()),
                Span::styled(" newline  ·  ", muted()),
                Span::styled("Ctrl+A", accent()),
                Span::styled(" options  ·  ", muted()),
                Span::styled("Ctrl+P", accent()),
                Span::styled(" views", muted()),
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
                    Span::styled(" APPROVAL PENDING ", pill(VIOLET, SURFACE_SEL)),
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
                    Span::styled(" MISSED ROUTINE ", pill(AMBER, SURFACE_SEL)),
                    Span::raw(" "),
                    Span::styled(routine.routine.name.clone(), primary_bold()),
                    Span::styled(
                        format!("  ({} missed · /routines)", routine.missedCount),
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

    // Input row: subtle dark surface band (`SURFACE_PILL`) with ` ❯ ` gutter + borderless TextArea
    let input_bg = Style::default().bg(SURFACE_PILL);
    let input_cols = Layout::horizontal([Constraint::Length(4), Constraint::Min(4)]).split(rows[1]);
    let prompt_gutter = Paragraph::new(Line::from(vec![
        Span::styled(" ", input_bg),
        Span::styled("❯", accent_bold().bg(SURFACE_PILL)),
        Span::styled("  ", input_bg),
    ]))
    .style(input_bg);
    frame.render_widget(prompt_gutter, input_cols[0]);

    app.assistant
        .request
        .set_block(Block::default().style(input_bg));
    app.assistant
        .request
        .set_style(Style::default().fg(FROST_GLOW).bg(SURFACE_PILL));
    app.assistant.request.set_cursor_line_style(input_bg);
    app.assistant
        .request
        .set_placeholder_text("Ask anything, or type / for commands…");
    app.assistant
        .request
        .set_placeholder_style(Style::default().fg(ICE_DIM).bg(SURFACE_PILL));
    frame.render_widget(&app.assistant.request, input_cols[1]);

    // Bottom hairline rule with subtle right-aligned mode/scope text (no background block)
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
    let meta_text = format!(" {mode_name} · {project_name} · Ctrl+A options ");
    let meta_w = meta_text.chars().count();
    let total_w = rows[2].width as usize;

    if total_w > meta_w + 4 {
        let rule_len = total_w - meta_w - 2;
        let line = Line::from(vec![
            Span::styled("─".repeat(rule_len), hairline_style()),
            Span::raw(" "),
            Span::styled(mode_name, ice_mid()),
            Span::styled(" · ", muted()),
            Span::styled(project_name, Style::default().fg(ICE_DIM)),
            Span::styled(" · Ctrl+A options", muted()),
            Span::raw(" "),
            Span::styled("─".repeat(2), hairline_style()),
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
    let inner_w = popup_width.saturating_sub(2) as usize;

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
        let used_w = 3 + 10 + 15 + spec.description.chars().count();
        let pad_w = inner_w.saturating_sub(used_w).max(1);
        lines.push(Line::from(vec![
            Span::styled(marker, cmd_style),
            Span::styled(cmd_col, cmd_style),
            Span::styled(args_col, args_style),
            Span::styled(spec.description, desc_style),
            Span::styled(" ".repeat(pad_w), row_bg),
        ]));
    }

    lines.push(Line::styled(
        "  ↑↓ select · Tab complete · Enter run · Esc close",
        muted(),
    ));

    let popup_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(ICE_MID))
        .title(Span::styled(" Commands ", accent_bold()));

    frame.render_widget(Paragraph::new(lines).block(popup_block), popup);
}

fn is_openrouter_credits_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("http 402")
        || lower.contains("status 402")
        || lower.contains("(402)")
        || (lower.contains("openrouter") && lower.contains("credit"))
        || lower.contains("insufficient credits")
        || lower.contains("more credits")
}

/// Computes `(request_min, title_len, constraints_len, urls_len)` for the
/// advanced composer (`Ctrl+A`). Each bordered input uses `Borders::ALL`
/// (+2 border rows), so normal terminals allocate `(4, 3, 4, 3)` giving
/// Title 1 inner row, Constraints 2 inner rows, and Starting URLs 1 inner row,
/// while tiny terminals clamp gracefully without starving Request.
fn advanced_composer_heights(total_height: u16) -> (u16, u16, u16, u16) {
    if total_height >= 17 {
        return (4, 3, 4, 3);
    }
    // Kind (1) + Project (1) + Footer (1) = 3 fixed rows.
    let req_min = total_height.saturating_sub(3).min(3);
    let budget = total_height.saturating_sub(3 + req_min);
    if budget >= 10 {
        (req_min, 3, 4, 3)
    } else if budget >= 9 {
        (req_min, 3, 3, 3)
    } else {
        let base = budget / 3;
        let rem = budget % 3;
        let title_h = base + u16::from(rem >= 2);
        let constraints_h = base + u16::from(rem >= 1);
        let urls_h = base;
        (req_min, title_h, constraints_h, urls_h)
    }
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

    let (req_min, title_h, constraints_h, urls_h) = advanced_composer_heights(area.height);
    let mut constraints = Vec::new();
    constraints.push(Constraint::Min(if app.assistant.advanced_open {
        req_min
    } else {
        4
    })); // request
    constraints.push(Constraint::Length(1)); // kind
    constraints.push(Constraint::Length(1)); // project
    if app.assistant.advanced_open {
        constraints.push(Constraint::Length(title_h)); // title
        constraints.push(Constraint::Length(constraints_h)); // constraints
        constraints.push(Constraint::Length(urls_h)); // urls
    }
    constraints.push(Constraint::Length(1)); // footer
    let rows = Layout::vertical(constraints).split(area);

    let focus = app.assistant.focus;
    let mut row = 0usize;

    app.assistant.request.set_block(rounded_block_focused(
        "Request (Ctrl+S queue, Tab next, Ctrl+A close)",
        focus == ComposerField::Request,
    ));
    if rows[row].height > 0 {
        frame.render_widget(&app.assistant.request, rows[row]);
    }
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
        if rows[row].height > 0 {
            frame.render_widget(&app.assistant.title, rows[row]);
        }
        row += 1;

        app.assistant.constraints.set_block(rounded_block_focused(
            "Constraints (optional)",
            focus == ComposerField::Constraints,
        ));
        if rows[row].height > 0 {
            frame.render_widget(&app.assistant.constraints, rows[row]);
        }
        row += 1;

        app.assistant.starting_urls.set_block(rounded_block_focused(
            "Starting URLs (optional, space/comma separated)",
            focus == ComposerField::StartingUrls,
        ));
        if rows[row].height > 0 {
            frame.render_widget(&app.assistant.starting_urls, rows[row]);
        }
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
            Span::styled(" approval ", pill(VIOLET, SURFACE_SEL)),
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
            Span::styled(" missed ", pill(AMBER, SURFACE_SEL)),
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
                Span::styled(humanize_token(&event.kind), accent()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};

    fn make_event(id: i64, kind: &str, payload: Value) -> Event {
        let map = match payload {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        Event {
            id,
            kind: kind.to_string(),
            taskId: Some("task-1".to_string()),
            runId: Some("run-1".to_string()),
            payload: map,
            createdAt: "2026-11-25T10:15:30Z".to_string(),
        }
    }

    #[test]
    fn formats_known_events_without_raw_dots_or_emoji_glitches() {
        let cases = vec![
            (
                make_event(1, "task.created", json!({ "kind": "research_brief" })),
                "task created",
            ),
            (
                make_event(
                    2,
                    "memory.used",
                    json!({ "globalEntries": 2, "projectEntries": 1, "truncated": false }),
                ),
                "2 global, 1 project",
            ),
            (
                make_event(
                    3,
                    "memory.used",
                    json!({ "entryCount": 3, "scope": "project", "truncated": true }),
                ),
                "3 entries (project) · truncated",
            ),
            (
                make_event(4, "run.limit_reached", json!({ "limitHit": "max_steps" })),
                "run limit reached",
            ),
            (
                make_event(5, "run.failed", json!({ "code": "provider_error" })),
                "run stopped",
            ),
            (
                make_event(6, "task.failed", json!({ "code": "provider_error" })),
                "task failed",
            ),
            (make_event(7, "task.completed", json!({})), "✓ completed"),
        ];

        for (event, expected_substr) in cases {
            let rendered = format_stream_event_branch(&event, false).to_string();
            assert!(
                rendered.contains(expected_substr),
                "expected `{expected_substr}` in `{rendered}`"
            );
            for forbidden in ['❄', '✖', '✔', '⏸'] {
                assert!(
                    !rendered.contains(forbidden),
                    "unexpected emoji glyph `{forbidden}` in `{rendered}`"
                );
            }
        }
    }

    #[test]
    fn coalesces_redundant_terminal_run_and_task_events() {
        let events = vec![
            make_event(1, "task.created", json!({})),
            make_event(2, "run.started", json!({})),
            make_event(3, "run.failed", json!({})),
            make_event(4, "task.failed", json!({ "code": "provider_error" })),
        ];
        let coalesced = coalesce_stream_events(&events);
        let kinds: Vec<&str> = coalesced.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["task.created", "run.started", "task.failed"]);
    }

    #[test]
    fn advanced_composer_shows_inner_lines_for_title_constraints_and_urls() {
        use crate::api::ApiClient;
        use crate::app::{Screen, Tab, TextArea};
        use ratatui::backend::TestBackend;
        use ratatui::Terminal;
        use tokio::sync::mpsc;

        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Assistant;
        app.assistant.advanced_open = true;
        app.assistant.request = TextArea::new(vec!["Compare SQLite WAL modes".to_string()]);
        app.assistant.title = TextArea::new(vec!["SQLite WAL Brief".to_string()]);
        app.assistant.constraints = TextArea::new(vec![
            "Line 1: cite benchmarks".to_string(),
            "Line 2: stay concise".to_string(),
        ]);
        app.assistant.starting_urls =
            TextArea::new(vec!["https://sqlite.org/wal.html".to_string()]);

        // Normal viewport: every bordered advanced field gets 1-2 visible inner lines.
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
        let content: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            content.contains("SQLite WAL Brief"),
            "missing Title input in: {content}"
        );
        assert!(content.contains("Line 1: cite benchmarks"));
        assert!(content.contains("Line 2: stay concise"));
        assert!(content.contains("https://sqlite.org/wal.html"));

        // Tiny terminal viewport clamps gracefully without panicking.
        let tiny_backend = TestBackend::new(60, 12);
        let mut tiny_terminal = Terminal::new(tiny_backend).unwrap();
        tiny_terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
    }

    #[test]
    fn error_rendering_shows_402_tip_only_for_402_or_credits_errors() {
        use crate::api::ApiClient;
        use crate::app::{Screen, Tab};
        use crate::contracts::{Task, TaskDetail};
        use ratatui::backend::TestBackend;
        use ratatui::Terminal;
        use tokio::sync::mpsc;

        fn render_error(error_msg: &str) -> String {
            let (tx, _rx) = mpsc::unbounded_channel();
            let api = ApiClient::new("http://127.0.0.1:0").unwrap();
            let mut app = App::new(tx, api);
            app.screen = Screen::Main;
            app.tab = Tab::Assistant;
            app.assistant.active_task_detail = Some(TaskDetail {
                task: Task {
                    id: "t1".to_string(),
                    title: "Test".to_string(),
                    request: "Test request".to_string(),
                    constraints: None,
                    startingUrls: None,
                    projectId: None,
                    kind: TaskKind::ResearchBrief,
                    exportArgs: None,
                    routineId: None,
                    state: TaskState::Failed,
                    attemptCount: 1,
                    lastRunId: None,
                    resultArtifactId: None,
                    error: Some(error_msg.to_string()),
                    createdAt: "2026-11-25T00:00:00Z".to_string(),
                    updatedAt: "2026-11-25T00:00:00Z".to_string(),
                },
                runs: vec![],
                events: vec![],
                artifact: None,
                approval: None,
            });
            let backend = TestBackend::new(110, 24);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal
                .draw(|frame| crate::ui::render(&mut app, frame))
                .unwrap();
            terminal
                .backend()
                .buffer()
                .content()
                .iter()
                .map(|c| c.symbol())
                .collect()
        }

        let http_402 =
            render_error("OpenRouter API error (HTTP 402): This request requires more credits");
        assert!(http_402.contains(
            "Tip: press Tab 6 (Settings) -> m to switch to openrouter/free or check credits"
        ));

        let other_err = render_error("Upstream connection timed out");
        assert!(other_err.contains("Upstream connection timed out"));
        assert!(!other_err.contains("Tip: press Tab 6 (Settings)"));
    }
}
