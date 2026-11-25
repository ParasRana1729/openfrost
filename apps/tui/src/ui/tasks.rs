use super::assistant::format_stream_event_branch;
use super::kind_label;
use super::theme::{
    accent, accent_bold, approval, danger, frost_glow, hairline_style, ice_mid, muted, pill,
    primary_bold, rounded_block, rounded_block_focused, section_rule, selected_style, success,
    warn, EMERALD, ICE_BRIGHT, ICE_DIM, MUTED, SURFACE_PILL, SURFACE_SEL, VIOLET,
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
        let items: Vec<ListItem> = visible
            .iter()
            .enumerate()
            .map(|(index, task)| {
                let is_sel = index == app.tasks.selected;
                let mut spans = vec![
                    Span::styled(
                        if is_sel { " ▸ " } else { "   " },
                        if is_sel { accent_bold() } else { muted() },
                    ),
                    Span::styled(
                        format!("{:<11}", task_state_short(&task.state)),
                        task_state_style(&task.state),
                    ),
                    Span::styled(truncate(&task.title, 48), frost_glow()),
                    Span::styled(
                        format!("  ·  {}", kind_label(&task.kind)),
                        Style::default().fg(ICE_DIM),
                    ),
                ];
                if task.attemptCount > 1 {
                    spans.push(Span::styled(format!(" · {}x", task.attemptCount), muted()));
                }
                if let Some(error) = &task.error {
                    spans.push(Span::styled(
                        format!("  × {}", truncate(error, 38)),
                        danger(),
                    ));
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
    frame.render_widget(keybind_footer(&hints), footer_area);

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
                let top_height = 7.min(content_area.height / 3);
                let chunks = Layout::vertical([Constraint::Length(top_height), Constraint::Min(6)])
                    .split(content_area);
                if let Some(detail) = &app.tasks.detail {
                    render_task_compact_summary(frame, chunks[0], detail);
                }
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

    let report_lines = crate::markdown::render_markdown(&artifact.markdown);
    let total_lines = report_lines.len();
    let inner_height = area.height.saturating_sub(2) as usize;
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
            frost_glow().add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(
            format!(
                " {}  ·  attempts: {}",
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
    ]));
    if !task.request.is_empty() {
        lines.push(Line::from(vec![
            Span::styled(" Request: ", muted()),
            Span::styled(truncate(&task.request, 160), frost_glow()),
        ]));
    }
    if let Some(error) = &task.error {
        lines.push(Line::styled(format!(" × Error: {error}"), danger()));
    }
    lines.push(Line::from(""));

    lines.push(section_rule("Runs", inner_w));
    if detail.runs.is_empty() {
        lines.push(Line::styled("   (no runs yet)", muted()));
    } else {
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
            let failure = run
                .failure
                .as_ref()
                .map(|failure| format!("  × {} ({})", failure.code, failure.message))
                .unwrap_or_default();
            lines.push(Line::from(vec![
                Span::styled(format!("   attempt {}  ", run.attempt), muted()),
                Span::styled(run_state_label(&run.state), run_state_style(&run.state)),
                Span::styled(usage, Style::default().fg(ICE_DIM)),
                Span::styled(failure, danger()),
            ]));
        }
    }
    lines.push(Line::from(""));

    if let Some(approval_item) = &detail.approval {
        lines.push(section_rule("Export approval", inner_w));
        lines.push(Line::from(vec![
            Span::raw("   "),
            Span::styled(
                format!(" {} ", approval_state_label(&approval_item.state)),
                approval_state_pill(&approval_item.state),
            ),
            Span::styled(
                format!(
                    "  write \"{}\" into {}",
                    approval_item.filename, approval_item.destinationPath
                ),
                frost_glow(),
            ),
            Span::styled(format!("  (risk: {:?})", approval_item.riskTier), muted()),
        ]));
        if approval_item.state == ApprovalState::Pending {
            lines.push(Line::styled(
                "   g grant (approves exact content & destination) · d reject",
                Style::default().fg(ICE_DIM),
            ));
        }
        if let Some(outcome) = &approval_item.outcome {
            lines.push(Line::styled(
                format!(
                    "   ✓ wrote {} bytes in {} ms → {}",
                    outcome.bytes, outcome.ms, outcome.file
                ),
                success(),
            ));
        }
        if let Some(reason) = &approval_item.refusalReason {
            lines.push(Line::styled(format!("   × refused: {reason}"), danger()));
        }
        lines.push(Line::from(""));
    }

    lines.push(section_rule(
        &format!("Events ({})", detail.events.len()),
        inner_w,
    ));
    let last_idx = detail.events.len().saturating_sub(1);
    for (idx, event) in detail.events.iter().enumerate() {
        lines.push(format_stream_event_branch(event, idx == last_idx));
    }

    if detail.artifact.is_none()
        && task.resultArtifactId.is_none()
        && task.state == TaskState::Completed
    {
        lines.push(Line::from(""));
        lines.push(Line::styled("   (no saved artifact)", muted()));
    }

    let total_lines = lines.len();
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

fn render_task_compact_summary(frame: &mut Frame, area: Rect, detail: &TaskDetail) {
    let task = &detail.task;
    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::styled(
            format!(" {} ", task_state_short(&task.state)),
            task_state_style(&task.state),
        ),
        Span::raw(" "),
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
    ]));
    if !task.request.is_empty() {
        lines.push(Line::from(vec![
            Span::styled(" Request: ", muted()),
            Span::styled(truncate(&task.request, 120), frost_glow()),
        ]));
    }
    if let Some(error) = &task.error {
        lines.push(Line::styled(format!(" × Error: {error}"), danger()));
    }
    if let Some(approval_item) = &detail.approval {
        lines.push(Line::from(vec![
            Span::styled(" Approval: ", muted()),
            Span::styled(
                format!(" {} ", approval_state_label(&approval_item.state)),
                approval_state_pill(&approval_item.state),
            ),
            Span::styled(
                format!(" write \"{}\"", approval_item.filename),
                frost_glow(),
            ),
        ]));
    }
    let block = rounded_block_focused("Task info (Tab/v: view log)", false);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block),
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
