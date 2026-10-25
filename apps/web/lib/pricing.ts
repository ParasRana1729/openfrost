import type { AssistantSettings } from '@openfrost/domain';
import { getJson } from './api';

/**
 * Known USD list prices per 1M tokens, input and output. Providers change
 * list prices without notice, so anything derived here is an estimate for
 * orientation only — never a billed amount.
 */
const LIST_PRICES_PER_MTOK: Readonly<
  Record<string, { input: number; output: number }>
> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
};

/** Estimated USD cost at list prices, or null when no price is on file. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = LIST_PRICES_PER_MTOK[model];
  if (!price) {
    return null;
  }
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Formats an estimate with enough precision for sub-cent amounts. */
export function formatCost(cost: number): string {
  if (cost === 0) {
    return '$0';
  }
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

let cachedModel: Promise<string | null> | null = null;

/**
 * The configured model name, loaded once per browser session via a
 * module-level cached promise. A transient failure clears the cache so a
 * later mount can retry.
 */
export function loadConfiguredModel(): Promise<string | null> {
  cachedModel ??= getJson<AssistantSettings>('/api/settings')
    .then((settings) => settings.model)
    .catch(() => {
      cachedModel = null;
      return null;
    });
  return cachedModel;
}
