'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getJson, mutate } from '../../lib/api';
import type { SessionInfo } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useToast } from '../../components/ToastProvider';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session && !session.ownerCreated) {
      router.replace('/onboarding');
    }
  }, [loading, session, router]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'owner', password },
        csrfToken: null,
      });
      // A 200 only means the API accepted the password; if the browser is
      // not keeping the session cookie, the owner would otherwise loop on
      // this page with no explanation.
      const session = await getJson<SessionInfo>('/api/auth/session');
      if (!session.authenticated) {
        const message =
          'Signed in, but this browser is not keeping the session cookie. Allow cookies for this site and try again.';
        setError(message);
        showToast('error', message);
        setBusy(false);
        return;
      }
      showToast('success', 'Signed in.');
      router.replace('/');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      setError(message);
      showToast('error', message);
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h1>Sign in</h1>
      <p className="muted">Local owner account for this OpenFrost installation.</p>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void submit();
          }
        }}
        autoComplete="current-password"
      />
      {error ? <p className="error">{error}</p> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={busy || password.length === 0} onClick={() => void submit()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
