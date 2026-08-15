import { isStrikeResult } from './engine';
import type {
  BattedBallType,
  GameTrackerGame,
  GameTrackerPlayer,
  PitchEventInput,
  ScenarioFilters,
  StoredGameEvent,
} from './types';

export type GameStatSource = {
  game: GameTrackerGame;
  players: GameTrackerPlayer[];
  events: StoredGameEvent[];
};

type CommonLine = { gamePlayerId: number; playerId: number | null; playerName: string; games: Set<number> };
type BattingAccumulator = CommonLine & {
  pa: number; ab: number; runs: number; hits: number; singles: number; doubles: number; triples: number; homeRuns: number;
  rbi: number; walks: number; intentionalWalks: number; hbp: number; strikeouts: number; sacFlies: number; sacBunts: number;
  stolenBases: number; caughtStealing: number; swings: number; whiffs: number; groundBalls: number; lineDrives: number;
  flyBalls: number; popups: number;
};
type PitchingAccumulator = CommonLine & {
  outs: number; battersFaced: number; pitches: number; strikes: number; swings: number; whiffs: number; calledStrikes: number;
  firstPitches: number; firstPitchStrikes: number; eaDen: number; eaNum: number; hits: number; runs: number; earnedRuns: number;
  walks: number; strikeouts: number; hbp: number; homeRuns: number; wildPitches: number; groundBalls: number; lineDrives: number;
  flyBalls: number; popups: number;
};
type FieldingAccumulator = CommonLine & { putouts: number; assists: number; errors: number; doublePlays: number };

export type BattingStatLine = Omit<BattingAccumulator, 'games'> & {
  games: number; avg: number | null; obp: number | null; slg: number | null; ops: number | null; iso: number | null;
  babip: number | null; kPct: number | null; bbPct: number | null; whiffPct: number | null;
};
export type PitchingStatLine = Omit<PitchingAccumulator, 'games'> & {
  games: number; ip: string; era: number | null; whip: number | null; kPct: number | null; bbPct: number | null;
  kMinusBbPct: number | null; strikePct: number | null; whiffPct: number | null; cswPct: number | null;
  swingingStrikePct: number | null; fpsPct: number | null; eaPct: number | null; gbPct: number | null;
  fbPct: number | null; hrPerFbPct: number | null; fip: number | null; xFip: number | null; siera: number | null;
};
export type FieldingStatLine = Omit<FieldingAccumulator, 'games'> & { games: number; totalChances: number; fieldingPct: number | null };

export type GameTrackerStats = {
  batting: BattingStatLine[];
  pitching: PitchingStatLine[];
  fielding: FieldingStatLine[];
};

const HIT_RESULTS = new Set(['single', 'double', 'triple', 'home_run']);
const WALK_RESULTS = new Set(['walk', 'intentional_walk']);
const AB_EXCLUSIONS = new Set(['walk', 'intentional_walk', 'hit_by_pitch', 'sacrifice_fly', 'sacrifice_bunt', 'catcher_interference']);
const FIP_CONSTANT = 3.20;
const LEAGUE_AVERAGE_HR_PER_FB = 0.13;

function pct(num: number, den: number): number | null {
  return den > 0 ? Number(((100 * num) / den).toFixed(1)) : null;
}

function rate(num: number, den: number, digits = 3): number | null {
  return den > 0 ? Number((num / den).toFixed(digits)) : null;
}

function baseStateMatches(event: StoredGameEvent, filter: ScenarioFilters['baseState']): boolean {
  if (!filter) return true;
  const first = Boolean(event.situation.runners.first);
  const second = Boolean(event.situation.runners.second);
  const third = Boolean(event.situation.runners.third);
  if (filter === 'risp') return second || third;
  const key = !first && !second && !third ? 'empty'
    : first && !second && !third ? 'first'
      : !first && second && !third ? 'second'
        : !first && !second && third ? 'third'
          : first && second && !third ? 'first_second'
            : first && !second && third ? 'first_third'
              : !first && second && third ? 'second_third'
                : 'loaded';
  return key === filter;
}

