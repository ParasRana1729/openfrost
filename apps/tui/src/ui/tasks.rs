use super::assistant::format_stream_event_branch_wrapped;
use super::kind_label;
use super::theme::{
    accent, accent_bold, approval, danger, display_width, frost_glow, hairline_style, ice_mid,
    muted, pill, primary_bold, rounded_block, rounded_block_focused, section_rule, selected_style,
    success, truncate_display_width, visual_line_count, warn, wrap_styled_spans, EMERALD,
    ICE_BRIGHT, ICE_DIM, MUTED, SURFACE_PILL, SURFACE_SEL, VIOLET,
};
use crate::app::{truncate, App, TaskDetailFocus, TaskDetailView, TaskFilter};
use crate::contracts::{ApprovalState, RunState, TaskDetail, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn keybind_footer(hints: &[(&str, &str)]) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = vec![Span::raw(" ")];
    for (idx, (key, label)) in hints.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::styled(" · ", hairline_style()));
        }
        spans.push(Span::styled((*key).to_string(), ice_mid()));
        spans.push(Span::styled(format!(" {label}"), muted()));
    }
    Line::from(spans)
}

fn keybind_footer_fitted(hints: &[(&str, &str)], max_width: usize) -> Line<'static> {
    if max_width == 0 {
        return Line::from("");
    }
    let mut spans: Vec<Span<'static>> = vec![Span::raw(" ")];
    let mut used = 1usize;
    for (idx, (key, label)) in hints.iter().enumerate() {
        let sep_w = if idx > 0 { 3 } else { 0 };
        let item_w = display_width(key) + 1 + display_width(label);
        if idx > 0 && used + sep_w + item_w > max_width {
            break;
        }
        if idx > 0 {
            spans.push(Span::styled(" · ", hairline_style()));
            used += sep_w;
        }
        if used + item_w <= max_width {
            spans.push(Span::styled((*key).to_string(), ice_mid()));
            spans.push(Span::styled(format!(" {label}"), muted()));
            used += item_w;
        } else {
            let rem = max_width.saturating_sub(used);
            let combined = format!("{key} {label}");
            spans.push(Span::styled(
                truncate_display_width(&combined, rem),
                muted(),
            ));
            break;
        }
    }
    Line::from(spans)
}

pub(super) fn empty_state_lines(
    headline: &str,
    sub: &str,
    hint: Option<&str>,
) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(""),
        Line::styled(
            format!("  {headline}"),
            frost_glow().add_modifier(Modifier::BOLD),
        ),
        Line::styled(format!("  {sub}"), muted()),
    ];
    if let Some(hint) = hint {
        lines.push(Line::styled(
            format!("  {hint}"),
            Style::default().fg(ICE_DIM),
        ));
    }
    lines
}

pub(super) fn render_tasks(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.tasks.searching {
        let chunks = Layout::vertical([Constraint::Length(3), Constraint::Min(3)]).split(area);
        app.tasks
            .search
            .set_block(rounded_block_focused("Search tasks", true));
        frame.render_widget(&app.tasks.search, chunks[0]);
        render_task_list(app, frame, chunks[1], false);
        return;
    }
    if app.tasks.detail_open {
        render_task_detail(app, frame, area);
        return;
    }
    render_task_list(app, frame, area, true);
}

