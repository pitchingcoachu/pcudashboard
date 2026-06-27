'use client';

import { useState } from 'react';
import MotionCaptureDashboard from '../motion-capture/motion-capture-dashboard';
import BiomechanicsSuite from './biomechanics-suite';

type BiomechanicsHubProps = {
  role: 'admin' | 'coach' | 'player';
  isActive?: boolean;
};

type BiomechanicsSubPage = 'force-plates' | 'motion-capture';

export default function BiomechanicsHub({ role, isActive = true }: BiomechanicsHubProps) {
  const [activeSubPage, setActiveSubPage] = useState<BiomechanicsSubPage>('force-plates');

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="portal-dashboard-suite-tabs">
        <div className="portal-dashboard-suite-tabs-center">
          <button
            type="button"
            className={activeSubPage === 'force-plates' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setActiveSubPage('force-plates')}
          >
            Force Plates
          </button>
          <button
            type="button"
            className={activeSubPage === 'motion-capture' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setActiveSubPage('motion-capture')}
          >
            Motion Capture
          </button>
        </div>
      </div>

      <div style={{ display: activeSubPage === 'force-plates' ? 'block' : 'none' }}>
        <BiomechanicsSuite role={role} isActive={isActive && activeSubPage === 'force-plates'} />
      </div>
      <div style={{ display: activeSubPage === 'motion-capture' ? 'block' : 'none' }}>
        <MotionCaptureDashboard />
      </div>
    </div>
  );
}
