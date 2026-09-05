import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { schoolBrandCssVars } from '../../../../lib/school-brand';
import PortalChrome from '../../portal-chrome';
import LogoutButton from '../../logout-button';
import PortalUserMenu from '../../user-menu';
import PortalNotificationsBell from '../../notifications-bell';
import PortalThemeToggle from '../../theme-toggle';
import { MessagesShell } from '../messages-shell';
import { resolveStaffPrimaryNavigation } from '../../../../lib/portal-primary-nav-server';
import StaffPrimaryNav, { staffPrimaryMobileItems } from '../../staff-primary-nav';

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await requirePortalSession();
  const isStaff = session.role === 'admin' || session.role === 'coach';
  const selectedSchool = resolveDashboardSchoolCode(session);
  const primaryNav = isStaff ? await resolveStaffPrimaryNavigation(session) : null;
  const { conversationId } = await params;
  const parsedConversationId = Number(conversationId);
  const selectedConversationId = Number.isFinite(parsedConversationId) && parsedConversationId > 0 ? parsedConversationId : null;

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={null}
      navLinks={
        isStaff && primaryNav ? (
          <StaffPrimaryNav {...primaryNav} />
        ) : (
          <>
          <Link href="/portal/player" className="portal-nav-link">
            Profile
          </Link>
          <Link href="/portal/messages" className="portal-nav-link active">
            Messages
          </Link>
          <Link href="/portal/dashboard" className="portal-nav-link">Dashboard</Link>
          </>
        )
      }
      mobileNavCurrentHref="/portal/messages"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={primaryNav ? staffPrimaryMobileItems(primaryNav) : [
        { href: '/portal/player', label: 'Profile' },
        { href: '/portal/messages', label: 'Messages' },
        { href: '/portal/dashboard', label: 'Dashboard' },
      ]}
      right={
        <>
          {isStaff ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalNotificationsBell />
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
        </>
      }
      sectionClassName="portal-messages-page"
      tabBarRole={session.role}
    >
      <MessagesShell currentUserId={session.userId ?? 0} currentUserRole={session.role} selectedConversationId={selectedConversationId} />
    </PortalChrome>
  );
}
