import type { ToolDefinition } from '../provider.js';

/**
 * One recorded retrieval attempt, successful or not, for the report's
 * `Retrieved sources` appendix and retrieval notes.
 */
export interface RetrievalRecord {
  url: string;
  finalUrl: string;
  /** HTTP status of the last response, or 0 when none was received. */
  status: number;
  ms: number;
  chars: number;
  /** Human-readable failure reason; absent on success. */
  error?: string;
}

/** Collects per-run retrieval records; one instance per run. */
export interface RunToolContext {
  recordRetrieval(r: RetrievalRecord): void;
}

/**
 * A bounded, policy-classified tool the agent may call. Every implementation
 * must enforce its own limits and trust boundaries; execution outcomes are
 * always a result (ok/content), never an exception path the agent sees.
 */
export interface AgentTool {
  definition: ToolDefinition;
  execute(
    argsJson: string,
    ctx: RunToolContext,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; content: string }>;
}
