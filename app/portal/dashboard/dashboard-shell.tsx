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

type SuiteName =
  | 'Pitching'
  | 'Hitting'
  | 'Catching'
  | 'Custom Reports'
  | 'Comparison Tool'
  | 'Player Plans'
  | 'Player Notes'
  | 'Stuff+ Calculator';

export default function DashboardShell({ role, selectedSchoolCode }: DashboardShellProps) {
  const [suite, setSuite] = useState<SuiteName>('Pitching');
  const [mountedSuites, setMountedSuites] = useState<Record<SuiteName, boolean>>({
    Pitching: true,
    Hitting: false,
    Catching: false,
    'Custom Reports': false,
    'Comparison Tool': false,
    'Player Plans': false,
    'Player Notes': false,
    'Stuff+ Calculator': false,
  });
  const canAccessPlayerNotes = role === 'admin' || role === 'coach';
  const suiteOptions: SuiteName[] = canAccessPlayerNotes
    ? ['Pitching', 'Hitting', 'Catching', 'Custom Reports', 'Comparison Tool', 'Player Plans', 'Player Notes', 'Stuff+ Calculator']
    : ['Pitching', 'Hitting', 'Catching', 'Custom Reports', 'Comparison Tool', 'Player Plans', 'Stuff+ Calculator'];
  const showSuite = (name: SuiteName) => suite === name;
  const activateSuite = (name: SuiteName) => {
    setSuite(name);
    setMountedSuites((current) => (current[name] ? current : { ...current, [name]: true }));
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="portal-dashboard-suite-select-wrap">
        <label className="portal-nav-mobile-label" htmlFor="dashboard-suite-select">
          Dashboard Suite
        </label>
        <select
          id="dashboard-suite-select"
          className="portal-nav-mobile"
          value={suite}
          onChange={(event) => activateSuite(event.target.value as SuiteName)}
        >
          {suiteOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="portal-dashboard-suite-tabs">
        {suiteOptions.map((name) => (
          <button
            key={name}
            type="button"
            className={suite === name ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => activateSuite(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {mountedSuites.Pitching ? <div style={{ display: showSuite('Pitching') ? 'block' : 'none' }}><PitchingSuite role={role} /></div> : null}
      {mountedSuites.Hitting ? <div style={{ display: showSuite('Hitting') ? 'block' : 'none' }}><HittingSuite /></div> : null}
      {mountedSuites.Catching ? <div style={{ display: showSuite('Catching') ? 'block' : 'none' }}><CatchingSuite /></div> : null}
      {mountedSuites['Custom Reports'] ? (
        <div style={{ display: showSuite('Custom Reports') ? 'block' : 'none' }}>
          <CustomReportsSuite initialSchoolCode={selectedSchoolCode} />
        </div>
      ) : null}
      {mountedSuites['Comparison Tool'] ? (
        <div style={{ display: showSuite('Comparison Tool') ? 'block' : 'none' }}>
          <ComparisonToolSuite />
        </div>
      ) : null}
      {mountedSuites['Player Plans'] ? (
        <div style={{ display: showSuite('Player Plans') ? 'block' : 'none' }}>
          <PlayerPlansSuite />
        </div>
      ) : null}
      {canAccessPlayerNotes && mountedSuites['Player Notes'] ? (
        <div style={{ display: showSuite('Player Notes') ? 'block' : 'none' }}>
          <PlayerNotesSuite />
        </div>
      ) : null}
      {mountedSuites['Stuff+ Calculator'] ? (
        <div style={{ display: showSuite('Stuff+ Calculator') ? 'block' : 'none' }}>
          <StuffCalculatorSuite />
        </div>
      ) : null}
    </div>
  );
}