fn render_task_list(app: &mut App, frame: &mut Frame, area: Rect, list_focused: bool) {
    let vertical = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(area);
    let (list_area, footer_area) = (vertical[0], vertical[1]);

    let visible = app.tasks.visible();
    let filter_counts = |filter: TaskFilter| {
        app.tasks
            .tasks
            .iter()
            .filter(|task| filter.matches(task))
            .count()
    };
    let query = app
        .tasks
        .search
        .lines()
        .first()
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    let query_suffix = if query.is_empty() {
        String::new()
    } else {
        format!("  ·  /{}", truncate(query, 24))
    };
    let title = format!(
        "Tasks · {}{}  ({} all · {} active · {} done · {} failed)",
        app.tasks.filter.label(),
        query_suffix,
        filter_counts(TaskFilter::All),
        filter_counts(TaskFilter::Active),
        filter_counts(TaskFilter::Done),
        filter_counts(TaskFilter::Failed),
    );
    let block = rounded_block_focused(&title, list_focused);

    if visible.is_empty() {
        let lines = if app.tasks.tasks.is_empty() {
            empty_state_lines(
                "No tasks yet",
                "Start a research brief or project update from the Assistant tab.",
                Some("Press 1 or Ctrl+P to switch to Assistant."),
            )
        } else {
            empty_state_lines(
                "No tasks match this view",
                "Adjust the filter or search query to see other tasks.",
                Some("Press f to cycle filters or / to edit search."),
            )
        };
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(block),
            list_area,
        );
    } else {
        let list_inner_w = list_area.width.saturating_sub(2) as usize;
        let items: Vec<ListItem> = visible
            .iter()
            .enumerate()
            .map(|(index, task)| {
                let is_sel = index == app.tasks.selected;
                let kind_suffix = format!("  ·  {}", kind_label(&task.kind));
                let attempts_suffix = if task.attemptCount > 1 {
                    format!(" · {}x", task.attemptCount)
                } else {
                    String::new()
                };
                let fixed_w =
                    3 + 11 + display_width(&kind_suffix) + display_width(&attempts_suffix);
                let rem_w = list_inner_w.saturating_sub(fixed_w);

                let (title_shown, err_shown) = if let Some(error) = &task.error {
                    let title_cap = if rem_w >= 20 {
                        ((rem_w * 55) / 100).clamp(10, 48).min(rem_w)
                    } else {
                        rem_w.max(6)
                    };
                    let title_str = truncate_display_width(&task.title, title_cap);
                    let used_title = display_width(&title_str);
                    let err_budget = rem_w.saturating_sub(used_title + 4);
                    let err_str = if err_budget >= 6 {
                        Some(truncate_display_width(error, err_budget.min(48)))
                    } else {
                        None
                    };
                    (title_str, err_str)
                } else {
                    (
                        truncate_display_width(&task.title, rem_w.clamp(8, 64)),
                        None,
                    )
                };

                let mut spans = vec![
                    Span::styled(
                        if is_sel { " ▸ " } else { "   " },
                        if is_sel { accent_bold() } else { muted() },
                    ),
                    Span::styled(
                        format!("{:<11}", task_state_short(&task.state)),
                        task_state_style(&task.state),
                    ),
                    Span::styled(title_shown, frost_glow()),
                    Span::styled(kind_suffix, Style::default().fg(ICE_DIM)),
                ];
                if !attempts_suffix.is_empty() {
                    spans.push(Span::styled(attempts_suffix, muted()));
                }
                if let Some(err_str) = err_shown {
                    spans.push(Span::styled(format!("  × {err_str}"), danger()));
                }
                if is_sel {
                    ListItem::new(Line::from(spans)).style(selected_style())
                } else {
                    ListItem::new(Line::from(spans))
                }
            })
            .collect();
        let mut list_state = ListState::default();
        list_state.select(Some(
            app.tasks.selected.min(visible.len().saturating_sub(1)),
        ));
        frame.render_stateful_widget(List::new(items).block(block), list_area, &mut list_state);
    }

    let footer = if app.tasks.searching {
        keybind_footer(&[("Enter", "apply"), ("Esc", "clear")])
    } else {
        let paused = app
            .tasks
            .executor
            .as_ref()
            .is_some_and(|exec| exec.dispatchPaused);
        if paused {
            keybind_footer(&[
                ("f", "filter"),
                ("/", "search"),
                ("Enter", "detail"),
                ("c", "cancel"),
                ("r", "retry"),
                ("R", "resume"),
                ("j/k", "move"),
            ])
        } else {
            keybind_footer(&[
                ("f", "filter"),
                ("/", "search"),
                ("Enter", "detail"),
                ("c", "cancel"),
                ("r", "retry"),
                ("j/k", "move"),
            ])
        }
    };
    frame.render_widget(footer, footer_area);
}

