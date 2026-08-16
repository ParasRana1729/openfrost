import { createHealthCheck } from "@openfrost/domain";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { getApiEnv } from "./env.js";

export function createApiServer() {
  const env = getApiEnv();
  const app = Fastify({ logger: env.NODE_ENV !== "test" });

  app.get("/health", () => createHealthCheck("api", "ok"));

  return { app, env };
}

export async function startApiServer() {
  const { app, env } = createApiServer();
  const address = await app.listen({
    host: env.OPENFROST_API_HOST,
    port: env.OPENFROST_API_PORT,
  });

  return { app, address };
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  startApiServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`Failed to start OpenFrost API: ${message}\n`);
    process.exit(1);
  });
}
