'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './game-tracker-live.module.css';
import {
  BATTED_BALL_TYPES, PA_RESULTS, PITCH_TYPES, RUNNER_REASONS, battingSideForHalf, fieldingSideForHalf,
  type BattedBallType, type GameEventInput, type GameTrackerGame, type GameTrackerPlayer,
  type Handedness, type PlateAppearanceResult, type RunnerReason, type StoredGameEvent, type ThrowingHand,
} from '../../lib/game-tracker/types';

type RosterPlayer = { playerId: number; fullName: string; bats: Handedness | null; throws: ThrowingHand | null; position: string | null };
type Bundle = { game: GameTrackerGame; players: GameTrackerPlayer[]; events: StoredGameEvent[]; roster: RosterPlayer[] };
type DraftPlayer = Omit<GameTrackerPlayer, 'id' | 'gameId'> & { id?: number; gameId?: number };

const RESULT_LABELS: Record<string, string> = {
  single: 'Single', double: 'Double', triple: 'Triple', home_run: 'Home run', reached_on_error: 'Reached on error',
  fielders_choice: "Fielder's choice", groundout: 'Ground out', flyout: 'Fly out', lineout: 'Line out', popout: 'Pop out',
  sacrifice_fly: 'Sac fly', sacrifice_bunt: 'Sac bunt', double_play: 'Double play', triple_play: 'Triple play', other: 'Other',
};
const IN_PLAY_RESULTS = PA_RESULTS.filter((value) => !['walk', 'intentional_walk', 'strikeout', 'hit_by_pitch', 'catcher_interference', 'dropped_third_strike'].includes(value));

function blankOpponent(order: number): DraftPlayer {
  return { teamSide: 'opponent', playerId: null, displayName: '', jerseyNumber: null, bats: 'R', throws: 'R', battingOrder: order, position: order === 1 ? 'P' : null, isStarter: true, isActive: true };
}

function LineupEditor({ bundle, onSaved }: { bundle: Bundle; onSaved: () => Promise<void> }) {
  const initial = bundle.players.length ? bundle.players : [
    ...bundle.roster.map((player, index) => ({ teamSide: 'us' as const, playerId: player.playerId, displayName: player.fullName, jerseyNumber: null, bats: player.bats ?? 'R' as Handedness, throws: player.throws ?? 'R' as ThrowingHand, battingOrder: index + 1, position: player.position, isStarter: true, isActive: true })),
    blankOpponent(1),
  ];
  const [players, setPlayers] = useState<DraftPlayer[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function patchPlayer(index: number, patch: Partial<DraftPlayer>) { setPlayers((current) => current.map((player, i) => i === index ? { ...player, ...patch } : player)); }
  async function save() {
    setSaving(true); setError('');
    const active = players.filter((player) => player.displayName.trim());
    const response = await fetch(`/api/game-tracker/games/${bundle.game.id}/lineup`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ players: active }) });
    const body = await response.json(); setSaving(false);
    if (!response.ok) return setError(body.error ?? 'Could not save lineups.');
    await onSaved();
  }

  return <section className="game-tracker-card game-tracker-lineup">
    <div className="game-tracker-card-heading"><span className="game-tracker-step">01</span><div><h2>Lineups & defense</h2><p>Batting and throwing hand are required and remain editable.</p></div></div>
    {(['us', 'opponent'] as const).map((side) => <div key={side} className="game-tracker-lineup-side">
      <div className="game-tracker-section-title"><h3>{side === 'us' ? bundle.game.schoolCode : bundle.game.opponentName}</h3><button type="button" className="btn btn-ghost" onClick={() => setPlayers((current) => [...current, side === 'opponent' ? blankOpponent(current.filter((p) => p.teamSide === side).length + 1) : { ...blankOpponent(current.filter((p) => p.teamSide === side).length + 1), teamSide: 'us' }])}>+ Player</button></div>
      <div className="game-tracker-lineup-table">
        <div className="game-tracker-lineup-head"><span>#</span><span>Player</span><span>Bats</span><span>Throws</span><span>Pos</span><span /></div>
        {players.map((player, index) => player.teamSide === side ? <div className="game-tracker-lineup-row" key={`${side}-${player.id ?? index}`}>
          <input aria-label="Batting order" type="number" min="1" max="99" value={player.battingOrder ?? ''} onChange={(e) => patchPlayer(index, { battingOrder: e.target.value ? Number(e.target.value) : null })} />
          <input aria-label="Player name" value={player.displayName} placeholder="Player name" onChange={(e) => patchPlayer(index, { displayName: e.target.value })} />
          <select aria-label="Bats" value={player.bats} onChange={(e) => patchPlayer(index, { bats: e.target.value as Handedness })}><option value="R">R</option><option value="L">L</option><option value="S">S</option></select>
          <select aria-label="Throws" value={player.throws} onChange={(e) => patchPlayer(index, { throws: e.target.value as ThrowingHand })}><option value="R">R</option><option value="L">L</option></select>
          <select aria-label="Position" value={player.position ?? ''} onChange={(e) => patchPlayer(index, { position: e.target.value || null })}><option value="">—</option>{['P','C','1B','2B','3B','SS','LF','CF','RF','DH','EH'].map((pos) => <option key={pos}>{pos}</option>)}</select>
          <button type="button" aria-label={`Remove ${player.displayName || 'player'}`} onClick={() => setPlayers((current) => current.filter((_, i) => i !== index))}>×</button>
        </div> : null)}
      </div>
    </div>)}
    {error ? <p className="game-tracker-error">{error}</p> : null}
    <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save lineups'}</button>
  </section>;
}

