'use client';

import { useEffect, useMemo, useState } from 'react';

type Visibility = 'private' | 'organization' | 'global';

type SavedItem = {
  id: number;
  name: string;
  schoolCode: string;
  visibility: Visibility;
  columnCount?: number;
  updatedAt: string;
};

type Group = {
  key: string;
  kind: 'table' | 'report';
  name: string;
  items: SavedItem[];
};

function visibilityLabel(value: Visibility): string {
  if (value === 'private') return 'Only me';
  if (value === 'global') return 'All sites';
  return 'My organization';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupItems(kind: 'table' | 'report', items: SavedItem[]): Group[] {
  const byName = new Map<string, SavedItem[]>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(item);
    byName.set(key, list);
  }
  return Array.from(byName.entries())
    .map(([key, groupItems]) => ({
      key: `${kind}-${key}`,
      kind,
      name: groupItems[0].name,
      items: groupItems.sort((a, b) => a.schoolCode.localeCompare(b.schoolCode)),
    }))
    .sort((a, b) => {
      const aLatest = Math.max(...a.items.map((item) => new Date(item.updatedAt).getTime() || 0));
      const bLatest = Math.max(...b.items.map((item) => new Date(item.updatedAt).getTime() || 0));
      return bLatest - aLatest;
    });
}

export default function MySavedViewsCard() {
  const [tables, setTables] = useState<SavedItem[]>([]);
  const [reports, setReports] = useState<SavedItem[]>([]);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/portal/my-saved-views', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        tables?: SavedItem[];
        reports?: SavedItem[];
        isGlobalAdmin?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load saved views.');
      setTables(payload.tables ?? []);
      setReports(payload.reports ?? []);
      setIsGlobalAdmin(Boolean(payload.isGlobalAdmin));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved views.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tableGroups = useMemo(() => groupItems('table', tables), [tables]);
  const reportGroups = useMemo(() => groupItems('report', reports), [reports]);

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyGroupVisibility = async (group: Group, visibility: Visibility) => {
    setBusyKey(group.key);
    setError('');
    try {
      const response = await fetch('/api/portal/my-saved-views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: group.kind, ids: group.items.map((item) => item.id), visibility }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update visibility.');
      const updater = (current: SavedItem[]) =>
        current.map((item) => (group.items.some((groupItem) => groupItem.id === item.id) ? { ...item, visibility } : item));
      if (group.kind === 'table') setTables(updater);
      else setReports(updater);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility.');
    } finally {
      setBusyKey('');
    }
  };

  const changeItemVisibility = async (kind: 'table' | 'report', id: number, visibility: Visibility) => {
    const key = `${kind}-item-${id}`;
    setBusyKey(key);
    setError('');
    try {
      const response = await fetch('/api/portal/my-saved-views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, visibility }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update visibility.');
      const updater = (current: SavedItem[]) => current.map((item) => (item.id === id ? { ...item, visibility } : item));
      if (kind === 'table') setTables(updater);
      else setReports(updater);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility.');
    } finally {
      setBusyKey('');
    }
  };

  const removeGroup = async (group: Group) => {
    setBusyKey(group.key);
    setError('');
    try {
      const response = await fetch(
        `/api/portal/my-saved-views?kind=${group.kind}&ids=${group.items.map((item) => item.id).join(',')}`,
        { method: 'DELETE' }
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete.');
      const ids = new Set(group.items.map((item) => item.id));
      if (group.kind === 'table') setTables((current) => current.filter((item) => !ids.has(item.id)));
      else setReports((current) => current.filter((item) => !ids.has(item.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setBusyKey('');
    }
  };

  const removeItem = async (kind: 'table' | 'report', id: number) => {
    const key = `${kind}-item-${id}`;
    setBusyKey(key);
    setError('');
    try {
      const response = await fetch(`/api/portal/my-saved-views?kind=${kind}&id=${id}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete.');
      if (kind === 'table') setTables((current) => current.filter((item) => item.id !== id));
      else setReports((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setBusyKey('');
    }
  };

  const renderGroup = (group: Group) => {
    const busy = busyKey === group.key;
    const isOpen = expanded.has(group.key);
    const uniformVisibility =
      group.items.every((item) => item.visibility === group.items[0].visibility) ? group.items[0].visibility : null;
    const totalColumns = group.kind === 'table' ? group.items[0].columnCount : undefined;
    const latestUpdate = group.items.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), group.items[0].updatedAt);

    return (
      <div key={group.key} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.6rem 0.85rem' }}>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => toggleExpanded(group.key)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isOpen ? '▾' : '▸'} {group.name}
              </div>
            </button>
            <div className="portal-muted-text" style={{ fontSize: '0.8rem' }}>
              {group.items.length > 1
                ? `${group.items.length} school${group.items.length === 1 ? '' : 's'}`
                : group.items[0].schoolCode}
              {totalColumns !== undefined ? ` · ${totalColumns} column${totalColumns === 1 ? '' : 's'}` : ''}
              {' · '}
              {formatTimestamp(latestUpdate)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <select
              value={uniformVisibility ?? ''}
              disabled={busy}
              onChange={(event) => void applyGroupVisibility(group, event.target.value as Visibility)}
            >
              {!uniformVisibility ? <option value="">Mixed</option> : null}
              <option value="private">Only me</option>
              <option value="organization">My organization</option>
              {isGlobalAdmin ? <option value="global">All sites</option> : null}
            </select>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void removeGroup(group)}>
              {busy ? '...' : group.items.length > 1 ? `Delete All (${group.items.length})` : 'Delete'}
            </button>
          </div>
        </div>

        {isOpen && group.items.length > 1 ? (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '0.5rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {group.items.map((item) => {
              const itemKey = `${group.kind}-item-${item.id}`;
              const itemBusy = busyKey === itemKey;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span className="portal-muted-text" style={{ fontSize: '0.85rem' }}>
                    {item.schoolCode} · {visibilityLabel(item.visibility)}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <select
                      value={item.visibility}
                      disabled={itemBusy}
                      onChange={(event) => void changeItemVisibility(group.kind, item.id, event.target.value as Visibility)}
                      style={{ fontSize: '0.8rem' }}
                    >
                      <option value="private">Only me</option>
                      <option value="organization">My organization</option>
                      {isGlobalAdmin ? <option value="global">All sites</option> : null}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                      disabled={itemBusy}
                      onClick={() => void removeItem(group.kind, item.id)}
                    >
                      {itemBusy ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <article className="portal-admin-card">
      <h2>My Saved Views</h2>
      <p className="portal-muted-text" style={{ marginTop: 0 }}>
        Custom tables and reports you&apos;ve built on the dashboard. Items with the same name across multiple schools
        are grouped together — change visibility for all of them at once, or expand to edit a single school&apos;s copy.
      </p>

      {loading ? <p className="portal-muted-text">Loading...</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      {!loading && tableGroups.length === 0 && reportGroups.length === 0 ? (
        <p className="portal-muted-text">You haven&apos;t built any custom tables or reports yet.</p>
      ) : null}

      {tableGroups.length > 0 ? (
        <div style={{ marginTop: '0.5rem' }}>
          <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 0.5rem' }}>
            Custom Tables
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{tableGroups.map(renderGroup)}</div>
        </div>
      ) : null}

      {reportGroups.length > 0 ? (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 0.5rem' }}>
            Custom Reports
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{reportGroups.map(renderGroup)}</div>
        </div>
      ) : null}
    </article>
  );
}
