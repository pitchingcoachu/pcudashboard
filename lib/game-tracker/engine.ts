import {
  battingSideForHalf,
  fieldingSideForHalf,
  type Base,
  type BaseRunners,
  type GameEventInput,
  type GameSituation,
  type GameState,
  type GameTrackerPlayer,
  type PitchEventInput,
  type StoredGameEvent,
  type TeamSide,
} from './types';

const STRIKE_RESULTS = new Set(['called_strike', 'swinging_strike', 'foul', 'foul_tip', 'in_play', 'pitch_clock_strike']);
const TERMINAL_RESULTS = new Set([
  'single', 'double', 'triple', 'home_run', 'walk', 'intentional_walk', 'strikeout', 'hit_by_pitch',
  'reached_on_error', 'fielders_choice', 'groundout', 'flyout', 'lineout', 'popout', 'sacrifice_fly',
  'sacrifice_bunt', 'catcher_interference', 'double_play', 'triple_play', 'dropped_third_strike', 'other',
]);

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function lineupForSide(players: GameTrackerPlayer[], side: TeamSide): GameTrackerPlayer[] {
  return players
    .filter((player) => player.teamSide === side && player.isActive && player.battingOrder !== null)
    .toSorted((a, b) => Number(a.battingOrder) - Number(b.battingOrder));
}

export function currentSituation(
  state: GameState,
  players: GameTrackerPlayer[],
  homeAway: 'home' | 'away'
): GameSituation {
  const battingSide = battingSideForHalf(homeAway, state.half);
  const fieldingSide = fieldingSideForHalf(homeAway, state.half);
  const lineup = lineupForSide(players, battingSide);
  const index = lineup.length > 0 ? state.battingIndex[battingSide] % lineup.length : 0;
  const batter = lineup[index] ?? null;
  const configuredPitcher = state.pitcherIds[fieldingSide];
  const pitcher = players.find((player) => player.id === configuredPitcher)
    ?? players.find((player) => player.teamSide === fieldingSide && player.isActive && player.position === 'P')
    ?? null;
  return {
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    balls: state.balls,
    strikes: state.strikes,
    runners: { ...state.runners },
    batterGamePlayerId: batter?.id ?? null,
    pitcherGamePlayerId: pitcher?.id ?? null,
    batterHand: batter?.bats ?? null,
    pitcherHand: pitcher?.throws ?? null,
    battingSide,
    fieldingSide,
  };
}

function scoreRun(state: GameState, battingSide: TeamSide, count = 1) {
  state.score[battingSide] += Math.max(0, count);
}

function runnersArray(runners: BaseRunners): Array<{ playerId: number; base: 1 | 2 | 3 }> {
  const out: Array<{ playerId: number; base: 1 | 2 | 3 }> = [];
  if (runners.first) out.push({ playerId: runners.first, base: 1 });
  if (runners.second) out.push({ playerId: runners.second, base: 2 });
  if (runners.third) out.push({ playerId: runners.third, base: 3 });
  return out;
}

function setRunner(runners: BaseRunners, base: Base, playerId: number | null) {
  if (base === 1) runners.first = playerId;
  if (base === 2) runners.second = playerId;
  if (base === 3) runners.third = playerId;
}

function clearRunner(runners: BaseRunners, base: Base) {
  setRunner(runners, base, null);
}

function defaultAdvanceForHit(
  state: GameState,
  battingSide: TeamSide,
  batterId: number,
  destination: 1 | 2 | 3 | 4
) {
  const existing = runnersArray(state.runners).toSorted((a, b) => b.base - a.base);
  state.runners = { first: null, second: null, third: null };
  for (const runner of existing) {
    const nextBase = (runner.base + destination) as Base;
    if (nextBase >= 4) scoreRun(state, battingSide);
    else setRunner(state.runners, nextBase, runner.playerId);
  }
  if (destination >= 4) scoreRun(state, battingSide);
  else setRunner(state.runners, destination, batterId);
}

function forceWalk(state: GameState, battingSide: TeamSide, batterId: number) {
  if (state.runners.first && state.runners.second && state.runners.third) scoreRun(state, battingSide);
  if (state.runners.first && state.runners.second) state.runners.third = state.runners.second;
  if (state.runners.first) state.runners.second = state.runners.first;
  state.runners.first = batterId;
}

function applyRunnerAdvances(state: GameState, battingSide: TeamSide, advances: NonNullable<PitchEventInput['runnerAdvances']>) {
  for (const advance of advances.toSorted((a, b) => b.fromBase - a.fromBase)) {
    if (advance.fromBase > 0) clearRunner(state.runners, advance.fromBase);
    if (advance.isOut) {
      state.outs += 1;
    } else if (advance.toBase >= 4) {
      scoreRun(state, battingSide);
    } else {
      setRunner(state.runners, advance.toBase, advance.runnerGamePlayerId);
    }
  }
}

function completePlateAppearance(state: GameState, side: TeamSide) {
  state.balls = 0;
  state.strikes = 0;
  state.battingIndex[side] += 1;
  state.completedPlateAppearances += 1;
}

function advanceHalfInning(state: GameState) {
  if (state.outs < 3) return;
  state.outs = 0;
  state.balls = 0;
  state.strikes = 0;
  state.runners = { first: null, second: null, third: null };
  if (state.half === 'top') state.half = 'bottom';
  else {
    state.half = 'top';
    state.inning += 1;
  }
}

