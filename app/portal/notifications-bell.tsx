'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type PortalNotification = {
  id: number;
  eventType: string;
  title: string;
  detail: string | null;
  path: string | null;
  actorName: string | null;
  actorRole: string | null;
  playerName: string | null;
  read: boolean;
  createdAt: string;
};

type NotificationsPayload = {
  unreadCount?: number;
  notifications?: PortalNotification[];
};

function formatRelativeTime(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`;
  if (diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

function roleLabel(value: string | null): string {
  if (value === 'admin') return 'Admin';
  if (value === 'coach') return 'Coach';
  if (value === 'player') return 'Player';
  return 'User';
}

export default function PortalNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const visibleCount = useMemo(() => (unreadCount > 99 ? '99+' : String(unreadCount)), [unreadCount]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch('/api/portal/notifications?limit=20', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load notifications.');
        const payload = (await response.json().catch(() => ({}))) as NotificationsPayload;
        if (!active) return;
        setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
        setUnreadCount(Number(payload.unreadCount ?? 0) || 0);
      } catch {
        if (!active) return;
        setUnreadCount(0);
        setNotifications([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  function markAllRead() {
    if (unreadCount <= 0) return;
    setUnreadCount(0);
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    fetch('/api/portal/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  function markOneRead(id: number) {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnreadCount((current) => Math.max(0, current - 1));
    fetch('/api/portal/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds: [id] }),
    }).catch(() => {});
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="portal-notifications" ref={wrapRef}>
      <button
        type="button"
        className="portal-notifications-btn"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 22a2.6 2.6 0 0 0 2.45-1.75h-4.9A2.6 2.6 0 0 0 12 22Zm7.1-5.2-1.4-1.6V10a5.72 5.72 0 0 0-4.45-5.58V3.75a1.25 1.25 0 0 0-2.5 0v.67A5.72 5.72 0 0 0 6.3 10v5.2l-1.4 1.6a1.08 1.08 0 0 0 .82 1.78h12.56a1.08 1.08 0 0 0 .82-1.78ZM8.2 16.55V10a3.8 3.8 0 0 1 7.6 0v6.55H8.2Z" />
        </svg>
        {unreadCount > 0 ? <span className="portal-notifications-badge">{visibleCount}</span> : null}
      </button>

      {open ? (
        <div className="portal-notifications-menu">
          <div className="portal-notifications-head">
            <strong>Notifications</strong>
            {unreadCount > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={markAllRead}>
                Mark all read
              </button>
            ) : (
              <span>No new alerts</span>
            )}
          </div>
          <div className="portal-notifications-list">
            {loading && notifications.length === 0 ? <p className="portal-notifications-empty">Loading...</p> : null}
            {!loading && notifications.length === 0 ? <p className="portal-notifications-empty">No recent notes or uploads.</p> : null}
            {notifications.map((item) => (
              <Link
                key={item.id}
                href={item.path || '/portal/dashboard'}
                className="portal-notification-item"
                onClick={() => {
                  markOneRead(item.id);
                  setOpen(false);
                }}
              >
                <span className={!item.read ? `portal-notification-dot ${item.eventType === 'media_uploaded' ? 'is-media' : 'is-note'}` : 'portal-notification-dot-spacer'} aria-hidden="true" />
                <span className="portal-notification-copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <small>
                    {item.actorName ? `${item.actorName} · ` : ''}{roleLabel(item.actorRole)} · {formatRelativeTime(item.createdAt)}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
