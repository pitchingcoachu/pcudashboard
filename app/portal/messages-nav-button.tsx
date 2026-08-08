'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listConversations } from '../../lib/messages-client';

const POLL_INTERVAL_MS = 15000;

export default function PortalMessagesNavButton() {
  const [unreadCount, setUnreadCount] = useState(0);
  const visibleCount = useMemo(() => (unreadCount > 99 ? '99+' : String(unreadCount)), [unreadCount]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await listConversations();
        if (!active) return;
        const total = (response.conversations ?? []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        setUnreadCount(total);
      } catch {
        // Best-effort -- the next poll will catch up.
      }
    }
    void load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Link href="/portal/messages" className="portal-notifications-btn" aria-label={`Messages${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4.5 4V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      {unreadCount > 0 ? <span className="portal-notifications-badge">{visibleCount}</span> : null}
    </Link>
  );
}
