import { requirePortalSession } from '../../../../lib/portal-session';
import { listPlayerChoicesByOrganization } from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import TestingBuilder from './testing-builder';

export default async function AdminTestingPage() {
  const session = await requirePortalSession();
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const brand = resolveSchoolBrand(programmingSchoolCode);
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
        <h2>Testing</h2>
        <p>Build testing dashboards for player trends across body weight and exercise performance.</p>
      </div>
      {programmingOrganizationId > 0 ? (
        <article className="portal-admin-card">
          <TestingBuilder
            players={players}
            schoolCode={programmingSchoolCode}
            schoolLogoSrc={brand.logoSrc}
            schoolLogoAlt={brand.logoAlt}
          />
        </article>
      ) : null}
    </div>
  );
}