function eventMatches(source: GameStatSource, event: StoredGameEvent, filters: ScenarioFilters): boolean {
  if (filters.gameTypes?.length && !filters.gameTypes.includes(source.game.gameType)) return false;
  if (filters.dateFrom && source.game.gameDate < filters.dateFrom) return false;
  if (filters.dateTo && source.game.gameDate > filters.dateTo) return false;
  if (filters.count && filters.count !== `${event.situation.balls}-${event.situation.strikes}`) return false;
  if (filters.outs !== null && filters.outs !== undefined && filters.outs !== event.situation.outs) return false;
  if (!baseStateMatches(event, filters.baseState)) return false;
  if (filters.batterHand && filters.batterHand !== event.situation.batterHand) return false;
  if (filters.pitcherHand && filters.pitcherHand !== event.situation.pitcherHand) return false;
  return true;
}

function common(player: GameTrackerPlayer): CommonLine {
  return { gamePlayerId: player.id, playerId: player.playerId, playerName: player.displayName, games: new Set<number>() };
}

function battingBase(player: GameTrackerPlayer): BattingAccumulator {
  return {
    ...common(player), pa: 0, ab: 0, runs: 0, hits: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0, rbi: 0,
    walks: 0, intentionalWalks: 0, hbp: 0, strikeouts: 0, sacFlies: 0, sacBunts: 0, stolenBases: 0,
    caughtStealing: 0, swings: 0, whiffs: 0, groundBalls: 0, lineDrives: 0, flyBalls: 0, popups: 0,
  };
}

function pitchingBase(player: GameTrackerPlayer): PitchingAccumulator {
  return {
    ...common(player), outs: 0, battersFaced: 0, pitches: 0, strikes: 0, swings: 0, whiffs: 0, calledStrikes: 0,
    firstPitches: 0, firstPitchStrikes: 0, eaDen: 0, eaNum: 0, hits: 0, runs: 0, earnedRuns: 0, walks: 0,
    strikeouts: 0, hbp: 0, homeRuns: 0, wildPitches: 0, groundBalls: 0, lineDrives: 0, flyBalls: 0, popups: 0,
  };
}

function fieldingBase(player: GameTrackerPlayer): FieldingAccumulator {
  return { ...common(player), putouts: 0, assists: 0, errors: 0, doublePlays: 0 };
}

function identityKey(player: GameTrackerPlayer): string {
  return player.playerId ? `player:${player.playerId}` : `game-player:${player.id}`;
}

function getLine<T extends CommonLine>(map: Map<string, T>, player: GameTrackerPlayer, create: () => T): T {
  const key = identityKey(player);
  const current = map.get(key);
  if (current) return current;
  const next = create();
  map.set(key, next);
  return next;
}

function isSwing(input: PitchEventInput): boolean {
  return ['swinging_strike', 'foul', 'foul_tip', 'in_play'].includes(input.result);
}

function addBattedBall(line: { groundBalls: number; lineDrives: number; flyBalls: number; popups: number }, type?: BattedBallType | null) {
  if (type === 'ground_ball' || type === 'bunt') line.groundBalls += 1;
  if (type === 'line_drive') line.lineDrives += 1;
  if (type === 'fly_ball') line.flyBalls += 1;
  if (type === 'popup') line.popups += 1;
}

