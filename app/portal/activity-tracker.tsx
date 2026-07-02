'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type PortalActivityDetail = {
  eventType?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

const PAGE_LABELS: Array<{ pattern: RegExp; label: string; section: string }> = [
  { pattern: /^\/portal\/admin\/activity\b/, label: 'Activity Tracker', section: 'Admin' },
  { pattern: /^\/portal\/admin\/coaches\b/, label: 'Coach Management', section: 'Admin' },
  { pattern: /^\/portal\/admin\/clients\b/, label: 'Player Management', section: 'Admin' },
  { pattern: /^\/portal\/admin\/email-templates\b/, label: 'Email Automations', section: 'Admin' },
  { pattern: /^\/portal\/admin\/exercises\b/, label: 'Exercise Library', section: 'Admin' },
  { pattern: /^\/portal\/admin\/master-calendar\b/, label: 'Master Calendar', section: 'Admin' },
  { pattern: /^\/portal\/admin\/questionnaires\b/, label: 'Questionnaires', section: 'Admin' },
  { pattern: /^\/portal\/admin\/schedule\b/, label: 'Schedule Builder', section: 'Admin' },
  { pattern: /^\/portal\/admin\/testing\b/, label: 'Testing Data', section: 'Admin' },
  { pattern: /^\/portal\/admin\/workouts\b/, label: 'Workout Builder', section: 'Admin' },
  { pattern: /^\/portal\/admin\b/, label: 'Admin Home', section: 'Admin' },
  { pattern: /^\/portal\/dashboard\/pitching\/leaderboard\b/, label: 'Dashboard / Pitching / Leaderboard', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/summary\b/, label: 'Dashboard / Pitching / Summary', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/game-log\b/, label: 'Dashboard / Pitching / Game Log', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/pitch-log\b/, label: 'Dashboard / Pitching / Pitch Log', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/ab-report\b/, label: 'Dashboard / Pitching / AB Report', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/velocity\b/, label: 'Dashboard / Pitching / Velocity', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/heatmaps\b/, label: 'Dashboard / Pitching / HeatMaps', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/qp-locations\b/, label: 'Dashboard / Pitching / QP Locations', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/trend\b/, label: 'Dashboard / Pitching / Trend', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\/velo-manual-entry\b/, label: 'Dashboard / Pitching / Velo Manual Entry', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/pitching\b/, label: 'Dashboard / Pitching', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/leaderboard\b/, label: 'Dashboard / Hitting / Leaderboard', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/summary\b/, label: 'Dashboard / Hitting / Summary', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/game-log\b/, label: 'Dashboard / Hitting / Game Log', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/ab-report\b/, label: 'Dashboard / Hitting / AB Report', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/heatmaps\b/, label: 'Dashboard / Hitting / HeatMaps', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\/swing-data\b/, label: 'Dashboard / Hitting / Swing Data', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/hitting\b/, label: 'Dashboard / Hitting', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/catching\/leaderboard\b/, label: 'Dashboard / Catching / Leaderboard', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/catching\b/, label: 'Dashboard / Catching', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/custom-reports\b/, label: 'Dashboard / Custom Reports', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/comparison-tool\b/, label: 'Dashboard / Comparison Tool', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/biomechanics\b/, label: 'Dashboard / Biomechanics', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/player-plans\b/, label: 'Dashboard / Player Plans', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/player-notes\b/, label: 'Dashboard / Player Notes', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/stuff-calculator\b/, label: 'Dashboard / Stuff+ Calculator', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\/home\b/, label: 'Dashboard / Home', section: 'Dashboard' },
  { pattern: /^\/portal\/dashboard\b/, label: 'Dashboard', section: 'Dashboard' },
  { pattern: /^\/portal\/force-plates\b/, label: 'Force Plates', section: 'Biomechanics' },
  { pattern: /^\/portal\/motion-capture\b/, label: 'Motion Capture', section: 'Biomechanics' },
  { pattern: /^\/portal\/player\/program\/bullpens\b/, label: 'Bullpens', section: 'Player Program' },
  { pattern: /^\/portal\/player\/program\/drills\b/, label: 'Drills', section: 'Player Program' },
  { pattern: /^\/portal\/player\/program\/throwing\b/, label: 'Throwing Calendar', section: 'Player Program' },
  { pattern: /^\/portal\/player\/program\/velocity\b/, label: 'Velocity', section: 'Player Program' },
  { pattern: /^\/portal\/player\/program\b/, label: 'Player Program', section: 'Player' },
  { pattern: /^\/portal\/player\b/, label: 'Player Profile', section: 'Player' },
  { pattern: /^\/profiles\b/, label: 'Profiles', section: 'Profiles' },
  { pattern: /^\/portal\b/, label: 'Portal Home', section: 'Portal' },
];

function buildPageMetadata(pathname: string, searchParams: URLSearchParams) {
  const match = PAGE_LABELS.find((entry) => entry.pattern.test(pathname));
  const interestingParams = ['school', 'role', 'q', 'tab', 'view', 'playerId', 'previewPlayerId', 'date', 'mode'];
  const query: Record<string, string> = {};
  for (const key of interestingParams) {
    const value = searchParams.get(key);
    if (value) query[key] = value;
  }
  return {
    pageTitle: typeof document !== 'undefined' ? document.title : '',
    pageLabel: match?.label ?? (pathname.replace(/^\/+/, '').replaceAll('/', ' / ') || 'Portal'),
    section: match?.section ?? 'Portal',
    pathname,
    query,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
  };
}

function postActivity(detail: PortalActivityDetail) {
  const path = String(detail.path ?? '').trim();
  if (!path) return;
  window
    .fetch('/api/portal/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: detail.eventType || 'page_view',
        path,
        metadata: detail.metadata ?? {},
      }),
      keepalive: true,
    })
    .catch(() => {});
}

export default function PortalActivityTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPathRef = useRef('');

  useEffect(() => {
    const query = searchParams.toString();
    const path = `${pathname}${query ? `?${query}` : ''}`;
    if (!path || lastPathRef.current === path) return;
    lastPathRef.current = path;
    postActivity({ eventType: 'page_view', path, metadata: buildPageMetadata(pathname, searchParams) });
  }, [pathname, searchParams]);

  useEffect(() => {
    const handlePortalActivity = (event: Event) => {
      const detail = (event as CustomEvent<PortalActivityDetail>).detail;
      const path = String(detail?.path ?? '').trim();
      if (!path || lastPathRef.current === path) return;
      const matchedLabel = PAGE_LABELS.find((entry) => entry.pattern.test(path));
      lastPathRef.current = path;
      postActivity({
        eventType: detail.eventType || 'page_view',
        path,
        metadata: {
          ...(detail.metadata ?? {}),
          pageLabel: String(detail.metadata?.pageLabel ?? '').trim() || matchedLabel?.label || path,
          section: String(detail.metadata?.section ?? '').trim() || matchedLabel?.section || 'Portal',
        },
      });
    };
    window.addEventListener('pcu:portal-activity', handlePortalActivity);
    return () => window.removeEventListener('pcu:portal-activity', handlePortalActivity);
  }, []);

  return null;
}
