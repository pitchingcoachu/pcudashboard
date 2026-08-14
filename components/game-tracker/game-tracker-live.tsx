'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  if (!bundle) return <main className="game-tracker-shell"><p>{error || 'Loading Game Tracker…'}</p></main>;
  const state = bundle.game.state;
  const box = bundle.events.reduce((totals, event) => {
    if (event.isVoided || event.input.type !== 'pitch') return totals;
    const batting = event.situation.battingSide;
    if (['single','double','triple','home_run'].includes(String(event.input.plateAppearanceResult))) totals[batting].hits += 1;
    for (const credit of event.input.fielderCredits ?? []) if (credit.credit === 'error') totals[event.situation.fieldingSide].errors += 1;
    return totals;
  }, { us: { hits: 0, errors: 0 }, opponent: { hits: 0, errors: 0 } });
  const hasLineups = bundle.players.some((p) => p.teamSide === 'us') && bundle.players.some((p) => p.teamSide === 'opponent');
  if (!hasLineups || lineupOpen) return <main className="game-tracker-shell"><div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link>{hasLineups ? <button className="btn btn-ghost" onClick={() => setLineupOpen(false)}>Return to scoring</button> : null}</div><LineupEditor bundle={bundle} onSaved={async () => { await load(); setLineupOpen(false); }} /></main>;

  return <main className="game-tracker-shell game-tracker-live">
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link><div><button className="btn btn-ghost" onClick={() => setLineupOpen(true)}>Edit lineups</button> <Link className="btn btn-ghost as-link" href="/portal/admin/game-tracker/stats">Stats</Link></div></div>
    <section className="game-tracker-scoreboard">
      <div><span>{bundle.game.schoolCode}</span><strong>{state.score.us}</strong></div><div className="game-tracker-inning"><span>{state.half === 'top' ? '▲' : '▼'} {state.inning}</span><small>{state.outs} OUT{state.outs === 1 ? '' : 'S'}</small></div><div><span>{bundle.game.opponentName}</span><strong>{state.score.opponent}</strong></div>
    </section>
    <section className="game-tracker-boxscore" aria-label="Live box score"><span /><b>R</b><b>H</b><b>E</b><strong>{bundle.game.schoolCode}</strong><span>{state.score.us}</span><span>{box.us.hits}</span><span>{box.us.errors}</span><strong>{bundle.game.opponentName}</strong><span>{state.score.opponent}</span><span>{box.opponent.hits}</span><span>{box.opponent.errors}</span></section>
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
          <button className="game-tracker-field" onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); setFieldPoint({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }); }}><span>Tap where the ball was hit</span>{fieldPoint ? <i style={{ left: `${fieldPoint.x * 100}%`, top: `${fieldPoint.y * 100}%` }} /> : null}</button>
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
      </aside>
    </section>
  </main>;
}