fn task_state_short(state: &TaskState) -> &'static str {
    match state {
        TaskState::Queued => "◌ queued",
        TaskState::Running => "✦ running",
        TaskState::AwaitingApproval => "◈ approval",
        TaskState::Completed => "✓ done",
        TaskState::Failed => "× failed",
        TaskState::Canceled => "⊘ canceled",
        TaskState::Interrupted => "‖ paused",
    }
}

fn task_state_style(state: &TaskState) -> Style {
    match state {
        TaskState::Queued => warn(),
        TaskState::Running => accent_bold(),
        TaskState::AwaitingApproval => approval().add_modifier(Modifier::BOLD),
        TaskState::Completed => success(),
        TaskState::Failed => danger(),
        TaskState::Canceled => muted(),
        TaskState::Interrupted => warn(),
    }
}

fn render_task_detail(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(detail) = &app.tasks.detail else {
        frame.render_widget(
            Paragraph::new("  Loading task detail…")
                .style(muted())
                .block(rounded_block("Task detail")),
            area,
        );
        return;
    };

    let has_artifact = detail.artifact.is_some();
    let has_exportable_artifact = detail.task.resultArtifactId.is_some();
    let pending_approval = detail
        .approval
        .as_ref()
        .is_some_and(|a| a.state == ApprovalState::Pending);
    let vertical = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    let mut hints: Vec<(&str, &str)> = vec![("b/Esc", "back")];
    if has_artifact {
        hints.push(("Tab", "focus"));
        hints.push(("v", "view"));
    }
    if pending_approval {
        hints.push(("g", "grant"));
        hints.push(("d", "reject"));
    }
    if matches!(
        detail.task.state,
        TaskState::Queued
            | TaskState::Running
            | TaskState::AwaitingApproval
            | TaskState::Interrupted
    ) {
        hints.push(("c", "cancel"));
    }
    if matches!(
        detail.task.state,
        TaskState::Failed | TaskState::Canceled | TaskState::Interrupted
    ) {
        hints.push(("r", "retry"));
    }
    if has_exportable_artifact && !pending_approval {
        hints.push(("e", "export"));
    }
    hints.push(("j/k", "scroll"));
    frame.render_widget(
        keybind_footer_fitted(&hints, footer_area.width as usize),
        footer_area,
    );

    if !has_artifact {
        render_task_detail_log(app, frame, content_area, true);
        return;
    }

    match app.tasks.detail_view {
        TaskDetailView::ReportOnly => {
            render_task_saved_report(app, frame, content_area, true, true);
        }
        TaskDetailView::LogOnly => {
            render_task_detail_log(app, frame, content_area, true);
        }
        TaskDetailView::Auto => {
            if content_area.width >= 90 {
                let left_width = 46.min(content_area.width / 2);
                let chunks =
                    Layout::horizontal([Constraint::Length(left_width), Constraint::Min(40)])
                        .split(content_area);
                let log_focused = app.tasks.detail_focus == TaskDetailFocus::Log;
                let report_focused = app.tasks.detail_focus == TaskDetailFocus::Report;
                render_task_detail_log(app, frame, chunks[0], log_focused);
                render_task_saved_report(app, frame, chunks[1], report_focused, false);
            } else {
                let summary_lines = build_task_compact_summary_lines(
                    detail,
                    content_area.width.saturating_sub(2) as usize,
                );
                let needed_h =
                    visual_line_count(&summary_lines, content_area.width.saturating_sub(2))
                        .saturating_add(2) as u16;
                let max_top = if content_area.height >= 12 {
                    (content_area.height / 2).max(5)
                } else {
                    (content_area.height / 3).max(3)
                };
                let top_height = needed_h.clamp(4, max_top);
                let chunks = Layout::vertical([Constraint::Length(top_height), Constraint::Min(6)])
                    .split(content_area);
                let block = rounded_block_focused("Task info (Tab/v: view log)", false);
                frame.render_widget(
                    Paragraph::new(summary_lines)
                        .wrap(Wrap { trim: false })
                        .block(block),
                    chunks[0],
                );
                let report_focused = true;
                render_task_saved_report(app, frame, chunks[1], report_focused, false);
            }
        }
    }
}

