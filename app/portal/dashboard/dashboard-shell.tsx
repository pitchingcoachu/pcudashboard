'use client';

import { useState } from 'react';
import CatchingSuite from './catching-suite';
import ComparisonToolSuite from './comparison-tool-suite';
import CustomReportsSuite from './custom-reports-suite';
import HittingSuite from './hitting-suite';
import PlayerNotesSuite from './player-notes-suite';
import PlayerPlansSuite from './player-plans-suite';
import PitchingSuite from './pitching-suite';
import StuffCalculatorSuite from './stuff-calculator-suite';

type DashboardShellProps = {
  role: 'admin' | 'coach' | 'player';
  selectedSchoolCode: string;
};

export default function DashboardShell({ role, selectedSchoolCode }: DashboardShellProps) {
  const [suite, setSuite] = useState<
    'Pitching' | 'Hitting' | 'Catching' | 'Custom Reports' | 'Comparison Tool' | 'Player Plans' | 'Player Notes' | 'Stuff+ Calculator'
  >('Pitching');
  const canAccessPlayerNotes = role === 'admin' || role === 'coach';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingInline: 4 }}>
        <button type="button" className={suite === 'Pitching' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Pitching')}>
          Pitching
        </button>
        <button type="button" className={suite === 'Hitting' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Hitting')}>
          Hitting
        </button>
        <button type="button" className={suite === 'Catching' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Catching')}>
          Catching
        </button>
        <button type="button" className={suite === 'Custom Reports' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Custom Reports')}>
          Custom Reports
        </button>
        <button type="button" className={suite === 'Comparison Tool' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Comparison Tool')}>
          Comparison Tool
        </button>
        <button type="button" className={suite === 'Player Plans' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Player Plans')}>
          Player Plans
        </button>
        {canAccessPlayerNotes ? (
          <button type="button" className={suite === 'Player Notes' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Player Notes')}>
            Player Notes
          </button>
        ) : null}
        <button type="button" className={suite === 'Stuff+ Calculator' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSuite('Stuff+ Calculator')}>
          Stuff+ Calculator
        </button>
      </div>
      {suite === 'Pitching' ? (
        <PitchingSuite role={role} />
      ) : suite === 'Stuff+ Calculator' ? (
        <StuffCalculatorSuite />
      ) : suite === 'Hitting' ? (
        <HittingSuite />
      ) : suite === 'Catching' ? (
        <CatchingSuite />
      ) : suite === 'Comparison Tool' ? (
        <ComparisonToolSuite />
      ) : suite === 'Player Plans' ? (
        <PlayerPlansSuite />
      ) : suite === 'Player Notes' && canAccessPlayerNotes ? (
        <PlayerNotesSuite />
      ) : (
        <CustomReportsSuite initialSchoolCode={selectedSchoolCode} />
      )}
    </div>
  );
}
