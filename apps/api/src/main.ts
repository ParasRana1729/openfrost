import { buildApp, closeBuiltApp } from './app.js';
import { loadConfig } from './config.js';

/**
 * Local API entrypoint. Binds to loopback only, recovers interrupted runs
 * from previous sessions, and pauses dispatch for owner review if any were
 * found. Provider wiring arrives with the S02 research slice.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const built = await buildApp({ config });
  const { app, executor, scheduler } = built;

  // Recover before listening: no request can precede recovery, and dispatch
  // is already paused for review when the first request arrives.
  const recovery = executor.recover();
  if (recovery.dispatchPaused) {
    app.log.warn(
      { interruptedRuns: recovery.interruptedRuns },
      'dispatch paused after recovery; owner review required at /api/dispatch',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // A second signal means the owner wants out even if closing hangs.
      process.exit(1);
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down; in-flight runs are marked interrupted');
    try {
      await closeBuiltApp(built);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });

  if (!recovery.dispatchPaused) {
    void executor.kick();
  }
  // Routines run without an open browser: the tick dispatches due
  // occurrences into the global queue (a paused dispatch simply holds them).
  scheduler.start();
}

main().catch((err) => {
  console.error('OpenFrost API failed to start:', err);
  process.exit(1);
});