fn render_task_saved_report(
    app: &mut App,
    frame: &mut Frame,
    area: Rect,
    is_focused: bool,
    maximized: bool,
) {
    let Some(detail) = &app.tasks.detail else {
        return;
    };
    let Some(artifact) = &detail.artifact else {
        return;
    };

    let inner_w = area.width.saturating_sub(2);
    let inner_height = area.height.saturating_sub(2) as usize;
    let report_lines =
        crate::markdown::render_markdown_for_width(&artifact.markdown, inner_w as usize);
    let total_lines = visual_line_count(&report_lines, inner_w);
    let max_scroll = total_lines.saturating_sub(inner_height);
    let scroll_y = (app.tasks.artifact_scroll as usize).min(max_scroll) as u16;
    app.tasks.artifact_scroll = scroll_y;

    let scroll_info = if total_lines > inner_height {
        format!(" [{}/{}]", scroll_y + 1, total_lines)
    } else {
        String::new()
    };

    let view_hint = if maximized {
        " · split (v/Tab)"
    } else if is_focused {
        " · focused"
    } else {
        " · Tab to focus"
    };

    let title = format!("Saved Report{scroll_info}{view_hint}");
    let block = rounded_block_focused(&title, is_focused);

    frame.render_widget(
        Paragraph::new(report_lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0))
            .block(block),
        area,
    );
}

