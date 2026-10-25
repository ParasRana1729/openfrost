import { z } from 'zod';
import { executionLimitsSchema } from './task.js';

/** Built-in model providers. 'fake' is the scripted dev/test hook only. */
export const providerIdSchema = z.enum(['openai', 'gemini', 'openrouter']);
export const settingsProviderSchema = z.enum(['openai', 'gemini', 'openrouter', 'fake']);
export type ProviderId = z.infer<typeof providerIdSchema>;

/**
 * Owner-facing assistant settings (API response shape). This contract can
 * never carry a raw provider key; only per-provider booleans "a key is
 * configured". `model` is the active provider's configured model; `models`
 * carries each provider's configured model (null = that provider's default).
 * When the `OPENFROST_PROVIDER=fake` dev hook is active, `provider` is
 * 'fake' and provider switching is disabled in the UI.
 */
export const assistantSettingsSchema = z.strictObject({
  provider: settingsProviderSchema,
  /** The active provider's effective model (configured override or default). */
  model: z.string().min(1).nullable(),
  models: z.strictObject({
    openai: z.string().min(1),
    gemini: z.string().min(1),
    openrouter: z.string().min(1),
  }),
  hasProviderKey: z.boolean(),
  hasOpenAIKey: z.boolean(),
  hasGeminiKey: z.boolean(),
  hasOpenRouterKey: z.boolean(),
  executionLimits: executionLimitsSchema,
  onboardingCompletedAt: z.string().min(1).nullable(),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

/** Request body for storing a provider API key; never echoed back or logged. */
export const setProviderKeyRequestSchema = z.strictObject({
  provider: providerIdSchema,
  key: z.string().min(10).max(500),
});
export type SetProviderKeyRequest = z.infer<typeof setProviderKeyRequestSchema>;

/** Switch the active provider and optionally set its model. */
export const setProviderConfigRequestSchema = z.strictObject({
  provider: providerIdSchema,
  model: z.string().min(1).max(100).nullable().optional(),
});
export type SetProviderConfigRequest = z.infer<typeof setProviderConfigRequestSchema>;
