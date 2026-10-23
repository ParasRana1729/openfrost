'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, mutate } from '../../lib/api';
import { useSession } from '../../lib/useSession';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
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
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
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
