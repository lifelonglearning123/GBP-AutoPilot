'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  ['', 'Overview'],
  ['/reviews', 'Reviews'],
  ['/posts', 'Posts'],
  ['/site', 'Website'],
  ['/competitors', 'Competitors'],
  ['/map', 'Map'],
  ['/citations', 'Listings'],
  ['/config', 'Settings'],
];

export default function Tabs({ base }: { base: string }) {
  const path = usePathname();
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2" style={{ borderColor: 'var(--line)' }}>
      {TABS.map(([suffix, label]) => {
        const href = base + suffix;
        const active = suffix === '' ? path === base : path.startsWith(href);
        return <Link key={href} href={href} className={`tab ${active ? 'active' : ''}`}>{label}</Link>;
      })}
    </div>
  );
}
