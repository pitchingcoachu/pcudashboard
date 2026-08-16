'use client';

import { useEffect, useState } from 'react';
import { listConversations } from '../../lib/messages-client';

const POLL_INTERVAL_MS = 15000;

export function useUnreadMessageCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await listConversations();
        if (!active) return;
        const total = (response.conversations ?? []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        setCount(total);
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

  return count;
}

export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/portal/notifications?limit=1', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load notifications.');
        const payload = (await response.json().catch(() => ({}))) as { unreadCount?: number };
        if (!active) return;
        setCount(Number(payload.unreadCount ?? 0) || 0);
      } catch {
        // Best-effort -- the next poll will catch up.
      }
    }
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return count;
}
