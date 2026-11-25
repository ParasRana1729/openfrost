'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { installCommand } from '../lib/content';

function legacyCopy(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export function InstallCommand() {
  const codeId = useId();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const timerRef = useRef<number | null>(null);
  const lastAnnouncementRef = useRef('');

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    let ok = false;
    try {
      await navigator.clipboard.writeText(installCommand);
      ok = true;
    } catch {
      ok = legacyCopy(installCommand);
    }

    let message = ok ? 'Copied' : 'Copy failed';
    if (message === lastAnnouncementRef.current) {
      message += '\u00A0';
    }
    lastAnnouncementRef.current = message;

    setCopyState(ok ? 'copied' : 'failed');
    setAnnouncement(message);

    timerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      setAnnouncement('');
    }, 2200);
  }

  const label =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'failed'
        ? 'Copy failed'
        : 'Copy command';

  return (
    <div className="install-command" data-ui>
      <div className="install-command-bar">
        <span>Windows PowerShell · %USERPROFILE%\.openfrost\source</span>
        <span className="copy-wrap">
          <button
            type="button"
            className="copy-button"
            aria-label="Copy PowerShell install command"
            data-copied={copyState === 'copied' ? '' : undefined}
            data-failed={copyState === 'failed' ? '' : undefined}
            onClick={handleCopy}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {copyState === 'copied' ? (
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
              ) : (
                <>
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
                  <path d="M3 10.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V3" />
                </>
              )}
            </svg>
            <span>{label}</span>
          </button>
          <span className="copy-tip" role="status" data-visible={announcement ? 'true' : 'false'}>
            {announcement}
          </span>
        </span>
      </div>
      <div className="install-command-row">
        <pre tabIndex={0}>
          <code id={codeId}>{installCommand}</code>
        </pre>
      </div>
    </div>
  );
}
