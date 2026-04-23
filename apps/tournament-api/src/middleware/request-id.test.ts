import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from './request-id.js';

function buildApp() {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.get('/probe', (c) => {
    // Return both values so tests can assert on the ctx-set shape.
    return c.json({
      requestId: c.get('requestId'),
      // `c.get('logger')` is a pino Logger; we don't serialize it here —
      // the presence of `logger.info` on ctx is enough.
      hasLogger: typeof c.get('logger')?.info === 'function',
    });
  });
  return app;
}

describe('requestIdMiddleware (T1-7)', () => {
  test('generates a UUID when no X-Request-Id header is present', async () => {
    const app = buildApp();
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requestId: string; hasLogger: boolean };
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.hasLogger).toBe(true);
    // Outbound header carries the same id.
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
  });

  test('reuses a valid incoming X-Request-Id', async () => {
    const app = buildApp();
    const incoming = 'client-provided-abc-123';
    const res = await app.request('/probe', {
      headers: { 'x-request-id': incoming },
    });
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(incoming);
    expect(res.headers.get('x-request-id')).toBe(incoming);
  });

  test('rejects malformed X-Request-Id and generates a fresh UUID', async () => {
    const app = buildApp();
    // Note: we can't include literal newlines or CR in the test header
    // because the Fetch Headers API rejects them at construction time
    // (that's defense-in-depth at a higher layer). The middleware's
    // regex still needs to reject whitespace + separator characters
    // that DO pass Headers validation but would be log-injection vectors.
    const malformedCases = [
      'has space',
      'has;semicolon',
      'has"quote',
      'has\\backslash',
      'has/slash',
      'a'.repeat(129), // >128 chars
      '', // empty string — treated as absent
    ];
    for (const bad of malformedCases) {
      const res = await app.request('/probe', {
        headers: { 'x-request-id': bad },
      });
      const body = (await res.json()) as { requestId: string };
      // Whatever we got, it's NOT the malformed input.
      expect(body.requestId).not.toBe(bad);
      // And it's a UUID.
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test('sets request-scoped child logger on ctx with requestId bound', async () => {
    // Verify via downstream handler that `c.get('logger')` is a pino
    // child logger whose `.bindings()` returns the expected requestId.
    // Pino's sonic-boom destination bypasses vitest's stdout wrapping,
    // so we can't spy on stdout output directly — we assert the logger
    // shape/bindings instead. log.test.ts already pins the end-to-end
    // child-logger-emits-requestId contract via the file-sink probe.
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.get('/log', (c) => {
      const ctxLogger = c.get('logger');
      return c.json({
        bindings: ctxLogger.bindings(),
        hasError: typeof ctxLogger.error === 'function',
      });
    });

    const res = await app.request('/log', {
      headers: { 'x-request-id': 'probe-req-xyz' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bindings: Record<string, unknown>;
      hasError: boolean;
    };
    expect(body.bindings['requestId']).toBe('probe-req-xyz');
    expect(body.hasError).toBe(true);
  });

  test('outbound X-Request-Id matches the id stored on ctx', async () => {
    const app = buildApp();
    const res = await app.request('/probe');
    const body = (await res.json()) as { requestId: string };
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
  });
});
