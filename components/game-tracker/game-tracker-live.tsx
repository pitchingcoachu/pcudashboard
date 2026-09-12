'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './game-tracker-live.module.css';
import {
  BATTED_BALL_TYPES, PA_RESULTS, PITCH_TYPES, RUNNER_REASONS, battingSideForHalf, fieldingSideForHalf,
  type BattedBallType, type GameEventInput, type GameTrackerGame, type GameTrackerPlayer,
  type GameTrackerRosterMember, type GameTrackerTeam, type Handedness, type PlateAppearanceResult,
  type RunnerReason, type StoredGameEvent, type TeamSide, type ThrowingHand,
} from '../../lib/game-tracker/types';

type RosterPlayer = { playerId: number; fullName: string; bats: Handedness | null; throws: ThrowingHand | null; position: string | null };
type Bundle = { game: GameTrackerGame; players: GameTrackerPlayer[]; events: StoredGameEvent[]; roster: RosterPlayer[]; teams: GameTrackerTeam[]; rosterMembers: GameTrackerRosterMember[] };
type DraftPlayer = Omit<GameTrackerPlayer, 'id' | 'gameId'> & { id?: number; gameId?: number };

const RESULT_LABELS: Record<string, string> = {
  single: 'Single', double: 'Double', triple: 'Triple', home_run: 'Home run', reached_on_error: 'Reached on error',
  fielders_choice: "Fielder's choice", groundout: 'Ground out', flyout: 'Fly out', lineout: 'Line out', popout: 'Pop out',
  sacrifice_fly: 'Sac fly', sacrifice_bunt: 'Sac bunt', double_play: 'Double play', triple_play: 'Triple play', other: 'Other',
};
const IN_PLAY_RESULTS = PA_RESULTS.filter((value) => !['walk', 'intentional_walk', 'strikeout', 'hit_by_pitch', 'catcher_interference', 'dropped_third_strike'].includes(value));
const POSITION_OPTIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH', 'PH'] as const;
const STARTING_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;

function blankPlayer(teamSide: TeamSide, battingOrder: number | null, position: string | null, statTeamId: number | null = null): DraftPlayer {
  return { teamSide, playerId: null, rosterPersonId: null, statTeamId, displayName: '', jerseyNumber: null, bats: 'R', throws: 'R', battingOrder, position, isStarter: true, isActive: true };
}

function defaultLineup(teamSide: TeamSide, statTeamId: number | null): DraftPlayer[] {
  return [
    ...STARTING_POSITIONS.map((position, index) => blankPlayer(teamSide, index + 1, position, statTeamId)),
    blankPlayer(teamSide, null, 'P', statTeamId),
  ];
}

function lineupFromTeam(bundle: Bundle, teamSide: TeamSide, teamId: number | null): DraftPlayer[] {
  const team = bundle.teams.find((candidate) => candidate.id === teamId);
  const statTeamId = team?.statSourceTeamId ?? teamId;
  const slots = defaultLineup(teamSide, statTeamId);
  const members = bundle.rosterMembers.filter((member) => member.teamId === teamId);
  const used = new Set<number>();
  function fill(slot: DraftPlayer, member?: GameTrackerRosterMember): DraftPlayer {
    if (!member) return slot;
    used.add(member.id);
    return {
      ...slot, playerId: member.playerId, rosterPersonId: member.rosterPersonId, displayName: member.displayName,
      jerseyNumber: member.jerseyNumber, bats: member.bats, throws: member.throws,
    };
  }
  const battingSlots = slots.slice(0, 9).map((slot) => {
    const exact = members.find((member) => !used.has(member.id) && member.position === slot.position && member.position !== 'P');
    const available = exact ?? members.find((member) => !used.has(member.id) && member.position !== 'P');
    return fill(slot, available);
  });
  const pitcherSlot = fill(slots[9], members.find((member) => !used.has(member.id) && member.position === 'P'));
  return [...battingSlots, pitcherSlot];
}

