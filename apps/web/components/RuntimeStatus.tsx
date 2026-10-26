'use client';

import { useEffect, useState } from 'react';
import { getJson, type SessionInfo } from '../lib/api';

type RuntimeState = 'checking' | 'running' | 'offline';

const STATUS_LABEL: Record<RuntimeState, string> = {
  checking: 'Checking…',
  running: 'Running',
  offline: 'Offline',
};

export function RuntimeStatus() {
  const [status, setStatus] = useState<RuntimeState>('checking');

  useEffect(() => {
    let active = true;
    const checkRuntime = async () => {
      try {
        await getJson<SessionInfo>('/api/auth/session');
        if (active) {
          setStatus('running');
        }
      } catch {
        if (active) {
          setStatus('offline');
        }
      }
    };

    void checkRuntime();
    const interval = window.setInterval(() => void checkRuntime(), 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="sidebar-foot">
      <span className="runtime-chip" data-status={status} role="status" title="Local API status">
        <span
          className={`dot ${status === 'running' ? 'dot-ok' : status === 'offline' ? 'dot-offline' : 'dot-idle'}`}
          aria-hidden="true"
        />
        <span>Local runtime · {STATUS_LABEL[status]}</span>
      </span>
    </div>
  );
}
