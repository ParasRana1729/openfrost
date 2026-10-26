import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Anton, Archivo, JetBrains_Mono } from 'next/font/google';
import { SidebarNav } from '../components/SidebarNav';
import { RuntimeStatus } from '../components/RuntimeStatus';
import { ToastProvider } from '../components/ToastProvider';
import { StatusBar } from '../components/StatusBar';
import './globals.css';

/**
 * The polar-instrument type stack, self-hosted by next/font (no runtime
 * font fetches): Anton carries the display moments, Archivo the UI,
 * JetBrains Mono the machine truth.
 */
const display = Anton({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

const body = Archivo({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OpenFrost',
  description: 'Personal AI OS — local runtime (v0.1 foundation)',
};

function FlakeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <aside className="sidebar">
            <span className="brand">
              <FlakeMark />
              OpenFrost
            </span>
            <SidebarNav />
            <RuntimeStatus />
          </aside>
          <main className="main">
            <ToastProvider>
              <StatusBar />
              {children}
            </ToastProvider>
          </main>
        </div>
      </body>
    </html>
  );
}
