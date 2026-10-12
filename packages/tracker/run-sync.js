#!/usr/bin/env node
// Build the backend first: pnpm --filter car-tracker-backend build.
// This runner shares live GPS persistence and durable Telegram claims.
try {
  const { runTrackerCli } = await import('../../backend/dist/cli/trackerSync.js');
  await runTrackerCli();
} catch {
  console.error('[tracker-cli] Unable to run backend sync. Build the backend and check its configuration.');
  process.exitCode = 1;
}
