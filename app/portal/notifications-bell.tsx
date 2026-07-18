'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type PortalNotification = {
  id: number;
  eventType: 'note_added' | 'media_uploaded';
  title: string;
  detail: string;
  path: string;
  actorName: string | null;
  actorRole: 'admin' | 'coach' | 'player' | 'unknown';
  playerName: string | null;
  createdAt: string;
};

type NotificationsPayload = {
  count?: number;
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

function roleLabel(value: PortalNotification['actorRole']): string {
  if (value === 'admin') return 'Admin';
  if (value === 'coach') return 'Coach';
  if (value === 'player') return 'Player';
  return 'User';
}

export default function PortalNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [acknowledgedId, setAcknowledgedId] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const visibleCount = useMemo(() => (count > 99 ? '99+' : String(count)), [count]);
  const newestNotificationId = useMemo(
    () => notifications.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0),
    [notifications]
  );

  useEffect(() => {
    const storageKey = 'portalNotificationsAcknowledgedId';
    const readAcknowledgedId = () => {
      try {
        const stored = Number(window.localStorage.getItem(storageKey) ?? '0');
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
      } catch {
        return 0;
      }
    };
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch('/api/portal/notifications?limit=15&sinceDays=30', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load notifications.');
        const payload = (await response.json().catch(() => ({}))) as NotificationsPayload;
        if (!active) return;
        const rows = Array.isArray(payload.notifications) ? payload.notifications : [];
        const currentAcknowledgedId = readAcknowledgedId();
        setAcknowledgedId(currentAcknowledgedId);
        setCount(currentAcknowledgedId > 0 ? rows.filter((item) => Number(item.id) > currentAcknowledgedId).length : (Number(payload.count ?? 0) || 0));
        setNotifications(rows);
      } catch {
        if (!active) return;
        setCount(0);
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

  function clearNotificationAlerts() {
    if (newestNotificationId <= 0) {
      setCount(0);
      return;
    }
    setAcknowledgedId(newestNotificationId);
    setCount(0);
    try {
      window.localStorage.setItem('portalNotificationsAcknowledgedId', String(newestNotificationId));
    } catch {
      // Ignore private browsing/storage failures; the current page still clears.
    }
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
        aria-label={`Notifications${count ? `, ${count} recent` : ''}`}
        aria-expanded={open}
        onClick={() => {
          clearNotificationAlerts();
          setOpen((current) => !current);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 22a2.6 2.6 0 0 0 2.45-1.75h-4.9A2.6 2.6 0 0 0 12 22Zm7.1-5.2-1.4-1.6V10a5.72 5.72 0 0 0-4.45-5.58V3.75a1.25 1.25 0 0 0-2.5 0v.67A5.72 5.72 0 0 0 6.3 10v5.2l-1.4 1.6a1.08 1.08 0 0 0 .82 1.78h12.56a1.08 1.08 0 0 0 .82-1.78ZM8.2 16.55V10a3.8 3.8 0 0 1 7.6 0v6.55H8.2Z" />
        </svg>
        {count > 0 ? <span className="portal-notifications-badge">{visibleCount}</span> : null}
      </button>

      {open ? (
        <div className="portal-notifications-menu">
          <div className="portal-notifications-head">
            <strong>Notifications</strong>
            <span>{count ? `${count} new` : 'No new alerts'}</span>
          </div>
          <div className="portal-notifications-list">
            {loading && notifications.length === 0 ? <p className="portal-notifications-empty">Loading...</p> : null}
            {!loading && notifications.length === 0 ? <p className="portal-notifications-empty">No recent notes or uploads.</p> : null}
            {notifications.map((item) => {
              const isUnread = Number(item.id) > acknowledgedId;
              return (
                <Link key={item.id} href={item.path || '/portal/dashboard'} className="portal-notification-item" onClick={() => { clearNotificationAlerts(); setOpen(false); }}>
                  <span className={isUnread ? `portal-notification-dot ${item.eventType === 'media_uploaded' ? 'is-media' : 'is-note'}` : 'portal-notification-dot-spacer'} aria-hidden="true" />
                  <span className="portal-notification-copy">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <small>
                      {item.actorName ? `${item.actorName} · ` : ''}{roleLabel(item.actorRole)} · {formatRelativeTime(item.createdAt)}
                    </small>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
