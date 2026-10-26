import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: 'OpenFrost — one assistant, work that gets finished',
  description:
    'A Windows-first local assistant for research briefs, project updates, and weekly plans. One task at a time, saved with its sources.',
  applicationName: 'OpenFrost',
  openGraph: {
    title: 'OpenFrost — one assistant, work that gets finished',
    description:
      'A local assistant that researches the public web or reads project notes you grant, then saves the result with its sources.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenFrost — one assistant, work that gets finished',
    description:
      'A local assistant for research briefs, project updates, and weekly plans.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
