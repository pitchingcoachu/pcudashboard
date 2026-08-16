'use client';

import { useRouter } from 'next/navigation';
import { VIEW_MODE_COOKIE } from '../../../lib/view-mode-shared';

const SUITE_DESCRIPTIONS: Record<string, string> = {
  Pitching: 'Pitch-by-pitch metrics, leaderboards, and trends.',
  Hitting: 'Batted-ball and plate-discipline metrics and trends.',
  Catching: 'Framing, blocking, and throwing metrics.',
  'Custom Reports': 'Build a custom chart or table report.',
  'Comparison Tool': 'Compare players or teams side by side.',
  'Player Plans': 'Review assigned player development plans.',
  'Stuff+ Calculator': 'Grade pitch shape and stuff quality.',
};

export default function MobileDashboardHome({
  suiteOptions,
  onOpenSuite,
}: {
  suiteOptions: string[];
  onOpenSuite: (suite: string) => void;
}) {
  const router = useRouter();
  const visibleSuites = suiteOptions.filter((name) => name !== 'Home' && name !== 'Biomechanics');

  function openFullDashboard() {
    document.cookie = `${VIEW_MODE_COOKIE}=desktop; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="portal-mobile-dashboard-home">
      {visibleSuites.map((name) => (
        <button
          key={name}
          type="button"
          className="portal-admin-card portal-mobile-dashboard-home-card"
          onClick={() => onOpenSuite(name)}
        >
          <h2>{name}</h2>
          <p className="portal-muted-text">{SUITE_DESCRIPTIONS[name] ?? ''}</p>
        </button>
      ))}
      <button type="button" className="btn btn-primary" onClick={openFullDashboard} style={{ width: '100%' }}>
        Open Full Dashboard
      </button>
    </div>
  );
}
