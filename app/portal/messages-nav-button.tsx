'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useUnreadMessageCount } from './use-unread-counts';

export default function PortalMessagesNavButton() {
  const unreadCount = useUnreadMessageCount();
  const visibleCount = useMemo(() => (unreadCount > 99 ? '99+' : String(unreadCount)), [unreadCount]);

  return (
    <Link href="/portal/messages" className="portal-notifications-btn" aria-label={`Messages${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4.5 4V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      {unreadCount > 0 ? <span className="portal-notifications-badge">{visibleCount}</span> : null}
    </Link>
  );
}
