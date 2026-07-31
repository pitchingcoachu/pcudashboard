import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import {
  buildAllowedNameKeys,
  fetchFilters,
  fetchOverview,
  fetchPitchingAbReport,
  fetchPitchingGameDates,
  findCountRow,
  findPitchTypeRow,
  findPlayerRow,
  formatStatValue,
  hasRows,
  normalizeKey,
  normalizeName,
  normalizeText,
  parseNumberLike,
  pickPlayerFromQuestion,
  resolveBestPitchByMetric,
  resolveGameByGamePitchVeloFromAbReport,
  resolveMetricFromOverview,
  resolveMetricLabelFromColumns,
  resolveModeCandidates,
  resolvePitchTypeVeloStatsFromAbReport,
  resolveSeasonWindow,
  unique,
  usageForPitch,
  type ChatDomain,
  type OverviewPayload,
} from './dashboard-data';
import { METRICS_GLOSSARY } from './metrics-glossary';
import { PAGE_MANIFEST } from './page-manifest';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD).');
const countToken = z.string().regex(/^[0-3]-[0-2]$/, 'Must be a count like "0-1".');

export type ChatSessionContext = {
  apiBase: string;
  schoolCode: string;
  isProSchool: boolean;
  shouldScopePlayer: boolean;
  /** Only set when shouldScopePlayer is true. */
  scopedPitcherName?: string;
  scopedHitterName?: string;
};

function levelForSchool(ctx: ChatSessionContext): string | null {
  return ctx.isProSchool ? 'All' : null;
}

async function loadFilters(ctx: ChatSessionContext, domain: ChatDomain) {
  if (ctx.shouldScopePlayer) {
    const name = domain === 'pitching' ? ctx.scopedPitcherName : ctx.scopedHitterName;
    return {
      pitchers: domain === 'pitching' && name ? [name] : [],
      hitters: domain === 'hitting' && name ? [name] : [],
      max_date: null as string | null,
      table_modes: [] as string[],
    };
  }
  return fetchFilters(ctx.apiBase, ctx.schoolCode, domain);
}

function rosterForDomain(filters: { pitchers?: string[]; hitters?: string[] }, domain: ChatDomain): string[] {
  return unique(domain === 'pitching' ? filters.pitchers ?? [] : filters.hitters ?? []);
}

// ---------------------------------------------------------------------------
// get_player_stat
// ---------------------------------------------------------------------------

const getPlayerStatSchema = z.object({
  domain: z.enum(['pitching', 'hitting']).describe('Which stat domain to query.'),
  playerName: z.string().describe('Exact roster name as returned by find_player or already known from context.'),
  metrics: z.array(z.string()).min(1).max(6).describe('Metric names or aliases to retrieve, e.g. ["BB%", "K%"].'),
  startDate: isoDate.optional().describe('ISO date. Defaults to the current season window if omitted.'),
  endDate: isoDate.optional().describe('ISO date. Defaults to the latest available date if omitted.'),
  countToken: countToken.optional().describe('Ball-strike count filter, e.g. "0-1".'),
  afterCount: z.boolean().optional().describe('If true, filter to counts reached AFTER this count rather than the count itself.'),
  batterSide: z.enum(['Left', 'Right']).optional().describe('Filter pitching stats to a specific batter handedness.'),
  pitchType: z.string().optional().describe('Filter to one pitch type, e.g. "Fastball", "Slider".'),
  tableMode: z.string().optional().describe('Specific upstream table mode to query, if known (e.g. "Stuff", "Usage"). Omit to try candidate modes in order.'),
});

function buildGetPlayerStatTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof getPlayerStatSchema>> {
  return betaZodTool({
    name: 'get_player_stat',
    description:
      'Get one or more stat/metric values for a single named player (pitcher or hitter) over a date range. ' +
      'Use this for direct questions like "What is X\'s BB%?" or "Show Y\'s xWOBA over the last 2 weeks." ' +
      'Call find_player first if you are not certain of the exact roster name. ' +
      'Call search_metrics first if you are unsure which table column a metric name maps to.',
    inputSchema: getPlayerStatSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, input.domain);
      const seasonWindow = resolveSeasonWindow(ctx.schoolCode, filters.max_date ?? null);
      const startDate = input.startDate ?? seasonWindow.startDate;
      const endDate = input.endDate ?? seasonWindow.endDate;
      const splitBy = input.pitchType ? 'Pitch' : (input.countToken ? (input.afterCount ? 'After Count' : 'Count') : (input.domain === 'pitching' ? 'Pitcher' : 'Hitter'));
      const modes = resolveModeCandidates(input.domain, filters);

      for (const mode of modes) {
        try {
          const payload = await fetchOverview({
            apiBase: ctx.apiBase,
            domain: input.domain,
            schoolCode: ctx.schoolCode,
            startDate,
            endDate,
            playerName: input.playerName,
            level: levelForSchool(ctx),
            splitBy,
            tableMode: mode,
            batterSide: input.batterSide ?? null,
          });
          let scoped: OverviewPayload | null = payload;
          if (input.pitchType) {
            const row = findPitchTypeRow(payload, input.pitchType);
            scoped = row ? { table_columns: payload.table_columns, table_rows: [row] } : null;
          } else if (input.countToken) {
            const row = findCountRow(payload, input.countToken);
            scoped = row ? { table_columns: payload.table_columns, table_rows: [row] } : null;
          }
          if (!scoped || !hasRows(scoped)) continue;

          const columns = Array.isArray(scoped.table_columns)
            ? scoped.table_columns.map((v) => normalizeText(String(v))).filter(Boolean)
            : Object.keys(scoped.table_rows?.[0] ?? {});

          const results: Record<string, string | number | null> = {};
          for (const requestedMetric of input.metrics) {
            const label = resolveMetricLabelFromColumns('', columns, [requestedMetric], requestedMetric);
            const found = resolveMetricFromOverview(scoped, [label, requestedMetric]);
            results[requestedMetric] = found ? found.metricValue : null;
          }
          const anyFound = Object.values(results).some((v) => v !== null);
          if (!anyFound) continue;

          return JSON.stringify({
            player: normalizeName(input.playerName),
            domain: input.domain,
            window: { start: startDate, end: endDate },
            filters: {
              countToken: input.countToken ?? null,
              afterCount: input.afterCount ?? false,
              batterSide: input.batterSide ?? null,
              pitchType: input.pitchType ?? null,
            },
            metrics: results,
            tableMode: mode,
          });
        } catch {
          // try next mode
        }
      }
      return JSON.stringify({
        player: normalizeName(input.playerName),
        domain: input.domain,
        window: { start: startDate, end: endDate },
        error: 'No data found for this player/window/filter combination.',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_leaderboard
// ---------------------------------------------------------------------------

const getLeaderboardSchema = z.object({
  domain: z.enum(['pitching', 'hitting']),
  metric: z.string().describe('Metric name or alias to rank by.'),
  direction: z.enum(['highest', 'lowest', 'both', 'all']).default('both')
    .describe('"both" returns highest+lowest; "all" returns the full sorted list.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max players to return when direction is "all". Defaults to full roster.'),
  minSampleSize: z.number().int().min(0).optional().describe('Minimum BF (pitching) or PA (hitting) threshold to qualify. Defaults to 20 for pitching, 0 for hitting.'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  playerNames: z.array(z.string()).optional().describe('If set, restrict/aggregate over only these named players instead of the full roster.'),
});

function buildGetLeaderboardTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof getLeaderboardSchema>> {
  return betaZodTool({
    name: 'get_leaderboard',
    description:
      'Get a ranked list of players (or a single highest/lowest player) by a metric across the roster or a named group. ' +
      'Use for "who has the highest K%?", "list all our pitchers\' BB%", "top 5 hitters by xWOBA".',
    inputSchema: getLeaderboardSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, input.domain);
      const seasonWindow = resolveSeasonWindow(ctx.schoolCode, filters.max_date ?? null);
      const startDate = input.startDate ?? seasonWindow.startDate;
      const endDate = input.endDate ?? seasonWindow.endDate;
      const splitBy = input.domain === 'pitching' ? 'Pitcher' : 'Hitter';
      const allowed = buildAllowedNameKeys(rosterForDomain(filters, input.domain));
      const selectedKeys = input.playerNames?.length ? buildAllowedNameKeys(input.playerNames) : null;
      const minSampleSize = input.minSampleSize ?? (input.domain === 'pitching' ? 20 : 0);
      const sampleField = input.domain === 'pitching' ? 'BF' : 'PA';
      const modes = resolveModeCandidates(input.domain, filters);

      for (const mode of modes) {
        try {
          const payload = await fetchOverview({
            apiBase: ctx.apiBase,
            domain: input.domain,
            schoolCode: ctx.schoolCode,
            startDate,
            endDate,
            playerName: '',
            includePlayerFilter: false,
            level: levelForSchool(ctx),
            splitBy,
            tableMode: mode,
          });
          const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
          if (!rows.length) continue;
          const columns = Array.isArray(payload.table_columns)
            ? payload.table_columns.map((v) => normalizeText(String(v))).filter(Boolean)
            : Object.keys(rows[0] ?? {});
          const metricLabel = resolveMetricLabelFromColumns('', columns, [input.metric], input.metric);

          let entries = rows
            .map((row) => {
              const name = normalizeText(String(row[input.domain === 'pitching' ? 'Pitcher' : 'Hitter'] ?? row.name ?? ''));
              const sampleSize = parseNumberLike(row[sampleField]);
              const value = parseNumberLike(row[metricLabel]);
              return { name, sampleSize, value };
            })
            .filter((row) => {
              if (!row.name || row.value === null) return false;
              if ((row.sampleSize ?? 0) < minSampleSize) return false;
              const key = normalizeKey(normalizeName(row.name));
              if (allowed.size > 0 && !allowed.has(key)) return false;
              if (selectedKeys && !selectedKeys.has(key)) return false;
              return true;
            });
          if (!entries.length) continue;

          entries = entries.sort((a, b) => (b.value! - a.value!));
          let out: Array<{ name: string; value: number | null; sampleSize: number | null }>;
          if (input.direction === 'highest') out = entries.slice(0, 1);
          else if (input.direction === 'lowest') out = entries.slice(-1);
          else if (input.direction === 'both') out = [entries[0], entries[entries.length - 1]];
          else out = entries.slice(0, input.limit ?? entries.length);

          return JSON.stringify({
            metric: metricLabel,
            domain: input.domain,
            window: { start: startDate, end: endDate },
            tableMode: mode,
            sampleSizeThreshold: minSampleSize,
            totalQualifying: entries.length,
            entries: out.map((e) => ({
              name: normalizeName(e.name),
              value: e.value !== null ? formatStatValue(e.value) : null,
              sampleSize: e.sampleSize,
            })),
          });
        } catch {
          // try next mode
        }
      }
      return JSON.stringify({ metric: input.metric, domain: input.domain, error: 'No leaderboard data found for this window.' });
    },
  });
}

// ---------------------------------------------------------------------------
// compare_splits
// ---------------------------------------------------------------------------

const compareSplitsSchema = z.object({
  domain: z.enum(['pitching', 'hitting']),
  playerName: z.string(),
  metric: z.string(),
  splitType: z.enum(['batter_side', 'count', 'game_by_game']),
  pitchType: z.string().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  counts: z.array(countToken).optional().describe('Only used when splitType is "count". Defaults to comparing all standard counts if omitted.'),
  afterCount: z.boolean().optional(),
});

function buildCompareSplitsTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof compareSplitsSchema>> {
  return betaZodTool({
    name: 'compare_splits',
    description:
      'Compare a metric for one player across two or more splits: batter handedness (left/right), ball-strike count, or game-by-game. ' +
      'Use for "lefty vs righty", "what about after 0-1 vs 1-1", "show me each outing this month".',
    inputSchema: compareSplitsSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, input.domain);
      const seasonWindow = resolveSeasonWindow(ctx.schoolCode, filters.max_date ?? null);
      const startDate = input.startDate ?? seasonWindow.startDate;
      const endDate = input.endDate ?? seasonWindow.endDate;
      const modes = resolveModeCandidates(input.domain, filters);

      if (input.splitType === 'batter_side') {
        for (const mode of modes) {
          try {
            const [leftPayload, rightPayload] = await Promise.all([
              fetchOverview({
                apiBase: ctx.apiBase, domain: input.domain, schoolCode: ctx.schoolCode, startDate, endDate,
                playerName: input.playerName, level: levelForSchool(ctx),
                splitBy: input.pitchType ? 'Pitch' : 'Pitcher', tableMode: mode, batterSide: 'Left',
              }),
              fetchOverview({
                apiBase: ctx.apiBase, domain: input.domain, schoolCode: ctx.schoolCode, startDate, endDate,
                playerName: input.playerName, level: levelForSchool(ctx),
                splitBy: input.pitchType ? 'Pitch' : 'Pitcher', tableMode: mode, batterSide: 'Right',
              }),
            ]);
            const leftScoped = input.pitchType ? scopeToPitchType(leftPayload, input.pitchType) : leftPayload;
            const rightScoped = input.pitchType ? scopeToPitchType(rightPayload, input.pitchType) : rightPayload;
            if (!hasRows(leftScoped) && !hasRows(rightScoped)) continue;
            const mergedCols = unique([
              ...columnsOf(leftScoped ?? leftPayload),
              ...columnsOf(rightScoped ?? rightPayload),
            ]);
            const metricLabel = resolveMetricLabelFromColumns('', mergedCols, [input.metric], input.metric);
            const leftMetric = leftScoped ? resolveMetricFromOverview(leftScoped, [metricLabel, input.metric]) : null;
            const rightMetric = rightScoped ? resolveMetricFromOverview(rightScoped, [metricLabel, input.metric]) : null;
            if (!leftMetric && !rightMetric) continue;
            return JSON.stringify({
              player: normalizeName(input.playerName), metric: metricLabel, splitType: 'batter_side',
              window: { start: startDate, end: endDate }, tableMode: mode,
              comparisons: [
                { label: 'Left', value: leftMetric?.metricValue ?? null },
                { label: 'Right', value: rightMetric?.metricValue ?? null },
              ],
            });
          } catch {
            // try next mode
          }
        }
      }

      if (input.splitType === 'count') {
        const splitBy = input.afterCount ? 'After Count' : 'Count';
        const counts = input.counts?.length ? input.counts : ['0-0', '0-1', '0-2', '1-0', '1-1', '1-2', '2-0', '2-1', '2-2', '3-0', '3-1', '3-2'];
        for (const mode of modes) {
          try {
            const payload = await fetchOverview({
              apiBase: ctx.apiBase, domain: input.domain, schoolCode: ctx.schoolCode, startDate, endDate,
              playerName: input.playerName, level: levelForSchool(ctx), splitBy, tableMode: mode,
            });
            if (!hasRows(payload)) continue;
            const columns = columnsOf(payload);
            const metricLabel = resolveMetricLabelFromColumns('', columns, [input.metric], input.metric);
            const comparisons = counts
              .map((count) => {
                const row = findCountRow(payload, count);
                if (!row) return null;
                const value = parseNumberLike(row[metricLabel]);
                return { label: count, value: value !== null ? formatStatValue(value) : null };
              })
              .filter((entry): entry is { label: string; value: string | null } => entry !== null);
            if (!comparisons.length) continue;
            return JSON.stringify({
              player: normalizeName(input.playerName), metric: metricLabel, splitType: 'count',
              window: { start: startDate, end: endDate }, tableMode: mode, comparisons,
            });
          } catch {
            // try next mode
          }
        }
      }

      if (input.splitType === 'game_by_game') {
        if (input.pitchType && /velo/i.test(input.metric)) {
          try {
            const rows = await resolveGameByGamePitchVeloFromAbReport({
              apiBase: ctx.apiBase, schoolCode: ctx.schoolCode, pitcher: input.playerName,
              pitchType: input.pitchType, startDate, endDate, maxGames: 20,
            });
            if (rows.length) {
              return JSON.stringify({
                player: normalizeName(input.playerName), metric: `${input.pitchType} Velo`, splitType: 'game_by_game',
                window: { start: startDate, end: endDate }, source: 'ab-report',
                comparisons: rows.map((r) => ({ label: r.date, value: `avg ${r.avgVelo.toFixed(1)} mph, max ${r.maxVelo.toFixed(1)} mph (${r.pitchCount} pitches)` })),
              });
            }
          } catch {
            // fall through
          }
        }
        try {
          const gameDates = await fetchPitchingGameDates({
            apiBase: ctx.apiBase, schoolCode: ctx.schoolCode, pitcher: input.playerName, startDate, endDate,
          });
          const cappedDates = gameDates.length > 20 ? gameDates.slice(gameDates.length - 20) : gameDates;
          if (cappedDates.length) {
            const splitBy = input.pitchType ? 'Pitch' : 'Pitcher';
            for (const mode of modes) {
              const comparisons: Array<{ label: string; value: string | null }> = [];
              let usedMode: string | null = null;
              for (const date of cappedDates) {
                try {
                  const payload = await fetchOverview({
                    apiBase: ctx.apiBase, domain: input.domain, schoolCode: ctx.schoolCode,
                    startDate: date, endDate: date, playerName: input.playerName,
                    level: levelForSchool(ctx), splitBy, tableMode: mode,
                  });
                  const scoped = input.pitchType ? scopeToPitchType(payload, input.pitchType) : payload;
                  if (!scoped || !hasRows(scoped)) continue;
                  const columns = columnsOf(scoped);
                  const metricLabel = resolveMetricLabelFromColumns('', columns, [input.metric], input.metric);
                  const found = resolveMetricFromOverview(scoped, [metricLabel, input.metric]);
                  if (found) {
                    comparisons.push({ label: date, value: found.metricValue });
                    usedMode = mode;
                  }
                } catch {
                  // skip this date
                }
              }
              if (comparisons.length) {
                return JSON.stringify({
                  player: normalizeName(input.playerName), metric: input.metric, splitType: 'game_by_game',
                  window: { start: startDate, end: endDate }, tableMode: usedMode,
                  gamesShown: comparisons.length, gamesAvailable: gameDates.length, comparisons,
                });
              }
            }
          }
        } catch {
          // fall through to error below
        }
      }

      return JSON.stringify({ player: normalizeName(input.playerName), metric: input.metric, splitType: input.splitType, error: 'No split data found for this player/window/filter combination.' });
    },
  });
}

// ---------------------------------------------------------------------------
// get_best_pitch_by_metric
// ---------------------------------------------------------------------------

const getBestPitchByMetricSchema = z.object({
  domain: z.literal('pitching').default('pitching'),
  playerName: z.string(),
  metric: z.string().describe('Metric to rank pitch types by, e.g. "PV/100", "Whiff%", "Stuff+".'),
  direction: z.enum(['highest', 'lowest']).default('highest'),
  batterSide: z.enum(['Left', 'Right']).optional().describe('If set, find the best pitch specifically against this batter handedness.'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});

function buildGetBestPitchByMetricTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof getBestPitchByMetricSchema>> {
  return betaZodTool({
    name: 'get_best_pitch_by_metric',
    description:
      'Find which single pitch type in a pitcher\'s arsenal ranks highest (or lowest) on a given metric, optionally filtered ' +
      'to one batter handedness. Use this — not get_player_stat or compare_splits — for questions like "what is X\'s best pitch by ' +
      'PV/100?", "what is X\'s best whiff pitch vs lefties?", or "which of X\'s pitches has the highest Stuff+?". ' +
      'This directly ranks pitch types by the metric in one call; do not try to reconstruct this by calling get_player_stat once per pitch type.',
    inputSchema: getBestPitchByMetricSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, 'pitching');
      const seasonWindow = resolveSeasonWindow(ctx.schoolCode, filters.max_date ?? null);
      const startDate = input.startDate ?? seasonWindow.startDate;
      const endDate = input.endDate ?? seasonWindow.endDate;
      const modes = resolveModeCandidates('pitching', filters);

      for (const mode of modes) {
        try {
          const payload = await fetchOverview({
            apiBase: ctx.apiBase, domain: 'pitching', schoolCode: ctx.schoolCode, startDate, endDate,
            playerName: input.playerName, level: levelForSchool(ctx),
            splitBy: 'Pitch', tableMode: mode, batterSide: input.batterSide ?? null,
          });
          if (!hasRows(payload)) continue;
          const columns = columnsOf(payload);
          const metricLabel = resolveMetricLabelFromColumns('', columns, [input.metric], input.metric);
          const best = resolveBestPitchByMetric(payload, metricLabel, input.direction);
          if (!best) continue;
          const usage = usageForPitch(payload, best.pitch);
          return JSON.stringify({
            player: normalizeName(input.playerName),
            metric: metricLabel,
            direction: input.direction,
            batterSide: input.batterSide ?? 'All',
            window: { start: startDate, end: endDate },
            tableMode: mode,
            bestPitch: best.pitch,
            value: best.valueText,
            usage,
          });
        } catch {
          // try next mode
        }
      }
      return JSON.stringify({
        player: normalizeName(input.playerName), metric: input.metric,
        error: 'No pitch-level data found for this player/window/filter combination.',
      });
    },
  });
}

