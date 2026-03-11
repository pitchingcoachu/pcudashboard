'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useMemo, useState } from 'react';
import type { ClientRow, CoachRow } from '../../../../lib/training-db';

type Props = {
  coaches: CoachRow[];
  clients: ClientRow[];
  currentUserId: number;
};

export function CoachesTable({ coaches, clients, currentUserId }: Props) {
  const [expandedCoachId, setExpandedCoachId] = useState<number | null>(null);

  const playersByCoach = useMemo(() => {
    const map = new Map<number, ClientRow[]>();
    for (const coach of coaches) {
      const coachId = Number(coach.userId);
      map.set(
        coach.userId,
        clients.filter((client) => Number(client.assignedCoachUserId ?? 0) === coachId)
      );
    }
    return map;
  }, [coaches, clients]);

  return (
    <div className="portal-table-wrap">
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
            const isExpanded = expandedCoachId === coach.userId;
            const assignedPlayers = playersByCoach.get(coach.userId) ?? [];
            return (
              <Fragment key={coach.userId}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="portal-inline-link portal-coach-name-link"
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      onClick={() => setExpandedCoachId((prev) => (prev === coach.userId ? null : coach.userId))}
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
                    {coach.userId === currentUserId ? (
                      <span className="portal-muted-text">Current user</span>
                    ) : (
                      <>
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
  );
}
