import { syncPitchFlightBackfill } from '../lib/pitch-flight-sync';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

syncPitchFlightBackfill({
  incremental: process.argv.includes('--incremental'),
  schoolCode: option('--school'),
  floorDate: option('--floor-date'),
  pitchEventsOnly: process.argv.includes('--pitch-events-only'),
  allDates: process.argv.includes('--all-dates'),
})
  .then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