fn render_task_detail_log(app: &mut App, frame: &mut Frame, area: Rect, is_focused: bool) {
    let Some(detail) = &app.tasks.detail else {
        frame.render_widget(
            Paragraph::new("  Loading task detail…")
                .style(muted())
                .block(rounded_block("Task detail")),
            area,
        );
        return;
    };
    let inner_w = area.width.saturating_sub(2);
    let line_w = (inner_w as usize).max(1);
    let task = &detail.task;
    let mut lines: Vec<Line> = Vec::new();

    let state_pill = Span::styled(
        format!(" {} ", task_state_short(&task.state)),
        task_state_style(&task.state),
    );
    let title_cont = vec![Span::raw("   ")];
    lines.extend(wrap_styled_spans(
        &[Span::styled(
            task.title.clone(),
            frost_glow().add_modifier(Modifier::BOLD),
        )],
        &[state_pill, Span::raw(" ")],
        &title_cont,
        line_w,
    ));

    let meta_prefix = vec![Span::raw(" ")];
    let meta_spans = vec![
        Span::styled(
            format!(
                "{}  ·  attempts: {}",
                kind_label(&task.kind),
                task.attemptCount
            ),
            muted(),
        ),
        if let Some(project) = task.projectId.as_deref() {
            Span::styled(
                format!("  ·  project: {project}"),
                Style::default().fg(ICE_DIM),
            )
        } else {
            Span::styled("  ·  global scope", muted())
        },
    ];
    lines.extend(wrap_styled_spans(
        &meta_spans,
        &meta_prefix,
        &meta_prefix,
        line_w,
    ));

    let label_cont = if line_w >= 24 {
        vec![Span::raw("          ")]
    } else {
        vec![Span::raw("   ")]
    };
    if !task.request.is_empty() {
        lines.extend(wrap_styled_spans(
            &[Span::styled(task.request.clone(), frost_glow())],
            &[Span::styled(" Request: ", muted())],
            &label_cont,
            line_w,
        ));
    }
    if let Some(error) = &task.error {
        lines.extend(wrap_styled_spans(
            &[Span::styled(error.clone(), danger())],
            &[Span::styled(" × Error: ", danger())],
            &label_cont,
            line_w,
        ));
    }
    lines.push(Line::from(""));

    lines.push(section_rule("Runs", inner_w));
    if detail.runs.is_empty() {
        lines.push(Line::styled("   (no runs yet)", muted()));
    } else {
        let run_first = vec![Span::raw("   ")];
        let run_cont = vec![Span::raw("     ")];
        let fail_first = vec![Span::styled("     × ", danger())];
        let fail_cont = vec![Span::raw("       ")];
        for run in &detail.runs {
            let usage = run
                .usage
                .as_ref()
                .map(|usage| {
                    format!(
                        "  steps {} · in {} · out {}",
                        usage.steps, usage.inputChars, usage.outputChars
                    )
                })
                .unwrap_or_default();
            lines.extend(wrap_styled_spans(
                &[
                    Span::styled(format!("attempt {}  ", run.attempt), muted()),
                    Span::styled(run_state_label(&run.state), run_state_style(&run.state)),
                    Span::styled(usage, Style::default().fg(ICE_DIM)),
                ],
                &run_first,
                &run_cont,
                line_w,
            ));
            if let Some(failure) = &run.failure {
                lines.extend(wrap_styled_spans(
                    &[Span::styled(
                        format!("{} ({})", failure.code, failure.message),
                        danger(),
                    )],
                    &fail_first,
                    &fail_cont,
                    line_w,
                ));
            }
        }
    }
    lines.push(Line::from(""));

    if let Some(approval_item) = &detail.approval {
        lines.push(section_rule("Export approval", inner_w));
        let appr_first = vec![
            Span::raw("   "),
            Span::styled(
                format!(" {} ", approval_state_label(&approval_item.state)),
                approval_state_pill(&approval_item.state),
            ),
            Span::raw("  "),
        ];
        let appr_cont = vec![Span::raw("     ")];
        lines.extend(wrap_styled_spans(
            &[
                Span::styled(
                    format!(
                        "write \"{}\" into {}",
                        approval_item.filename, approval_item.destinationPath
                    ),
                    frost_glow(),
                ),
                Span::styled(format!("  (risk: {:?})", approval_item.riskTier), muted()),
            ],
            &appr_first,
            &appr_cont,
            line_w,
        ));
        if approval_item.state == ApprovalState::Pending {
            let hint_prefix = vec![Span::raw("   ")];
            lines.extend(wrap_styled_spans(
                &[Span::styled(
                    "g grant (approves exact content & destination) · d reject",
                    Style::default().fg(ICE_DIM),
                )],
                &hint_prefix,
                &hint_prefix,
                line_w,
            ));
        }
        if let Some(outcome) = &approval_item.outcome {
            let out_first = vec![Span::styled("   ✓ ", success())];
            let out_cont = vec![Span::raw("     ")];
            lines.extend(wrap_styled_spans(
                &[Span::styled(
                    format!(
                        "wrote {} bytes in {} ms → {}",
                        outcome.bytes, outcome.ms, outcome.file
                    ),
                    success(),
                )],
                &out_first,
                &out_cont,
                line_w,
            ));
        }
        if let Some(reason) = &approval_item.refusalReason {
            let ref_first = vec![Span::styled("   × refused: ", danger())];
            let ref_cont = vec![Span::raw("     ")];
            lines.extend(wrap_styled_spans(
                &[Span::styled(reason.clone(), danger())],
                &ref_first,
                &ref_cont,
                line_w,
            ));
        }
        lines.push(Line::from(""));
    }

    lines.push(section_rule(
        &format!("Events ({})", detail.events.len()),
        inner_w,
    ));
    let last_idx = detail.events.len().saturating_sub(1);
    for (idx, event) in detail.events.iter().enumerate() {
        lines.extend(format_stream_event_branch_wrapped(
            event,
            idx == last_idx,
            line_w,
        ));
    }

    if detail.artifact.is_none()
        && task.resultArtifactId.is_none()
        && task.state == TaskState::Completed
    {
        lines.push(Line::from(""));
        lines.push(Line::styled("   (no saved artifact)", muted()));
    }

    let total_lines = visual_line_count(&lines, inner_w);
    let inner_height = area.height.saturating_sub(2) as usize;
    let max_scroll = total_lines.saturating_sub(inner_height);
    let scroll_y = (app.tasks.log_scroll as usize).min(max_scroll) as u16;
    app.tasks.log_scroll = scroll_y;

    let scroll_info = if total_lines > inner_height {
        format!(" [{}/{}]", scroll_y + 1, total_lines)
    } else {
        String::new()
    };

    let title = if detail.artifact.is_some() {
        if is_focused {
            format!("Task detail{scroll_info} · focused")
        } else {
            format!("Task detail{scroll_info} · Tab to focus")
        }
    } else {
        format!("Task detail{scroll_info}")
    };

    let block = rounded_block_focused(&title, is_focused);

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll_y, 0))
            .block(block),
        area,
    );
}

