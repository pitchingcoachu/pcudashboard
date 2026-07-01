'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export default function PortalActivityTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPathRef = useRef('');

  useEffect(() => {
    const query = searchParams.toString();
    const path = `${pathname}${query ? `?${query}` : ''}`;
    if (!path || lastPathRef.current === path) return;
    lastPathRef.current = path;
    window
      .fetch('/api/portal/activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventType: 'page_view', path }),
        keepalive: true,
      })
      .catch(() => {});
  }, [pathname, searchParams]);

  return null;
}
