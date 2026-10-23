import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenFrost',
  description: 'Personal AI OS — local runtime (v0.1 foundation)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">❄ OpenFrost</span>
          <span className="links">
            <Link href="/">Home</Link>
            <Link href="/tasks">Tasks</Link>
            <Link href="/settings">Settings</Link>
          </span>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
