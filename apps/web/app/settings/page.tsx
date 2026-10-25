'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AssistantSettings, ProviderId } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { useSession } from '../../lib/useSession';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
};

const PROVIDER_CHOICES: ReadonlyArray<ProviderId> = ['openai', 'gemini', 'openrouter'];

const MAX_MODEL_LENGTH = 100;

export default function SettingsPage() {
  const { session, loading } = useSession();
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  // The provider the owner is currently editing. Initialized once from the
  // active provider on first load, then kept sticky across refreshes so a
  // background reload cannot yank the form while the owner is mid-edit.
  const [selected, setSelected] = useState<ProviderId | null>(null);
  // Typed model text, tied to the provider it was typed for. Null = show that
  // provider's effective model from settings instead of a draft.
  const [modelDraft, setModelDraft] = useState<{ provider: ProviderId; value: string } | null>(
    null,
  );
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      const next = await getJson<AssistantSettings>('/api/settings');
      setSettings(next);
      // Under the fake dev hook no provider is active; default the editor to
      // OpenAI so the panel still shows concrete model/key state.
      setSelected((prev) => prev ?? (next.provider === 'fake' ? 'openai' : next.provider));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings');
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshSettings();
    }
  }, [session?.authenticated, refreshSettings]);

  const csrf = session?.csrfToken ?? null;

  const fakeActive = settings?.provider === 'fake';
  const selectedProvider: ProviderId = selected ?? 'openai';
  const selectedModel = settings?.models[selectedProvider] ?? null;
  const hasKeyByProvider: Record<ProviderId, boolean> = {
    openai: settings?.hasOpenAIKey ?? false,
    gemini: settings?.hasGeminiKey ?? false,
    openrouter: settings?.hasOpenRouterKey ?? false,
  };
  const selectedHasKey = hasKeyByProvider[selectedProvider];
  // Show the typed draft only while it belongs to the selected provider;
  // otherwise fall back to the loaded effective model.
  const modelValue =
    modelDraft && modelDraft.provider === selectedProvider
      ? modelDraft.value
      : (selectedModel ?? '');

  const chooseProvider = (next: ProviderId) => {
    setSelected(next);
    setModelDraft(null);
    setNotice(null);
    setError(null);
    void refreshSettings();
  };

  const saveProvider = async () => {
    if (!csrf) {
      // Reachable only in the brief window before the session check resolves;
      // surfacing it beats a silent no-op click.
      setError('Session is still loading — try again in a moment.');
      return;
    }
    const trimmedModel = modelValue.trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({
        method: 'PUT',
        path: '/api/settings/provider',
        body: {
          provider: selectedProvider,
          model: trimmedModel === '' ? null : trimmedModel,
        },
        csrfToken: csrf,
      });
      setModelDraft(null);
      setNotice(
        `${PROVIDER_LABEL[selectedProvider]} saved as the active provider. It takes effect on the next task run.`,
      );
      await refreshSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save provider settings');
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (!csrf) {
      setError('Session is still loading — try again in a moment.');
      return;
    }
    if (apiKey.trim().length < 10) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({
        method: 'PUT',
        path: '/api/settings/provider-key',
        body: { provider: selectedProvider, key: apiKey.trim() },
        csrfToken: csrf,
      });
      setApiKey('');
      setNotice(
        `${PROVIDER_LABEL[selectedProvider]} key stored (DPAPI-protected). It is never shown again or logged.`,
      );
      await refreshSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not store key');
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!csrf) {
      setError('Session is still loading — try again in a moment.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({
        method: 'DELETE',
        path: `/api/settings/provider-key?provider=${selectedProvider}`,
        csrfToken: csrf,
      });
      setNotice(`Stored ${PROVIDER_LABEL[selectedProvider]} key removed.`);
      await refreshSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove key');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Settings</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h1>Provider</h1>
        <p>
          OpenFrost runs tasks on one provider at a time. Each provider keeps its
          own API key, protected with Windows DPAPI (current user) and stored
          under <code>%USERPROFILE%\.openfrost\secrets</code>. Keys are decrypted
          only when a run needs them, are never displayed again, and never enter
          logs, reports, or memory.
        </p>

        {fakeActive ? (
          <p className="note">
            OPENFROST_PROVIDER=fake is active — runs are scripted and provider
            switching is disabled.
          </p>
        ) : null}

        <div
          className="segmented"
          role="radiogroup"
          aria-label="Model provider"
          style={{ marginTop: 12 }}
        >
          {PROVIDER_CHOICES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selectedProvider === id}
              disabled={busy || fakeActive}
              onClick={() => chooseProvider(id)}
            >
              {PROVIDER_LABEL[id]}
            </button>
          ))}
        </div>

        <label htmlFor="provider-model">{PROVIDER_LABEL[selectedProvider]} model</label>
        <input
          id="provider-model"
          type="text"
          value={modelValue}
          maxLength={MAX_MODEL_LENGTH}
          onChange={(e) => setModelDraft({ provider: selectedProvider, value: e.target.value })}
          placeholder={selectedModel ?? ''}
          autoComplete="off"
          disabled={fakeActive}
        />
        <p className="muted">Leave empty to use this provider&rsquo;s default model.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={busy || !csrf || fakeActive}
            onClick={() => void saveProvider()}
          >
            Save provider
          </button>
        </div>
        <p className="muted">
          Status: {PROVIDER_LABEL[selectedProvider]} · Model: {selectedModel ?? '—'} ·{' '}
          {selectedHasKey ? 'key stored' : 'no key'}. Switching providers and
          saved keys take effect on the next task run — no restart needed.
        </p>

        <h2>API keys</h2>
        <p className="muted">
          OpenAI: {settings?.hasOpenAIKey ? 'key stored' : 'no key'} · Gemini:{' '}
          {settings?.hasGeminiKey ? 'key stored' : 'no key'} · OpenRouter:{' '}
          {settings?.hasOpenRouterKey ? 'key stored' : 'no key'}.
        </p>
        <label htmlFor="apikey">
          {selectedHasKey
            ? `Replace ${PROVIDER_LABEL[selectedProvider]} key`
            : `${PROVIDER_LABEL[selectedProvider]} API key`}
        </label>
        <input
          id="apikey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key…"
          autoComplete="off"
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={busy || !csrf || apiKey.trim().length < 10}
            onClick={() => void saveKey()}
          >
            Save key
          </button>
          <button disabled={busy || !csrf || !selectedHasKey} onClick={() => void removeKey()}>
            Remove stored key
          </button>
        </div>
        {notice ? <p style={{ color: 'var(--ok)' }}>{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="panel">
        <h2>Execution limits</h2>
        <p className="muted">Finite bounds applied to every run; a run that hits one stops with a clear result.</p>
        <table>
          <tbody>
            <tr>
              <th>Max steps per run</th>
              <td className="mono">{settings?.executionLimits.maxSteps ?? '—'}</td>
            </tr>
            <tr>
              <th>Wall clock</th>
              <td className="mono">
                {((settings?.executionLimits.maxWallClockMs ?? 0) / 1000 / 60).toFixed(0)} min
              </td>
            </tr>
            <tr>
              <th>Max input</th>
              <td className="mono">
                {settings?.executionLimits.maxInputChars.toLocaleString() ?? '—'} chars
              </td>
            </tr>
            <tr>
              <th>Max output</th>
              <td className="mono">
                {settings?.executionLimits.maxOutputChars.toLocaleString() ?? '—'} chars
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Retrieval times reported in saved research briefs come from real page
          fetches, so slow sites use more of the run&rsquo;s wall-clock budget.
        </p>
      </div>

      <div className="panel">
        <h2>Privacy &amp; availability</h2>
        <p className="muted">
          Requests, granted context, and retrieved excerpts are sent to the
          configured model/search provider for processing. OpenFrost runs only
          while this PC is awake and the runtime is running; closing the browser
          does not stop tasks. Data lives under <code>%USERPROFILE%\.openfrost</code>.
        </p>
      </div>
    </>
  );
}
