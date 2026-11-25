import type { MetadataRoute } from 'next';
import { getSiteBaseUrl } from '../lib/content';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteBaseUrl();
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(baseUrl ? { sitemap: new URL('sitemap.xml', baseUrl).toString() } : {}),
  };
}
