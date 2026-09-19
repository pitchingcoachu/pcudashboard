import type { PortalPrimaryNavItem } from '../../lib/portal-primary-nav';
import PortalNavOverflowMenu from './nav-overflow-menu';
import PrimaryNavLink from './primary-nav-link';

type StaffPrimaryNavProps = {
  activeHref?: string;
  canAccessSchedule: boolean;
  canAccessSessionBooking: boolean;
  canAccessPlayerNotes: boolean;
  moreItems: PortalPrimaryNavItem[];
};

export function staffPrimaryMobileItems(input: Omit<StaffPrimaryNavProps, 'activeHref'>): PortalPrimaryNavItem[] {
  return [
    { href: '/portal/admin', label: 'Home' },
    ...(input.canAccessSchedule ? [{ href: '/portal/admin/schedule', label: 'Schedule' }] : []),
    { href: '/portal/dashboard', label: 'Dashboard' },
    ...(input.canAccessPlayerNotes ? [{ href: '/portal/admin/player-notes', label: 'Player Notes' }] : []),
    ...input.moreItems,
  ];
}

export default function StaffPrimaryNav({ activeHref, canAccessSchedule, canAccessPlayerNotes, moreItems }: StaffPrimaryNavProps) {
  return (
    <>
      <PrimaryNavLink href="/portal/admin" exact active={activeHref === undefined ? undefined : activeHref === '/portal/admin'}>
        Home
      </PrimaryNavLink>
      {canAccessSchedule ? (
        <PrimaryNavLink href="/portal/admin/schedule" active={activeHref === undefined ? undefined : activeHref === '/portal/admin/schedule'}>
          Schedule
        </PrimaryNavLink>
      ) : null}
      <PrimaryNavLink href="/portal/dashboard" active={activeHref === undefined ? undefined : activeHref === '/portal/dashboard'}>
        Dashboard
      </PrimaryNavLink>
      {canAccessPlayerNotes ? (
        <PrimaryNavLink href="/portal/admin/player-notes" active={activeHref === undefined ? undefined : activeHref === '/portal/admin/player-notes'}>
          Player Notes
        </PrimaryNavLink>
      ) : null}
      <PortalNavOverflowMenu items={moreItems} />
    </>
  );
}
