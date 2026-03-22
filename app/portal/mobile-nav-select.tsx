'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type MobileNavItem = {
  href: string;
  label: string;
};

type MobileNavSelectProps = {
  items: MobileNavItem[];
  currentHref?: string;
  ariaLabel?: string;
  loggedInAs?: string;
  showLogout?: boolean;
};

export default function MobileNavSelect({
  items,
  currentHref,
  ariaLabel = 'Portal Navigation',
  loggedInAs,
  showLogout = true,
}: MobileNavSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  const selectedHref = useMemo(() => {
    if (currentHref) return currentHref;
    const sorted = [...items].sort((a, b) => b.href.length - a.href.length);
    const match = sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    return match?.href ?? items[0]?.href ?? '';
  }, [currentHref, items, pathname]);

  if (items.length === 0) return null;

  const logoutValue = '__logout__';
  const navItems = showLogout ? [...items, { href: logoutValue, label: loggedInAs ? `Log Out (${loggedInAs})` : 'Log Out' }] : items;

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
        onChange={async (event) => {
          const next = event.target.value;
          if (!next) return;
          if (next === logoutValue) {
            setLoggingOut(true);
            await fetch('/api/auth/logout', { method: 'POST' });
            router.push('/login');
            router.refresh();
            return;
          }
          router.push(next);
        }}
      >
        {navItems.map((item) => (
          <option key={item.href} value={item.href}>
            {item.label}
          </option>
        ))}
      </select>
      {loggingOut ? <p className="portal-muted-text" style={{ margin: 0, fontSize: '0.72rem' }}>Logging out...</p> : null}
    </div>
  );
}
