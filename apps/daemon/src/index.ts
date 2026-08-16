import { fileURLToPath } from "node:url";
import { getDaemonEnv } from "./env.js";

export type DaemonTick = {
  at: string;
  pollMs: number;
};

export function createDaemonTick(now: Date = new Date()): DaemonTick {
  const env = getDaemonEnv();
  return {
    at: now.toISOString(),
    pollMs: env.OPENFROST_DAEMON_POLL_MS,
  };
}

export function startDaemonLoop(onTick: (tick: DaemonTick) => void = defaultTickLogger) {
  const env = getDaemonEnv();
  onTick(createDaemonTick());

  const timer = setInterval(() => {
    onTick(createDaemonTick());
  }, env.OPENFROST_DAEMON_POLL_MS);

  return () => {
    clearInterval(timer);
  };
}

function defaultTickLogger(tick: DaemonTick): void {
  process.stdout.write(`OpenFrost daemon tick at ${tick.at}\n`);
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    startDaemonLoop();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`Failed to start OpenFrost daemon: ${message}\n`);
    process.exit(1);
  }
}