function playerName(players: GameTrackerPlayer[], id: number | null) { return players.find((player) => player.id === id)?.displayName ?? 'Not set'; }

function BaseballFieldGraphic() {
  return (
    <svg className="game-tracker-field-art" viewBox="0 0 600 520" aria-hidden="true">
      <defs>
        <linearGradient id="gt-field-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#244d31" />
          <stop offset="1" stopColor="#102719" />
        </linearGradient>
        <linearGradient id="gt-field-dirt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a8754f" />
          <stop offset="1" stopColor="#70482f" />
        </linearGradient>
        <clipPath id="gt-field-clip">
          <path d="M300 496 10 225A320 320 0 0 1 590 225Z" />
        </clipPath>
      </defs>
      <path className="field-shadow" d="M300 504 5 228A326 326 0 0 1 595 228Z" />
      <path className="field-grass" d="M300 496 10 225A320 320 0 0 1 590 225Z" fill="url(#gt-field-grass)" />
      <g clipPath="url(#gt-field-clip)" className="field-mow-lines">
        <path d="M-10 190 300 510 610 190" />
        <path d="M48 105 300 510 552 105" />
        <path d="M112 36 300 510 488 36" />
        <path d="M178 -4 300 510 422 -4" />
      </g>
      <path className="field-outfield-fence" d="M7 228A326 326 0 0 1 593 228" />
      <path className="field-warning-track" d="M31 226A299 299 0 0 1 569 226" />
      <circle className="field-home-dirt" cx="300" cy="476" r="35" fill="url(#gt-field-dirt)" />
      <path
        className="field-infield-dirt"
        d="M300 492 163 359Q153 348 169 329Q217 268 300 250Q383 268 431 329Q447 348 437 359Z"
        fill="url(#gt-field-dirt)"
      />
      <path
        className="field-infield-grass"
        d="M300 463 199 365Q191 356 202 344Q244 300 300 286Q356 300 398 344Q409 356 401 365Z"
      />
      <circle className="field-mound-dirt" cx="300" cy="378" r="24" fill="url(#gt-field-dirt)" />
      <rect className="field-rubber" x="291" y="375" width="18" height="5" rx="1" />
      <path className="field-foul-line" d="M300 496 10 225M300 496 590 225" />
      <g className="field-base">
        <rect x="406" y="370" width="16" height="16" transform="rotate(45 414 378)" />
        <rect x="292" y="256" width="16" height="16" transform="rotate(45 300 264)" />
        <rect x="178" y="370" width="16" height="16" transform="rotate(45 186 378)" />
      </g>
      <path className="field-home-plate" d="M290 478h20v8l-10 10-10-10Z" />
      <circle className="field-position" cx="300" cy="130" r="4" />
      <circle className="field-position" cx="155" cy="220" r="4" />
      <circle className="field-position" cx="445" cy="220" r="4" />
      <circle className="field-position" cx="300" cy="378" r="4" />
    </svg>
  );
}

