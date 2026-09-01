'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type RosterClient = {
  playerId: number;
  fullName: string;
  email: string;
  assignedCoachUserId: number | null;
  assignedCoachName: string | null;
  status: string;
};

type CoachOption = {
  userId: number;
  name: string;
  role: 'admin' | 'coach';
};

export default function BulkCoachAssignTable({
  clients,
  coaches,
  canManagePrograms,
  canDelete,
  pageHref,
}: {
  clients: RosterClient[];
  coaches: CoachOption[];
  canManagePrograms: boolean;
  canDelete: boolean;
  pageHref: string;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCoachUserId, setBulkCoachUserId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;

  function toggleOne(playerId: number) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((previous) => (previous.size === clients.length ? new Set() : new Set(clients.map((c) => c.playerId))));
  }

  const selectedCount = selectedIds.size;
  const bulkCoachLabel = useMemo(() => {
    if (!bulkCoachUserId) return 'Unassigned';
    return coaches.find((c) => String(c.userId) === bulkCoachUserId)?.name ?? 'Unassigned';
  }, [bulkCoachUserId, coaches]);

  async function handleBulkAssign() {
    if (!selectedCount) return;
    setIsAssigning(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/clients/bulk-assign-coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerIds: Array.from(selectedIds),
          coachUserId: bulkCoachUserId ? Number(bulkCoachUserId) : null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { succeeded?: number; failed?: { playerId: number; error: string }[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to assign coach.');
      const succeeded = payload.succeeded ?? 0;
      const failed = payload.failed ?? [];
      setMessage(
        failed.length
          ? `Assigned ${bulkCoachLabel} to ${succeeded} player${succeeded === 1 ? '' : 's'}; ${failed.length} failed.`
          : `Assigned ${bulkCoachLabel} to ${succeeded} player${succeeded === 1 ? '' : 's'}.`
      );
      setSelectedIds(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign coach.');
    } finally {
      setIsAssigning(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="portal-choice-line-actions" style={{ flexWrap: 'wrap' }}>
        <span className="portal-muted-text">{selectedCount} selected</span>
        <select value={bulkCoachUserId} onChange={(event) => setBulkCoachUserId(event.target.value)} disabled={!selectedCount || isAssigning}>
          <option value="">Unassigned</option>
          {coaches.map((coach) => (
            <option key={coach.userId} value={String(coach.userId)}>
              {coach.name} ({coach.role})
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" onClick={handleBulkAssign} disabled={!selectedCount || isAssigning}>
          {isAssigning ? 'Assigning…' : 'Assign Coach to Selected'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setSelectedIds(new Set())} disabled={!selectedCount || isAssigning}>
          Clear Selection
        </button>
      </div>
      {message ? <p className="auth-message">{message}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="portal-roster-table-wrap portal-table-wrap">
        <table className="portal-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all players" />
              </th>
              <th>Player</th>
              <th>Email</th>
              <th>Coach</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const isInactive = String(client.status ?? '').trim().toLowerCase() === 'inactive';
              return (
                <tr key={client.playerId} className={isInactive ? 'portal-table-row-inactive' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(client.playerId)}
                      onChange={() => toggleOne(client.playerId)}
                      aria-label={`Select ${client.fullName}`}
                    />
                  </td>
                  <td>{client.fullName}</td>
                  <td>{client.email}</td>
                  <td>{client.assignedCoachName ?? '-'}</td>
                  <td>{isInactive ? 'Inactive' : 'Active'}</td>
                  <td className="portal-table-actions">
                    {canManagePrograms ? (
                      <>
                        <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                          Edit Player
                        </Link>
                        <Link className="btn btn-ghost as-link" href={`/portal/admin/programs/${client.playerId}`}>
                          Build Program
                        </Link>
                        <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                          View Profile
                        </Link>
                        <Link className="btn btn-ghost as-link" href={`/portal/player/program?previewPlayerId=${client.playerId}`}>
                          Preview Program
                        </Link>
                      </>
                    ) : (
                      <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                        Edit Player
                      </Link>
                    )}
                    <form method="post" action="/api/admin/clients/manage" style={{ display: 'inline' }}>
                      <input type="hidden" name="redirectTo" value={pageHref} />
                      <input type="hidden" name="action" value={isInactive ? 'activate' : 'deactivate'} />
                      <input type="hidden" name="playerId" value={String(client.playerId)} />
                      <button type="submit" className="btn btn-ghost">
                        {isInactive ? 'Activate' : 'Deactivate'}
                      </button>
                    </form>
                    {canDelete ? (
                      <form method="post" action="/api/admin/clients/manage" style={{ display: 'inline' }}>
                        <input type="hidden" name="redirectTo" value="/portal/admin/clients" />
                        <input type="hidden" name="action" value="delete" />
                        <input type="hidden" name="playerId" value={String(client.playerId)} />
                        <button type="submit" className="btn btn-ghost">
                          Delete Player
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
