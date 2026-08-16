import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { schoolBrandCssVars } from '../../../../../lib/school-brand';
import { normalizeHittingDrillsState } from '../../../../../lib/hitting-drills-program';
import { getPlayerForUser, listExercisesByOrganization, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import PortalChrome from '../../../portal-chrome';
import DashboardSchoolSelector from '../../../dashboard/dashboard-school-selector';
import PreviewAthleteSelect from '../../../preview-athlete-select';
import LogoutButton from '../../../logout-button';
import PortalUserMenu from '../../../user-menu';
import PortalThemeToggle from '../../../theme-toggle';
import PortalNotificationsBell from '../../../notifications-bell';
import PortalMessagesNavButton from '../../../messages-nav-button';
import HittingDrillsReadonly from './hitting-drills-readonly';

type HittingDrillsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerHittingDrillsPage({ searchParams }: HittingDrillsPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const params = await searchParams;
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const previewPlayerId = Number(typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';
  let resolvedPlayerId = 0;
  if (session.role === 'player') {
    const player = await getPlayerForUser({ organizationId: session.organizationId, userId: session.userId });
    resolvedPlayerId = Number(player?.id ?? session.playerId ?? 0);
  } else if (canPreview && previewPlayerId > 0) {
    resolvedPlayerId = previewPlayerId;
  }
  const h = await headers();
  const host = h.get('host');
  if (!host) redirect('/portal/player/program');
  const protocol = h.get('x-forwarded-proto') ?? 'http';
  const response = await fetch(`${protocol}://${host}/api/player/throwing${playerIdQuery}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  const hittingDrillsState = normalizeHittingDrillsState((payload as { hittingDrillsState?: unknown }).hittingDrillsState);
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const drillVideos = programmingOrganizationId > 0
    ? (await listExercisesByOrganization(programmingOrganizationId))
        .map((exercise) => ({
          name: exercise.name,
          instructionVideoUrl: String(exercise.instructionVideoUrl ?? '').trim(),
        }))
        .filter((exercise) => exercise.name.trim() && exercise.instructionVideoUrl)
    : [];
  const backHref = canPreview && previewPlayerId > 0
    ? `/portal/player/program?previewPlayerId=${previewPlayerId}`
    : '/portal/player/program';
  const profileHref = canPreview && previewPlayerId > 0 ? `/portal/player?previewPlayerId=${previewPlayerId}` : '/portal/player';
  const previewClients = canPreview && programmingOrganizationId > 0
    ? await listPlayerChoicesByOrganization({ organizationId: programmingOrganizationId })
    : [];

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={
        <>
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
          {canPreview ? (
            <PreviewAthleteSelect basePath="/portal/player/program/hitting-drills" selectedPlayerId={previewPlayerId} players={previewClients} />
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
        <h2 style={{ marginTop: 0 }}>Hitting Drills</h2>
        <Link href={backHref} className="btn btn-ghost as-link">Back to Program</Link>
      </div>
      <HittingDrillsReadonly state={hittingDrillsState} drillVideos={drillVideos} playerId={resolvedPlayerId} />
    </PortalChrome>
  );
}
