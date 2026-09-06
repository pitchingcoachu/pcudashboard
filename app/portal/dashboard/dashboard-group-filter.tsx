'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type DashboardGroup = {
  id: number;
  name: string;
  memberNames: string[];
};

type Props = {
  startDate: string;
  endDate: string;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onMemberNamesChange: (names: string[]) => void;
};

export default function DashboardGroupFilter({
  startDate,
  endDate,
  selectedIds,
  onChange,
  onMemberNamesChange,
}: Props) {
  const [groups, setGroups] = useState<DashboardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    fetch(`/api/dashboard/player-groups?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { groups?: DashboardGroup[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Failed to load groups.');
        setGroups(payload.groups ?? []);
        setError('');
      })
      .catch((reason) => {
        if ((reason as { name?: string })?.name !== 'AbortError') {
          setGroups([]);
          setError(reason instanceof Error ? reason.message : 'Failed to load groups.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [startDate, endDate]);

  const validSelectedIds = useMemo(() => {
    const available = new Set(groups.map((group) => group.id));
    return selectedIds.filter((id) => available.has(id));
  }, [groups, selectedIds]);

  const memberNames = useMemo(() => {
    if (validSelectedIds.length === 0) return [];
    const selected = new Set(validSelectedIds);
    const names = new Map<string, string>();
    for (const group of groups) {
      if (!selected.has(group.id)) continue;
      for (const name of group.memberNames) {
        const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized && !names.has(normalized)) names.set(normalized, name.trim());
      }
    }
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [groups, validSelectedIds]);

  useEffect(() => {
    onMemberNamesChange(memberNames);
  }, [memberNames, onMemberNamesChange]);

  useEffect(() => {
    if (!loading && validSelectedIds.length !== selectedIds.length) onChange(validSelectedIds);
  }, [loading, onChange, selectedIds, validSelectedIds]);

  const selected = new Set(validSelectedIds);
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(query.trim().toLowerCase()));
  const summary = loading
    ? 'Loading groups…'
    : selected.size === 0
      ? 'All groups'
      : selected.size === 1
        ? groups.find((group) => selected.has(group.id))?.name ?? '1 group'
        : `${selected.size} groups`;

  function toggle(groupId: number) {
    const next = new Set(validSelectedIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    onChange(Array.from(next));
  }

  return (
    <label className="portal-dashboard-group-filter">
      Groups
      <div className="portal-search-select" ref={rootRef}>
        <button
          type="button"
          className="portal-search-select-trigger"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {summary}
        </button>
        {open ? (
          <div className="portal-search-select-menu">
            <input
              className="portal-search-select-input"
              placeholder="Type to filter..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="portal-search-select-options">
              <button
                type="button"
                className="portal-search-select-option portal-search-select-option-multi"
                onClick={() => onChange([])}
              >
                <span>{selected.size === 0 ? '✓' : ''}</span>
                <span>All</span>
              </button>
              {filteredGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="portal-search-select-option portal-search-select-option-multi"
                  onClick={() => toggle(group.id)}
                >
                  <span>{selected.has(group.id) ? '✓' : ''}</span>
                  <span>{group.name}</span>
                </button>
              ))}
              {!loading && groups.length === 0 ? <p className="portal-muted-text">No groups created yet.</p> : null}
              {!loading && groups.length > 0 && filteredGroups.length === 0 ? <p className="portal-muted-text">No groups match.</p> : null}
            </div>
            {error ? <p className="auth-error">{error}</p> : null}
          </div>
        ) : null}
      </div>
    </label>
  );
}
