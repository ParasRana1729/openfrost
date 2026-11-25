/**
 * Provider seam for model-backed execution: a single agent step that either
 * finishes with a final report or requests tool calls that the executor
 * performs and feeds back. The OpenAI adapter lands with the S02 research
 * slice; tests use the deterministic fake, so no automated check needs a
 * paid API call.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

/**
 * Conversation state for one run. The executor owns the transcript; the
 * provider maps it onto its wire format.
 */
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool_calls'; calls: Array<{ id: string; name: string; argsJson: string }> }
  | { role: 'tool_result'; callId: string; name: string; ok: boolean; content: string };

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProviderCitation {
  url: string;
  title?: string;
}

export type ProviderStepResult =
  | {
      kind: 'final';
      text: string;
      citations: ProviderCitation[];
      usage: ProviderUsage;
      webSearchSkippedReason?: string;
      warnings?: string[];
    }
  | {
      kind: 'tool_calls';
      calls: Array<{ id: string; name: string; argsJson: string }>;
      /** Provider-hosted search calls performed during this step. */
      searches: number;
      usage: ProviderUsage;
      webSearchSkippedReason?: string;
      warnings?: string[];
    };

export interface ProviderStepRequest {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  /** 1-based step number within the current run. */
  step: number;
  /** Honored by providers: resolves/rejects promptly when canceled. */
  signal: AbortSignal;
  /**
   * Whether hosted provider-side web search is offered this step. True only
   * for web-grounded workflows (research briefs). File-grounded workflows
   * (project updates, weekly plans) run without it: their policy grounds
   * them in granted files and saved updates, and hosted search bills the
   * owner's account per search even when the model itself is free.
   */
  webSearch: boolean;
}

export interface LlmProvider {
  readonly name: string;
  step(request: ProviderStepRequest): Promise<ProviderStepResult>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderMissingError';
  }
}

/** Removes an exact provider credential before errors can be persisted or shown. */
export function redactSecret(message: string, secret: string): string {
  return secret.length === 0 ? message : message.split(secret).join('[redacted]');
}

const LOG_SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, '[redacted]'],
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, '[redacted]'],
  [/\b(authorization|x-goog-api-key|x-api-key)\b(\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;}{]+/gi, '$1$2[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]'],
  [/\bsk-or-v1-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{12,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b(\s*[:=]\s*["']?)[^\s"',;}{]+/gi, '$1$2[redacted]'],
];

/** Scrubs both exact known keys and common credential/header patterns before logging. */
export function redactLogSecrets(
  message: string,
  knownSecrets: readonly string[] = [],
): string {
  let scrubbed = message;
  for (const secret of knownSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length > 0) {
      scrubbed = redactSecret(scrubbed, trimmed);
    }
  }
  for (const [pattern, replacement] of LOG_SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}
