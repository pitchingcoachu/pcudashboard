import { syncPitchFlightBackfill } from '../lib/pitch-flight-sync';

syncPitchFlightBackfill({ incremental: process.argv.includes('--incremental') })
  .then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
