'use client';

import Link from 'next/link';

type PortalUserMenuProps = {
  displayName: string;
};

// A compact settings-gear icon that goes straight to the dedicated Settings
// page (/portal/settings) -- this used to be a "Logged In As [Name]" text
// button that opened a small dropdown with just an email-preference
// checkbox and a Log Out button; both now live on the Settings page itself
// (Account card shows who's logged in, Notifications card has the email
// toggle, Logout card has Log Out), so this component's only job now is to
// get staff there from wherever they are, matching how players already
// reach the same page via their own tab-bar Settings link.
export default function PortalUserMenu({ displayName }: PortalUserMenuProps) {
  return (
    <Link href="/portal/settings" className="portal-notifications-btn" aria-label={`Settings, logged in as ${displayName}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.06.94c0 .32.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.6.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
      </svg>
    </Link>
  );
}
