'use client';

import { useState } from 'react';
import BiomechanicsSuite from './biomechanics-suite';
import PcuMocapDashboard from './pcu-mocap-dashboard';

type BiomechanicsHubProps = {
  role: 'admin' | 'coach' | 'player';
  schoolCode: string;
  isActive?: boolean;
  fixedPlayerName?: string;
};

type BiomechanicsSubPage = 'force-plates' | 'motion-capture';

export default function BiomechanicsHub({ role, schoolCode, isActive = true, fixedPlayerName }: BiomechanicsHubProps) {
  const [activeSubPage, setActiveSubPage] = useState<BiomechanicsSubPage>('force-plates');
  const isPcu = schoolCode.trim().toUpperCase() === 'PCU';
  const displayedSubPage: BiomechanicsSubPage = isPcu ? activeSubPage : 'force-plates';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="portal-dashboard-suite-tabs">
        <div className="portal-dashboard-suite-tabs-center">
          <button
            type="button"
            className={displayedSubPage === 'force-plates' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setActiveSubPage('force-plates')}
          >
            Force Plates
          </button>
          {isPcu ? (
            <button
              type="button"
              className={displayedSubPage === 'motion-capture' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setActiveSubPage('motion-capture')}
            >
              Motion Capture
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: displayedSubPage === 'force-plates' ? 'block' : 'none' }}>
        <BiomechanicsSuite role={role} schoolCode={schoolCode} isActive={isActive && displayedSubPage === 'force-plates'} fixedPlayerName={fixedPlayerName} />
      </div>
      {isPcu ? (
        <div style={{ display: displayedSubPage === 'motion-capture' ? 'block' : 'none' }}>
          <PcuMocapDashboard canEditEvents={role === 'admin' || role === 'coach'} />
        </div>
      ) : null}
    </div>
  );
}