function addTerminalStats(batter: BattingAccumulator, pitcher: PitchingAccumulator, input: PitchEventInput) {
  const result = input.plateAppearanceResult;
  if (!result) return;
  batter.pa += 1;
  pitcher.battersFaced += 1;
  if (!AB_EXCLUSIONS.has(result)) batter.ab += 1;
  if (HIT_RESULTS.has(result)) {
    batter.hits += 1;
    pitcher.hits += 1;
  }
  if (result === 'single') batter.singles += 1;
  if (result === 'double') batter.doubles += 1;
  if (result === 'triple') batter.triples += 1;
  if (result === 'home_run') {
    batter.homeRuns += 1;
    batter.runs += 1;
    pitcher.homeRuns += 1;
  }
  if (WALK_RESULTS.has(result)) {
    batter.walks += 1;
    pitcher.walks += 1;
    if (result === 'intentional_walk') batter.intentionalWalks += 1;
  }
  if (result === 'hit_by_pitch') {
    batter.hbp += 1;
    pitcher.hbp += 1;
  }
  if (result === 'strikeout') {
    batter.strikeouts += 1;
    pitcher.strikeouts += 1;
  }
  if (result === 'sacrifice_fly') batter.sacFlies += 1;
  if (result === 'sacrifice_bunt') batter.sacBunts += 1;
  batter.rbi += Math.max(0, input.rbi ?? 0);
  pitcher.runs += Math.max(0, input.runsScored ?? 0);
  pitcher.earnedRuns += Math.max(0, input.earnedRuns ?? input.runsScored ?? 0);
  pitcher.outs += Math.max(0, input.outsRecorded ?? (
    result === 'double_play' ? 2 : result === 'triple_play' ? 3
      : ['strikeout', 'groundout', 'flyout', 'lineout', 'popout', 'sacrifice_fly', 'sacrifice_bunt'].includes(result) ? 1 : 0
  ));
  addBattedBall(batter, input.battedBallType);
  addBattedBall(pitcher, input.battedBallType);
}

function addRunsScoredByOtherRunners(
  source: GameStatSource,
  event: StoredGameEvent,
  input: PitchEventInput,
  players: Map<number, GameTrackerPlayer>,
  batting: Map<string, BattingAccumulator>,
  selectedPlayerId?: number | null
) {
  const batterId = event.situation.batterGamePlayerId;
  const scoredRunnerIds = new Set<number>();
  for (const advance of input.runnerAdvances ?? []) {
    if (!advance.isOut && advance.toBase >= 4 && advance.runnerGamePlayerId !== batterId) scoredRunnerIds.add(advance.runnerGamePlayerId);
  }
  if (!input.runnerAdvances?.length && input.plateAppearanceResult) {
    const distance = input.plateAppearanceResult === 'single' ? 1 : input.plateAppearanceResult === 'double' ? 2
      : input.plateAppearanceResult === 'triple' ? 3 : input.plateAppearanceResult === 'home_run' ? 4 : 0;
    const bases = [[event.situation.runners.first, 1], [event.situation.runners.second, 2], [event.situation.runners.third, 3]] as const;
    for (const [runnerId, base] of bases) if (runnerId && base + distance >= 4) scoredRunnerIds.add(runnerId);
  }
  for (const runnerId of scoredRunnerIds) {
    const runner = players.get(runnerId);
    if (!runner || (selectedPlayerId && runner.playerId !== selectedPlayerId)) continue;
    const line = getLine(batting, runner, () => battingBase(runner));
    line.games.add(source.game.id);
    line.runs += 1;
  }
}

function battingOutput(line: BattingAccumulator): BattingStatLine {
  const totalBases = line.singles + (2 * line.doubles) + (3 * line.triples) + (4 * line.homeRuns);
  const avg = rate(line.hits, line.ab);
  const obp = rate(line.hits + line.walks + line.hbp, line.ab + line.walks + line.hbp + line.sacFlies);
  const slg = rate(totalBases, line.ab);
  const babipDen = line.ab - line.strikeouts - line.homeRuns + line.sacFlies;
  return {
    ...line,
    games: line.games.size,
    avg,
    obp,
    slg,
    ops: obp !== null && slg !== null ? Number((obp + slg).toFixed(3)) : null,
    iso: slg !== null && avg !== null ? Number((slg - avg).toFixed(3)) : null,
    babip: rate(line.hits - line.homeRuns, babipDen),
    kPct: pct(line.strikeouts, line.pa),
    bbPct: pct(line.walks, line.pa),
    whiffPct: pct(line.whiffs, line.swings),
  };
}