fn build_task_compact_summary_lines(detail: &TaskDetail, line_w: usize) -> Vec<Line<'static>> {
    let w = line_w.max(1);
    let task = &detail.task;
    let mut lines = Vec::new();
    let head_first = vec![
        Span::styled(
            format!(" {} ", task_state_short(&task.state)),
            task_state_style(&task.state),
        ),
        Span::raw(" "),
    ];
    let head_cont = vec![Span::raw("   ")];
    lines.extend(wrap_styled_spans(
        &[
            Span::styled(task.title.clone(), primary_bold()),
            Span::styled(
                format!(
                    "  ·  {}  ·  attempts: {}  ·  events: {}",
                    kind_label(&task.kind),
                    task.attemptCount,
                    detail.events.len()
                ),
                muted(),
            ),
        ],
        &head_first,
        &head_cont,
        w,
    ));

    let label_cont = if w >= 24 {
        vec![Span::raw("          ")]
    } else {
        vec![Span::raw("   ")]
    };
    if !task.request.is_empty() {
        lines.extend(wrap_styled_spans(
            &[Span::styled(task.request.clone(), frost_glow())],
            &[Span::styled(" Request: ", muted())],
            &label_cont,
            w,
        ));
    }
    if let Some(error) = &task.error {
        lines.extend(wrap_styled_spans(
            &[Span::styled(error.clone(), danger())],
            &[Span::styled(" × Error: ", danger())],
            &label_cont,
            w,
        ));
    }
    if let Some(approval_item) = &detail.approval {
        let appr_first = vec![
            Span::styled(" Approval: ", muted()),
            Span::styled(
                format!(" {} ", approval_state_label(&approval_item.state)),
                approval_state_pill(&approval_item.state),
            ),
            Span::raw(" "),
        ];
        lines.extend(wrap_styled_spans(
            &[Span::styled(
                format!("write \"{}\"", approval_item.filename),
                frost_glow(),
            )],
            &appr_first,
            &label_cont,
            w,
        ));
    }
    lines
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
        RunState::Running => accent(),
        RunState::Completed => success(),
        RunState::Failed => danger(),
        RunState::Canceled => muted(),
        RunState::Interrupted => warn(),
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

