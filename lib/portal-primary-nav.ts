export type PortalPrimaryNavItem = {
  href: string;
  label: string;
};

export type StaffPrimaryNavigation = {
  canAccessSchedule: boolean;
  canAccessPlayerNotes: boolean;
  moreItems: PortalPrimaryNavItem[];
};

export function buildStaffMoreNavItems(input: {
  role: string;
  selectedSchool: string;
  canAccessProgramming: boolean;
  canAccessClientManagement: boolean;
  canAccessGameTracker: boolean;
  canAccessActivityTracker: boolean;
  canAccessEmailAutomations: boolean;
}): PortalPrimaryNavItem[] {
  const school = input.selectedSchool.trim().toUpperCase();
  const isTrial = school === 'TRIAL';
  const isLeague = school === 'LEAGUE';
  const isPro = school === 'PRO';
  const isStaff = input.role === 'admin' || input.role === 'coach';
  const showClientManagement = input.canAccessClientManagement && !(input.role === 'coach' && isPro);

  return [
    ...(!isTrial && !isLeague && !isPro ? [{ href: '/portal/admin/pulse', label: 'PULSE' }] : []),
    ...(input.canAccessGameTracker ? [{ href: '/portal/admin/game-tracker', label: 'Game Tracker' }] : []),
    { href: '/profiles', label: 'Profiles' },
    ...(showClientManagement ? [{ href: '/portal/admin/clients', label: 'Players' }] : []),
    ...(showClientManagement ? [{ href: '/portal/admin/clients/groups', label: 'Player Groups' }] : []),
    ...(showClientManagement ? [{ href: '/portal/admin/coaches', label: 'Coaches' }] : []),
    ...(input.canAccessProgramming
      ? [
          { href: '/portal/admin/exercises', label: 'Exercise Library' },
          { href: '/portal/admin/workouts', label: 'Workout Library' },
          { href: '/portal/admin/master-calendar', label: 'Master Calendar' },
          { href: '/portal/admin/testing', label: 'Testing' },
          { href: '/portal/admin/questionnaires', label: 'Questionnaires' },
        ]
      : []),
    ...(input.canAccessActivityTracker ? [{ href: '/portal/admin/activity', label: 'Activity Tracker' }] : []),
    ...(input.canAccessEmailAutomations ? [{ href: '/portal/admin/email-templates', label: 'Email Automations' }] : []),
    ...(!isTrial ? [{ href: '/portal/force-plates', label: 'Force Plate Data' }] : []),
    ...(!isTrial ? [{ href: '/portal/admin/force-plates-live', label: 'Force Plate Live Search' }] : []),
    ...(!isTrial && isStaff ? [{ href: '/portal/admin/csv-uploads', label: 'CSV Uploads' }] : []),
  ];
}
