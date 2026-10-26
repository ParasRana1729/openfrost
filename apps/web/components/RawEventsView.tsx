'use client';

import React, { useState } from 'react';
import type { Event } from '@openfrost/domain';
import { formatTimestamp } from '../lib/format';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';

export interface RawEventsViewProps {
  /** Array of domain system events */
  events: Event[];
  /** Optional custom title; defaults to "Raw system events" */
  title?: string;
  /** Whether the disclosure starts expanded; defaults to false */
  defaultOpen?: boolean;
  /** Optional controlled open state */
  isOpen?: boolean;
  /** Callback when user toggles the disclosure */
  onToggle?: (open: boolean) => void;
  /** Max height for the internal scrollable container */
  maxHeight?: number | string;
  /** Whether to show a "Copy all JSON" action */
  showCopyAll?: boolean;
  className?: string;
}

export function RawEventsView({
  events,
  title = 'Raw system events',
  defaultOpen = false,
  isOpen,
  onToggle,
  maxHeight = 340,
  showCopyAll = true,
  className = '',
}: RawEventsViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = async () => {
    try {
      const json = JSON.stringify(events, null, 2);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback or ignore clipboard error in restricted test environments
    }
  };

  return (
    <Disclosure
      title={title}
      badge={
        <span className="chip" aria-label={`${events.length} events recorded`}>
          {events.length}
        </span>
      }
      variant="card"
      headingLevel="h3"
      defaultOpen={defaultOpen}
      isOpen={isOpen}
      onToggle={onToggle}
      className={`raw-events-disclosure ${className}`.trim()}
    >
      <div className="raw-events-panel">
        <div className="raw-events-toolbar">
          <span className="raw-events-hint">
            Low-level system and agent execution trace.
          </span>
          {showCopyAll && events.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyAll}
              aria-label="Copy all raw events as JSON"
            >
              {copied ? 'Copied JSON!' : 'Copy JSON'}
            </Button>
          ) : null}
        </div>

        {/* Scrollable container with role="region", aria-label, and tabIndex={0} for keyboard operability */}
        <div
          className="console raw-events-console"
          role="region"
          aria-label="Raw events log"
          tabIndex={0}
          style={{ maxHeight }}
        >
          {events.length === 0 ? (
            <div className="console-empty">No events recorded.</div>
          ) : (
            events.map((event) => (
              <div className="console-row raw-event-row" key={event.id}>
                <span className="console-time">{formatTimestamp(event.createdAt)}</span>
                <span className="console-type chip chip-code">{event.type}</span>
                {event.taskId ? (
                  <span className="console-ref" title={`Task ID: ${event.taskId}`}>
                    task:{event.taskId.slice(0, 8)}
                  </span>
                ) : null}
                {event.runId ? (
                  <span className="console-ref" title={`Run ID: ${event.runId}`}>
                    run:{event.runId.slice(0, 8)}
                  </span>
                ) : null}
                {event.payload && Object.keys(event.payload).length > 0 ? (
                  <details className="raw-payload-details">
                    <summary className="raw-payload-summary">payload</summary>
                    <pre className="raw-payload-pre">
                      <code>{JSON.stringify(event.payload, null, 2)}</code>
                    </pre>
                  </details>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </Disclosure>
  );
}