function applyTerminalPitch(state: GameState, input: PitchEventInput, situation: GameSituation) {
  const batterId = situation.batterGamePlayerId;
  if (!batterId) throw new Error('A batter is required before recording a completed plate appearance.');
  const result = input.plateAppearanceResult;
  if (!result || !TERMINAL_RESULTS.has(result)) throw new Error('A valid plate appearance result is required.');

  const scoreBeforePlay = state.score[situation.battingSide];
  if (input.runnerAdvances && input.runnerAdvances.length > 0) {
    applyRunnerAdvances(state, situation.battingSide, input.runnerAdvances);
    if (input.batterDestination && input.batterDestination < 4) setRunner(state.runners, input.batterDestination, batterId);
    if (input.batterDestination === 4) scoreRun(state, situation.battingSide);
  } else if (result === 'single') defaultAdvanceForHit(state, situation.battingSide, batterId, 1);
  else if (result === 'double') defaultAdvanceForHit(state, situation.battingSide, batterId, 2);
  else if (result === 'triple') defaultAdvanceForHit(state, situation.battingSide, batterId, 3);
  else if (result === 'home_run') defaultAdvanceForHit(state, situation.battingSide, batterId, 4);
  else if (result === 'walk' || result === 'intentional_walk' || result === 'hit_by_pitch' || result === 'catcher_interference') {
    forceWalk(state, situation.battingSide, batterId);
  } else if (result === 'reached_on_error' || result === 'fielders_choice' || result === 'dropped_third_strike') {
    state.runners.first = batterId;
  }

  const defaultOuts = result === 'double_play' ? 2
    : result === 'triple_play' ? 3
      : ['strikeout', 'groundout', 'flyout', 'lineout', 'popout', 'sacrifice_fly', 'sacrifice_bunt'].includes(result) ? 1 : 0;
  state.outs += Math.max(0, input.outsRecorded ?? defaultOuts);
  const desiredRuns = Math.max(0, input.runsScored ?? 0);
  const alreadyScored = state.score[situation.battingSide] - scoreBeforePlay;
  if (desiredRuns > alreadyScored) scoreRun(state, situation.battingSide, desiredRuns - alreadyScored);
  completePlateAppearance(state, situation.battingSide);
}

function normalizePitchInput(state: GameState, input: PitchEventInput): PitchEventInput {
  if ((input.result === 'ball' || input.result === 'intentional_ball' || input.result === 'pitch_clock_ball') && state.balls >= 3) {
    return { ...input, plateAppearanceResult: input.result === 'intentional_ball' ? 'intentional_walk' : 'walk' };
  }
  if (input.result === 'hit_by_pitch') return { ...input, plateAppearanceResult: 'hit_by_pitch' };
  if (
    ['called_strike', 'swinging_strike', 'foul_tip', 'pitch_clock_strike'].includes(input.result)
    && state.strikes >= 2
  ) {
    return { ...input, plateAppearanceResult: 'strikeout' };
  }
  return input;
}

export function applyGameEvent(
  current: GameState,
  input: GameEventInput,
  players: GameTrackerPlayer[],
  homeAway: 'home' | 'away'
): { state: GameState; situation: GameSituation; input: GameEventInput } {
  const state = cloneState(current);
  const situation = currentSituation(state, players, homeAway);

  if (input.type === 'runner') {
    clearRunner(state.runners, input.fromBase);
    if (input.isOut) state.outs += 1;
    else if (input.toBase === 4) scoreRun(state, situation.battingSide);
    else setRunner(state.runners, input.toBase, input.runnerGamePlayerId);
    advanceHalfInning(state);
    return { state, situation, input };
  }

  if (!situation.batterGamePlayerId || !situation.pitcherGamePlayerId) {
    throw new Error('Set both teams’ lineups and pitchers before scoring pitches.');
  }

  const normalizedInput = normalizePitchInput(state, input);

  if (normalizedInput.result === 'ball' || normalizedInput.result === 'intentional_ball' || normalizedInput.result === 'pitch_clock_ball') {
    state.balls += 1;
    if (state.balls >= 4) {
      applyTerminalPitch(state, normalizedInput, situation);
    }
  } else if (normalizedInput.result === 'hit_by_pitch') {
    applyTerminalPitch(state, normalizedInput, situation);
  } else if (normalizedInput.result === 'in_play') {
    applyTerminalPitch(state, normalizedInput, situation);
  } else if (STRIKE_RESULTS.has(normalizedInput.result)) {
    const foulWithTwoStrikes = normalizedInput.result === 'foul' && state.strikes >= 2;
    if (!foulWithTwoStrikes) state.strikes += 1;
    if (state.strikes >= 3) applyTerminalPitch(state, normalizedInput, situation);
  }

  advanceHalfInning(state);
  return { state, situation, input: normalizedInput };
}

export function rebuildGameState(
  events: StoredGameEvent[],
  players: GameTrackerPlayer[],
  homeAway: 'home' | 'away',
  initial: GameState
): GameState {
  return events
    .filter((event) => !event.isVoided)
    .toSorted((a, b) => a.sequence - b.sequence)
    .reduce((state, event) => applyGameEvent(state, event.input, players, homeAway).state, cloneState(initial));
}

export function isStrikeResult(result: string): boolean {
  return STRIKE_RESULTS.has(result);
}
