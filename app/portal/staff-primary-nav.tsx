import Link from 'next/link';
import type { PortalPrimaryNavItem } from '../../lib/portal-primary-nav';
import PortalNavOverflowMenu from './nav-overflow-menu';

type StaffPrimaryNavProps = {
  activeHref?: string;
  canAccessSchedule: boolean;
  canAccessPlayerNotes: boolean;
  moreItems: PortalPrimaryNavItem[];
};

function navClass(active: boolean): string {
  return `portal-nav-link${active ? ' active' : ''}`;
}

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
      <Link href="/portal/admin" className={navClass(activeHref === '/portal/admin')}>
        Home
      </Link>
      {canAccessSchedule ? (
        <Link href="/portal/admin/schedule" className={navClass(activeHref === '/portal/admin/schedule')}>
          Schedule
        </Link>
      ) : null}
      <Link href="/portal/dashboard" className={navClass(activeHref === '/portal/dashboard')}>
        Dashboard
      </Link>
      {canAccessPlayerNotes ? (
        <Link href="/portal/admin/player-notes" className={navClass(activeHref === '/portal/admin/player-notes')}>
          Player Notes
        </Link>
      ) : null}
      <PortalNavOverflowMenu items={moreItems} />
    </>
  );
}