function pitchingOutput(line: PitchingAccumulator): PitchingStatLine {
  const innings = Math.floor(line.outs / 3);
  const thirds = line.outs % 3;
  const ip = `${innings}.${thirds}`;
  const inningsPitched = line.outs / 3;
  const ballsInPlay = line.groundBalls + line.lineDrives + line.flyBalls + line.popups;
  const fipNumerator = (13 * line.homeRuns) + (3 * (line.walks + line.hbp)) - (2 * line.strikeouts);
  const expectedHomeRuns = line.flyBalls * LEAGUE_AVERAGE_HR_PER_FB;
  const xFipNumerator = (13 * expectedHomeRuns) + (3 * (line.walks + line.hbp)) - (2 * line.strikeouts);
  const strikeoutRate = line.battersFaced > 0 ? line.strikeouts / line.battersFaced : 0;
  const walkRate = line.battersFaced > 0 ? line.walks / line.battersFaced : 0;
  const netGroundBallRate = line.battersFaced > 0
    ? (line.groundBalls - line.flyBalls - line.popups) / line.battersFaced
    : 0;
  const siera = line.battersFaced > 0
    ? 6.145
      - (16.986 * strikeoutRate)
      + (11.434 * walkRate)
      - (1.858 * netGroundBallRate)
      + (7.653 * strikeoutRate * strikeoutRate)
      + (6.664 * netGroundBallRate * Math.abs(netGroundBallRate))
      + (10.130 * strikeoutRate * netGroundBallRate)
      - (5.195 * walkRate * netGroundBallRate)
    : null;
  return {
    ...line,
    games: line.games.size,
    ip,
    era: line.outs > 0 ? Number(((line.earnedRuns * 27) / line.outs).toFixed(2)) : null,
    whip: line.outs > 0 ? Number((((line.walks + line.hits) * 3) / line.outs).toFixed(2)) : null,
    kPct: pct(line.strikeouts, line.battersFaced),
    bbPct: pct(line.walks, line.battersFaced),
    kMinusBbPct: line.battersFaced > 0 ? Number((((line.strikeouts - line.walks) * 100) / line.battersFaced).toFixed(1)) : null,
    strikePct: pct(line.strikes, line.pitches),
    whiffPct: pct(line.whiffs, line.swings),
    swingingStrikePct: pct(line.whiffs, line.pitches),
    cswPct: pct(line.calledStrikes + line.whiffs, line.pitches),
    fpsPct: pct(line.firstPitchStrikes, line.firstPitches),
    eaPct: pct(line.eaNum, line.eaDen),
    gbPct: pct(line.groundBalls, ballsInPlay),
    fbPct: pct(line.flyBalls, ballsInPlay),
    hrPerFbPct: pct(line.homeRuns, line.flyBalls),
    fip: inningsPitched > 0 ? Number(((fipNumerator / inningsPitched) + FIP_CONSTANT).toFixed(2)) : null,
    xFip: inningsPitched > 0 ? Number(((xFipNumerator / inningsPitched) + FIP_CONSTANT).toFixed(2)) : null,
    siera: siera === null ? null : Number(siera.toFixed(2)),
  };
}

function fieldingOutput(line: FieldingAccumulator): FieldingStatLine {
  const totalChances = line.putouts + line.assists + line.errors;
  return { ...line, games: line.games.size, totalChances, fieldingPct: rate(line.putouts + line.assists, totalChances) };
}

