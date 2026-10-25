'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AssistantSettings } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { useSession } from '../../lib/useSession';

export default function SettingsPage() {
  const { session, loading } = useSession();
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await getJson<AssistantSettings>('/api/settings'));
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

  const saveKey = async () => {
    if (!csrf || apiKey.trim().length < 10) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({
        method: 'PUT',
        path: '/api/settings/provider-key',
        body: { key: apiKey.trim() },
        csrfToken: csrf,
      });
      setApiKey('');
      setNotice('Key stored (DPAPI-protected). It is never shown again or logged.');
      await refreshSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not store key');
    } finally {
      setBusy(false);
    }
  };

  const deleteKey = async () => {
    if (!csrf) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({ method: 'DELETE', path: '/api/settings/provider-key', csrfToken: csrf });
      setNotice('Stored key removed.');
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
        <h1>Provider credentials</h1>
        <p>
          OpenFrost uses OpenAI with your API key. The key is protected with
          Windows DPAPI (current user) and stored under{' '}
          <code>%USERPROFILE%\.openfrost\secrets</code>. It is decrypted only when
          a run needs it, is never displayed again, and never enters logs,
          reports, or memory.
        </p>
        <p className="muted">
          Status:{' '}
          {settings?.hasProviderKey ? (
            <strong>a key is configured</strong>
          ) : (
            'no key configured'
          )}
          .{' '}
          {settings?.model ? (
            <>
              Model: {settings.model}.
            </>
          ) : (
            'Model: not configured — set OPENFROST_OPENAI_MODEL.'
          )}
        </p>
        <label htmlFor="apikey">{settings?.hasProviderKey ? 'Replace key' : 'OpenAI API key'}</label>
        <input
          id="apikey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
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
          {settings?.hasProviderKey ? (
            <button disabled={busy || !csrf} onClick={() => void deleteKey()}>
              Remove stored key
            </button>
          ) : null}
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
