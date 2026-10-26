'use client';

import React, { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task, TaskKind } from '@openfrost/domain';
import { ApiError, mutate } from '../lib/api';
import { useSession } from '../lib/useSession';
import { useToast } from './ToastProvider';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';

export interface ProjectSummary {
  id: string;
  name: string;
  grants?: Array<{ id: string; path: string }> | unknown[];
  instructions?: string | null;
}

export interface TaskComposerInitialValues {
  kind?: 'research_brief' | 'project_update';
  title?: string;
  request?: string;
  projectId?: string;
  constraints?: string[] | string;
  startingUrls?: string[];
}

export interface TaskComposerProps {
  projects: ProjectSummary[];
  activeProjectId?: string | null;
  initialValues?: TaskComposerInitialValues;
  onSuccess?: (task: Task) => void;
  onCancel?: () => void;
  inline?: boolean;
  executorBusy?: boolean;
  csrfToken?: string;
  initialFocusRef?: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

const MAX_STARTING_URLS = 5;

/** The API requires a title; the composer derives one from the request if omitted. */
export function deriveTitle(request: string): string {
  const firstLine = request.trim().split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

export function TaskComposer({
  projects,
  activeProjectId,
  initialValues,
  onSuccess,
  onCancel,
  inline = true,
  executorBusy = false,
  csrfToken: propCsrfToken,
  initialFocusRef,
  className = '',
}: TaskComposerProps) {
  const { session } = useSession();
  const { showToast } = useToast();
  const csrf = propCsrfToken ?? session?.csrfToken ?? null;

  // Form state
  const [request, setRequest] = useState(initialValues?.request ?? '');
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [kind, setKind] = useState<TaskKind>(initialValues?.kind ?? 'research_brief');
  const [projectId, setProjectId] = useState(
    initialValues?.projectId ?? activeProjectId ?? '',
  );
  const [constraints, setConstraints] = useState(
    Array.isArray(initialValues?.constraints)
      ? initialValues.constraints.join('\n')
      : (initialValues?.constraints ?? ''),
  );
  const [startingUrlsText, setStartingUrlsText] = useState(
    initialValues?.startingUrls?.join('\n') ?? '',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Controlled disclosure for Advanced Options
  const hasAdvancedInitialValues = Boolean(
    initialValues?.constraints ||
      (initialValues?.startingUrls && initialValues.startingUrls.length > 0) ||
      initialValues?.title,
  );
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(hasAdvancedInitialValues);

  const requestId = useId();
  const titleId = useId();
  const constraintsId = useId();
  const urlsId = useId();
  const hintId = useId();

  // URL Parsing and Validation
  const parsedUrls = useMemo(() => {
    return startingUrlsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, [startingUrlsText]);

  const urlsValid = useMemo(() => {
    if (kind !== 'research_brief') return true;
    if (parsedUrls.length > MAX_STARTING_URLS) return false;
    return parsedUrls.every((url) => /^https?:\/\//i.test(url));
  }, [kind, parsedUrls]);

  const projectUpdateInvalid = kind === 'project_update' && projectId === '';
  const canSubmit =
    Boolean(csrf) &&
    request.trim().length > 0 &&
    !projectUpdateInvalid &&
    urlsValid &&
    !isSubmitting;

  // Dynamic Queue Hint Resolution
  const queueHint = useMemo(() => {
    if (!csrf) {
      return 'Checking your local session…';
    }
    if (request.trim().length === 0) {
      return 'Describe the work you need first.';
    }
    if (projectUpdateInvalid) {
      return projects.length === 0
        ? 'Create a project before preparing a project update.'
        : 'Choose a project to prepare its update.';
    }
    if (!urlsValid) {
      return parsedUrls.length > MAX_STARTING_URLS
        ? `At most ${MAX_STARTING_URLS} starting URLs are allowed (${parsedUrls.length} given).`
        : 'Fix the starting URLs before queuing this brief.';
    }
    if (executorBusy) {
      return 'The active run finishes first; this task will wait.';
    }
    return 'Ready to queue. The task runs in the background.';
  }, [
    csrf,
    request,
    projectUpdateInvalid,
    projects.length,
    urlsValid,
    parsedUrls.length,
    executorBusy,
  ]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSubmit || !csrf) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const effectiveTitle = title.trim().length > 0 ? title.trim() : deriveTitle(request);
    const body: {
      title: string;
      request: string;
      constraints?: string;
      startingUrls?: string[];
      projectId?: string;
      kind: TaskKind;
    } = {
      title: effectiveTitle,
      request: request.trim(),
      kind,
    };

    if (constraints.trim().length > 0) {
      body.constraints = constraints.trim();
    }
    if (kind === 'research_brief' && parsedUrls.length > 0) {
      body.startingUrls = parsedUrls;
    }
    if (projectId !== '') {
      body.projectId = projectId;
    }

    try {
      const response = await mutate<{ task: Task }>({
        method: 'POST',
        path: '/api/tasks',
        body,
        csrfToken: csrf,
      });

      // Reset form state
      setRequest('');
      setTitle('');
      setConstraints('');
      setStartingUrlsText('');
      setIsAdvancedOpen(false);

      showToast('success', 'Task added to the queue.');
      if (response?.task) {
        onSuccess?.(response.task);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create task';
      setSubmitError(message);
      showToast('error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (canSubmit && !isSubmitting) {
        e.preventDefault();
        void handleSubmit();
      }
    }
  };

  const containerClasses = [
    'composer',
    inline ? 'composer-inline' : 'composer-modal',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form className={containerClasses} onSubmit={handleSubmit} noValidate>
      {/* Explicit Title input in modal mode */}
      {!inline ? (
        <div className="composer-field-group">
          <label htmlFor={titleId}>Title (optional)</label>
          <input
            id={titleId}
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Descriptive title (auto-derived if left empty)"
            className="composer-title-input"
          />
        </div>
      ) : null}

      <div className="composer-field-group">
        <label htmlFor={requestId}>Task</label>
        <textarea
          ref={initialFocusRef}
          id={requestId}
          value={request}
          maxLength={20000}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the task — a question to research, or notes to turn into a project update. It runs in the background."
          rows={3}
          required
        />
      </div>

      <div className="composer-bar">
        <div className="composer-options">
          <div className="segmented composer-workflows" role="group" aria-label="Task workflow">
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={kind === 'research_brief'}
              onClick={() => setKind('research_brief')}
            >
              Research brief
            </button>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={kind === 'project_update'}
              onClick={() => setKind('project_update')}
            >
              Project update
            </button>
          </div>

          {kind === 'project_update' ? (
            <select
              aria-label="Project for update"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="composer-project-select"
            >
              <option value="">Choose project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="composer-primary-action">
          <span className="queue-hint" id={hintId} aria-live="polite">
            {queueHint}
          </span>

          {onCancel ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canSubmit || isSubmitting}
            loading={isSubmitting}
            loadingText="Queuing…"
            aria-describedby={hintId}
          >
            Queue task
          </Button>
        </div>
      </div>

      <Disclosure
        variant="subtle"
        title="Advanced options"
        isOpen={isAdvancedOpen}
        onToggle={setIsAdvancedOpen}
        className="composer-disclosure"
      >
        <div className="advanced-fields">
          {inline ? (
            <>
              <label htmlFor={titleId}>Title override (optional)</label>
              <input
                id={titleId}
                type="text"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leave blank to derive automatically from task prompt"
                style={{ marginBottom: 12 }}
              />
            </>
          ) : null}

          <label htmlFor={constraintsId}>Constraints (optional)</label>
          <textarea
            id={constraintsId}
            value={constraints}
            maxLength={2000}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="Prefer local-first tools; budget under $20/month"
            style={{ minHeight: 64 }}
          />

          {kind === 'research_brief' ? (
            <>
              <label htmlFor={urlsId}>
                Starting URLs (optional, one per line, max {MAX_STARTING_URLS})
              </label>
              <textarea
                id={urlsId}
                value={startingUrlsText}
                onChange={(e) => setStartingUrlsText(e.target.value)}
                placeholder={'https://example.com/overview\nhttps://example.com/pricing'}
                style={{ minHeight: 64 }}
              />
            </>
          ) : null}
        </div>
      </Disclosure>

      {kind === 'project_update' && projects.length === 0 ? (
        <p className="error" style={{ marginTop: 10 }}>
          A project update needs a project with a granted folder. Create one on
          the <Link href="/projects">projects page</Link> first.
        </p>
      ) : null}

      {!urlsValid ? (
        <p className="error" style={{ marginTop: 10 }}>
          {parsedUrls.length > MAX_STARTING_URLS
            ? `At most ${MAX_STARTING_URLS} starting URLs are allowed (${parsedUrls.length} given).`
            : 'Starting URLs must begin with http:// or https://.'}
        </p>
      ) : null}

      {submitError ? (
        <p className="error" style={{ marginTop: 10 }}>
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
