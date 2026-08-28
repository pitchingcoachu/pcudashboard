'use client';

import { useMemo, useState } from 'react';
import type { PlayerGroupRow, PlayerGroupWithMembersRow, PlayerSummaryRow } from '../../../../../lib/training-db';

type Props = {
  initialGroups: PlayerGroupRow[];
  players: PlayerSummaryRow[];
};

export default function PlayerGroupsManager({ initialGroups, players }: Props) {
  const [groups, setGroups] = useState<PlayerGroupRow[]>(initialGroups);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<PlayerGroupWithMembersRow | null>(null);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [renameValue, setRenameValue] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredPlayers = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    if (!q) return players;
    return players.filter((player) => player.fullName.toLowerCase().includes(q));
  }, [players, playerQuery]);

  async function refreshGroups() {
    const response = await fetch('/api/admin/player-groups');
    const payload = (await response.json().catch(() => ({}))) as { groups?: PlayerGroupRow[]; error?: string };
    if (response.ok) setGroups(payload.groups ?? []);
  }

  async function openGroup(groupId: number) {
    setSelectedGroupId(groupId);
    setSelectedGroup(null);
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/admin/player-groups?groupId=${groupId}`);
      const payload = (await response.json().catch(() => ({}))) as { group?: PlayerGroupWithMembersRow; error?: string };
      if (!response.ok || !payload.group) throw new Error(payload.error ?? 'Failed to load group.');
      setSelectedGroup(payload.group);
      setRenameValue(payload.group.name);
      setMemberIds(new Set(payload.group.members.map((member) => member.playerId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group.');
    } finally {
      setIsLoading(false);
    }
  }

  function closeGroup() {
    setSelectedGroupId(null);
    setSelectedGroup(null);
    setPlayerQuery('');
  }

  function toggleMember(playerId: number) {
    setMemberIds((previous) => {
      const next = new Set(previous);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  async function handleCreateGroup(event: React.FormEvent) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/player-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => ({}))) as { group?: PlayerGroupWithMembersRow; error?: string };
      if (!response.ok || !payload.group) throw new Error(payload.error ?? 'Failed to create group.');
      setNewGroupName('');
      await refreshGroups();
      setMessage(`Created "${payload.group.name}".`);
      openGroup(payload.group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveGroup() {
    if (!selectedGroupId) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/player-groups', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroupId, name: renameValue, playerIds: Array.from(memberIds) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { group?: PlayerGroupWithMembersRow; error?: string };
      if (!response.ok || !payload.group) throw new Error(payload.error ?? 'Failed to save group.');
      setSelectedGroup(payload.group);
      await refreshGroups();
      setMessage('Group saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save group.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteGroup() {
    if (!selectedGroupId) return;
    if (!window.confirm(`Delete "${selectedGroup?.name ?? 'this group'}"? This can't be undone.`)) return;
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/player-groups?groupId=${selectedGroupId}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Failed to delete group.');
      closeGroup();
      await refreshGroups();
      setMessage('Group deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <article className="portal-admin-card">
        <h3>Create Group</h3>
        <form className="portal-form-grid" onSubmit={handleCreateGroup}>
          <label>
            Group Name
            <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Varsity" required />
          </label>
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? 'Creating...' : 'Create Group'}
          </button>
        </form>
      </article>

      <article className="portal-admin-card">
        <h3>Groups</h3>
        {groups.length === 0 ? (
          <p>No groups yet. Create one above.</p>
        ) : (
          <div className="portal-choice-line-actions" style={{ flexWrap: 'wrap' }}>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={group.id === selectedGroupId ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => openGroup(group.id)}
              >
                {group.name} ({group.memberCount})
              </button>
            ))}
          </div>
        )}
      </article>

      {message ? <p className="auth-message">{message}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      {selectedGroupId ? (
        <article className="portal-admin-card">
          <h3>Edit Group</h3>
          {isLoading || !selectedGroup ? (
            <p>Loading...</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                Group Name
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required />
              </label>

              <label>
                Search Players
                <input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Search..." />
              </label>

              <div className="portal-choice-line-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setMemberIds(new Set(filteredPlayers.map((p) => p.playerId)))}>
                  Select All{playerQuery ? ' Matching' : ''}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setMemberIds(new Set())}>
                  Clear Players
                </button>
                <span className="portal-muted-text">{memberIds.size} selected</span>
              </div>

              <div className="portal-questionnaire-player-list">
                {filteredPlayers.map((player) => (
                  <label key={player.playerId} className="portal-questionnaire-player-option">
                    <input type="checkbox" checked={memberIds.has(player.playerId)} onChange={() => toggleMember(player.playerId)} />
                    <span>{player.fullName}</span>
                  </label>
                ))}
                {filteredPlayers.length === 0 ? <p className="portal-muted-text">No players match.</p> : null}
              </div>

              <div className="portal-choice-line-actions">
                <button type="button" className="btn btn-primary" onClick={handleSaveGroup} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Group'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={closeGroup}>
                  Close
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleDeleteGroup} disabled={isSaving}>
                  Delete Group
                </button>
              </div>
            </div>
          )}
        </article>
      ) : null}
    </>
  );
}
