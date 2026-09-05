import MobileNavSelect from './mobile-nav-select';
import MobileTabBar from './mobile-tab-bar';
import ViewModeDesktopStrip from './view-mode-desktop-strip';
import { resolveViewMode } from '../../lib/view-mode';

type MobileNavItem = {
  href: string;
  label: string;
};

type PortalChromeProps = {
  extraShellClass?: string;
  schoolBrandStyle?: React.CSSProperties;
  extraHeaderClass?: string;
  left: React.ReactNode;
  navLinks: React.ReactNode;
  wrapNavInStack?: boolean;
  mobileNavItems: MobileNavItem[];
  mobileNavCurrentHref?: string;
  mobileNavLoggedInAs?: string;
  right: React.ReactNode;
  /** Omit to render `children` directly with no wrapping <section> (e.g. dashboard's DashboardShell). */
  sectionClassName?: string;
  sectionProps?: React.HTMLAttributes<HTMLElement>;
  children: React.ReactNode;
  /** Role for the mobile bottom tab bar. Omit to hide the tab bar entirely (e.g. tutorials, profiles). */
  tabBarRole?: 'admin' | 'coach' | 'player';
  tabBarScheduleLocked?: boolean;
  tabBarWorkoutsLocked?: boolean;
  tabBarGameTrackerVisible?: boolean;
  tabBarPreviewPlayerId?: number | null;
};

export default async function PortalChrome({
  extraShellClass = '',
  schoolBrandStyle,
  extraHeaderClass = '',
  left,
  navLinks,
  wrapNavInStack = false,
  mobileNavItems,
  mobileNavCurrentHref,
  mobileNavLoggedInAs,
  right,
  sectionClassName,
  sectionProps,
  children,
  tabBarRole,
  tabBarScheduleLocked = false,
  tabBarWorkoutsLocked = false,
  tabBarGameTrackerVisible = true,
  tabBarPreviewPlayerId = null,
}: PortalChromeProps) {
  const viewMode = await resolveViewMode();
  const viewModeClass = viewMode === 'desktop' ? ' portal-shell--viewmode-desktop-forced' : ' portal-shell--viewmode-auto';
  const schoolTheme = String((schoolBrandStyle as Record<string, unknown> | undefined)?.['--portal-school-theme'] ?? '');
  const schoolThemeClass = schoolTheme === 'arizona' ? ' portal-shell--arizona' : '';

  return (
    <div className={`portal-shell${extraShellClass ? ` ${extraShellClass}` : ''}${schoolThemeClass}${viewModeClass}`} style={schoolBrandStyle}>
      <header className={`portal-header${extraHeaderClass ? ` ${extraHeaderClass}` : ''}`}>
        <div className="portal-header-left">{left}</div>
        <div className="portal-header-center">
          {wrapNavInStack ? (
            <div className="portal-header-nav-stack">
              <nav className="portal-nav" aria-label="Portal Navigation">
                {navLinks}
              </nav>
            </div>
          ) : (
            <nav className="portal-nav" aria-label="Portal Navigation">
              {navLinks}
            </nav>
          )}
          <MobileNavSelect currentHref={mobileNavCurrentHref} loggedInAs={mobileNavLoggedInAs} items={mobileNavItems} />
        </div>
        <div className="portal-header-right">{right}</div>
      </header>
      {sectionClassName !== undefined ? (
        <section className={sectionClassName} {...sectionProps}>
          {children}
        </section>
      ) : (
        children
      )}
      {viewMode === 'desktop' ? <ViewModeDesktopStrip /> : null}
      {viewMode === 'auto' && tabBarRole ? (
        <MobileTabBar
          role={tabBarRole}
          scheduleLocked={tabBarScheduleLocked}
          workoutsLocked={tabBarWorkoutsLocked}
          gameTrackerVisible={tabBarGameTrackerVisible}
          previewPlayerId={tabBarPreviewPlayerId}
        />
      ) : null}
    </div>
  );
}
