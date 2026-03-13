'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type MobileNavItem = {
  href: string;
  label: string;
};

type MobileNavSelectProps = {
  items: MobileNavItem[];
  currentHref?: string;
  ariaLabel?: string;
};

export default function MobileNavSelect({ items, currentHref, ariaLabel = 'Portal Navigation' }: MobileNavSelectProps) {
  const router = useRouter();
  const pathname = usePathname();

  const selectedHref = useMemo(() => {
    if (currentHref) return currentHref;
    const sorted = [...items].sort((a, b) => b.href.length - a.href.length);
    const match = sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    return match?.href ?? items[0]?.href ?? '';
  }, [currentHref, items, pathname]);

  if (items.length === 0) return null;

  return (
    <div className="portal-nav-mobile-wrap">
      <label className="portal-nav-mobile-label" htmlFor="portal-mobile-nav">
        Go to
      </label>
      <select
        id="portal-mobile-nav"
        className="portal-nav-mobile"
        aria-label={ariaLabel}
        value={selectedHref}
        onChange={(event) => {
          const next = event.target.value;
          if (next) router.push(next);
        }}
      >
        {items.map((item) => (
          <option key={item.href} value={item.href}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
