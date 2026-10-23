interface DispatchStripProps {
  busy: boolean;
  activeTaskId: string | null;
  dispatchPaused: boolean;
  queuedCount: number;
}

/**
 * The runtime status line: one run owns the executor, everything else
 * queues, and dispatch can be paused for review. Rendered in system
 * monospace — this is the one component that describes the machine.
 */
export function DispatchStrip({
  busy,
  activeTaskId,
  dispatchPaused,
  queuedCount,
}: DispatchStripProps) {
  return (
    <div className="strip" role="status">
      <span className="strip-seg">
        <span className="strip-label">Run</span>
        {busy ? (
          <>
            <span className="dot dot-running" aria-hidden="true" />
            <span>running · {(activeTaskId ?? '').slice(0, 8) || '…'}</span>
          </>
        ) : (
          <>
            <span className="dot dot-idle" aria-hidden="true" />
            <span>idle</span>
          </>
        )}
      </span>
      <span className="strip-sep" aria-hidden="true" />
      <span className="strip-seg">
        <span className="strip-label">Queue</span>
        <span>
          {queuedCount} {queuedCount === 1 ? 'task' : 'tasks'} waiting
        </span>
      </span>
      <span className="strip-sep" aria-hidden="true" />
      <span className="strip-seg">
        <span className="strip-label">Dispatch</span>
        {dispatchPaused ? (
          <span className="strip-paused">paused — review required</span>
        ) : (
          <span className="strip-ok">open</span>
        )}
      </span>
    </div>
  );
}
