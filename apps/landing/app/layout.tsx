import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Anton, Archivo } from 'next/font/google';
import './styles.css';

const display = Anton({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });
const body = Archivo({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: 'OpenFrost — a local assistant for work',
  description:
    'OpenFrost researches the public web or reads project files you grant, then saves finished work with its sources. A Windows-first local AI assistant.',
  applicationName: 'OpenFrost',
  keywords: ['OpenFrost', 'local AI assistant', 'Windows', 'research', 'project updates'],
  openGraph: {
    title: 'OpenFrost — a local assistant for work',
    description:
      'A Windows-first local assistant for research, project updates, and weekly plans.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenFrost — a local assistant for work',
    description:
      'A Windows-first local assistant for research, project updates, and weekly plans.',
  },
};

const softwareApplication = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'OpenFrost',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Windows',
  description:
    'A local assistant for research briefs, project updates, and weekly plans.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
        />
        {children}
      </body>
    </html>
  );
}
