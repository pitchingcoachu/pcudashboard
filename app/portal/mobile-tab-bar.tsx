'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnreadMessageCount, useUnreadNotificationCount } from './use-unread-counts';
import {
  AdminShieldIcon,
  DashboardIcon,
  GameTrackerIcon,
  MessagesIcon,
  PlayersIcon,
  ScheduleIcon,
  SettingsGearIcon,
  WorkoutsIcon,
} from './tab-icons';

type TabDef = {
  key: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export default function MobileTabBar({
  role,
  scheduleLocked,
  workoutsLocked,
  previewPlayerId,
}: {
  role: 'admin' | 'coach' | 'player';
  scheduleLocked: boolean;
  workoutsLocked: boolean;
  previewPlayerId: number | null;
}) {
  const pathname = usePathname();
  const unreadMessages = useUnreadMessageCount();
  const unreadNotifications = useUnreadNotificationCount();
  const isStaff = role === 'admin' || role === 'coach';
  const isPlayer = role === 'player';

  const scheduleHref = isStaff ? '/portal/admin/schedule' : '/portal/player/program';
  const playersHref = isStaff
    ? '/portal/admin/clients'
    : previewPlayerId
    ? `/portal/player?previewPlayerId=${previewPlayerId}`
    : '/portal/player';
  const workoutsHref = '/portal/admin/workouts';
  const adminSettingsHref = isStaff ? '/portal/admin' : '/portal/settings';

  const tabs: TabDef[] = [
    { key: 'schedule', href: scheduleHref, label: 'Schedule', icon: <ScheduleIcon locked={scheduleLocked} /> },
    {
      key: 'messages',
      href: '/portal/messages',
      label: 'Messages',
      icon: <MessagesIcon />,
      badge: unreadMessages > 0 ? unreadMessages : undefined,
    },
    {
      key: 'players',
      href: playersHref,
      label: 'Players',
      icon: <PlayersIcon />,
      badge: isPlayer && unreadNotifications > 0 ? unreadNotifications : undefined,
    },
    { key: 'workouts', href: workoutsHref, label: 'Workouts', icon: <WorkoutsIcon locked={workoutsLocked} /> },
    { key: 'dashboard', href: '/portal/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
    ...(isStaff
      ? [{ key: 'game-tracker', href: '/portal/admin/game-tracker', label: 'Game Tracker', icon: <GameTrackerIcon /> }]
      : []),
    {
      key: 'admin-settings',
      href: adminSettingsHref,
      label: isStaff ? 'Admin' : 'Settings',
      icon: isStaff ? <AdminShieldIcon /> : <SettingsGearIcon />,
      badge: !isPlayer && unreadNotifications > 0 ? unreadNotifications : undefined,
    },
  ];

  const sorted = [...tabs].sort((a, b) => b.href.length - a.href.length);
  const activeKey = sorted.find((tab) => pathname === tab.href || pathname?.startsWith(`${tab.href}/`))?.key;

  return (
    <nav className="portal-tabbar" aria-label="Primary Navigation">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`portal-tabbar-item${active ? ' active' : ''}`}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
          >
            <span className="portal-tabbar-icon">{tab.icon}</span>
            {tab.badge ? <span className="portal-tabbar-badge">{formatBadge(tab.badge)}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
