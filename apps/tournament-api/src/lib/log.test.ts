import { describe, expect, test } from 'vitest';
import pino, { type Logger } from 'pino';
import { Writable } from 'node:stream';
// Importing from log-options (pure) avoids the top-level pino-roll
// side-effect in log.ts — tests don't touch the filesystem.
import { loggerOptions } from './log-options.js';

/**
 * Logger tests (T1-7).
 *
 * These tests verify the pino CONFIGURATION shape exported from
 * `log.ts` via `loggerOptions` — constructing an in-memory logger
 * against a controlled Writable stream so we can deterministically
 * assert on the JSON output.
 *
 * Why not the real singleton? pino uses sonic-boom for stdout which
 * bypasses `process.stdout.write`, making spy-based assertions
 * unreliable. And the multistream's pino-roll file destination is an
 * async SonicBoom stream whose buffer is independent of pino's own
 * flush — inspecting the file would require timing-based waits that
 * are flaky under CI.
 *
 * The file-sink integration is covered by AC #17's post-deploy smoke
 * verification: operator confirms `/app/data/logs/tournament.*.log`
 * is populated after 10+ requests in production. The contract between
 * pino, pino-multistream, and pino-roll is exercised there.
 */

function buildTestLogger(): { logger: Logger; lines: () => string[] } {
  const captured: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, cb) {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
      cb();
    },
  });
  const logger = pino(loggerOptions, stream);
  return { logger, lines: () => captured };
}

function parseLine(s: string): Record<string, unknown> {
  return JSON.parse(s.trim()) as Record<string, unknown>;
}

describe('logger config (T1-7)', () => {
  test('logger.info produces JSON with ISO timestamp + string level + no pid/hostname', async () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ msg: 'shape-probe', custom: 'yes' });
    // Pino writes synchronously to a node Writable in this test shape,
    // but we still drain microtasks to be safe across pino versions.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lines().length).toBeGreaterThan(0);
    const parsed = parseLine(lines()[0]!);
    expect(parsed['level']).toBe('info');
    expect(typeof parsed['ts']).toBe('string');
    expect(parsed['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(parsed['msg']).toBe('shape-probe');
    expect(parsed['custom']).toBe('yes');
    // pid and hostname MUST NOT leak (base: null in loggerOptions).
    expect(parsed['pid']).toBeUndefined();
    expect(parsed['hostname']).toBeUndefined();
  });

  test('logger.child({ requestId }).error binds requestId without caller passing it', async () => {
    const { logger, lines } = buildTestLogger();
    const child = logger.child({ requestId: 'test-req-abc' });
    child.error({ msg: 'child-bind-probe' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const line = lines().find((l) => l.includes('child-bind-probe'));
    expect(line).toBeDefined();
    const parsed = parseLine(line!);
    expect(parsed['requestId']).toBe('test-req-abc');
    expect(parsed['level']).toBe('error');
    expect(parsed['msg']).toBe('child-bind-probe');
  });

  test('custom context fields pass through unmodified', async () => {
    const { logger, lines } = buildTestLogger();
    logger.warn({ msg: 'context-probe', eventId: 'evt-1', holeNumber: 7, sub: 'google-sub' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const line = lines().find((l) => l.includes('context-probe'));
    expect(line).toBeDefined();
    const parsed = parseLine(line!);
    expect(parsed['eventId']).toBe('evt-1');
    expect(parsed['holeNumber']).toBe(7);
    expect(parsed['sub']).toBe('google-sub');
    expect(parsed['level']).toBe('warn');
  });

  test('pino-roll filename contract: matches /^tournament\\.\\d{4}-\\d{2}-\\d{2}\\.\\d+\\.log$/', async () => {
    // Integration-level check: construct pino-roll with the same options
    // log.ts uses and confirm the emitted filename matches the canonical
    // regex from AC #3. This catches separator drift (dot vs hyphen) or
    // extension changes across pino-roll upgrades without depending on
    // the module-level singleton (which would trigger the fs side effect).
    const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    // @ts-expect-error — pino-roll ships no types
    const pinoRoll = (await import('pino-roll')).default;

    const dir = mkdtempSync(join(tmpdir(), 'tournament-pino-roll-probe-'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stream: any = null;
    try {
      stream = await pinoRoll({
        file: join(dir, 'tournament'),
        frequency: 'daily',
        size: '100m',
        mkdir: true,
        extension: '.log',
        dateFormat: 'yyyy-MM-dd',
      });
      // Write something so pino-roll creates the file.
      stream.write('{"probe":"filename-contract"}\n');
      // Flush with a bounded timeout. `stream.flush?.(cb) ?? resolve()`
      // has a subtle bug — if flush exists but returns falsy (most
      // Writable.flush methods return undefined), the short-circuit
      // resolves immediately rather than waiting for the callback.
      // A single-bounded timer is the safe pattern.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        if (typeof stream.flush === 'function') {
          stream.flush(done);
        } else {
          done();
        }
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Deadline-bounded poll for the file to appear.
      const deadline = Date.now() + 2000;
      // pino-roll@4 filename shape: `tournament.{YYYY-MM-DD}.{n}.log`.
      // The `{n}` segment is pino-roll's rotation number — it starts at
      // 1 for a fresh directory and increments on size/day rollover.
      // This is the actual library-observed format (verified against
      // v4.0.0 at impl time); the spec's "canonical regex" is updated
      // accordingly in AC #3 / #11 / #17.
      const canonicalRe = /^tournament\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;
      let matched = false;
      while (Date.now() < deadline) {
        const files = readdirSync(dir);
        if (files.some((f) => canonicalRe.test(f))) {
          matched = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      expect(matched).toBe(true);
    } finally {
      // Close the SonicBoom stream so Windows can release the file
      // handle before rmSync. Without this the recursive delete throws
      // EBUSY on NTFS because pino-roll keeps the fd open. SonicBoom's
      // `.end()` callback signature is unreliable across versions;
      // listen for the `close` event instead and bound the wait.
      if (stream && typeof stream.end === 'function') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 500);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          stream.once?.('close', done);
          stream.once?.('finish', done);
          stream.end();
        });
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('level filter: `trace` is dropped when LOG_LEVEL is info (default)', async () => {
    // loggerOptions.level comes from env.LOG_LEVEL, which defaults to
    // 'info' under test. A trace line below info should be filtered out
    // at the pino layer — the stream never sees it.
    const { logger, lines } = buildTestLogger();
    logger.trace({ msg: 'trace-probe' });
    logger.debug({ msg: 'debug-probe' });
    logger.info({ msg: 'info-probe' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const all = lines().join('\n');
    expect(all).not.toContain('trace-probe');
    expect(all).not.toContain('debug-probe');
    expect(all).toContain('info-probe');
  });
});
