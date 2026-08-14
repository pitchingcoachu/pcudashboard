'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { GameTrackerStats } from '../../lib/game-tracker/stats';

type View = keyof GameTrackerStats;
const dash = (value: unknown) => value === null || value === undefined ? '—' : String(value);
const pct = (value: unknown) => value === null || value === undefined ? '—' : `${value}%`;
const rate = (value: unknown) => value === null || value === undefined ? '—' : Number(value).toFixed(3).replace(/^0/, '');

const columns: Record<View, Array<[string, string, (value: unknown) => string]>> = {
  batting: [['games','G',dash],['pa','PA',dash],['ab','AB',dash],['runs','R',dash],['hits','H',dash],['doubles','2B',dash],['triples','3B',dash],['homeRuns','HR',dash],['rbi','RBI',dash],['walks','BB',dash],['strikeouts','K',dash],['avg','AVG',rate],['obp','OBP',rate],['slg','SLG',rate],['ops','OPS',rate],['iso','ISO',rate],['babip','BABIP',rate],['kPct','K%',pct],['bbPct','BB%',pct],['whiffPct','Whiff%',pct]],
  pitching: [['games','G',dash],['ip','IP',dash],['era','ERA',dash],['whip','WHIP',dash],['pitches','P',dash],['hits','H',dash],['runs','R',dash],['earnedRuns','ER',dash],['walks','BB',dash],['strikeouts','K',dash],['kPct','K%',pct],['bbPct','BB%',pct],['kMinusBbPct','K-BB%',pct],['strikePct','Strike%',pct],['whiffPct','Whiff%',pct],['cswPct','CSW%',pct],['fpsPct','FPS%',pct],['eaPct','E+A%',pct],['gbPct','GB%',pct]],
  fielding: [['games','G',dash],['putouts','PO',dash],['assists','A',dash],['errors','E',dash],['doublePlays','DP',dash],['totalChances','TC',dash],['fieldingPct','FLD%',rate]],
};

export default function GameTrackerStatsView() {
  const [view, setView] = useState<View>('batting');
  const [stats, setStats] = useState<GameTrackerStats>({ batting: [], pitching: [], fielding: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(form?: HTMLFormElement) {
    setLoading(true); setError('');
    const query = form ? new URLSearchParams(new FormData(form) as never) : new URLSearchParams();
    const response = await fetch(`/api/game-tracker/stats?${query.toString()}`, { cache: 'no-store' });
    const body = await response.json(); setLoading(false);
    if (!response.ok) setError(body.error ?? 'Could not calculate stats.'); else setStats(body);
  }
  useEffect(() => { void load(); }, []);

  return <main className="game-tracker-shell">
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← Game Tracker</Link></div>
    <section className="game-tracker-hero"><div><p className="game-tracker-eyebrow">SITUATIONAL REPORTING</p><h1>Season Stats</h1><p>Filter every line by game context, count, outs, base state, RISP, and matchup handedness.</p></div></section>
    <form className="game-tracker-card game-tracker-filters" onSubmit={(event) => { event.preventDefault(); void load(event.currentTarget); }}>
      <label>From<input name="dateFrom" type="date" /></label><label>To<input name="dateTo" type="date" /></label>
      <label>Session<select name="gameType" defaultValue=""><option value="">All types</option><option value="game">Games</option><option value="scrimmage">Scrimmages</option><option value="live_bp">Live BP</option></select></label>
      <label>Count<select name="count" defaultValue=""><option value="">Any count</option>{['0-0','1-0','0-1','2-0','1-1','0-2','3-0','2-1','1-2','3-1','2-2','3-2'].map((count) => <option key={count}>{count}</option>)}</select></label>
      <label>Outs<select name="outs" defaultValue=""><option value="">Any outs</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
      <label>Runners<select name="baseState" defaultValue=""><option value="">Any base state</option><option value="empty">Bases empty</option><option value="first">Runner on 1st</option><option value="second">Runner on 2nd</option><option value="third">Runner on 3rd</option><option value="first_second">1st + 2nd</option><option value="first_third">1st + 3rd</option><option value="second_third">2nd + 3rd</option><option value="loaded">Bases loaded</option><option value="risp">RISP (2nd or 3rd)</option></select></label>
      <label>Batter side<select name="batterHand" defaultValue=""><option value="">Any</option><option value="R">RHH</option><option value="L">LHH</option><option value="S">Switch</option></select></label>
      <label>Pitcher side<select name="pitcherHand" defaultValue=""><option value="">Any</option><option value="R">RHP</option><option value="L">LHP</option></select></label>
      <button className="btn btn-primary">Apply filters</button>
    </form>
    <section className="game-tracker-card game-tracker-stats-card">
      <div className="game-tracker-tabs">{(['batting','pitching','fielding'] as View[]).map((name) => <button key={name} className={view === name ? 'is-active' : ''} onClick={() => setView(name)}>{name}</button>)}</div>
      {error ? <p className="game-tracker-error">{error}</p> : loading ? <p className="game-tracker-muted">Calculating stats…</p> : <div className="game-tracker-table-wrap"><table><thead><tr><th>Player</th>{columns[view].map(([,label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{stats[view].length === 0 ? <tr><td colSpan={columns[view].length + 1}>No tracked events match these filters.</td></tr> : stats[view].map((line) => <tr key={`${line.playerId ?? line.gamePlayerId}-${line.playerName}`}><th>{line.playerName}</th>{columns[view].map(([key,label,format]) => <td key={label}>{format((line as unknown as Record<string, unknown>)[key])}</td>)}</tr>)}</tbody></table></div>}
      {view === 'batting' ? <p className="game-tracker-footnote">Hitting intentionally excludes Strike%. Whiff% is misses divided by swings.</p> : null}
    </section>
  </main>;
}
