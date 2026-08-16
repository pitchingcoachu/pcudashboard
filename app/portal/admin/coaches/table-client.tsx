'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useMemo, useState } from 'react';
import type { CoachAssignedPlayerRow, CoachRow } from '../../../../lib/training-db';

type Props = {
  coaches: CoachRow[];
  clients: CoachAssignedPlayerRow[];
  currentUserId: number;
  canManageAdmins: boolean;
};

export function CoachesTable({ coaches, clients, currentUserId, canManageAdmins }: Props) {
  const [expandedCoachId, setExpandedCoachId] = useState<number | null>(null);

  const playersByCoach = useMemo(() => {
    const map = new Map<number, CoachAssignedPlayerRow[]>();
    for (const coach of coaches) {
      const coachId = Number(coach.userId);
      map.set(coachId, []);
    }
    for (const client of clients) {
      const coachId = Number(client.assignedCoachUserId ?? 0);
      if (coachId <= 0) continue;
      const bucket = map.get(coachId);
      if (!bucket) continue;
      bucket.push(client);
    }
    return map;
  }, [coaches, clients]);

  return (
    <>
      <div className="portal-roster-cards">
        {coaches.map((coach) => {
          const coachId = Number(coach.userId);
          const isExpanded = expandedCoachId === coachId;
          const assignedPlayers = playersByCoach.get(coach.userId) ?? [];
          const canManageCoach = coachId !== currentUserId && (canManageAdmins || coach.role === 'coach');
          const initials = coach.name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase();
          return (
            <div key={coachId}>
              <button
                type="button"
                className="portal-roster-card"
                style={{ width: '100%', border: 'none', cursor: 'pointer' }}
                onClick={() => setExpandedCoachId((prev) => (prev === coachId ? null : coachId))}
              >
                <span className="portal-roster-card-avatar" aria-hidden="true">
                  {initials || '?'}
                </span>
                <span className="portal-roster-card-body">
                  <span className="portal-roster-card-name">{coach.name}</span>
                  <span className="portal-roster-card-meta">
                    {coach.role} &middot; {coach.assignedPlayerCount} player{coach.assignedPlayerCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className={`portal-roster-card-status${coach.isActive ? '' : ' is-inactive'}`}>
                  {coach.isActive ? 'Active' : 'Inactive'}
                </span>
              </button>
              {isExpanded ? (
                <div className="portal-admin-card" style={{ marginTop: 6 }}>
                  {coachId === currentUserId ? (
                    <span className="portal-muted-text">Current user</span>
                  ) : !canManageCoach ? (
                    <span className="portal-muted-text">Admin only</span>
                  ) : (
                    <div className="portal-choice-line-actions">
                      <Link className="btn btn-ghost as-link" href={`/portal/admin/coaches?edit=${coachId}`}>
                        Edit
                      </Link>
                      <form method="post" action="/api/admin/coaches/manage">
                        <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                        <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                        <input type="hidden" name="action" value={coach.isActive ? 'deactivate' : 'activate'} />
                        <button type="submit" className="btn btn-ghost">
                          {coach.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </form>
                      <form method="post" action="/api/admin/coaches/manage">
                        <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                        <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                        <input type="hidden" name="action" value="delete" />
                        <button type="submit" className="btn btn-ghost">
                          Delete
                        </button>
                      </form>
                    </div>
                  )}
                  <strong style={{ display: 'block', marginTop: 10 }}>Assigned Players</strong>
                  {assignedPlayers.length === 0 ? (
                    <p className="portal-muted-text">No players are currently assigned to this coach.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                      {assignedPlayers.map((player) => (
                        <Link
                          key={player.playerId}
                          href={`/portal/player?previewPlayerId=${player.playerId}`}
                          className="portal-roster-card"
                        >
                          <span className="portal-roster-card-body">
                            <span className="portal-roster-card-name">{player.fullName}</span>
                            <span className="portal-roster-card-meta">{player.email}</span>
                          </span>
                          <span className="portal-roster-card-status">{player.status}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="portal-roster-table-wrap portal-table-wrap">
      <table className="portal-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Role</th>
            <th>Status</th>
            <th>Assigned</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {coaches.map((coach) => {
            const coachId = Number(coach.userId);
            const isExpanded = expandedCoachId === coachId;
            const assignedPlayers = playersByCoach.get(coach.userId) ?? [];
            const canManageCoach = coachId !== currentUserId && (canManageAdmins || coach.role === 'coach');
            return (
              <Fragment key={coachId}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="portal-inline-link portal-coach-name-link"
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      onClick={() => setExpandedCoachId((prev) => (prev === coachId ? null : coachId))}
                    >
                      {coach.name}
                    </button>
                  </td>
                  <td>{coach.email}</td>
                  <td>{coach.phone ?? '-'}</td>
                  <td>{coach.role}</td>
                  <td>{coach.isActive ? 'Active' : 'Inactive'}</td>
                  <td>{coach.assignedPlayerCount}</td>
                  <td className="portal-table-actions">
                    {coachId === currentUserId ? (
                      <span className="portal-muted-text">Current user</span>
                    ) : !canManageCoach ? (
                      <span className="portal-muted-text">Admin only</span>
                    ) : (
                      <>
                        <Link className="btn btn-ghost as-link" href={`/portal/admin/coaches?edit=${coachId}`}>
                          Edit
                        </Link>
                        <form method="post" action="/api/admin/coaches/manage">
                          <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                          <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                          <input type="hidden" name="action" value={coach.isActive ? 'deactivate' : 'activate'} />
                          <button type="submit" className="btn btn-ghost">
                            {coach.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </form>
                        <form method="post" action="/api/admin/coaches/manage">
                          <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                          <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                          <input type="hidden" name="action" value="delete" />
                          <button type="submit" className="btn btn-ghost">
                            Delete
                          </button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7}>
                      <strong>Assigned Players</strong>
                      {assignedPlayers.length === 0 ? (
                        <p className="portal-muted-text">No players are currently assigned to this coach.</p>
                      ) : (
                        <div className="portal-table-wrap" style={{ marginTop: '0.45rem' }}>
                          <table className="portal-table">
                            <thead>
                              <tr>
                                <th>Player</th>
                                <th>Email</th>
                                <th>Status</th>
                                <th>Profile</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assignedPlayers.map((player) => (
                                <tr key={player.playerId}>
                                  <td>{player.fullName}</td>
                                  <td>{player.email}</td>
                                  <td>{player.status}</td>
                                  <td>
                                    <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${player.playerId}`}>
                                      View Profile
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
