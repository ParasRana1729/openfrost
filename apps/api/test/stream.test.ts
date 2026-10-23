import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupOwner, startApp, type TestApp } from './helpers.js';

let app: TestApp;
let base: string;

beforeAll(async () => {
  app = await startApp();
  await setupOwner(app);
  await app.built.app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.built.app.addresses()[0];
  expect(address?.address).toBe('127.0.0.1');
  expect(address?.port).toBeGreaterThan(0);
  base = `http://127.0.0.1:${address!.port}`;
});

afterAll(async () => {
  await app.close();
});

describe('loopback binding and authenticated SSE', () => {
  it('rejects unauthenticated stream access', async () => {
    const anonymous = await fetch(`${base}/api/events/stream`);
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();
  });

  it('sends CORS headers on the hijacked stream for allowlisted browser origins', async () => {
    // Regression: reply.hijack() used to discard the CORS headers, so the
    // browser refused the cross-origin EventSource and the UI silently ran
    // on its polling fallback.
    const stream = await fetch(`${base}/api/events/stream`, {
      headers: { origin: 'http://127.0.0.1:3000', cookie: app.cookie! },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3000',
    );
    expect(stream.headers.get('access-control-allow-credentials')).toBe('true');
    await stream.body?.cancel();
  });

  it('streams activity events to authenticated owners', async () => {
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/events/stream`, {
      headers: { cookie: app.cookie! },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');

    const reader = stream.body!.getReader();
    const create = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: app.cookie!,
        'x-csrf-token': app.csrfToken!,
      },
      body: JSON.stringify({ title: 'Streamed', request: 'stream me' }),
    });
    expect(create.status).toBe(202);

    const decoder = new TextDecoder();
    let received = '';
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      received += decoder.decode(value, { stream: true });
      if (received.includes('task.created')) {
        break;
      }
    }
    controller.abort();
    expect(received).toContain('event: activity');
    expect(received).toContain('task.created');
  });
});
