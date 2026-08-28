import { requirePortalSession } from '../../../../lib/portal-session';
import { listPlayerChoicesByOrganization } from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import ForcePlatesLiveSearch from './force-plates-live-search';

export default async function ForcePlatesLivePage() {
  const session = await requirePortalSession();
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const playersRaw =
    programmingOrganizationId > 0
      ? await listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: null,
        })
      : [];

  const players = playersRaw.map((player) => ({
    id: player.playerId,
    name: player.fullName,
  }));

  return (
    <div className="portal-admin-stack">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Force Plate Live Search</h2>
        <p>Search a player and pull their ForceDecks data straight from VALD, on demand -- no sync required. Looks back 30 days.</p>
      </div>
      {programmingOrganizationId > 0 ? (
        <article className="portal-admin-card">
          <ForcePlatesLiveSearch players={players} />
        </article>
      ) : null}
    </div>
  );
}
