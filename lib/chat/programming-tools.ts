import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import {
  getBullpenLogEntries,
  getRecoverableBullpenScripts,
  getRecoverableThrowingTemplates,
  getRecoverableVelocityScripts,
  getWorkoutByIdInOrganization,
  listBodyWeightLogsForPlayer,
  listCycleProgramItemsForPlayer,
  listExerciseTrendForPlayer,
  listPlayerChoicesByOrganization,
  listProgramItemsForPlayerByDateRange,
  listScheduleTemplatesByOrganization,
  listTrackedExercisesForPlayer,
  listWorkoutsByOrganization,
  playerExistsInOrganization,
  type ProgramItemRow,
} from '../training-db';
import { scoreNameCandidate } from './tools';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD).');

export type ProgrammingSessionContext = {
  organizationId: number;
  role: 'admin' | 'coach' | 'player';
  userId: number;
  /** Set only when role === 'player' and the account resolves to a real players.id row. */
  scopedPlayerId?: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function assertManageable(ctx: ProgrammingSessionContext, playerId: number): Promise<boolean> {
  return playerExistsInOrganization({ organizationId: ctx.organizationId, playerId });
}

function resolvePlayerIdForTool(ctx: ProgrammingSessionContext, requestedPlayerId: number | undefined): number | null {
  if (ctx.role === 'player') return ctx.scopedPlayerId ?? null;
  return requestedPlayerId ?? null;
}

function shapeProgramItem(row: ProgramItemRow) {
  return {
    dayDate: row.dayDate,
    cycleSlot: row.cycleSlot,
    itemType: row.itemType,
    itemName: row.itemName,
    workoutCategory: row.workoutCategory,
    prescribedSets: row.prescribedSets,
    prescribedReps: row.prescribedReps,
    prescribedLoad: row.prescribedLoad,
    completed: row.completed,
    performedSets: row.performedSets,
    performedReps: row.performedReps,
    performedLoad: row.performedLoad,
  };
}

// ---------------------------------------------------------------------------
// find_player_by_name
// ---------------------------------------------------------------------------

const findPlayerByNameSchema = z.object({
  nameQuery: z.string().describe('The player name or partial name as it appeared in the user\'s question.'),
});

function buildFindPlayerByNameTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof findPlayerByNameSchema>> {
  return betaZodTool({
    name: 'find_player_by_name',
    description:
      'Fuzzy-search the training-program roster for a player name, returning their numeric playerId. ' +
      'ALWAYS call this first before any schedule/program/workout/exercise tool for a named player if you do not ' +
      'already have their playerId from earlier in this conversation — those tools require a numeric playerId, not a name. ' +
      'If more than one plausible candidate is returned, or none are, ask the user to confirm rather than guessing.',
    inputSchema: findPlayerByNameSchema,
    run: async (input) => {
      const roster = await listPlayerChoicesByOrganization({
        organizationId: ctx.organizationId,
        assignedCoachUserId: ctx.role === 'coach' ? ctx.userId : null,
        activeOnly: true,
      });
      const scored = roster
        .map((player) => ({ player, score: scoreNameCandidate(input.nameQuery, player.fullName) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return JSON.stringify({
        query: input.nameQuery,
        candidates: scored.map((item) => ({
          playerId: item.player.playerId,
          name: item.player.fullName,
          confidence: item.score >= 90 ? 'exact' : item.score >= 60 ? 'high' : 'low',
        })),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_player_schedule
// ---------------------------------------------------------------------------

function buildGetPlayerScheduleSchema(ctx: ProgrammingSessionContext) {
  const base = {
    startDate: isoDate.optional().describe('ISO date. Defaults to today if omitted.'),
    endDate: isoDate.optional().describe('ISO date. Defaults to startDate + 13 days if omitted. Capped at 31 days from startDate.'),
  };
  if (ctx.role === 'player') return z.object(base);
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
    ...base,
  });
}

function buildGetPlayerScheduleTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_player_schedule',
    description:
      'Get a player\'s assigned calendar-based training schedule (workouts and exercises, prescribed vs. actually performed, ' +
      'completion status) for a date range. Use for "what does X have scheduled this week" or "did X complete their program on [date]". ' +
      'Defaults to the next 2 weeks from today if no dates are given. For a player-scoped session this always returns that ' +
      'player\'s own schedule. If this returns no rows, the school may use cycle-based programming instead — try get_player_cycle_program.',
    inputSchema: buildGetPlayerScheduleSchema(ctx),
    run: async (input: { playerId?: number; startDate?: string; endDate?: string }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const startDate = input.startDate ?? todayIso();
      let endDate = input.endDate ?? addDaysIso(startDate, 13);
      const maxEnd = addDaysIso(startDate, 31);
      if (endDate > maxEnd) endDate = maxEnd;

      const rows = await listProgramItemsForPlayerByDateRange({ playerId, startDate, endDate });
      const capped = rows.slice(0, 200);
      return JSON.stringify({
        playerId,
        window: { start: startDate, end: endDate },
        items: capped.map(shapeProgramItem),
        truncated: rows.length > capped.length,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_player_cycle_program
// ---------------------------------------------------------------------------

function buildGetPlayerCycleProgramSchema(ctx: ProgrammingSessionContext) {
  if (ctx.role === 'player') return z.object({});
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
  });
}

function buildGetPlayerCycleProgramTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_player_cycle_program',
    description:
      'Get a player\'s 3-Day Cycle training schedule (medium/high/low/mobility/strength-and-conditioning slots), for schools ' +
      'using cycle-based programming instead of calendar dates. Use instead of get_player_schedule when the school\'s program ' +
      'is cycle-based — if unsure which applies, try get_player_schedule first, and use this if that returns no rows.',
    inputSchema: buildGetPlayerCycleProgramSchema(ctx),
    run: async (input: { playerId?: number }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const rows = await listCycleProgramItemsForPlayer({ playerId });
      const capped = rows.slice(0, 100);
      return JSON.stringify({
        playerId,
        items: capped.map(shapeProgramItem),
        truncated: rows.length > capped.length,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_player_bullpen_log
// ---------------------------------------------------------------------------

function buildGetPlayerBullpenLogSchema(ctx: ProgrammingSessionContext) {
  const base = {
    templateId: z.string().optional().describe('Filter to one bullpen template/script id, if known.'),
    limit: z.number().int().positive().max(20).optional().describe('Max number of most-recent bullpen sessions to return. Defaults to 5.'),
  };
  if (ctx.role === 'player') return z.object(base);
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
    ...base,
  });
}

function buildGetPlayerBullpenLogTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_player_bullpen_log',
    description:
      'Get a player\'s logged bullpen sessions (actual data recorded during a bullpen), most recent first. Use for ' +
      '"what did X throw in their last bullpen" or "show Y\'s bullpen log from last week". This is actual logged/performed ' +
      'data, not the prescribed schedule — for what is assigned but not yet logged, use get_player_schedule instead.',
    inputSchema: buildGetPlayerBullpenLogSchema(ctx),
    run: async (input: { playerId?: number; templateId?: string; limit?: number }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const entries = await getBullpenLogEntries({
        organizationId: ctx.organizationId,
        playerId,
        templateId: input.templateId ?? null,
      });
      const limit = input.limit ?? 5;
      const limited = entries.slice(0, limit);
      return JSON.stringify({
        playerId,
        entries: limited.map((entry) => ({
          templateId: entry.templateId,
          bullpenDate: entry.bullpenDate,
          updatedAt: entry.updatedAt,
          rows: entry.rowsJson.slice(0, 50),
          rowsTruncated: entry.rowsJson.length > 50,
        })),
        totalEntries: entries.length,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_player_weight_logs
// ---------------------------------------------------------------------------

function buildGetPlayerWeightLogsSchema(ctx: ProgrammingSessionContext) {
  const base = {
    limit: z.number().int().positive().max(120).optional().describe('Max number of most recent weigh-ins to return. Defaults to 30.'),
  };
  if (ctx.role === 'player') return z.object(base);
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
    ...base,
  });
}

function buildGetPlayerWeightLogsTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_player_weight_logs',
    description:
      'Get a player\'s logged body-weight history (date, weight in lbs, optional notes), oldest to newest. ' +
      'Use for questions about weight trend, most recent weigh-in, or weight change over time.',
    inputSchema: buildGetPlayerWeightLogsSchema(ctx),
    run: async (input: { playerId?: number; limit?: number }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const logs = await listBodyWeightLogsForPlayer({ playerId, limit: input.limit ?? 30 });
      return JSON.stringify({ playerId, logs });
    },
  });
}

// ---------------------------------------------------------------------------
// get_player_tracked_exercises
// ---------------------------------------------------------------------------

function buildGetPlayerTrackedExercisesSchema(ctx: ProgrammingSessionContext) {
  if (ctx.role === 'player') return z.object({});
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
  });
}

function buildGetPlayerTrackedExercisesTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_player_tracked_exercises',
    description:
      'List which exercises a player has logged actual performance history for (real tracked load data, not just assigned-but-never-logged). ' +
      'Call this BEFORE get_exercise_trend if you do not already know the numeric exerciseId for the exercise in question.',
    inputSchema: buildGetPlayerTrackedExercisesSchema(ctx),
    run: async (input: { playerId?: number }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const rows = await listTrackedExercisesForPlayer({ playerId });
      return JSON.stringify({ playerId, exercises: rows.slice(0, 100) });
    },
  });
}

// ---------------------------------------------------------------------------
// get_exercise_trend
// ---------------------------------------------------------------------------

function buildGetExerciseTrendSchema(ctx: ProgrammingSessionContext) {
  const base = {
    exerciseId: z.number().int().positive().describe('The exercise_library id. Call get_player_tracked_exercises first if you do not already know this.'),
  };
  if (ctx.role === 'player') return z.object(base);
  return z.object({
    playerId: z.number().int().positive().describe('The player\'s numeric id. Call find_player_by_name first if you only have a name.'),
    ...base,
  });
}

function buildGetExerciseTrendTool(ctx: ProgrammingSessionContext): BetaRunnableTool<any> {
  return betaZodTool({
    name: 'get_exercise_trend',
    description:
      'Get a player\'s logged load trend over time for ONE specific exercise (date + average load per day). Requires an exerciseId — ' +
      'call get_player_tracked_exercises first if you do not already know it. Use for "how has X\'s back squat progressed" style questions.',
    inputSchema: buildGetExerciseTrendSchema(ctx),
    run: async (input: { playerId?: number; exerciseId: number }) => {
      const playerId = resolvePlayerIdForTool(ctx, input.playerId);
      if (!playerId) return JSON.stringify({ error: 'No player specified.' });
      if (ctx.role !== 'player' && !(await assertManageable(ctx, playerId))) {
        return JSON.stringify({ error: 'Player not found or not accessible.' });
      }
      const points = await listExerciseTrendForPlayer({ playerId, exerciseId: input.exerciseId });
      const capped = points.slice(-60);
      return JSON.stringify({
        playerId,
        exerciseId: input.exerciseId,
        points: capped,
        truncated: points.length > capped.length,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// find_scheduling_gaps — admin/coach only
// ---------------------------------------------------------------------------

const findSchedulingGapsSchema = z.object({
  startDate: isoDate.optional().describe('ISO date. Defaults to today if omitted.'),
  days: z.number().int().min(1).max(31).optional().describe('Window length in days. Defaults to 7.'),
});

function buildFindSchedulingGapsTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof findSchedulingGapsSchema>> {
  return betaZodTool({
    name: 'find_scheduling_gaps',
    description:
      'ADMIN/COACH ONLY. Find players with gaps (missing days) in their assigned training schedule over a date window, sorted by ' +
      'most-missing-days first. Use for coverage questions like "who hasn\'t been assigned anything this week". Not available to players.',
    inputSchema: findSchedulingGapsSchema,
    run: async (input) => {
      const startDate = input.startDate ?? todayIso();
      const days = input.days ?? 7;
      const endDate = addDaysIso(startDate, days - 1);
      const dayKeys = Array.from({ length: days }, (_, i) => addDaysIso(startDate, i));

      const roster = await listPlayerChoicesByOrganization({
        organizationId: ctx.organizationId,
        assignedCoachUserId: ctx.role === 'coach' ? ctx.userId : null,
        activeOnly: true,
      });

      // Bounded concurrency: the shared DB pool has a modest max size (default 12), so
      // querying the whole roster in parallel could starve other concurrent requests.
      const results: Array<{ playerId: number; fullName: string; missingDays: number }> = [];
      const concurrency = 5;
      for (let start = 0; start < roster.length; start += concurrency) {
        const chunk = roster.slice(start, start + concurrency);
        const chunkResults = await Promise.all(
          chunk.map(async (player) => {
            const rows = await listProgramItemsForPlayerByDateRange({
              playerId: player.playerId,
              startDate,
              endDate,
            });
            const missingDays = dayKeys.filter((day) => !rows.some((row) => row.dayDate === day)).length;
            return { player, missingDays };
          })
        );
        for (const { player, missingDays } of chunkResults) {
          if (missingDays > 0) {
            results.push({ playerId: player.playerId, fullName: player.fullName, missingDays });
          }
        }
      }
      results.sort((a, b) => b.missingDays - a.missingDays || a.fullName.localeCompare(b.fullName));

      return JSON.stringify({
        window: { start: startDate, end: endDate, days },
        totalPlayersChecked: roster.length,
        playersWithGaps: results.length,
        players: results.slice(0, 25),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// list_workouts / get_workout_detail
// ---------------------------------------------------------------------------

const listWorkoutsSchema = z.object({
  searchQuery: z.string().optional().describe('Optional case-insensitive substring filter on workout name or category.'),
});

function buildListWorkoutsTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof listWorkoutsSchema>> {
  return betaZodTool({
    name: 'list_workouts',
    description:
      'List the organization\'s workout library (name, category, exercise count). Use to answer "what workouts do we have for X" ' +
      'or before get_workout_detail if you do not know the exact workoutId.',
    inputSchema: listWorkoutsSchema,
    run: async (input) => {
      const workouts = await listWorkoutsByOrganization(ctx.organizationId);
      const query = (input.searchQuery ?? '').trim().toLowerCase();
      const filtered = query
        ? workouts.filter((w) => w.name.toLowerCase().includes(query) || w.category.toLowerCase().includes(query))
        : workouts;
      return JSON.stringify({
        workouts: filtered.slice(0, 40).map((w) => ({
          id: w.id,
          name: w.name,
          category: w.category,
          exerciseCount: w.exerciseCount,
          exerciseNames: w.exerciseNames,
        })),
      });
    },
  });
}

const getWorkoutDetailSchema = z.object({
  workoutId: z.number().int().positive().describe('The workout id. Call list_workouts first if you do not know this.'),
});

function buildGetWorkoutDetailTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof getWorkoutDetailSchema>> {
  return betaZodTool({
    name: 'get_workout_detail',
    description:
      'Get full exercise-by-exercise detail for one workout (sets/reps/load prescriptions, notes) by id. ' +
      'Call list_workouts first if you do not know the workoutId.',
    inputSchema: getWorkoutDetailSchema,
    run: async (input) => {
      const workout = await getWorkoutByIdInOrganization({ organizationId: ctx.organizationId, workoutId: input.workoutId });
      if (!workout) return JSON.stringify({ error: 'Workout not found.' });
      return JSON.stringify({
        id: workout.id,
        name: workout.name,
        category: workout.category,
        description: workout.description,
        items: workout.items.slice(0, 40).map((item) => ({
          exerciseName: item.exerciseName,
          category: item.category,
          prescribedSets: item.prescribedSets,
          prescribedReps: item.prescribedReps,
          prescribedLoad: item.prescribedLoad,
          notes: item.notes,
        })),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_schedule_templates — admin/coach only
// ---------------------------------------------------------------------------

function buildGetScheduleTemplatesTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof emptySchema>> {
  return betaZodTool({
    name: 'get_schedule_templates',
    description:
      'ADMIN/COACH ONLY. List the organization\'s saved multi-day schedule templates (name, total days, workout count) used to ' +
      'bulk-assign a program to a player. Use for "what schedule templates do we have" questions.',
    inputSchema: emptySchema,
    run: async () => {
      const templates = await listScheduleTemplatesByOrganization(ctx.organizationId);
      return JSON.stringify({
        templates: templates.slice(0, 40).map((t) => ({
          id: t.id,
          name: t.name,
          totalDays: t.totalDays,
          workoutCount: t.workoutCount,
        })),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_throwing_bullpen_templates — admin/coach only
// ---------------------------------------------------------------------------

const emptySchema = z.object({});

const getThrowingBullpenTemplatesSchema = z.object({
  kind: z.enum(['bullpen', 'velocity', 'throwing_program', 'all']).optional()
    .describe('Which kind of reusable throwing content to list. Defaults to "all".'),
});

function extractTitle(row: unknown): string {
  if (row && typeof row === 'object') {
    const obj = row as Record<string, unknown>;
    if (typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim();
    if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
  }
  return 'Untitled';
}

function buildGetThrowingBullpenTemplatesTool(ctx: ProgrammingSessionContext): BetaRunnableTool<z.infer<typeof getThrowingBullpenTemplatesSchema>> {
  return betaZodTool({
    name: 'get_throwing_bullpen_templates',
    description:
      'ADMIN/COACH ONLY. List reusable/recoverable throwing content the organization has previously saved: bullpen scripts, ' +
      'velocity program scripts, and throwing program templates (by title). Use for "what bullpen scripts / velocity programs / ' +
      'throwing templates do we have saved" questions.',
    inputSchema: getThrowingBullpenTemplatesSchema,
    run: async (input) => {
      const kind = input.kind ?? 'all';
      const result: Record<string, Array<{ title: string }>> = {};
      if (kind === 'bullpen' || kind === 'all') {
        const rows = await getRecoverableBullpenScripts({ organizationId: ctx.organizationId });
        result.bullpenScripts = rows.slice(0, 30).map((r) => ({ title: extractTitle(r) }));
      }
      if (kind === 'velocity' || kind === 'all') {
        const rows = await getRecoverableVelocityScripts({ organizationId: ctx.organizationId });
        result.velocityScripts = rows.slice(0, 30).map((r) => ({ title: extractTitle(r) }));
      }
      if (kind === 'throwing_program' || kind === 'all') {
        const rows = await getRecoverableThrowingTemplates({ organizationId: ctx.organizationId });
        result.throwingTemplates = rows.slice(0, 30).map((r) => ({ title: extractTitle(r) }));
      }
      return JSON.stringify(result);
    },
  });
}

// ---------------------------------------------------------------------------
// Tool list assembly
// ---------------------------------------------------------------------------

export type BuildProgrammingToolsInput = {
  session: ProgrammingSessionContext;
};

export function buildProgrammingToolsForSession({ session }: BuildProgrammingToolsInput): BetaRunnableTool<any>[] {
  const tools: BetaRunnableTool<any>[] = [
    buildGetPlayerScheduleTool(session),
    buildGetPlayerCycleProgramTool(session),
    buildGetPlayerBullpenLogTool(session),
    buildGetPlayerWeightLogsTool(session),
    buildGetPlayerTrackedExercisesTool(session),
    buildGetExerciseTrendTool(session),
    buildListWorkoutsTool(session),
    buildGetWorkoutDetailTool(session),
  ];
  if (session.role === 'admin' || session.role === 'coach') {
    tools.push(buildFindPlayerByNameTool(session));
    tools.push(buildFindSchedulingGapsTool(session));
    tools.push(buildGetScheduleTemplatesTool(session));
    tools.push(buildGetThrowingBullpenTemplatesTool(session));
  }
  return tools;
}
