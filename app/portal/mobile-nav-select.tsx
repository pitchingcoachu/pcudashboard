'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { unregisterNativePushDevice } from './native-push-registration';

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
  const [open, setOpen] = useState(false);

  const selectedHref = useMemo(() => {
    if (currentHref) return currentHref;
    const sorted = [...items].sort((a, b) => b.href.length - a.href.length);
    const match = sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    return match?.href ?? items[0]?.href ?? '';
  }, [currentHref, items, pathname]);

  const logoutValue = '__logout__';
  const navItems = showLogout ? [...items, { href: logoutValue, label: loggedInAs ? `Log Out (${loggedInAs})` : 'Log Out' }] : items;
  const selectedLabel = navItems.find((item) => item.href === selectedHref)?.label ?? navItems[0]?.label ?? 'Menu';

  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const { body, documentElement } = document;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      touchAction: body.style.touchAction,
      overscrollBehavior: body.style.overscrollBehavior,
    };
    const previousHtmlStyles = {
      overflow: documentElement.style.overflow,
      overscrollBehavior: documentElement.style.overscrollBehavior,
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    body.style.overscrollBehavior = 'none';
    documentElement.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.touchAction = previousBodyStyles.touchAction;
      body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
      documentElement.style.overflow = previousHtmlStyles.overflow;
      documentElement.style.overscrollBehavior = previousHtmlStyles.overscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  async function handleSelection(next: string) {
    if (!next) return;
    setOpen(false);
    if (next === logoutValue) {
      setLoggingOut(true);
      await unregisterNativePushDevice();
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
      return;
    }
    router.push(next);
  }

  if (items.length === 0) return null;

  return (
    <div className="portal-nav-mobile-wrap">
      <button
        type="button"
        className="portal-nav-mobile"
        aria-label={`Open ${ariaLabel.toLowerCase()} menu`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span>Go to</span>
        <strong>{selectedLabel}</strong>
      </button>
      {loggingOut ? <p className="portal-muted-text" style={{ margin: 0, fontSize: '0.72rem' }}>Logging out...</p> : null}
      {open ? (
        <div className="portal-nav-mobile-sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="portal-nav-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="portal-nav-mobile-sheet-head">
              <strong>Go to</strong>
              <button type="button" className="portal-nav-mobile-sheet-close" aria-label="Close navigation menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="portal-nav-mobile-sheet-list">
              {navItems.map((item) => {
                const selected = item.href === selectedHref;
                const isLogout = item.href === logoutValue;
                return (
                  <button
                    key={item.href}
                    type="button"
                    className={`portal-nav-mobile-sheet-option${selected ? ' active' : ''}${isLogout ? ' is-logout' : ''}`}
                    aria-current={selected ? 'page' : undefined}
                    onClick={() => void handleSelection(item.href)}
                  >
                    <span>{item.label}</span>
                    {selected ? <small>Current</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
