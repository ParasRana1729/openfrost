import type { MetadataRoute } from 'next';
import { getSiteBaseUrl } from '../lib/content';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getSiteBaseUrl();
  return baseUrl ? [{ url: baseUrl }] : [];
}