export function calculateGameTrackerStats(sources: GameStatSource[], filters: ScenarioFilters = {}): GameTrackerStats {
  const batting = new Map<string, BattingAccumulator>();
  const pitching = new Map<string, PitchingAccumulator>();
  const fielding = new Map<string, FieldingAccumulator>();

  for (const source of sources) {
    const players = new Map(source.players.map((player) => [player.id, player]));
    for (const event of source.events) {
      if (event.isVoided || !eventMatches(source, event, filters)) continue;
      if (event.input.type === 'runner') {
        const runner = players.get(event.input.runnerGamePlayerId);
        if (!runner || (filters.playerId && runner.playerId !== filters.playerId)) continue;
        const line = getLine(batting, runner, () => battingBase(runner));
        line.games.add(source.game.id);
        if (event.input.reason === 'stolen_base' && !event.input.isOut) line.stolenBases += 1;
        if (event.input.reason === 'caught_stealing' || event.input.isOut) line.caughtStealing += 1;
        if (event.input.toBase === 4 && !event.input.isOut) line.runs += 1;
        continue;
      }

      const batter = event.situation.batterGamePlayerId ? players.get(event.situation.batterGamePlayerId) : null;
      const pitcher = event.situation.pitcherGamePlayerId ? players.get(event.situation.pitcherGamePlayerId) : null;
      if (!batter || !pitcher) continue;
      const batterSelected = !filters.playerId || batter.playerId === filters.playerId;
      const pitcherSelected = !filters.playerId || pitcher.playerId === filters.playerId;
      const batterLine = getLine(batting, batter, () => battingBase(batter));
      const pitcherLine = getLine(pitching, pitcher, () => pitchingBase(pitcher));
      if (batterSelected) batterLine.games.add(source.game.id);
      if (pitcherSelected) pitcherLine.games.add(source.game.id);

      if (batterSelected) {
        if (isSwing(event.input)) batterLine.swings += 1;
        if (event.input.result === 'swinging_strike') batterLine.whiffs += 1;
      }
      if (pitcherSelected) {
        pitcherLine.pitches += 1;
        if (isStrikeResult(event.input.result)) pitcherLine.strikes += 1;
        if (isSwing(event.input)) pitcherLine.swings += 1;
        if (event.input.result === 'swinging_strike') pitcherLine.whiffs += 1;
        if (event.input.result === 'called_strike') pitcherLine.calledStrikes += 1;
        if (event.situation.balls === 0 && event.situation.strikes === 0) {
          pitcherLine.firstPitches += 1;
          if (isStrikeResult(event.input.result)) pitcherLine.firstPitchStrikes += 1;
        }
        const eaEligible = (event.situation.balls + event.situation.strikes) <= 1 || event.situation.strikes > event.situation.balls;
        if (eaEligible) {
          pitcherLine.eaDen += 1;
          if (isStrikeResult(event.input.result)) pitcherLine.eaNum += 1;
        }
      }

      if (event.input.plateAppearanceResult) {
        addRunsScoredByOtherRunners(source, event, event.input, players, batting, filters.playerId);
        if (batterSelected && pitcherSelected) addTerminalStats(batterLine, pitcherLine, event.input);
        else if (batterSelected) addTerminalStats(batterLine, pitchingBase(pitcher), event.input);
        else if (pitcherSelected) addTerminalStats(battingBase(batter), pitcherLine, event.input);
      }

      for (const credit of event.input.fielderCredits ?? []) {
        const fielder = players.get(credit.gamePlayerId);
        if (!fielder || (filters.playerId && fielder.playerId !== filters.playerId)) continue;
        const line = getLine(fielding, fielder, () => fieldingBase(fielder));
        line.games.add(source.game.id);
        if (credit.credit === 'putout') line.putouts += 1;
        if (credit.credit === 'assist') line.assists += 1;
        if (credit.credit === 'error') line.errors += 1;
        if (event.input.plateAppearanceResult === 'double_play') line.doublePlays += 1;
      }
    }
  }

  const sortByName = <T extends { playerName: string }>(a: T, b: T) => a.playerName.localeCompare(b.playerName);
  return {
    batting: Array.from(batting.values()).map(battingOutput).filter((line) => line.pa > 0 || line.stolenBases > 0 || line.caughtStealing > 0).toSorted(sortByName),
    pitching: Array.from(pitching.values()).map(pitchingOutput).filter((line) => line.pitches > 0).toSorted(sortByName),
    fielding: Array.from(fielding.values()).map(fieldingOutput).filter((line) => line.totalChances > 0).toSorted(sortByName),
  };
}
