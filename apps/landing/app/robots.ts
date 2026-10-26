import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(siteUrl ? { sitemap: new URL('/sitemap.xml', siteUrl).toString() } : {}),
  };
}
