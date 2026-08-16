import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { resolveSchoolBrand, schoolBrandCssVars } from '../../../../../lib/school-brand';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import PortalChrome from '../../../portal-chrome';
import DashboardSchoolSelector from '../../../dashboard/dashboard-school-selector';
import PreviewAthleteSelect from '../../../preview-athlete-select';
import LogoutButton from '../../../logout-button';
import PortalUserMenu from '../../../user-menu';
import PortalThemeToggle from '../../../theme-toggle';
import PortalNotificationsBell from '../../../notifications-bell';
import PortalMessagesNavButton from '../../../messages-nav-button';
import ScriptEntry from '../shared-script-entry';

type HittingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerHittingPage({ searchParams }: HittingPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const schoolBrand = resolveSchoolBrand(resolveProgrammingSchoolCode(session));
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewPlayerId = Number(previewPlayerIdRaw ?? '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';

  let resolvedPlayerId = 0;
  if (session.role === 'player') {
    const orgId = Number(session.organizationId ?? 0);
    const userId = Number(session.userId ?? 0);
    const player = userId > 0 ? await getPlayerForUser({ organizationId: orgId, userId }) : null;
    resolvedPlayerId = Number(player?.id ?? 0);
  } else if (canPreview && previewPlayerId > 0) {
    resolvedPlayerId = previewPlayerId;
  }

  const h = await headers();
  const protocol = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');
  if (!host) redirect('/portal/player/program');
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${protocol}://${host}/api/player/hitting${playerIdQuery}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};

  type Template = { id: string; name: string; rowCount: number; columns: string[]; columnTypes?: string[]; rows: string[][] };
  const hittingTemplates: Template[] = Array.isArray((payload as { hittingTemplates?: Template[] }).hittingTemplates)
    ? ((payload as { hittingTemplates?: Template[] }).hittingTemplates ?? [])
    : [];
  const hittingState = (payload as {
    hittingState?: { selectedTemplateId: string; visibleTemplateIds: string[]; notes?: string }
  }).hittingState ?? { selectedTemplateId: '', visibleTemplateIds: [], notes: '' };

  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const previewClients = canPreview && programmingOrganizationId > 0
    ? await listPlayerChoicesByOrganization({ organizationId: programmingOrganizationId })
    : [];
  const backHref = canPreview && previewPlayerId > 0 ? `/portal/player/program?previewPlayerId=${previewPlayerId}` : '/portal/player/program';
  const profileHref = canPreview && previewPlayerId > 0 ? `/portal/player?previewPlayerId=${previewPlayerId}` : '/portal/player';

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={
        <>
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
          {canPreview ? (
            <PreviewAthleteSelect basePath="/portal/player/program/hitting" selectedPlayerId={previewPlayerId} players={previewClients} />
          ) : null}
        </>
      }
      navLinks={
        <>
          {canPreview ? (
            <Link href="/portal/admin" className="portal-nav-link">
              Admin
            </Link>
          ) : null}
          <Link href={profileHref} className="portal-nav-link">
            Profile
          </Link>
          <Link href={backHref} className="portal-nav-link active">
            Program
          </Link>
          {session.role === 'player' ? (
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
          ) : (
            <Link href="/profiles" className="portal-nav-link">
              Profiles
            </Link>
          )}
        </>
      }
      mobileNavCurrentHref="/portal/player/program"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={[
        ...(canPreview ? [{ href: '/portal/admin', label: 'Admin' }] : []),
        { href: profileHref, label: 'Profile' },
        { href: backHref, label: 'Program' },
        ...(session.role === 'player'
          ? [{ href: '/portal/dashboard', label: 'Dashboard' }]
          : [{ href: '/profiles', label: 'Profiles' }]),
      ]}
      right={
        <>
          {canPreview ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalMessagesNavButton />
          <PortalNotificationsBell />
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
        </>
      }
      sectionClassName="portal-panel"
      tabBarRole={session.role}
      tabBarPreviewPlayerId={canPreview ? previewPlayerId || null : null}
    >
      <div className="portal-row-between">
        <h2 style={{ marginTop: 0 }}>BP Templates</h2>
        <Link href={backHref} className="btn btn-ghost as-link">
          Back to Program
        </Link>
      </div>
      {hittingState.notes?.trim() ? (
        <div className="portal-panel" style={{ minHeight: 'unset', marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>Notes</h4>
          <p className="portal-muted-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{hittingState.notes.trim()}</p>
        </div>
      ) : null}
      <ScriptEntry
        mode="hitting"
        templates={hittingTemplates}
        state={hittingState}
        playerId={resolvedPlayerId}
        previewQuery={playerIdQuery}
        schoolLogoSrc={schoolBrand.logoSrc}
        schoolLogoAlt={schoolBrand.logoAlt}
      />
    </PortalChrome>
  );
}