function LineupEditor({ bundle, onSaved, locked = false }: { bundle: Bundle; onSaved: () => Promise<void>; locked?: boolean }) {
  const initial = bundle.players.length ? bundle.players.filter((player) => player.isActive) : [
    ...lineupFromTeam(bundle, 'us', bundle.game.usTeamId), ...lineupFromTeam(bundle, 'opponent', bundle.game.opponentTeamId),
  ];
  const [players, setPlayers] = useState<DraftPlayer[]>(initial);
  const [draggedPlayerIndex, setDraggedPlayerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function patchPlayer(index: number, patch: Partial<DraftPlayer>) { setPlayers((current) => current.map((player, i) => i === index ? { ...player, ...patch } : player)); }
  function setPlayerName(index: number, name: string) {
    const current = players[index];
    const sideTeamId = current.teamSide === 'us' ? bundle.game.usTeamId : bundle.game.opponentTeamId;
    const rosterMember = bundle.rosterMembers.find((member) => member.teamId === sideTeamId && member.displayName.localeCompare(name.trim(), undefined, { sensitivity: 'accent' }) === 0)
      ?? bundle.rosterMembers.find((member) => member.displayName.localeCompare(name.trim(), undefined, { sensitivity: 'accent' }) === 0);
    const rosterPlayer = bundle.roster.find((player) => player.fullName.localeCompare(name.trim(), undefined, { sensitivity: 'accent' }) === 0);
    patchPlayer(index, rosterMember ? {
      displayName: name, playerId: rosterMember.playerId, rosterPersonId: rosterMember.rosterPersonId,
      statTeamId: bundle.teams.find((team) => team.id === rosterMember.teamId)?.statSourceTeamId ?? rosterMember.teamId,
      bats: rosterMember.bats, throws: rosterMember.throws,
    } : rosterPlayer ? {
      displayName: name,
      playerId: rosterPlayer.playerId,
      rosterPersonId: null,
      bats: rosterPlayer.bats ?? 'R',
      throws: rosterPlayer.throws ?? 'R',
    } : { displayName: name, playerId: null, rosterPersonId: null });
  }
  function reorderPlayers(side: TeamSide, sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex) return;
    setPlayers((current) => {
      const battingRows = current
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => player.teamSide === side && player.battingOrder !== null)
        .sort((a, b) => Number(a.player.battingOrder) - Number(b.player.battingOrder));
      const sourcePosition = battingRows.findIndex(({ index }) => index === sourceIndex);
      const targetPosition = battingRows.findIndex(({ index }) => index === targetIndex);
      if (sourcePosition < 0 || targetPosition < 0) return current;
      const reordered = [...battingRows];
      const [moved] = reordered.splice(sourcePosition, 1);
      reordered.splice(targetPosition, 0, moved);
      const battingOrderByIndex = new Map(reordered.map(({ index }, order) => [index, order + 1]));
      return current.map((player, index) => battingOrderByIndex.has(index)
        ? { ...player, battingOrder: battingOrderByIndex.get(index) ?? player.battingOrder }
        : player);
    });
  }
  function movePlayerWithKeyboard(side: TeamSide, index: number, direction: -1 | 1) {
    const battingRows = players
      .map((player, playerIndex) => ({ player, index: playerIndex }))
      .filter(({ player }) => player.teamSide === side && player.battingOrder !== null)
      .sort((a, b) => Number(a.player.battingOrder) - Number(b.player.battingOrder));
    const position = battingRows.findIndex((row) => row.index === index);
    const target = battingRows[position + direction];
    if (target) reorderPlayers(side, index, target.index);
  }
  function removePlayer(side: TeamSide, removedIndex: number) {
    setPlayers((current) => {
      const remaining = current.filter((_, index) => index !== removedIndex);
      const orderedPlayerIndexes = remaining
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => player.teamSide === side && player.battingOrder !== null)
        .sort((a, b) => Number(a.player.battingOrder) - Number(b.player.battingOrder))
        .map(({ index }) => index);
      const battingOrderByIndex = new Map(orderedPlayerIndexes.map((index, order) => [index, order + 1]));
      return remaining.map((player, index) => battingOrderByIndex.has(index)
        ? { ...player, battingOrder: battingOrderByIndex.get(index) ?? player.battingOrder }
        : player);
    });
  }
  async function save() {
    setSaving(true); setError('');
    const active = players.filter((player) => player.displayName.trim());
    const response = await fetch(`/api/game-tracker/games/${bundle.game.id}/lineup`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ players: active }) });
    const body = await response.json(); setSaving(false);
    if (!response.ok) return setError(body.error ?? 'Could not save lineups.');
    await onSaved();
  }

  return <section className="game-tracker-card game-tracker-lineup">
    <datalist id="game-tracker-roster-options">{Array.from(new Set([...bundle.roster.map((player) => player.fullName), ...bundle.rosterMembers.map((member) => member.displayName)])).sort().map((name) => <option key={name} value={name} />)}</datalist>
    <div className="game-tracker-card-heading"><span className="game-tracker-step">01</span><div><h2>Lineups & defense</h2><p>{locked ? 'The game is underway. Use substitutions from the scoring screen to protect player history.' : 'Both teams can use your roster for intersquad games. Drag the grip beside a lineup number to reorder.'}</p></div></div>
    {(['us', 'opponent'] as const).map((side) => <div key={side} className="game-tracker-lineup-side">
      <div className="game-tracker-section-title"><h3>{side === 'us' ? bundle.game.usTeamName : bundle.game.opponentName}</h3>{!locked ? <button type="button" className="btn btn-ghost" onClick={() => setPlayers((current) => {
        const nextOrder = Math.max(0, ...current.filter((player) => player.teamSide === side).map((player) => player.battingOrder ?? 0)) + 1;
        return [...current, blankPlayer(side, nextOrder, 'EH', side === 'us' ? bundle.game.usTeamId : bundle.game.opponentTeamId)];
      })}>+ Add player</button> : null}</div>
      <div className="game-tracker-lineup-table">
        <div className="game-tracker-lineup-head"><span>#</span><span>Player</span><span>Bats</span><span>Throws</span><span>Pos</span><span>Stats team</span><span /></div>
        {players.map((player, index) => ({ player, index })).filter(({ player }) => player.teamSide === side).sort((a, b) => {
          if (a.player.position === 'P' && a.player.battingOrder === null) return 1;
          if (b.player.position === 'P' && b.player.battingOrder === null) return -1;
          return Number(a.player.battingOrder ?? 999) - Number(b.player.battingOrder ?? 999);
        }).map(({ player, index }) => <div
          className={`game-tracker-lineup-row ${player.position === 'P' && player.battingOrder === null ? 'is-pitcher-row' : ''} ${draggedPlayerIndex === index ? 'is-dragging' : ''}`}
          key={`${side}-${player.id ?? index}`}
          onDragOver={(event) => { if (!locked && player.battingOrder !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
          onDrop={(event) => { event.preventDefault(); if (draggedPlayerIndex !== null) reorderPlayers(side, draggedPlayerIndex, index); setDraggedPlayerIndex(null); }}
        >
          <div className="game-tracker-order-cell"><strong>{player.battingOrder ?? 'P'}</strong>{!locked && player.battingOrder !== null ? <button
            type="button"
            className="game-tracker-drag-handle"
            draggable
            aria-label={`Drag ${player.displayName || `lineup spot ${player.battingOrder}`} to reorder`}
            title="Drag to reorder"
            onDragStart={(event) => { setDraggedPlayerIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
            onDragEnd={() => setDraggedPlayerIndex(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                movePlayerWithKeyboard(side, index, event.key === 'ArrowUp' ? -1 : 1);
              }
            }}
          >⠿</button> : null}</div>
          <input aria-label="Player name" disabled={locked} list="game-tracker-roster-options" value={player.displayName} placeholder="Select roster player or type a name" onChange={(e) => setPlayerName(index, e.target.value)} />
          <select aria-label="Bats" disabled={locked} value={player.bats} onChange={(e) => patchPlayer(index, { bats: e.target.value as Handedness })}><option value="R">R</option><option value="L">L</option><option value="S">S</option></select>
          <select aria-label="Throws" disabled={locked} value={player.throws} onChange={(e) => patchPlayer(index, { throws: e.target.value as ThrowingHand })}><option value="R">R</option><option value="L">L</option></select>
          <select aria-label="Position" disabled={locked} value={player.position ?? ''} onChange={(e) => patchPlayer(index, { position: e.target.value || null })}><option value="">—</option>{POSITION_OPTIONS.map((pos) => <option key={pos}>{pos}</option>)}</select>
          <select aria-label="Stats team" disabled={locked} value={player.statTeamId ?? ''} onChange={(e) => patchPlayer(index, { statTeamId: e.target.value ? Number(e.target.value) : null })}><option value="">Game only</option>{bundle.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
          {!locked ? <button type="button" className="game-tracker-remove-player" aria-label={`Remove ${player.displayName || 'player'}`} onClick={() => removePlayer(side, index)}>×</button> : <span />}
        </div>)}
      </div>
    </div>)}
    {error ? <p className="game-tracker-error">{error}</p> : null}
    {!locked ? <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save lineups'}</button> : null}
  </section>;
}

function playerName(players: GameTrackerPlayer[], id: number | null) { return players.find((player) => player.id === id)?.displayName ?? 'Not set'; }

function SubstitutionPanel({ bundle, onClose, onSaved }: { bundle: Bundle; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'substitute' | 'change_position'>('substitute');
  const liveBattingSide = battingSideForHalf(bundle.game.homeAway, bundle.game.state.half);
  const liveLineup = bundle.players
    .filter((player) => player.teamSide === liveBattingSide && player.isActive && player.battingOrder !== null)
    .sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder) || a.id - b.id);
  const liveBatter = liveLineup.length
    ? liveLineup[bundle.game.state.battingIndex[liveBattingSide] % liveLineup.length]
    : null;
  const [side, setSide] = useState<TeamSide>(liveBattingSide);
  const activePlayers = bundle.players.filter((player) => player.teamSide === side && player.isActive);
  const [selectedPlayerId, setSelectedPlayerId] = useState(() => liveBatter?.id ?? activePlayers[0]?.id ?? 0);
  const selectedPlayer = bundle.players.find((player) => player.id === selectedPlayerId);
  const [name, setName] = useState('');
  const [rosterPlayerId, setRosterPlayerId] = useState<number | null>(null);
  const [rosterPersonId, setRosterPersonId] = useState<number | null>(null);
  const [statTeamId, setStatTeamId] = useState<number | null>(liveBattingSide === 'us' ? bundle.game.usTeamId : bundle.game.opponentTeamId);
  const [bats, setBats] = useState<Handedness>('R');
  const [throws, setThrows] = useState<ThrowingHand>('R');
  const [position, setPosition] = useState('PH');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function changeSide(nextSide: TeamSide) {
    const first = nextSide === liveBattingSide && liveBatter
      ? liveBatter
      : bundle.players.find((player) => player.teamSide === nextSide && player.isActive);
    setSide(nextSide);
    setSelectedPlayerId(first?.id ?? 0);
    setPosition(mode === 'change_position' ? first?.position ?? '' : 'PH');
    setStatTeamId(nextSide === 'us' ? bundle.game.usTeamId : bundle.game.opponentTeamId);
  }

  function changeSelectedPlayer(id: number) {
    const player = bundle.players.find((candidate) => candidate.id === id);
    setSelectedPlayerId(id);
    setPosition(mode === 'change_position' ? player?.position ?? '' : 'PH');
  }

  function changeName(value: string) {
    setName(value);
    const sideTeamId = side === 'us' ? bundle.game.usTeamId : bundle.game.opponentTeamId;
    const member = bundle.rosterMembers.find((player) => player.teamId === sideTeamId && player.displayName.localeCompare(value.trim(), undefined, { sensitivity: 'accent' }) === 0)
      ?? bundle.rosterMembers.find((player) => player.displayName.localeCompare(value.trim(), undefined, { sensitivity: 'accent' }) === 0);
    const rosterPlayer = bundle.roster.find((player) => player.fullName.localeCompare(value.trim(), undefined, { sensitivity: 'accent' }) === 0);
    setRosterPlayerId(member?.playerId ?? rosterPlayer?.playerId ?? null);
    setRosterPersonId(member?.rosterPersonId ?? null);
    if (member) {
      setBats(member.bats); setThrows(member.throws);
      setStatTeamId(bundle.teams.find((team) => team.id === member.teamId)?.statSourceTeamId ?? member.teamId);
    } else if (rosterPlayer) {
      setBats(rosterPlayer.bats ?? 'R'); setThrows(rosterPlayer.throws ?? 'R');
    }
  }

  async function submit() {
    if (!selectedPlayerId) return setError('Choose an active player.');
    if (mode === 'substitute' && !name.trim()) return setError('Enter the replacement player name.');
    setSaving(true); setError('');
    const body = mode === 'substitute'
      ? { action: mode, outgoingPlayerId: selectedPlayerId, incoming: { playerId: rosterPlayerId, rosterPersonId, statTeamId, displayName: name, bats, throws, position } }
      : { action: mode, playerId: selectedPlayerId, position };
    const response = await fetch(`/api/game-tracker/games/${bundle.game.id}/lineup`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error ?? 'Could not update the lineup.');
    await onSaved();
    onClose();
  }

  return <section className="game-tracker-card game-tracker-substitution">
    <div className="game-tracker-substitution-heading"><div><small>LIVE ROSTER MOVE</small><h2>Substitutions & positions</h2></div><button type="button" aria-label="Close substitutions" onClick={onClose}>×</button></div>
    <div className="game-tracker-segmented" role="group" aria-label="Lineup change type">
      <button type="button" className={mode === 'substitute' ? 'is-active' : ''} onClick={() => { setMode('substitute'); setPosition('PH'); }}>Pinch hit / replace</button>
      <button type="button" className={mode === 'change_position' ? 'is-active' : ''} onClick={() => { setMode('change_position'); setPosition(selectedPlayer?.position ?? ''); }}>Change position</button>
    </div>
    <div className="game-tracker-substitution-grid">
      <label>Game team<select value={side} onChange={(event) => changeSide(event.target.value as TeamSide)}><option value="us">{bundle.game.usTeamName}</option><option value="opponent">{bundle.game.opponentName}</option></select></label>
      <label>{mode === 'substitute' ? 'Player leaving' : 'Player'}<select value={selectedPlayerId || ''} onChange={(event) => changeSelectedPlayer(Number(event.target.value))}><option value="">Choose player</option>{activePlayers.map((player) => <option key={player.id} value={player.id}>{player.battingOrder ? `${player.battingOrder}. ` : ''}{player.displayName} · {player.position ?? '—'}</option>)}</select></label>
      {mode === 'substitute' ? <>
        <label className="is-wide">Replacement player<input list="game-tracker-substitution-roster" value={name} placeholder="Select roster player or type a name" onChange={(event) => changeName(event.target.value)} /></label>
        <datalist id="game-tracker-substitution-roster">{Array.from(new Set([...bundle.roster.map((player) => player.fullName), ...bundle.rosterMembers.map((member) => member.displayName)])).sort().map((playerName) => <option key={playerName} value={playerName} />)}</datalist>
        <label>Bats<select value={bats} onChange={(event) => setBats(event.target.value as Handedness)}><option value="R">Right</option><option value="L">Left</option><option value="S">Switch</option></select></label>
        <label>Throws<select value={throws} onChange={(event) => setThrows(event.target.value as ThrowingHand)}><option value="R">Right</option><option value="L">Left</option></select></label>
        <label>Stats team<select value={statTeamId ?? ''} onChange={(event) => setStatTeamId(event.target.value ? Number(event.target.value) : null)}><option value="">Game only</option>{bundle.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      </> : null}
      <label>New position<select value={position} onChange={(event) => setPosition(event.target.value)}>{POSITION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {mode === 'substitute' ? <p className="game-tracker-substitution-note">{selectedPlayer?.id === liveBatter?.id
      ? `The replacement takes over the current at-bat immediately at ${bundle.game.state.balls}–${bundle.game.state.strikes}. The outgoing player’s earlier plays stay intact.`
      : `The replacement takes over batting spot ${selectedPlayer?.battingOrder ?? '—'} the next time that spot comes up. The outgoing player’s earlier plays and stats stay intact.`}</p> : null}
    {error ? <p className="game-tracker-error">{error}</p> : null}
    <div className="game-tracker-inline-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Saving…' : mode === 'substitute' ? 'Confirm substitution' : 'Update position'}</button></div>
  </section>;
}

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
  const [substitutionOpen, setSubstitutionOpen] = useState(false);
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
    const lineup = bundle.players.filter((p) => p.teamSide === battingSide && p.isActive && p.battingOrder !== null).sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder) || a.id - b.id);
    const batter = lineup.length ? lineup[bundle.game.state.battingIndex[battingSide] % lineup.length] : null;
    const pitcherId = bundle.game.state.pitcherIds[fieldingSide];
    const pitcher = bundle.players.find((p) => p.id === pitcherId && p.isActive) ?? bundle.players.find((p) => p.teamSide === fieldingSide && p.isActive && p.position === 'P');
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
  async function endHalfInning() {
    if (!bundle) return;
    const half = bundle.game.state.half === 'top' ? 'top' : 'bottom';
    const inning = bundle.game.state.inning;
    const outs = bundle.game.state.outs;
    const message = `End the ${half} of inning ${inning} now with ${outs} out${outs === 1 ? '' : 's'}? The count and runners will be cleared, and the unfinished batter will not be charged with a plate appearance.`;
    if (!window.confirm(message)) return;
    await sendEvent({ type: 'half_inning', note: 'Half-inning ended manually.' });
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
  if (!hasLineups || lineupOpen) return <main className={`${styles.shell} game-tracker-shell`}><div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link>{hasLineups ? <button className="btn btn-ghost" onClick={() => setLineupOpen(false)}>Return to scoring</button> : null}</div><LineupEditor bundle={bundle} locked={bundle.events.length > 0} onSaved={async () => { await load(); setLineupOpen(false); }} /></main>;

  return <main className={`${styles.shell} game-tracker-shell game-tracker-live`}>
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← All sessions</Link><div><button className="btn btn-ghost" onClick={() => setLineupOpen(true)}>{bundle.events.length ? 'View lineups' : 'Edit lineups'}</button><button className="btn btn-ghost" onClick={() => setSubstitutionOpen((open) => !open)}>Substitutions</button><Link className="btn btn-ghost as-link" href="/portal/admin/game-tracker/stats">Stats</Link></div></div>
    {substitutionOpen ? <SubstitutionPanel bundle={bundle} onClose={() => setSubstitutionOpen(false)} onSaved={load} /> : null}
    <section className="game-tracker-scoreboard-panel">
      <div className="game-tracker-scoreboard">
        <div><span>{bundle.game.usTeamName}</span><strong>{state.score.us}</strong></div><div className="game-tracker-inning"><span>{state.half === 'top' ? '▲' : '▼'} {state.inning}</span><small>{state.outs} OUT{state.outs === 1 ? '' : 'S'}</small></div><div><span>{bundle.game.opponentName}</span><strong>{state.score.opponent}</strong></div>
      </div>
      <div className="game-tracker-linescore-wrap">
        <table className="game-tracker-linescore" aria-label="Inning-by-inning line score">
          <thead><tr><th>Team</th>{lineScoreInnings.map((inning) => <th key={inning} className={inning === state.inning ? 'is-current' : ''}>{inning}</th>)}<th>R</th><th>H</th><th>E</th></tr></thead>
          <tbody>
            <tr><th>{bundle.game.usTeamName}</th>{lineScoreInnings.map((inning) => <td key={inning} className={inning === state.inning ? 'is-current' : ''}>{inningDisplay('us', inning)}</td>)}<td>{state.score.us}</td><td>{lineScore.us.hits}</td><td>{lineScore.us.errors}</td></tr>
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
        <div className="game-tracker-event-log"><h3>Last plays</h3>{bundle.events.filter((event) => !event.isVoided).slice(-6).reverse().map((event) => <p key={event.id}><strong>{event.sequence}.</strong> {event.input.type === 'pitch' ? `${event.input.pitchType} · ${(event.input.plateAppearanceResult ?? event.input.result).replaceAll('_', ' ')}` : event.input.type === 'runner' ? event.input.reason.replaceAll('_', ' ') : 'Half-inning ended'}</p>)}</div>
        <button className="btn btn-ghost game-tracker-end-inning" disabled={busy || bundle.game.status === 'final'} onClick={endHalfInning}>End {state.half === 'top' ? 'Top' : 'Bottom'} Half</button>
        <button className="btn btn-ghost" disabled={busy || bundle.events.length === 0} onClick={undo}>Undo last play</button>
        {bundle.game.status === 'final' ? <button className="btn btn-primary" onClick={() => setStatus('live')}>Reopen game</button> : <button className="btn btn-primary" onClick={() => setStatus('final')}>Finalize game</button>}
        <button className="btn btn-ghost" onClick={deleteGame}>Delete game</button>
      </aside>
    </section>
  </main>;
}
