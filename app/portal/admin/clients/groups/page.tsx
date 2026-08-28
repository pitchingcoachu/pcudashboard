import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { listPlayerGroups, listPlayerSummariesByOrganization } from '../../../../../lib/training-db';
import PlayerGroupsManager from './player-groups-manager';

export default async function PlayerGroupsPage() {
  const session = await requirePortalSession();
  // Groups are coach/admin-only, end to end -- players never see this page
  // or any group membership about themselves.
  if (session.role === 'player') notFound();

  const organizationId = await resolveProgrammingOrganizationId(session);
  const [groups, players] = organizationId > 0
    ? await Promise.all([
        listPlayerGroups({ organizationId }),
        listPlayerSummariesByOrganization({ organizationId }),
      ])
    : [[], []];

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Player Groups</h2>
        <p>Organize players into groups like Varsity or JV, then apply a workout to the whole group at once.</p>
      </div>

      {organizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Player Groups</h3>
          <p>Session context missing. Please log out and log in again.</p>
        </article>
      ) : (
        <PlayerGroupsManager initialGroups={groups} players={players} />
      )}
    </div>
  );
}
