'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task, Project, TaskState } from '@openfrost/domain';
import { formatTaskDuration, formatTimestamp, useElapsedTimer } from '../lib/format';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';

export type TaskFilter = 'all' | 'active' | 'queued' | 'done' | 'failed';

export interface TaskFeedProps {
  tasks: Task[];
  projects?: Project[];
  selectedTaskId?: string | null;
  onSelectTask?: (task: Task) => void;
  onCancelTask?: (taskId: string) => Promise<void> | void;
  onRetryTask?: (taskId: string) => Promise<void> | void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

const REQUEUEABLE: ReadonlySet<TaskState> = new Set(['failed', 'canceled', 'interrupted']);

function RunningDuration({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTimer(startedAt, true);
  return <span>running for {elapsed}</span>;
}

function TaskDurationDisplay({ task }: { task: Task }) {
  if (task.state === 'running') {
    return <RunningDuration startedAt={task.updatedAt} />;
  }
  return <span>{formatTaskDuration(task)}</span>;
}

export function TaskFeed({
  tasks,
  projects = [],
  selectedTaskId,
  onSelectTask,
  onCancelTask,
  onRetryTask,
  emptyTitle,
  emptyDescription,
  className = '',
}: TaskFeedProps) {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => {
    let active = 0;
    let queued = 0;
    let done = 0;
    let failed = 0;
    for (const t of tasks) {
      if (t.state === 'running' || t.state === 'awaiting_approval') active++;
      else if (t.state === 'queued') queued++;
      else if (t.state === 'completed') done++;
      else if (REQUEUEABLE.has(t.state)) failed++;
    }
    return { all: tasks.length, active, queued, done, failed };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Status filter
      if (filter === 'active' && task.state !== 'running' && task.state !== 'awaiting_approval') {
        return false;
      }
      if (filter === 'queued' && task.state !== 'queued') {
        return false;
      }
      if (filter === 'done' && task.state !== 'completed') {
        return false;
      }
      if (filter === 'failed' && !REQUEUEABLE.has(task.state)) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const titleMatch = task.title.toLowerCase().includes(q);
        const reqMatch = task.request.toLowerCase().includes(q);
        const errorMatch = task.error ? task.error.toLowerCase().includes(q) : false;
        if (!titleMatch && !reqMatch && !errorMatch) {
          return false;
        }
      }

      return true;
    });
  }, [tasks, filter, searchQuery]);

  const getProjectName = (projectId: string | null): string => {
    if (!projectId) return '';
    const proj = projects.find((p) => p.id === projectId);
    return proj ? proj.name : `${projectId.slice(0, 8)}…`;
  };

  return (
    <div className={`task-feed ${className}`.trim()}>
      {/* Controls Bar: Filters and Search */}
      <div className="task-feed-controls">
        <div className="task-feed-tabs" role="tablist" aria-label="Filter tasks by status">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`task-feed-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All <span className="tab-count">({counts.all})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'active'}
            className={`task-feed-tab ${filter === 'active' ? 'active' : ''}`}
            onClick={() => setFilter('active')}
          >
            Active <span className="tab-count">({counts.active})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'queued'}
            className={`task-feed-tab ${filter === 'queued' ? 'active' : ''}`}
            onClick={() => setFilter('queued')}
          >
            Queued <span className="tab-count">({counts.queued})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'done'}
            className={`task-feed-tab ${filter === 'done' ? 'active' : ''}`}
            onClick={() => setFilter('done')}
          >
            Done <span className="tab-count">({counts.done})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'failed'}
            className={`task-feed-tab ${filter === 'failed' ? 'active' : ''}`}
            onClick={() => setFilter('failed')}
          >
            Failed <span className="tab-count">({counts.failed})</span>
          </button>
        </div>

        <div className="task-feed-search">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks by title or request"
            className="task-feed-search-input"
          />
        </div>
      </div>

      {/* Task List or Empty State */}
      {tasks.length === 0 ? (
        <div className="task-feed-empty panel">
          <p className="empty-title">
            <strong>{emptyTitle ?? 'Nothing queued right now.'}</strong>
          </p>
          <p className="muted">
            {emptyDescription ??
              'Describe what the assistant should work on above, and it will run here — one task at a time.'}
          </p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="task-feed-empty panel">
          <p className="empty-title">
            <strong>No tasks match your filter.</strong>
          </p>
          <p className="muted">Try adjusting your status filter or clearing your search query.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilter('all');
              setSearchQuery('');
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : (
        <ul className="task-feed-list" role="list" aria-label="Tasks and activity feed">
          {filteredTasks.map((task) => {
            const isSelected = selectedTaskId === task.id;
            const projectName = getProjectName(task.projectId);
            const isRunning = task.state === 'running';
            const isQueuedOrRunning = task.state === 'queued' || isRunning;
            const isRequeueable = REQUEUEABLE.has(task.state);

            const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
              const target = e.target as HTMLElement | null;
              const interactiveChild = target?.closest(
                'button, a, input, select, textarea, [role="button"]',
              );
              if (interactiveChild) {
                return;
              }
              onSelectTask?.(task);
            };

            return (
              <li key={task.id} className="task-feed-item">
                <Card
                  variant="panel"
                  className={`task-row-card ${isSelected ? 'task-row-selected' : ''}`}
                  onClick={handleRowClick}
                >
                  <div className="task-row-main">
                    <div className="task-row-header">
                      <h3 className="task-row-heading">
                        <button
                          type="button"
                          className="task-row-title-btn"
                          onClick={() => onSelectTask?.(task)}
                          aria-haspopup="dialog"
                          aria-expanded={isSelected}
                          aria-label={`View run details for ${task.title}`}
                        >
                          {task.title}
                        </button>
                      </h3>

                      <div className="task-row-badges">
                        {/* StatusBadge with live pulse for running state */}
                        <StatusBadge state={task.state} pulse={isRunning} />

                        {/* Workflow Badge */}
                        {task.kind === 'research_brief' ? (
                          <span className="workflow-badge workflow-research-brief">
                            Research brief
                          </span>
                        ) : task.kind === 'project_update' ? (
                          <span className="workflow-badge workflow-project-update">
                            Project update
                          </span>
                        ) : task.kind === 'export_report' ? (
                          <span className="workflow-badge workflow-export-report">
                            Export
                          </span>
                        ) : task.kind === 'weekly_plan' ? (
                          <span className="workflow-badge workflow-weekly-plan">
                            Weekly plan
                          </span>
                        ) : null}

                        {/* Research Brief Starting URL Pill */}
                        {task.kind === 'research_brief' &&
                        task.startingUrls &&
                        task.startingUrls.length > 0 ? (
                          <span
                            className="workflow-badge-pill url-pill"
                            aria-label={`${task.startingUrls.length} starting URL${task.startingUrls.length > 1 ? 's' : ''}`}
                          >
                            🌐 {task.startingUrls.length}{' '}
                            {task.startingUrls.length === 1 ? 'URL' : 'URLs'}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="task-row-meta">
                      {/* Project Link if applicable */}
                      {task.projectId ? (
                        <span className="task-meta-item">
                          <Link
                            href={`/projects?id=${task.projectId}`}
                            className="project-badge-link"
                            aria-label={`Project: ${projectName}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            📁 {projectName}
                          </Link>
                        </span>
                      ) : null}

                      {/* Duration / Elapsed Display */}
                      <span className="task-meta-item task-duration">
                        ⏱ <TaskDurationDisplay task={task} />
                      </span>

                      {/* Timestamp */}
                      <span className="task-meta-item task-time" title={task.createdAt}>
                        Created {formatTimestamp(task.createdAt)}
                      </span>

                      {/* Attempt Count */}
                      {task.attemptCount > 1 ? (
                        <span className="task-meta-item task-attempts">
                          Attempt {task.attemptCount}
                        </span>
                      ) : null}

                      {/* Last error if present */}
                      {task.error ? (
                        <span className="task-meta-item task-error-snippet" title={task.error}>
                          Error: {task.error}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div className="task-row-actions">
                    {isQueuedOrRunning ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onCancelTask?.(task.id);
                        }}
                        aria-label={`Cancel task: ${task.title}`}
                      >
                        Cancel
                      </Button>
                    ) : null}

                    {isRequeueable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRetryTask?.(task.id);
                        }}
                        aria-label={`Retry task: ${task.title}`}
                      >
                        Retry
                      </Button>
                    ) : null}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTask?.(task);
                      }}
                      aria-label={`Details for task: ${task.title}`}
                    >
                      Details
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
