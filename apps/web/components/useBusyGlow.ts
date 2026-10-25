'use client';

import { useEffect } from 'react';

/**
 * Reports executor state to the shell: `body[data-busy='true']` lights the
 * frost bloom behind the content while a run owns the machine.
 */
export function useBusyGlow(busy: boolean): void {
  useEffect(() => {
    document.body.dataset.busy = busy ? 'true' : 'false';
    return () => {
      delete document.body.dataset.busy;
    };
  }, [busy]);
}