export default function GameTrackerLive({ gameId }: { gameId: number }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [pitchType, setPitchType] = useState('Fastball');
  const [inPlay, setInPlay] = useState(false);
  const [paResult, setPaResult] = useState<PlateAppearanceResult>('single');
  const [battedBallType, setBattedBallType] = useState<BattedBallType>('ground_ball');
  const [fieldPoint, setFieldPoint] = useState<{ x: number; y: number } | null>(null);
  const [fielderId, setFielderId] = useState('');
  const [fieldingCredit, setFieldingCredit] = useState<'putout' | 'assist' | 'error'>('putout');
  const [runnerReason, setRunnerReason] = useState<RunnerReason>('manual');
  const [busy, setBusy] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/game-tracker/games/${gameId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Could not load game.'); else setBundle(body);
  }, [gameId]);
  useEffect(() => { void load(); }, [load]);

  const context = useMemo(() => {
    if (!bundle) return null;
    const battingSide = battingSideForHalf(bundle.game.homeAway, bundle.game.state.half);
    const fieldingSide = fieldingSideForHalf(bundle.game.homeAway, bundle.game.state.half);
    const lineup = bundle.players.filter((p) => p.teamSide === battingSide && p.isActive && p.battingOrder !== null).sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder));
    const batter = lineup.length ? lineup[bundle.game.state.battingIndex[battingSide] % lineup.length] : null;
    const pitcherId = bundle.game.state.pitcherIds[fieldingSide];
    const pitcher = bundle.players.find((p) => p.id === pitcherId) ?? bundle.players.find((p) => p.teamSide === fieldingSide && p.position === 'P');
    return { battingSide, fieldingSide, batter, pitcher };
  }, [bundle]);

  async function sendEvent(event: GameEventInput) {
    if (!bundle) return;
    setBusy(true); setError('');
    const response = await fetch(`/api/game-tracker/games/${gameId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, expectedRevision: bundle.game.revision, clientEventId: crypto.randomUUID() }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error ?? 'Could not record play.'); if (response.status === 409) await load(); return; }
    setBundle((current) => current ? { ...current, game: body.game, players: body.players, events: [...current.events, body.event] } : current);
    setInPlay(false); setFieldPoint(null);
  }

  async function undo() {
    setBusy(true); const response = await fetch(`/api/game-tracker/games/${gameId}/events`, { method: 'DELETE' }); const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error ?? 'Could not undo.'); await load();
  }
  async function setStatus(status: 'live' | 'final') {
    const response = await fetch(`/api/game-tracker/games/${gameId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    if (response.ok) await load();
  }
  async function deleteGame() {
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    const response = await fetch(`/api/game-tracker/games/${gameId}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error ?? 'Could not delete the game.');
    window.location.href = '/portal/admin/game-tracker';
  }

  if (!bundle) return <main className={`${styles.shell} game-tracker-shell`}><p>{error || 'Loading Game Tracker…'}</p></main>;
  const state = bundle.game.state;
  const lineScore = bundle.events.reduce((totals, event) => {
    if (event.isVoided) return totals;
    const batting = event.situation.battingSide;
    if (event.input.type === 'pitch') {
      if (['single','double','triple','home_run'].includes(String(event.input.plateAppearanceResult))) totals[batting].hits += 1;
      for (const credit of event.input.fielderCredits ?? []) if (credit.credit === 'error') totals[event.situation.fieldingSide].errors += 1;
    }
    const runDelta = Math.max(0, event.stateAfter.score[batting] - totals.previousScore[batting]);
    if (runDelta > 0) totals[batting].innings[event.situation.inning] = (totals[batting].innings[event.situation.inning] ?? 0) + runDelta;
    totals.previousScore = { ...event.stateAfter.score };
    return totals;
  }, {
    us: { hits: 0, errors: 0, innings: {} as Record<number, number> },
    opponent: { hits: 0, errors: 0, innings: {} as Record<number, number> },
    previousScore: { us: 0, opponent: 0 },
  });
  const lineScoreInnings = Array.from(
    { length: Math.max(bundle.game.inningsScheduled, state.inning) },
    (_, index) => index + 1
  );
  const activeBattingSide = battingSideForHalf(bundle.game.homeAway, state.half);
  const inningDisplay = (side: 'us' | 'opponent', inning: number) => {
    const sideHasBatted = inning < state.inning
      || (inning === state.inning && (state.half === 'bottom' || side === activeBattingSide));
    return sideHasBatted ? (lineScore[side].innings[inning] ?? 0) : '';
  };
  const hasLineups = bundle.players.some((p) => p.teamSide === 'us') && bundle.players.some((p) => p.teamSide === 'opponent');
  if (!hasLineups || lineupOpen) return <main className={`${styles.shell} game-tracker-shell`}><div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link>{hasLineups ? <button className="btn btn-ghost" onClick={() => setLineupOpen(false)}>Return to scoring</button> : null}</div><LineupEditor bundle={bundle} onSaved={async () => { await load(); setLineupOpen(false); }} /></main>;

  return <main className={`${styles.shell} game-tracker-shell game-tracker-live`}>
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link><div><button className="btn btn-ghost" onClick={() => setLineupOpen(true)}>Edit lineups</button> <Link className="btn btn-ghost as-link" href="/portal/admin/game-tracker/stats">Stats</Link></div></div>
    <section className="game-tracker-scoreboard-panel">
      <div className="game-tracker-scoreboard">
        <div><span>{bundle.game.schoolCode}</span><strong>{state.score.us}</strong></div><div className="game-tracker-inning"><span>{state.half === 'top' ? '▲' : '▼'} {state.inning}</span><small>{state.outs} OUT{state.outs === 1 ? '' : 'S'}</small></div><div><span>{bundle.game.opponentName}</span><strong>{state.score.opponent}</strong></div>
      </div>
      <div className="game-tracker-linescore-wrap">
        <table className="game-tracker-linescore" aria-label="Inning-by-inning line score">
          <thead><tr><th>Team</th>{lineScoreInnings.map((inning) => <th key={inning} className={inning === state.inning ? 'is-current' : ''}>{inning}</th>)}<th>R</th><th>H</th><th>E</th></tr></thead>
          <tbody>
            <tr><th>{bundle.game.schoolCode}</th>{lineScoreInnings.map((inning) => <td key={inning} className={inning === state.inning ? 'is-current' : ''}>{inningDisplay('us', inning)}</td>)}<td>{state.score.us}</td><td>{lineScore.us.hits}</td><td>{lineScore.us.errors}</td></tr>
            <tr><th>{bundle.game.opponentName}</th>{lineScoreInnings.map((inning) => <td key={inning} className={inning === state.inning ? 'is-current' : ''}>{inningDisplay('opponent', inning)}</td>)}<td>{state.score.opponent}</td><td>{lineScore.opponent.hits}</td><td>{lineScore.opponent.errors}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section className="game-tracker-live-grid">
      <article className="game-tracker-card game-tracker-atbat">
        <div className="game-tracker-matchup"><div><small>BATTER · {context?.batter?.bats ?? '—'}HH</small><strong>{context?.batter?.displayName ?? 'Set batter'}</strong></div><span>vs</span><div><small>PITCHER · {context?.pitcher?.throws ?? '—'}HP</small><strong>{context?.pitcher?.displayName ?? 'Set pitcher'}</strong></div></div>
        <div className="game-tracker-count"><strong>{state.balls}–{state.strikes}</strong><span>COUNT</span><div className="game-tracker-bases" aria-label="Runners on base"><i className={state.runners.second ? 'is-on' : ''}/><i className={state.runners.third ? 'is-on' : ''}/><i className={state.runners.first ? 'is-on' : ''}/></div></div>
        <label className="game-tracker-pitch-type">Pitch type<select value={pitchType} onChange={(event) => setPitchType(event.target.value)}>{PITCH_TYPES.map((pitch) => <option key={pitch}>{pitch}</option>)}</select></label>
        {!inPlay ? <div className="game-tracker-result-grid">
          <button disabled={busy} className="is-ball" onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'ball' })}>Ball</button>
          <button disabled={busy} className="is-strike" onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'called_strike' })}>Called strike</button>
          <button disabled={busy} className="is-strike" onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'swinging_strike' })}>Swing & miss</button>
          <button disabled={busy} onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'foul' })}>Foul</button>
          <button disabled={busy} onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'hit_by_pitch' })}>Hit by pitch</button>
          <button disabled={busy} className="is-contact" onClick={() => setInPlay(true)}>Ball in play →</button>
        </div> : <div className="game-tracker-inplay">
          <div><label>Outcome<select value={paResult} onChange={(e) => setPaResult(e.target.value as PlateAppearanceResult)}>{IN_PLAY_RESULTS.map((result) => <option key={result} value={result}>{RESULT_LABELS[result] ?? result}</option>)}</select></label><label>Batted ball<select value={battedBallType} onChange={(e) => setBattedBallType(e.target.value as BattedBallType)}>{BATTED_BALL_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label><label>Primary fielder<select value={fielderId} onChange={(e) => setFielderId(e.target.value)}><option value="">Not recorded</option>{bundle.players.filter((player) => player.teamSide === context?.fieldingSide && player.isActive).map((player) => <option key={player.id} value={player.id}>{player.position ?? '—'} · {player.displayName}</option>)}</select></label><label>Fielding credit<select value={fieldingCredit} onChange={(e) => setFieldingCredit(e.target.value as typeof fieldingCredit)}><option value="putout">Putout</option><option value="assist">Assist</option><option value="error">Error</option></select></label></div>
          <button className="game-tracker-field" onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); setFieldPoint({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }); }}>
            <BaseballFieldGraphic />
            <span>Tap where the ball was hit</span>
            {fieldPoint ? <i style={{ left: `${fieldPoint.x * 100}%`, top: `${fieldPoint.y * 100}%` }} /> : null}
          </button>
          <div className="game-tracker-inline-actions"><button className="btn btn-ghost" onClick={() => setInPlay(false)}>Back</button><button className="btn btn-primary" disabled={busy} onClick={() => sendEvent({ type: 'pitch', pitchType, result: 'in_play', plateAppearanceResult: paResult, battedBallType, fieldX: fieldPoint?.x ?? null, fieldY: fieldPoint?.y ?? null, fielderCredits: fielderId ? [{ gamePlayerId: Number(fielderId), position: bundle.players.find((player) => player.id === Number(fielderId))?.position ?? '—', credit: fieldingCredit }] : [] })}>Record play</button></div>
        </div>}
        {error ? <p className="game-tracker-error">{error}</p> : null}
      </article>
      <aside className="game-tracker-card game-tracker-runner-panel">
        <h2>Runners</h2>
        {([3,2,1] as const).map((base) => { const id = base === 1 ? state.runners.first : base === 2 ? state.runners.second : state.runners.third; return <div key={base} className="game-tracker-runner-row"><span><small>{base === 1 ? '1ST' : base === 2 ? '2ND' : '3RD'}</small><strong>{id ? playerName(bundle.players, id) : 'Empty'}</strong></span>{id ? <div><button disabled={busy} onClick={() => sendEvent({ type: 'runner', runnerGamePlayerId: id, fromBase: base, toBase: base === 3 ? 4 : base + 1 as 2 | 3, reason: runnerReason })}>{base === 3 ? 'Score' : 'Advance'}</button><button disabled={busy} onClick={() => sendEvent({ type: 'runner', runnerGamePlayerId: id, fromBase: base, toBase: base, reason: runnerReason, isOut: true })}>Out</button></div> : null}</div>; })}
        <label>Runner reason<select value={runnerReason} onChange={(event) => setRunnerReason(event.target.value as RunnerReason)}>{RUNNER_REASONS.map((reason) => <option key={reason} value={reason}>{reason.replaceAll('_', ' ')}</option>)}</select></label>
        <div className="game-tracker-event-log"><h3>Last plays</h3>{bundle.events.filter((event) => !event.isVoided).slice(-6).reverse().map((event) => <p key={event.id}><strong>{event.sequence}.</strong> {event.input.type === 'pitch' ? `${event.input.pitchType} · ${(event.input.plateAppearanceResult ?? event.input.result).replaceAll('_', ' ')}` : event.input.reason.replaceAll('_', ' ')}</p>)}</div>
        <button className="btn btn-ghost" disabled={busy || bundle.events.length === 0} onClick={undo}>Undo last play</button>
        {bundle.game.status === 'final' ? <button className="btn btn-primary" onClick={() => setStatus('live')}>Reopen game</button> : <button className="btn btn-primary" onClick={() => setStatus('final')}>Finalize game</button>}
        <button className="btn btn-ghost" onClick={deleteGame}>Delete game</button>
      </aside>
    </section>
  </main>;
}
