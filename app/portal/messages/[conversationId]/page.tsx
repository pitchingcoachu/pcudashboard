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

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await requirePortalSession();
  const isStaff = session.role === 'admin' || session.role === 'coach';
  const selectedSchool = resolveDashboardSchoolCode(session);
  const { conversationId } = await params;
  const parsedConversationId = Number(conversationId);
  const selectedConversationId = Number.isFinite(parsedConversationId) && parsedConversationId > 0 ? parsedConversationId : null;

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={null}
      navLinks={
        <>
          {isStaff ? (
            <Link href="/portal/admin" className="portal-nav-link">
              Admin
            </Link>
          ) : null}
          <Link href="/portal/player" className="portal-nav-link">
            Profile
          </Link>
          <Link href="/portal/messages" className="portal-nav-link active">
            Messages
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
      mobileNavCurrentHref="/portal/messages"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={[
        ...(isStaff ? [{ href: '/portal/admin', label: 'Admin' }] : []),
        { href: '/portal/player', label: 'Profile' },
        { href: '/portal/messages', label: 'Messages' },
        session.role === 'player' ? { href: '/portal/dashboard', label: 'Dashboard' } : { href: '/profiles', label: 'Profiles' },
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
