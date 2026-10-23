import { z } from 'zod';
import { executionLimitsSchema } from './task.js';

/**
 * Owner-facing assistant settings (API response shape). This contract can
 * never carry a raw provider key; only a boolean "a key is configured".
 */
export const assistantSettingsSchema = z.strictObject({
  provider: z.literal('openai'),
  model: z.string().min(1).nullable(),
  hasProviderKey: z.boolean(),
  executionLimits: executionLimitsSchema,
  onboardingCompletedAt: z.string().min(1).nullable(),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

/** Request body for storing a provider API key; never echoed back or logged. */
export const setProviderKeyRequestSchema = z.strictObject({
  key: z.string().min(10).max(500),
});
export type SetProviderKeyRequest = z.infer<typeof setProviderKeyRequestSchema>;
