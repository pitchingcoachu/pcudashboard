type IconProps = { locked?: boolean };

function IconWrap({ children, locked }: { children: React.ReactNode; locked?: boolean }) {
  return (
    <span className="portal-tab-icon-wrap">
      {children}
      {locked ? (
        <svg viewBox="0 0 24 24" className="portal-tab-icon-lock" aria-hidden="true">
          <rect x="6" y="10" width="12" height="9" rx="1.5" fill="currentColor" />
          <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : null}
    </span>
  );
}

export function ScheduleIcon({ locked }: IconProps) {
  return (
    <IconWrap locked={locked}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 9.5h17" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </IconWrap>
  );
}

export function MessagesIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4.5 4V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </IconWrap>
  );
}

export function PlayersIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 19c.6-3 2.7-5 5.5-5s4.9 2 5.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15.5 14.3c2.2.3 3.8 2 4.3 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </IconWrap>
  );
}

export function WorkoutsIcon({ locked }: IconProps) {
  return (
    <IconWrap locked={locked}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 9.5v5M17.5 9.5v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M3.5 11v2M20.5 11v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6.5 12h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </IconWrap>
  );
}

export function DashboardIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20V13M11 20V6M18 20v-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </IconWrap>
  );
}

export function GameTrackerIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6 8c1.5 1 1.5 3 0 4M18 8c-1.5 1-1.5 3 0 4M6 16c1.5-1 1.5-3 0-4M18 16c-1.5-1-1.5-3 0-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </IconWrap>
  );
}

export function AdminShieldIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </IconWrap>
  );
}

export function SettingsGearIcon() {
  return (
    <IconWrap>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.66 6.34l-1.42 1.42M7.76 16.24l-1.42 1.42M17.66 17.66l-1.42-1.42M7.76 7.76 6.34 6.34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </IconWrap>
  );
}
