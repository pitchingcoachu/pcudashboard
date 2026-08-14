export const GAME_TYPES = ['game', 'scrimmage', 'live_bp'] as const;
export type GameType = (typeof GAME_TYPES)[number];
export type GameStatus = 'setup' | 'live' | 'final';
export type TeamSide = 'us' | 'opponent';
export type HalfInning = 'top' | 'bottom';
export type Handedness = 'R' | 'L' | 'S';
export type ThrowingHand = 'R' | 'L';
export type Base = 0 | 1 | 2 | 3 | 4;

export const PITCH_TYPES = [
  'Fastball',
  'Sinker',
  'Cutter',
  'Slider',
  'Sweeper',
  'Curveball',
  'Changeup',
  'Splitter',
  'Knuckleball',
  'Other',
] as const;

export const PITCH_RESULTS = [
  'ball',
  'called_strike',
  'swinging_strike',
  'foul',
  'foul_tip',
  'in_play',
  'hit_by_pitch',
  'intentional_ball',
  'pitch_clock_ball',
  'pitch_clock_strike',
] as const;
export type PitchResult = (typeof PITCH_RESULTS)[number];

export const PA_RESULTS = [
  'single',
  'double',
  'triple',
  'home_run',
  'walk',
  'intentional_walk',
  'strikeout',
  'hit_by_pitch',
  'reached_on_error',
  'fielders_choice',
  'groundout',
  'flyout',
  'lineout',
  'popout',
  'sacrifice_fly',
  'sacrifice_bunt',
  'catcher_interference',
  'double_play',
  'triple_play',
  'dropped_third_strike',
  'other',
] as const;
export type PlateAppearanceResult = (typeof PA_RESULTS)[number];

export const BATTED_BALL_TYPES = ['ground_ball', 'line_drive', 'fly_ball', 'popup', 'bunt'] as const;
export type BattedBallType = (typeof BATTED_BALL_TYPES)[number];

export const RUNNER_REASONS = [
  'stolen_base',
  'caught_stealing',
  'wild_pitch',
  'passed_ball',
  'pickoff',
  'pickoff_error',
  'balk',
  'defensive_indifference',
  'advance_on_throw',
  'advance_on_error',
  'tag_up',
  'force_out',
  'rundown',
  'runner_interference',
  'manual',
] as const;
export type RunnerReason = (typeof RUNNER_REASONS)[number];

export type GameTrackerGame = {
  id: number;
  organizationId: number;
  schoolCode: string;
  gameType: GameType;
  gameDate: string;
  season: string;
  opponentName: string;
  location: string | null;
  homeAway: 'home' | 'away';
  inningsScheduled: number;
  status: GameStatus;
  notes: string | null;
  state: GameState;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type GameTrackerPlayer = {
  id: number;
  gameId: number;
  teamSide: TeamSide;
  playerId: number | null;
  displayName: string;
  jerseyNumber: string | null;
  bats: Handedness;
  throws: ThrowingHand;
  battingOrder: number | null;
  position: string | null;
  isStarter: boolean;
  isActive: boolean;
};

export type BaseRunners = {
  first: number | null;
  second: number | null;
  third: number | null;
};

export type GameState = {
  inning: number;
  half: HalfInning;
  outs: number;
  balls: number;
  strikes: number;
  score: { us: number; opponent: number };
  battingIndex: { us: number; opponent: number };
  runners: BaseRunners;
  pitcherIds: { us: number | null; opponent: number | null };
  completedPlateAppearances: number;
};

export type RunnerAdvance = {
  runnerGamePlayerId: number;
  fromBase: Base;
  toBase: Base;
  isOut?: boolean;
  earnedRun?: boolean;
  reason?: RunnerReason;
};

export type FielderCredit = {
  gamePlayerId: number;
  position: string;
  credit: 'putout' | 'assist' | 'error';
};

export type PitchEventInput = {
  type: 'pitch';
  pitchType: string;
  result: PitchResult;
  plateAppearanceResult?: PlateAppearanceResult | null;
  battedBallType?: BattedBallType | null;
  fieldX?: number | null;
  fieldY?: number | null;
  rbi?: number;
  runsScored?: number;
  earnedRuns?: number;
  outsRecorded?: number;
  batterDestination?: Base | null;
  runnerAdvances?: RunnerAdvance[];
  fielderCredits?: FielderCredit[];
  note?: string;
};

export type RunnerEventInput = {
  type: 'runner';
  runnerGamePlayerId: number;
  fromBase: 1 | 2 | 3;
  toBase: 1 | 2 | 3 | 4;
  reason: RunnerReason;
  isOut?: boolean;
  earnedRun?: boolean;
  note?: string;
};

export type GameEventInput = PitchEventInput | RunnerEventInput;

export type GameSituation = {
  inning: number;
  half: HalfInning;
  outs: number;
  balls: number;
  strikes: number;
  runners: BaseRunners;
  batterGamePlayerId: number | null;
  pitcherGamePlayerId: number | null;
  batterHand: Handedness | null;
  pitcherHand: ThrowingHand | null;
  battingSide: TeamSide;
  fieldingSide: TeamSide;
};

export type StoredGameEvent = {
  id: number;
  gameId: number;
  sequence: number;
  input: GameEventInput;
  situation: GameSituation;
  stateAfter: GameState;
  isVoided: boolean;
  createdAt: string;
};

export type ScenarioFilters = {
  gameTypes?: GameType[];
  dateFrom?: string | null;
  dateTo?: string | null;
  count?: string | null;
  outs?: number | null;
  baseState?: 'empty' | 'first' | 'second' | 'third' | 'first_second' | 'first_third' | 'second_third' | 'loaded' | 'risp' | null;
  batterHand?: Handedness | null;
  pitcherHand?: ThrowingHand | null;
  playerId?: number | null;
};

export function initialGameState(): GameState {
  return {
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    score: { us: 0, opponent: 0 },
    battingIndex: { us: 0, opponent: 0 },
    runners: { first: null, second: null, third: null },
    pitcherIds: { us: null, opponent: null },
    completedPlateAppearances: 0,
  };
}

export function battingSideForHalf(homeAway: 'home' | 'away', half: HalfInning): TeamSide {
  if (homeAway === 'home') return half === 'top' ? 'opponent' : 'us';
  return half === 'top' ? 'us' : 'opponent';
}

export function fieldingSideForHalf(homeAway: 'home' | 'away', half: HalfInning): TeamSide {
  return battingSideForHalf(homeAway, half) === 'us' ? 'opponent' : 'us';
}
