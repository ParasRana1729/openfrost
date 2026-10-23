'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getJson, mutate } from '../../lib/api';
import type { SessionInfo } from '../../lib/api';

/**
 * First-run onboarding. The disclosures below are a product requirement
 * (spec §2): the owner must understand what leaves this PC and when the
 * assistant can run before creating the owner account.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await mutate({
        method: 'POST',
        path: '/api/auth/setup',
        body: { username: 'owner', password },
        csrfToken: null,
      });
      // Same diagnostic as the login page: a 201 does not prove the browser
      // stored the session cookie.
      const session = await getJson<SessionInfo>('/api/auth/session');
      if (!session.authenticated) {
        setError(
          'Account created, but this browser is not keeping the session cookie. Allow cookies for this site and sign in again.',
        );
        setBusy(false);
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed');
      setBusy(false);
    }
  };

  return (
    <>
      <div className="panel">
        <h1>Welcome to OpenFrost</h1>
        <p>
          OpenFrost is a personal AI assistant that runs on this PC. Before the
          first request, understand two things:
        </p>
        <div className="note">
          <strong>Data transmission.</strong> Local-first means the app and your
          data live on this PC — not that nothing leaves it. Your requests,
          granted context, and retrieved source excerpts are sent to the
          configured model/search provider (OpenAI, using your API key) for
          processing. Secrets are stored DPAPI-protected and are never sent
          anywhere other than to that provider as authentication.
        </div>
        <div className="note">
          <strong>Availability.</strong> OpenFrost runs only while this PC is
          awake and the runtime is running. Closing the browser does not stop
          tasks; sleeping or shutting down the PC does. Unfinished work is
          marked <em>interrupted</em> for your review on the next start — it is
          never silently retried.
        </div>
        <p className="muted">
          App data (database, secrets, memory) lives under{' '}
          <code>%USERPROFILE%\.openfrost</code>. This account is the single
          owner account for this installation.
        </p>
      </div>

      <div className="panel">
        <h2>Create the owner account</h2>
        <label htmlFor="password">Password (min 8 characters)</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <label htmlFor="confirm">Confirm password</label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create owner account'}
          </button>
        </div>
      </div>
    </>
  );
}
