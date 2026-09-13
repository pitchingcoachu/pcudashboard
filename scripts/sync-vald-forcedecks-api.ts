import { runForcePlateSync } from '../lib/force-plate-sync-runner';

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function main(): Promise<void> {
  const organizationId = positiveInt('FORCE_PLATE_SYNC_ORGANIZATION_ID', 1);
  const schoolCode = String(process.env.FORCE_PLATE_SYNC_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
  const lookbackDays = positiveInt('FORCE_PLATE_SYNC_DAILY_LOOKBACK_DAYS', 5);
  const result = await runForcePlateSync({
    organizationId,
    schoolCode,
    assignedCoachUserId: null,
    playerBatchSizeOverride: 10_000,
    maxRunSecondsOverride: positiveInt('FORCE_PLATE_SYNC_MAX_RUN_SECONDS', 3_300),
    lookbackDaysOverride: lookbackDays,
    testsWindowDaysOverride: Math.min(lookbackDays, positiveInt('FORCE_PLATE_SYNC_WINDOW_DAYS', 5)),
    recentTestLimitOverride: 10_000,
    // Fetch every trial attached to every test in the five-day window. The
    // summary endpoint alone does not contain left/right, asymmetry, repeats,
    // or every calculated ForceDecks result.
    trialFetchLimitOverride: 0,
    multiPlayerTrialFetchLimitOverride: 10_000,
    trialFetchConcurrencyOverride: positiveInt('VALD_TRIAL_FETCH_CONCURRENCY', 4),
  });
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
