import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization } from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import TestingBuilder from './testing-builder';

export default async function AdminTestingPage() {
  const session = await requirePortalSession();
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const brand = resolveSchoolBrand(programmingSchoolCode);
  const clients =
    programmingOrganizationId > 0 ? await listClientsByOrganization(programmingOrganizationId) : [];
  const visibleClients =
    session.role === 'coach' ? clients.filter((client) => client.assignedCoachUserId === session.userId) : clients;

  const players = visibleClients.map((client) => ({
    id: client.playerId,
    name: client.fullName,
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
