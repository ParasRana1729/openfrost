'use client';

import { useEffect, useState } from 'react';

export function DownloadAction({
  url,
  version,
}: {
  url: string | null;
  version: string | null;
}) {
  const [windows, setWindows] = useState<boolean | null>(null);

  useEffect(() => {
    const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
    setWindows(platform.includes('win'));
  }, []);

  if (!url) {
    return (
      <a className="button button-primary" href="#download">
        See how to get started <span aria-hidden="true">↗</span>
      </a>
    );
  }

  if (windows === false) {
    return (
      <a className="button button-primary" href="#source">
        Build from source <span aria-hidden="true">↗</span>
      </a>
    );
  }

  return (
    <a className="button button-primary" href={url}>
      Download for Windows{version ? ` · ${version}` : ''}{' '}
      <span aria-hidden="true">↓</span>
    </a>
  );
}
