'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/', label: 'Assistant' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/projects', label: 'Projects' },
  { href: '/memory', label: 'Memory' },
  { href: '/routines', label: 'Routines' },
  { href: '/settings', label: 'Settings' },
];

/** Sidebar navigation; the active destination carries the ice edge. */
export function SidebarNav() {
  const pathname = usePathname();
  return (
    <div className="links">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} data-active={pathname === link.href}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}
