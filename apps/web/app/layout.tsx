import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenFrost',
  description: 'Personal AI OS — local runtime (v0.1 foundation)',
};

function FlakeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      {[0, 60, 120].map((rotation) => (
        <g key={rotation} transform={`rotate(${rotation} 12 12)`}>
          <line x1="12" y1="2.5" x2="12" y2="21.5" />
          <path d="M12 2.5 L9.7 4.8 M12 2.5 L14.3 4.8" />
          <path d="M12 21.5 L9.7 19.2 M12 21.5 L14.3 19.2" />
        </g>
      ))}
    </svg>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">
            <FlakeMark />
            OpenFrost
          </span>
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
