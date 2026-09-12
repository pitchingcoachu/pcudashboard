import { z } from 'zod';
import { BATTED_BALL_TYPES, GAME_TYPES, PA_RESULTS, PITCH_RESULTS, RUNNER_REASONS } from './types';

const nullableText = z.string().trim().max(500).nullable().optional();

export const createGameSchema = z.object({
  gameType: z.enum(GAME_TYPES),
  gameDate: z.iso.date(),
  season: z.string().trim().min(1).max(40),
  opponentName: z.string().trim().min(1).max(120),
  usTeamId: z.coerce.number().int().positive().nullable().optional(),
  opponentTeamId: z.coerce.number().int().positive().nullable().optional(),
  location: nullableText,
  homeAway: z.enum(['home', 'away']),
  inningsScheduled: z.coerce.number().int().min(1).max(30).default(9),
  notes: nullableText,
});

export const lineupPlayerSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  teamSide: z.enum(['us', 'opponent']),
  playerId: z.coerce.number().int().positive().nullable().optional(),
  rosterPersonId: z.coerce.number().int().positive().nullable().optional(),
  statTeamId: z.coerce.number().int().positive().nullable().optional(),
  displayName: z.string().trim().min(1).max(120),
  jerseyNumber: z.string().trim().max(12).nullable().optional(),
  bats: z.enum(['R', 'L', 'S']),
  throws: z.enum(['R', 'L']),
  battingOrder: z.coerce.number().int().min(1).max(99).nullable().optional(),
  position: z.string().trim().max(10).nullable().optional(),
  isStarter: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const lineupSchema = z.object({ players: z.array(lineupPlayerSchema).min(2).max(100) });

export const lineupActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('substitute'),
    outgoingPlayerId: z.coerce.number().int().positive(),
    incoming: lineupPlayerSchema.omit({ id: true, teamSide: true, battingOrder: true, isStarter: true, isActive: true }),
  }),
  z.object({
    action: z.literal('change_position'),
    playerId: z.coerce.number().int().positive(),
    position: z.string().trim().min(1).max(10),
  }),
]);

const runnerAdvanceSchema = z.object({
  runnerGamePlayerId: z.number().int().positive(),
  fromBase: z.number().int().min(0).max(4),
  toBase: z.number().int().min(0).max(4),
  isOut: z.boolean().optional(),
  earnedRun: z.boolean().optional(),
  reason: z.enum(RUNNER_REASONS).optional(),
});

const pitchEventSchema = z.object({
  type: z.literal('pitch'),
  pitchType: z.string().trim().min(1).max(40),
  result: z.enum(PITCH_RESULTS),
  plateAppearanceResult: z.enum(PA_RESULTS).nullable().optional(),
  battedBallType: z.enum(BATTED_BALL_TYPES).nullable().optional(),
  fieldX: z.number().min(0).max(1).nullable().optional(),
  fieldY: z.number().min(0).max(1).nullable().optional(),
  rbi: z.number().int().min(0).max(20).optional(),
  runsScored: z.number().int().min(0).max(20).optional(),
  earnedRuns: z.number().int().min(0).max(20).optional(),
  outsRecorded: z.number().int().min(0).max(3).optional(),
  batterDestination: z.number().int().min(0).max(4).nullable().optional(),
  runnerAdvances: z.array(runnerAdvanceSchema).max(4).optional(),
  fielderCredits: z.array(z.object({
    gamePlayerId: z.number().int().positive(),
    position: z.string().trim().min(1).max(10),
    credit: z.enum(['putout', 'assist', 'error']),
  })).max(12).optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.result === 'in_play' && !value.plateAppearanceResult) {
    context.addIssue({ code: 'custom', path: ['plateAppearanceResult'], message: 'Choose the result of the ball in play.' });
  }
});

const runnerEventSchema = z.object({
  type: z.literal('runner'),
  runnerGamePlayerId: z.number().int().positive(),
  fromBase: z.number().int().min(1).max(3),
  toBase: z.number().int().min(1).max(4),
  reason: z.enum(RUNNER_REASONS),
  isOut: z.boolean().optional(),
  earnedRun: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

const halfInningEventSchema = z.object({
  type: z.literal('half_inning'),
  note: z.string().trim().max(500).optional(),
});

export const appendEventSchema = z.object({
  event: z.discriminatedUnion('type', [pitchEventSchema, runnerEventSchema, halfInningEventSchema]),
  clientEventId: z.string().trim().min(8).max(100).optional(),
  expectedRevision: z.number().int().nonnegative().nullable().optional(),
});

export const statusSchema = z.object({ status: z.enum(['setup', 'live', 'final']) });

export const createTrackerTeamSchema = z.object({
  action: z.literal('create_team'),
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().max(24).nullable().optional(),
  teamType: z.enum(['organization', 'intrasquad', 'opponent']),
  statSourceTeamId: z.coerce.number().int().positive().nullable().optional(),
});

export const saveTrackerRosterMemberSchema = z.object({
  action: z.literal('save_member'),
  teamId: z.coerce.number().int().positive(),
  rosterPersonId: z.coerce.number().int().positive().nullable().optional(),
  playerId: z.coerce.number().int().positive().nullable().optional(),
  displayName: z.string().trim().min(1).max(120),
  jerseyNumber: z.string().trim().max(12).nullable().optional(),
  bats: z.enum(['R', 'L', 'S']).default('R'),
  throws: z.enum(['R', 'L']).default('R'),
  position: z.string().trim().max(10).nullable().optional(),
});

export const importTrackerRosterSchema = z.object({
  action: z.literal('import_roster'),
  teamId: z.coerce.number().int().positive(),
  csvText: z.string().min(1).max(2_000_000),
});

export const linkTrackerPersonSchema = z.object({
  action: z.literal('link_person'),
  rosterPersonId: z.coerce.number().int().positive(),
  playerId: z.coerce.number().int().positive(),
});

export const trackerTeamActionSchema = z.discriminatedUnion('action', [
  createTrackerTeamSchema,
  saveTrackerRosterMemberSchema,
  importTrackerRosterSchema,
  linkTrackerPersonSchema,
]);
