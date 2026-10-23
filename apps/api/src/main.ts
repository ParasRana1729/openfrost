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
  const { app, executor } = built;

  await app.listen({ port: config.port, host: config.host });

  const recovery = executor.recover();
  if (recovery.dispatchPaused) {
    app.log.warn(
      { interruptedRuns: recovery.interruptedRuns },
      'dispatch paused after recovery; owner review required at /api/dispatch',
    );
  } else {
    void executor.kick();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down; in-flight runs are marked interrupted');
    try {
      await closeBuiltApp(built);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
