const repository = 'ParasRana1729/openfrost';
const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`;

type GitHubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
};

type GitHubAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
};

export type ReleaseInfo = {
  version: string;
  date: string | null;
  notesUrl: string;
  assetName: string | null;
  assetUrl: string | null;
  assetSize: number | null;
  sha256: string | null;
  checksumUrl: string | null;
};

export const releasesUrl = `https://github.com/${repository}/releases`;
export const sourceUrl = `https://github.com/${repository}`;

export async function getLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(releaseApi, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const release = (await response.json()) as GitHubRelease;
    if (
      typeof release.tag_name !== 'string' ||
      typeof release.html_url !== 'string'
    ) {
      return null;
    }

    const assets = Array.isArray(release.assets)
      ? (release.assets as GitHubAsset[])
      : [];
    const installer = assets.find(
      (asset) =>
        typeof asset.name === 'string' &&
        /\.(?:exe|msi|zip)$/i.test(asset.name),
    );
    const checksumAsset = assets.find(
      (asset) =>
        typeof asset.name === 'string' &&
        /(?:sha256|checksums?)\.(?:txt|sha256)$/i.test(asset.name),
    );
    const body = typeof release.body === 'string' ? release.body : '';
    const checksumMatch = body.match(/\b[a-f\d]{64}\b/i);

    return {
      version: release.tag_name,
      date: typeof release.published_at === 'string' ? release.published_at : null,
      notesUrl: release.html_url,
      assetName: typeof installer?.name === 'string' ? installer.name : null,
      assetUrl:
        typeof installer?.browser_download_url === 'string'
          ? installer.browser_download_url
          : null,
      assetSize: typeof installer?.size === 'number' ? installer.size : null,
      sha256: checksumMatch?.[0] ?? (checksumAsset ? 'See checksum file in release assets' : null),
      checksumUrl:
        typeof checksumAsset?.browser_download_url === 'string'
          ? checksumAsset.browser_download_url
          : null,
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
