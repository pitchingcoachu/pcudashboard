import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { schoolBrandCssVars } from '../../../../../lib/school-brand';
import { listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import PortalChrome from '../../../portal-chrome';
import DashboardSchoolSelector from '../../../dashboard/dashboard-school-selector';
import PreviewAthleteSelect from '../../../preview-athlete-select';
import LogoutButton from '../../../logout-button';
import PortalUserMenu from '../../../user-menu';
import PortalThemeToggle from '../../../theme-toggle';
import PortalNotificationsBell from '../../../notifications-bell';
import PortalMessagesNavButton from '../../../messages-nav-button';
import ThrowingReadonly from './throwing-readonly';

type ThrowingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerThrowingPage({ searchParams }: ThrowingPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const initialDate = typeof params.date === 'string' && params.date ? params.date : undefined;
  const previewPlayerId = Number(previewPlayerIdRaw ?? '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';

  const h = await headers();
  const protocol = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');
  if (!host) redirect('/portal/player/program');
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${protocol}://${host}/api/player/throwing${playerIdQuery}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  const byDate = ((payload as { byDate?: Record<string, { intensity: string; distance: string; throwsText: string; drills: string; bullpen: string }> }).byDate ?? {});
  const weekNotes = ((payload as { weekNotes?: Record<string, string> }).weekNotes ?? {});
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
            <PreviewAthleteSelect basePath="/portal/player/program/throwing" selectedPlayerId={previewPlayerId} players={previewClients} />
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
        <h2 style={{ marginTop: 0 }}>Throwing Calendar</h2>
        <Link href={backHref} className="btn btn-ghost as-link">
          Back to Program
        </Link>
      </div>
      {Object.keys(byDate).length === 0 ? (
        <p className="portal-muted-text">No throwing calendar data yet.</p>
      ) : (
        <ThrowingReadonly byDate={byDate} weekNotes={weekNotes} initialDate={initialDate} />
      )}
    </PortalChrome>
  );
}
