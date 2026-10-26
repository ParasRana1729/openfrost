import React from 'react';
import type { TaskState, RunState } from '@openfrost/domain';

export type HumanStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'canceled'
  | 'interrupted';

export interface StatusBadgeProps {
  state: TaskState | RunState | HumanStatus;
  size?: 'sm' | 'md';
  showDot?: boolean;
  pulse?: boolean;
  labelOverride?: string;
  className?: string;
}

interface StateConfig {
  label: string;
  cssModifier: string;
  dotClass: string;
  defaultPulse: boolean;
}

const STATUS_CONFIG: Record<string, StateConfig> = {
  queued: {
    label: 'Queued',
    cssModifier: 'badge-queued',
    dotClass: 'dot-idle',
    defaultPulse: false,
  },
  running: {
    label: 'Running',
    cssModifier: 'badge-running',
    dotClass: 'dot-running',
    defaultPulse: true,
  },
  completed: {
    label: 'Done',
    cssModifier: 'badge-completed',
    dotClass: 'dot-ok',
    defaultPulse: false,
  },
  done: {
    label: 'Done',
    cssModifier: 'badge-completed',
    dotClass: 'dot-ok',
    defaultPulse: false,
  },
  failed: {
    label: 'Failed',
    cssModifier: 'badge-failed',
    dotClass: 'dot-offline',
    defaultPulse: false,
  },
  awaiting_approval: {
    label: 'Needs Approval',
    cssModifier: 'badge-awaiting-approval',
    dotClass: 'dot-warn',
    defaultPulse: false,
  },
  canceled: {
    label: 'Canceled',
    cssModifier: 'badge-canceled',
    dotClass: 'dot-idle',
    defaultPulse: false,
  },
  interrupted: {
    label: 'Interrupted',
    cssModifier: 'badge-interrupted',
    dotClass: 'dot-offline',
    defaultPulse: false,
  },
};

export function StatusBadge({
  state,
  size = 'md',
  showDot = true,
  pulse,
  labelOverride,
  className = '',
}: StatusBadgeProps) {
  const normalizedKey = (state || 'queued').toLowerCase();
  const config = STATUS_CONFIG[normalizedKey] ?? {
    label: normalizedKey.replace('_', ' '),
    cssModifier: 'badge-default',
    dotClass: 'dot-idle',
    defaultPulse: false,
  };

  const displayText = labelOverride ?? config.label;
  const shouldPulse = pulse !== undefined ? pulse : config.defaultPulse;

  const classes = [
    'status-badge',
    config.cssModifier,
    `badge-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      role="status"
      aria-label={`Status: ${displayText}`}
    >
      {showDot ? (
        <span
          className={`badge-dot ${config.dotClass} ${shouldPulse ? 'dot-pulse' : ''}`}
          aria-hidden="true"
        />
      ) : null}
      <span className="badge-label">{displayText}</span>
    </span>
  );
}
