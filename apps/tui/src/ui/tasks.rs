use super::assistant::format_stream_event;
use super::{accent, block, kind_label, muted, selected_style};
use crate::app::{truncate, App, TaskDetailFocus, TaskDetailView, TaskFilter};
use crate::contracts::{ApprovalState, RunState, TaskDetail, TaskState};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_tasks(app: &mut App, frame: &mut Frame, area: Rect) {
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

    let has_artifact = detail.artifact.is_some();
    let vertical = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);

    let footer_text = if has_artifact {
        " b/Esc back | Tab switch focus | v toggle view (split/report/log) | c cancel | r retry | e export | j/k, PgUp/Dn scroll"
    } else {
        " b/Esc back | c cancel | r retry | e export | j/k, PgUp/Dn scroll"
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
    let block_style = if is_focused { accent() } else { muted() };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(block_style)
        .title(Span::styled(
            title,
            if is_focused {
                accent().add_modifier(Modifier::BOLD)
            } else {
                muted()
            },
        ));

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
                " g grant (approves exact content/dest) | d reject".to_string(),
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
        format!("Events ({})", detail.events.len()),
        accent().add_modifier(Modifier::BOLD),
    ));
    for event in &detail.events {
        lines.push(format_stream_event(event));
    }

    if detail.artifact.is_none()
        && task.resultArtifactId.is_none()
        && task.state == TaskState::Completed
    {
        lines.push(Line::from(""));
        lines.push(Line::styled("(no saved artifact)", muted()));
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

    let block_style = if is_focused { accent() } else { muted() };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(block_style)
        .title(Span::styled(
            title,
            if is_focused {
                accent().add_modifier(Modifier::BOLD)
            } else {
                muted()
            },
        ));

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
        Span::styled(
            task.title.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
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
            format!("Request: {}", truncate(&task.request, 120)),
            Style::default(),
        ));
    }
    if let Some(error) = &task.error {
        lines.push(Line::styled(
            format!("Error: {error}"),
            Style::default().fg(Color::Red),
        ));
    }
    if let Some(approval) = &detail.approval {
        lines.push(Line::from(vec![
            Span::styled("Approval: ", muted()),
            Span::styled(
                approval_state_label(&approval.state),
                approval_state_style(&approval.state),
            ),
            Span::raw(format!(" write \"{}\"", approval.filename)),
        ]));
    }
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(muted())
        .title(Span::styled("Task info (Tab/v: view log)", muted()));
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