fn approval_state_pill(state: &ApprovalState) -> Style {
    match state {
        ApprovalState::Pending => pill(VIOLET, SURFACE_SEL),
        ApprovalState::Granted => pill(ICE_BRIGHT, SURFACE_SEL),
        ApprovalState::Executed => pill(EMERALD, SURFACE_SEL),
        ApprovalState::Rejected | ApprovalState::Canceled | ApprovalState::Expired => {
            pill(MUTED, SURFACE_PILL)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::app::{Screen, Tab};
    use crate::contracts::{Approval, Event, RiskTier, Task, TaskDetailArtifact, TaskKind};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use serde_json::json;
    use tokio::sync::mpsc;

    fn make_task_app() -> App {
        let (tx, _rx) = mpsc::unbounded_channel();
        let api = ApiClient::new("http://127.0.0.1:0").unwrap();
        let mut app = App::new(tx, api);
        app.screen = Screen::Main;
        app.tab = Tab::Tasks;
        app.tasks.detail_open = true;
        app
    }

    #[test]
    fn task_detail_log_and_report_scroll_reach_true_bottom_when_wrapped() {
        let mut app = make_task_app();
        let mut md = String::from("# Report\n\n");
        for i in 1..=18 {
            md.push_str(&format!(
                "- Bullet item {i} with enough words to wrap inside a narrower split pane\n"
            ));
        }
        md.push_str("\nREPORT_END_SENTINEL");

        app.tasks.detail = Some(TaskDetail {
            task: Task {
                id: "t-1".to_string(),
                title: "Long Wrapped Task".to_string(),
                request: "A very long request string that wraps multiple visual lines in the split detail log pane to test visual line scroll clamping".to_string(),
                constraints: None,
                startingUrls: None,
                projectId: Some("proj-alpha".to_string()),
                kind: TaskKind::ExportReport,
                exportArgs: None,
                routineId: None,
                state: TaskState::Failed,
                attemptCount: 1,
                lastRunId: None,
                resultArtifactId: Some("art-1".to_string()),
                error: Some("Long error message describing an upstream failure that wraps onto several visual rows".to_string()),
                createdAt: "2026-11-26T00:00:00Z".to_string(),
                updatedAt: "2026-11-26T00:00:00Z".to_string(),
            },
            runs: vec![],
            events: vec![Event {
                id: 1,
                kind: "tool.executed".to_string(),
                taskId: Some("t-1".to_string()),
                runId: Some("r-1".to_string()),
                payload: serde_json::from_value(json!({
                    "tool": "web_search_skipped",
                    "ok": false,
                    "reason": "Long detail reason explaining why hosted web search was skipped and wrapping cleanly"
                }))
                .unwrap(),
                createdAt: "2026-11-26T10:15:30Z".to_string(),
            }],
            artifact: Some(TaskDetailArtifact {
                id: "art-1".to_string(),
                markdown: md,
            }),
            approval: Some(Approval {
                id: "ap-1".to_string(),
                taskId: "t-1".to_string(),
                runId: "r-1".to_string(),
                riskTier: RiskTier::Telegram,
                action: "export_report".to_string(),
                artifactId: "art-1".to_string(),
                destinationId: "dest-1".to_string(),
                destinationPath: "C:\\Users\\owner\\Documents\\OpenFrost\\exports\\very-long-report-filename.md".to_string(),
                filename: "very-long-report-filename.md".to_string(),
                contentSha256: "abc".to_string(),
                state: ApprovalState::Pending,
                requestedAt: "2026-11-26T00:00:00Z".to_string(),
                expiresAt: "2026-11-27T00:00:00Z".to_string(),
                decidedAt: None,
                executedAt: None,
                refusalReason: None,
                outcome: None,
            }),
        });
        app.tasks.artifact_scroll = u16::MAX;
        app.tasks.log_scroll = u16::MAX;

        let backend = TestBackend::new(96, 18);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();

        let rendered: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(
            rendered.contains("REPORT_END_SENTINEL"),
            "report scroll should reach true wrapped bottom: {rendered}"
        );
        assert!(
            rendered.contains("10:15:30"),
            "log scroll should reach final wrapped event line: {rendered}"
        );
        assert!(app.tasks.artifact_scroll < u16::MAX);
        assert!(app.tasks.log_scroll < u16::MAX);
    }

    #[test]
    fn narrow_40x16_task_detail_does_not_panic() {
        let mut app = make_task_app();
        app.tasks.detail = Some(TaskDetail {
            task: Task {
                id: "t-2".to_string(),
                title: "Narrow task".to_string(),
                request: "Long request on narrow 40x16 screen".to_string(),
                constraints: None,
                startingUrls: None,
                projectId: None,
                kind: TaskKind::ResearchBrief,
                exportArgs: None,
                routineId: None,
                state: TaskState::Completed,
                attemptCount: 1,
                lastRunId: None,
                resultArtifactId: Some("art-2".to_string()),
                error: None,
                createdAt: "2026-11-26T00:00:00Z".to_string(),
                updatedAt: "2026-11-26T00:00:00Z".to_string(),
            },
            runs: vec![],
            events: vec![],
            artifact: Some(TaskDetailArtifact {
                id: "art-2".to_string(),
                markdown: "# Heading\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"
                    .to_string(),
            }),
            approval: None,
        });

        let backend = TestBackend::new(40, 16);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::ui::render(&mut app, frame))
            .unwrap();
    }
}