function scopeToPitchType(payload: OverviewPayload, pitchType: string): OverviewPayload | null {
  const row = findPitchTypeRow(payload, pitchType);
  return row ? { table_columns: payload.table_columns, table_rows: [row] } : null;
}

function columnsOf(payload: OverviewPayload): string[] {
  return Array.isArray(payload.table_columns)
    ? payload.table_columns.map((v) => normalizeText(String(v))).filter(Boolean)
    : Object.keys(payload.table_rows?.[0] ?? {});
}

// ---------------------------------------------------------------------------
// search_metrics
// ---------------------------------------------------------------------------

const searchMetricsSchema = z.object({
  query: z.string().describe('Free-text search term, metric name, or alias.'),
  domain: z.enum(['pitching', 'hitting', 'both']).optional().default('both'),
});

function buildSearchMetricsTool(): BetaRunnableTool<z.infer<typeof searchMetricsSchema>> {
  return betaZodTool({
    name: 'search_metrics',
    description:
      'Search the stat glossary for metric definitions by name, alias, or description keyword. ' +
      'Use this when the user asks "what is xWOBA" or when you are unsure which canonical metric name/column ' +
      'a user\'s phrase (e.g. "chase rate", "swing and miss") maps to before calling get_player_stat or get_leaderboard.',
    inputSchema: searchMetricsSchema,
    run: async (input) => {
      const qNorm = normalizeKey(input.query);
      const qTokens = input.query.toLowerCase().split(/[^a-z0-9+%]+/).filter(Boolean);
      const scored = METRICS_GLOSSARY
        .filter((entry) => input.domain === 'both' || entry.domain === 'both' || entry.domain === input.domain)
        .map((entry) => {
          let score = 0;
          const nameNorm = normalizeKey(entry.name);
          if (nameNorm === qNorm) score += 100;
          else if (qNorm.includes(nameNorm) || nameNorm.includes(qNorm)) score += 60;
          for (const alias of entry.aliases) {
            const aliasNorm = normalizeKey(alias);
            if (aliasNorm === qNorm) score += 90;
            else if (qNorm.includes(aliasNorm) || aliasNorm.includes(qNorm)) score += 50;
          }
          const defTokens = entry.definition.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          for (const token of qTokens) {
            if (token.length < 3) continue;
            if (defTokens.includes(token)) score += 10;
          }
          return { entry, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return JSON.stringify({
        query: input.query,
        matches: scored.map((item) => ({
          name: item.entry.name,
          aliases: item.entry.aliases,
          definition: item.entry.definition,
          domain: item.entry.domain,
          typicalTableMode: item.entry.typicalTableMode,
        })),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// find_player
// ---------------------------------------------------------------------------

const findPlayerSchema = z.object({
  domain: z.enum(['pitching', 'hitting']),
  nameQuery: z.string().describe('The name or partial name as it appeared in the user\'s question.'),
});

export function scoreNameCandidate(nameQuery: string, candidate: string): number {
  const qNorm = normalizeKey(nameQuery);
  const full = normalizeName(candidate);
  const fullNorm = normalizeKey(full);
  if (!qNorm || !fullNorm) return 0;
  if (qNorm === fullNorm) return 100;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstLastNorm = normalizeKey(`${parts[0]} ${parts[parts.length - 1]}`);
    if (qNorm === firstLastNorm) return 95;
  }
  if (fullNorm.includes(qNorm) || qNorm.includes(fullNorm)) return 70;
  // last-name-only match
  if (parts.length >= 2) {
    const lastNorm = normalizeKey(parts[parts.length - 1]);
    if (lastNorm.length >= 3 && qNorm.includes(lastNorm)) return 55;
  }
  // crude one-edit-distance tolerance for short misspellings
  if (Math.abs(qNorm.length - fullNorm.length) <= 1 && levenshteinAtMostOne(qNorm, fullNorm)) return 60;
  return 0;
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else if (a.length > b.length) {
      i += 1;
    } else {
      j += 1;
    }
  }
  edits += (a.length - i) + (b.length - j);
  return edits <= 1;
}

function buildFindPlayerTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof findPlayerSchema>> {
  return betaZodTool({
    name: 'find_player',
    description:
      'Fuzzy-search the active roster for a player name mentioned in the user\'s question. ' +
      'Returns one or more candidate matches with confidence. If more than one plausible candidate is returned, ' +
      'or confidence is not high, ask the user to confirm which player they mean rather than guessing.',
    inputSchema: findPlayerSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, input.domain);
      const roster = rosterForDomain(filters, input.domain);
      const scored = roster
        .map((name) => ({ name, score: scoreNameCandidate(input.nameQuery, name) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const candidates = scored.map((item) => ({
        name: normalizeName(item.name),
        confidence: item.score >= 90 ? 'exact' as const : item.score >= 60 ? 'high' as const : 'low' as const,
      }));
      return JSON.stringify({ query: input.nameQuery, candidates });
    },
  });
}

// ---------------------------------------------------------------------------
// find_page
// ---------------------------------------------------------------------------

const findPageSchema = z.object({
  query: z.string().describe('What the user is trying to find or do.'),
});

function buildFindPageTool(role: 'admin' | 'coach' | 'player'): BetaRunnableTool<z.infer<typeof findPageSchema>> {
  return betaZodTool({
    name: 'find_page',
    description:
      'Search the dashboard\'s page/section directory to help the user navigate to a specific tool or page. ' +
      'Use when the user asks "where do I find X", "how do I get to the workout builder", "take me to player notes", etc. ' +
      'Returns a route the frontend can render as a clickable link — do not fabricate a route yourself.',
    inputSchema: findPageSchema,
    run: async (input) => {
      const qNorm = normalizeKey(input.query);
      const qTokens = input.query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const scored = PAGE_MANIFEST
        .filter((entry) => entry.roles.includes(role))
        .map((entry) => {
          let score = 0;
          const titleNorm = normalizeKey(entry.title);
          if (qNorm.includes(titleNorm) || titleNorm.includes(qNorm)) score += 70;
          for (const keyword of entry.keywords) {
            const keywordNorm = normalizeKey(keyword);
            if (qNorm.includes(keywordNorm) || keywordNorm.includes(qNorm)) score += 40;
          }
          const descTokens = entry.description.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          for (const token of qTokens) {
            if (token.length < 3) continue;
            if (descTokens.includes(token)) score += 8;
          }
          return { entry, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return JSON.stringify({
        query: input.query,
        matches: scored.map((item) => ({
          title: item.entry.title,
          href: item.entry.route,
          description: item.entry.description,
        })),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// get_ab_report
// ---------------------------------------------------------------------------

const getAbReportSchema = z.object({
  pitcherName: z.string(),
  gameKey: z.string().optional().describe('Specific game identifier if the user named one game. Omit to summarize recent games.'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  pitchType: z.string().optional().describe('Filter to one pitch type.'),
});

function buildGetAbReportTool(ctx: ChatSessionContext): BetaRunnableTool<z.infer<typeof getAbReportSchema>> {
  return betaZodTool({
    name: 'get_ab_report',
    description:
      'Get game-by-game pitch-level detail (pitch types, velocities) for a pitcher, either across recent games ' +
      'or for one specific game. Use for detailed pitch-sequencing or velocity-by-pitch questions that get_player_stat ' +
      'and compare_splits cannot answer directly.',
    inputSchema: getAbReportSchema,
    run: async (input) => {
      const filters = await loadFilters(ctx, 'pitching');
      const seasonWindow = resolveSeasonWindow(ctx.schoolCode, filters.max_date ?? null);
      const startDate = input.startDate ?? seasonWindow.startDate;
      const endDate = input.endDate ?? seasonWindow.endDate;

      if (input.gameKey) {
        const report = await fetchPitchingAbReport({
          apiBase: ctx.apiBase, schoolCode: ctx.schoolCode, pitcher: input.pitcherName, gameKey: input.gameKey,
        });
        const summary = summarizeAbReportByPitchType(report, input.pitchType);
        return JSON.stringify({ player: normalizeName(input.pitcherName), gameKey: input.gameKey, pitchTypes: summary });
      }

      if (input.pitchType) {
        const stats = await resolvePitchTypeVeloStatsFromAbReport({
          apiBase: ctx.apiBase, schoolCode: ctx.schoolCode, pitcher: input.pitcherName,
          pitchType: input.pitchType, startDate, endDate,
        });
        if (stats) {
          return JSON.stringify({
            player: normalizeName(input.pitcherName), window: { start: startDate, end: endDate },
            pitchType: input.pitchType, avgVelo: stats.avgVelo.toFixed(1), maxVelo: stats.maxVelo.toFixed(1), pitchCount: stats.pitchCount,
          });
        }
      }

      const gameDates = await fetchPitchingGameDates({
        apiBase: ctx.apiBase, schoolCode: ctx.schoolCode, pitcher: input.pitcherName, startDate, endDate,
      });
      const capped = gameDates.length > 20 ? gameDates.slice(gameDates.length - 20) : gameDates;
      return JSON.stringify({
        player: normalizeName(input.pitcherName),
        window: { start: startDate, end: endDate },
        availableGames: gameDates.length,
        gamesShown: capped,
        note: gameDates.length > capped.length ? `Showing the most recent ${capped.length} of ${gameDates.length} games. Call again with a specific gameKey for detail.` : 'Call again with a specific gameKey for pitch-by-pitch detail on one game.',
      });
    },
  });
}

function summarizeAbReportByPitchType(
  report: { pa_groups?: Array<{ pas?: Array<{ pitches?: Array<{ pitch_type?: string | null; velo?: number | null }> }> }> },
  onlyPitchType?: string
): Array<{ pitchType: string; count: number; avgVelo: string; maxVelo: string }> {
  const byType = new Map<string, { sum: number; count: number; max: number }>();
  const groups = Array.isArray(report.pa_groups) ? report.pa_groups : [];
  const onlyKey = onlyPitchType ? normalizeKey(onlyPitchType) : null;
  for (const group of groups) {
    const pas = Array.isArray(group.pas) ? group.pas : [];
    for (const pa of pas) {
      const pitches = Array.isArray(pa.pitches) ? pa.pitches : [];
      for (const pitch of pitches) {
        const type = normalizeText(String(pitch.pitch_type ?? 'Unknown'));
        if (onlyKey && normalizeKey(type) !== onlyKey) continue;
        const velo = typeof pitch.velo === 'number' ? pitch.velo : Number(pitch.velo);
        if (!Number.isFinite(velo)) continue;
        const entry = byType.get(type) ?? { sum: 0, count: 0, max: Number.NEGATIVE_INFINITY };
        entry.sum += velo;
        entry.count += 1;
        entry.max = Math.max(entry.max, velo);
        byType.set(type, entry);
      }
    }
  }
  return Array.from(byType.entries()).map(([pitchType, entry]) => ({
    pitchType,
    count: entry.count,
    avgVelo: (entry.sum / entry.count).toFixed(1),
    maxVelo: entry.max.toFixed(1),
  }));
}

// ---------------------------------------------------------------------------
// Tool list assembly
// ---------------------------------------------------------------------------

export type BuildToolsInput = {
  session: ChatSessionContext;
  role: 'admin' | 'coach' | 'player';
};

export function buildToolsForSession({ session, role }: BuildToolsInput): BetaRunnableTool<any>[] {
  const tools: BetaRunnableTool<any>[] = [
    buildSearchMetricsTool(),
    buildFindPageTool(role),
    buildGetPlayerStatTool(session),
    buildCompareSplitsTool(session),
    buildGetBestPitchByMetricTool(session),
    buildGetAbReportTool(session),
  ];
  if (!session.shouldScopePlayer) {
    tools.push(buildFindPlayerTool(session));
    tools.push(buildGetLeaderboardTool(session));
  }
  return tools;
}

// Retained for potential fallback name matching outside the tool loop (e.g. a
// last-ditch heuristic before returning "player not found").
export { pickPlayerFromQuestion };
