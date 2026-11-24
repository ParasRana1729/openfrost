use super::assistant::format_stream_event_branch;
use super::kind_label;
use super::theme::{
    accent, accent_bold, approval, danger, frost_glow, ice_mid, muted, primary_bold, rounded_block,
    rounded_block_focused, selected_style, success, warn,
};
use crate::app::{truncate, App, TaskDetailFocus, TaskDetailView, TaskFilter};
use crate::contracts::{ApprovalState, RunState, TaskDetail, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_tasks(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.tasks.searching {
        let chunks = Layout::vertical([Constraint::Length(3), Constraint::Min(3)]).split(area);
        app.tasks
            .search
            .set_block(rounded_block("Search (/ to focus, Enter apply, Esc clear)"));
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
            let is_sel = index == app.tasks.selected;
            let mut spans = vec![
                Span::styled(
                    if is_sel { " ▸ " } else { "   " },
                    if is_sel { accent_bold() } else { muted() },
                ),
                Span::styled(
                    format!("{:<9} ", task_state_short(&task.state)),
                    task_state_style(&task.state),
                ),
                Span::styled(truncate(&task.title, 48), frost_glow()),
                Span::styled(format!("  •  {}", kind_label(&task.kind)), ice_mid()),
            ];
            if let Some(error) = &task.error {
                spans.push(Span::styled(
                    format!("  ✖ {}", truncate(error, 40)),
                    danger(),
                ));
            }
            if is_sel {
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
        "Tasks — {}  •  f filter • / search • Enter detail • c cancel • r retry [{} all / {} active / {} done / {} failed]",
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
    frame.render_stateful_widget(
        List::new(items).block(rounded_block(&title)),
        area,
        &mut list_state,
    );
}

fn task_state_short(state: &TaskState) -> &'static str {
    match state {
        TaskState::Queued => "◌ queued",
        TaskState::Running => "✶ running",
        TaskState::AwaitingApproval => "◈ approval",
        TaskState::Completed => "✔ done",
        TaskState::Failed => "✖ failed",
        TaskState::Canceled => "⊘ canceled",
        TaskState::Interrupted => "⏸ intrpt",
    }
}

fn task_state_style(state: &TaskState) -> Style {
    match state {
        TaskState::Queued => warn(),
        TaskState::Running => accent_bold(),
        TaskState::AwaitingApproval => approval().add_modifier(Modifier::BOLD),
        TaskState::Completed => success(),
        TaskState::Failed => danger(),
        TaskState::Canceled | TaskState::Interrupted => muted(),
    }
}

fn render_task_detail(app: &mut App, frame: &mut Frame, area: Rect) {
    let Some(detail) = &app.tasks.detail else {
        frame.render_widget(
            Paragraph::new(" Loading…")
                .style(muted())
                .block(rounded_block("Task detail")),
            area,
        );
        return;
    };

    let has_artifact = detail.artifact.is_some();
    let vertical = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    let footer_text = if has_artifact {
        " b/Esc back • Tab switch focus • v toggle view (split/report/log) • c cancel • r retry • e export • j/k, PgUp/Dn scroll"
    } else {
        " b/Esc back • c cancel • r retry • e export • j/k, PgUp/Dn scroll"
    };
    frame.render_widget(Line::styled(footer_text, muted()), footer_area);

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
        " (v/Tab split)"
    } else if is_focused {
        " [Focused]"
    } else {
        " (Tab to focus)"
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
            Paragraph::new(" Loading…")
                .style(muted())
                .block(rounded_block("Task detail")),
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
            frost_glow().add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(
                "  •  {}  •  attempts: {}",
                kind_label(&task.kind),
                task.attemptCount
            ),
            muted(),
        ),
    ]));
    lines.push(Line::styled(
        format!(" Request: {}", truncate(&task.request, 160)),
        Style::default(),
    ));
    if let Some(error) = &task.error {
        lines.push(Line::styled(format!(" ✖ Error: {error}"), danger()));
    }
    if let Some(project) = task.projectId.as_deref() {
        lines.push(Line::styled(format!(" Project: {project}"), muted()));
    }
    lines.push(Line::from(""));

    lines.push(Line::styled(" Runs", accent_bold()));
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
            .map(|failure| format!(" – {} ({})", failure.code, failure.message))
            .unwrap_or_default();
        lines.push(Line::from(vec![
            Span::styled(format!("   attempt {} ", run.attempt), muted()),
            Span::styled(run_state_label(&run.state), run_state_style(&run.state)),
            Span::raw(usage),
            Span::styled(failure, danger()),
        ]));
    }
    lines.push(Line::from(""));

    if let Some(approval_item) = &detail.approval {
        lines.push(Line::styled(" Export approval", accent_bold()));
        lines.push(Line::from(vec![
            Span::styled(
                format!("   {} ", approval_state_label(&approval_item.state)),
                approval_state_style(&approval_item.state),
            ),
            Span::raw(format!(
                "write \"{}\" into {} (risk: {:?})",
                approval_item.filename, approval_item.destinationPath, approval_item.riskTier
            )),
        ]));
        if approval_item.state == ApprovalState::Pending {
            lines.push(Line::styled(
                "   g grant (approves exact content/dest) • d reject".to_string(),
                muted(),
            ));
        }
        if let Some(outcome) = &approval_item.outcome {
            lines.push(Line::styled(
                format!(
                    "   ✔ wrote {} bytes in {} ms → {}",
                    outcome.bytes, outcome.ms, outcome.file
                ),
                success(),
            ));
        }
        if let Some(reason) = &approval_item.refusalReason {
            lines.push(Line::styled(format!("   ✖ refused: {reason}"), danger()));
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::styled(
        format!(" Events ({})", detail.events.len()),
        accent_bold(),
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
        lines.push(Line::styled(" (no saved artifact)", muted()));
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
            format!("Task detail{scroll_info} [Focused]")
        } else {
            format!("Task detail{scroll_info} (Tab to focus)")
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
                "  {}  attempts: {}  events: {}",
                kind_label(&task.kind),
                task.attemptCount,
                detail.events.len()
            ),
            muted(),
        ),
    ]));
    if !task.request.is_empty() {
        lines.push(Line::styled(
            format!(" Request: {}", truncate(&task.request, 120)),
            Style::default(),
        ));
    }
    if let Some(error) = &task.error {
        lines.push(Line::styled(format!(" ✖ Error: {error}"), danger()));
    }
    if let Some(approval_item) = &detail.approval {
        lines.push(Line::from(vec![
            Span::styled(" Approval: ", muted()),
            Span::styled(
                approval_state_label(&approval_item.state),
                approval_state_style(&approval_item.state),
            ),
            Span::raw(format!(" write \"{}\"", approval_item.filename)),
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
        ApprovalState::Pending => approval(),
        ApprovalState::Granted => accent(),
        ApprovalState::Executed => success(),
        ApprovalState::Rejected | ApprovalState::Canceled | ApprovalState::Expired => muted(),
    }
}
