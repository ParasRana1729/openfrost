import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../types.js';

/**
 * Activity feed. The SSE stream is authenticated by the same session guard
 * as every other /api route; the origin guard rejects foreign origins.
 */
export const makeEventRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/events', async (request) => {
    const query = request.query as { limit?: string };
    const requested = Number(query.limit ?? 50);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 200) : 50;
    return { events: ctx.store.events.listRecent(limit) };
  });

  app.get('/events/stream', { logLevel: 'warn' }, (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    // reply.hijack() discards the headers @fastify/cors already set on the
    // reply, so a cross-origin EventSource would be refused by the browser.
    // The root origin guard has already validated Origin against the
    // allowlist; echo it back for browser clients.
    const headers: Record<string, string> = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    };
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
    }
    response.writeHead(200, headers);
    response.write('retry: 3000\n\n');
    const unsubscribe = ctx.bus.subscribe((event) => {
      response.write(
        `id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`,
      );
    });
    const heartbeat = setInterval(() => {
      response.write(': heartbeat\n\n');
    }, 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
};
