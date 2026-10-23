'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getJson, type SessionInfo } from './api';

export interface SessionState {
  session: SessionInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Client session guard. Route the owner to onboarding/login when needed;
 * the API remains the enforcement point for every protected resource.
 */
export function useSession(): SessionState {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await getJson<SessionInfo>('/api/auth/session');
      setSession(info);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'API unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading && session) {
      if (!session.ownerCreated) {
        router.replace('/onboarding');
      } else if (!session.authenticated) {
        router.replace('/login');
      }
    }
  }, [loading, session, router]);

  return { session, loading, error, refresh };
}
