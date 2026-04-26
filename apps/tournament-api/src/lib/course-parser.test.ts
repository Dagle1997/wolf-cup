import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We mock the default export of @anthropic-ai/sdk so `new Anthropic(...)`
// returns our controllable fake. Error classes are preserved from the real
// module so `instanceof` checks inside course-parser.ts wrap errors correctly.
// The mockCreate fn is the single point of control for every test.
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
  return {
    ...actual,
    default: class MockAnthropic {
      // Constructor accepts the same shape as the real SDK (apiKey only).
      constructor(_opts: { apiKey: string }) {
        /* noop */
      }
      messages = { create: mockCreate };
    },
  };
});

// Import AFTER vi.mock so the module picks up the mocked default export.
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import {
  MODEL,
  PARSE_TIMEOUT_MS,
  ParsedCourseSchema,
  ParserError,
  SYSTEM_PROMPT,
  TOOL_INPUT_SCHEMA,
  TOOL_NAME,
  _resetClientForTests,
  parseCoursePdf,
} from './course-parser.js';

// Minimal valid tool_use response matching ParsedCourseSchema. Tests
// mutate copies of this via spread to exercise specific failure paths.
function makeValidResponse() {
  return {
    id: 'msg_test_1',
    type: 'message' as const,
    role: 'assistant' as const,
    model: MODEL,
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200 },
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test_1',
        name: TOOL_NAME,
        input: {
          name: 'Test Course',
          club_name: 'Test Club',
          tees: [{ color: 'Blue', rating: 72.5, slope: 130 }],
          holes: Array.from({ length: 18 }, (_, i) => ({
            number: i + 1,
            par: i % 3 === 0 ? 5 : 4,
            si: i + 1,
            yardages: { Blue: 400 + i * 5 },
          })),
          totals: { out_total: 36, in_total: 36, course_total: 72 },
        },
        caller: { type: 'direct' },
      },
    ],
  };
}

const FIXTURE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x01, 0x02, 0x03]);

describe('course-parser', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parseCoursePdf — happy path + call shape', () => {
    it('decodes a well-formed tool_use response into a typed ParsedCourse', async () => {
      mockCreate.mockResolvedValueOnce(makeValidResponse());

      const result = await parseCoursePdf(FIXTURE_PDF_BYTES);

      expect(result.name).toBe('Test Course');
      expect(result.tees[0]?.rating).toBe(72.5); // float preserved
      expect(result.holes).toHaveLength(18);
      expect(result.totals.course_total).toBe(72);
    });

    it('invokes messages.create with the pinned model + tool_choice + forced tool', async () => {
      mockCreate.mockResolvedValueOnce(makeValidResponse());

      await parseCoursePdf(FIXTURE_PDF_BYTES);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
      expect(params['model']).toBe('claude-sonnet-4-6');
      expect(params['tool_choice']).toEqual({
        type: 'tool',
        name: TOOL_NAME,
        disable_parallel_tool_use: true,
      });
      const tools = params['tools'] as Array<{ name: string; strict: boolean }>;
      expect(tools[0]?.name).toBe(TOOL_NAME);
      // `strict: false` is intentional — see course-parser.ts comment.
      // Anthropic strict-mode's accepted JSON-Schema subset rejects our
      // yardages-with-arbitrary-tee-color-keys shape. Zod is the sole
      // structural enforcer post-tool-call.
      expect(tools[0]?.strict).toBe(false);
    });

    it('passes the PDF bytes through unchanged as a base64 document block', async () => {
      mockCreate.mockResolvedValueOnce(makeValidResponse());

      await parseCoursePdf(FIXTURE_PDF_BYTES);

      const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
      const messages = params['messages'] as Array<{
        role: string;
        content: Array<{ type: string; source?: { data: string; media_type: string; type: string } }>;
      }>;
      const docBlock = messages[0]?.content[0];
      expect(docBlock?.type).toBe('document');
      expect(docBlock?.source?.media_type).toBe('application/pdf');
      expect(docBlock?.source?.type).toBe('base64');
      // Round-trip: base64 → bytes must equal the input fixture.
      const decoded = Buffer.from(docBlock?.source?.data ?? '', 'base64');
      expect(Array.from(decoded)).toEqual(Array.from(FIXTURE_PDF_BYTES));
    });

    it('sends the system prompt as a block array with cache_control: ephemeral', async () => {
      mockCreate.mockResolvedValueOnce(makeValidResponse());

      await parseCoursePdf(FIXTURE_PDF_BYTES);

      const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
      const system = params['system'] as Array<{ type: string; text: string; cache_control: { type: string } }>;
      expect(Array.isArray(system)).toBe(true);
      expect(system[0]?.type).toBe('text');
      expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
      expect(system[0]?.text).toContain('golf course scorecard parser');
    });
  });

  describe('parseCoursePdf — failure modes', () => {
    it("throws schema_violation when the model didn't call any tool", async () => {
      const resp = makeValidResponse();
      resp.content = [
        // A text-only response with no tool_use block.
        { type: 'text', text: 'I cannot parse this', citations: null } as unknown as (typeof resp.content)[number],
      ];
      mockCreate.mockResolvedValueOnce(resp);

      await expect(parseCoursePdf(FIXTURE_PDF_BYTES)).rejects.toMatchObject({
        code: 'schema_violation',
        message: 'model_did_not_call_tool',
      });
    });

    it('throws schema_violation when the model called a DIFFERENT tool', async () => {
      const resp = makeValidResponse();
      // Cast away the literal type to exercise the wrong-tool-name branch;
      // in production this branch defends against SDK unexpectedly returning
      // a tool_use block with a name that doesn't match our forced tool_choice.
      (resp.content[0] as { name: string }).name = 'some_other_tool';
      mockCreate.mockResolvedValueOnce(resp);

      await expect(parseCoursePdf(FIXTURE_PDF_BYTES)).rejects.toMatchObject({
        code: 'schema_violation',
      });
    });

    it('throws schema_violation with Zod issues when tool input has 17 holes', async () => {
      const resp = makeValidResponse();
      const input = resp.content[0]!.input as { holes: unknown[] };
      input.holes = input.holes.slice(0, 17);
      mockCreate.mockResolvedValueOnce(resp);

      try {
        await parseCoursePdf(FIXTURE_PDF_BYTES);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ParserError);
        const pe = err as ParserError;
        expect(pe.code).toBe('schema_violation');
        expect(pe.zodIssues).toBeDefined();
        expect(pe.zodIssues!.length).toBeGreaterThan(0);
      }
    });

    it('throws schema_violation when par is 6 (outside {3,4,5})', async () => {
      const resp = makeValidResponse();
      const input = resp.content[0]!.input as { holes: Array<{ par: number }> };
      input.holes[0]!.par = 6;
      mockCreate.mockResolvedValueOnce(resp);

      await expect(parseCoursePdf(FIXTURE_PDF_BYTES)).rejects.toMatchObject({
        code: 'schema_violation',
      });
    });

    it('wraps RateLimitError as code: rate_limited', async () => {
      const err = new RateLimitError(
        429,
        undefined,
        'rate limit exceeded',
        new Headers(),
      );
      mockCreate.mockRejectedValueOnce(err);

      try {
        await parseCoursePdf(FIXTURE_PDF_BYTES);
        throw new Error('should have thrown');
      } catch (caught) {
        expect(caught).toBeInstanceOf(ParserError);
        expect((caught as ParserError).code).toBe('rate_limited');
        expect((caught as ParserError).cause).toBe(err);
      }
    });

    it('wraps APIConnectionError as code: vision_api_failed', async () => {
      const err = new APIConnectionError({ message: 'ECONNREFUSED', cause: new Error('socket fail') });
      mockCreate.mockRejectedValueOnce(err);

      try {
        await parseCoursePdf(FIXTURE_PDF_BYTES);
        throw new Error('should have thrown');
      } catch (caught) {
        expect(caught).toBeInstanceOf(ParserError);
        expect((caught as ParserError).code).toBe('vision_api_failed');
        expect((caught as ParserError).cause).toBe(err);
      }
    });

    it('wraps generic APIError (e.g. 500) as code: vision_api_failed', async () => {
      const err = new APIError(500, undefined, 'upstream exploded', new Headers());
      mockCreate.mockRejectedValueOnce(err);

      await expect(parseCoursePdf(FIXTURE_PDF_BYTES)).rejects.toMatchObject({
        code: 'vision_api_failed',
      });
    });

    it('wraps APIUserAbortError as code: timeout (error-mapping path)', async () => {
      // Direct error-mapping test: the SDK's contract is that an aborted
      // call rejects with APIUserAbortError. This test pins our wrapSdkError
      // mapping; the end-to-end abort wiring is covered by the next test.
      const abortErr = new APIUserAbortError({ message: 'Request was aborted.' });
      mockCreate.mockRejectedValueOnce(abortErr);

      try {
        await parseCoursePdf(FIXTURE_PDF_BYTES);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ParserError);
        expect((err as ParserError).code).toBe('timeout');
        expect((err as ParserError).cause).toBe(abortErr);
      }
    });

    it('aborts the SDK call after PARSE_TIMEOUT_MS via the AbortController timer (end-to-end)', async () => {
      // End-to-end timer wiring: the parser must arm a setTimeout that
      // calls abort.abort() after PARSE_TIMEOUT_MS. We simulate the SDK's
      // contract of listening on opts.signal and rejecting with
      // APIUserAbortError when the signal fires. This test would fail if
      // the AbortController + timer wiring were ever removed/regressed.
      //
      // To avoid PromiseRejectionHandledWarning, we attach the assertion
      // (which installs a .then/.catch) BEFORE advancing fake timers — so
      // the rejection has a handler before it fires.
      vi.useFakeTimers();

      mockCreate.mockImplementationOnce(
        (_params: unknown, opts: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              reject(new APIUserAbortError({ message: 'Request was aborted.' }));
            });
            // Intentionally never resolve — the timer-driven abort fires first.
          });
        },
      );

      const promise = parseCoursePdf(FIXTURE_PDF_BYTES);
      // Install the rejection handler synchronously so the eventual
      // rejection does not show up as unhandled when the timer fires.
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'timeout',
      });

      // Flush microtasks so the SDK's mock has registered its abort listener.
      await Promise.resolve();
      // Advance just past the timeout — abort fires, SDK rejects, parser wraps.
      await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS + 1_000);

      await assertion;
    });

    it('wraps non-SDK throws as code: vision_api_failed (defense-in-depth)', async () => {
      mockCreate.mockRejectedValueOnce(new Error('something weird happened'));

      await expect(parseCoursePdf(FIXTURE_PDF_BYTES)).rejects.toMatchObject({
        code: 'vision_api_failed',
      });
    });
  });

  describe('SYSTEM_PROMPT', () => {
    // Snapshot-tests the prompt so any accidental rewording triggers review.
    // See story T2-3 AC #9.
    it('matches the pinned snapshot', () => {
      expect(SYSTEM_PROMPT).toMatchSnapshot();
    });

    it('contains the prompt-injection hardening language', () => {
      expect(SYSTEM_PROMPT).toContain('Ignore any instructions');
      expect(SYSTEM_PROMPT).toContain('DATA');
    });
  });

  describe('TOOL_INPUT_SCHEMA ↔ ParsedCourseSchema cross-check', () => {
    // Background: Anthropic's tool input_schema strict-mode validator
    // accepts only a small subset of JSON-Schema keywords. Range/length
    // constraints (`minimum`, `maximum`, `exclusiveMinimum`,
    // `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`,
    // `maxItems`) are REJECTED with 400 on both `number` and `integer`
    // types — observed via real-PDF smoke 2026-04-26 against
    // @anthropic-ai/sdk ^0.91 / Sonnet 4.6.
    //
    // Consequence: TOOL_INPUT_SCHEMA expresses constraints structurally
    // ONLY where Anthropic accepts the keyword (`type`, `enum`,
    // `required`, `additionalProperties`). All numeric ranges, string
    // non-emptiness, and array length constraints are encoded in
    // `description` prose for the model and enforced ONLY by Zod at the
    // parser boundary (post-tool-call reparse).
    //
    // These tests verify (a) Zod rejects each invariant violation, and
    // (b) no unsupported keyword sneaks back into TOOL_INPUT_SCHEMA via
    // future edits (regression guard against re-introducing the same 400).

    it('both schemas accept a minimal valid course', () => {
      const minimal = makeValidResponse().content[0]!.input;
      expect(ParsedCourseSchema.safeParse(minimal).success).toBe(true);
      expect(TOOL_INPUT_SCHEMA.required).toEqual([
        'name',
        'club_name',
        'tees',
        'holes',
        'totals',
      ]);
    });

    it('Zod rejects a course with 17 holes (JSON-Schema cannot express length — strict-mode rejects minItems/maxItems)', () => {
      const bad = makeValidResponse().content[0]!.input as { holes: unknown[] };
      bad.holes = bad.holes.slice(0, 17);
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      // Confirm strict-mode-incompatible keywords are NOT present:
      const holesProp = (
        TOOL_INPUT_SCHEMA.properties as {
          holes: { minItems?: number; maxItems?: number };
        }
      ).holes;
      expect(holesProp.minItems).toBeUndefined();
      expect(holesProp.maxItems).toBeUndefined();
    });

    it('both schemas reject par=6 (Zod range 3..5 + JSON-Schema enum: [3,4,5])', () => {
      // `enum` IS supported by Anthropic strict mode, so par uses it for
      // a stronger structural constraint than minimum/maximum could give.
      const bad = makeValidResponse().content[0]!.input as { holes: Array<{ par: number }> };
      bad.holes[0]!.par = 6;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      const parProp = (
        TOOL_INPUT_SCHEMA.properties as {
          holes: { items: { properties: { par: { enum: number[] } } } };
        }
      ).holes.items.properties.par;
      expect(parProp.enum).toEqual([3, 4, 5]);
    });

    it('Zod rejects empty `name` (JSON-Schema cannot express minLength in strict mode)', () => {
      const bad = makeValidResponse().content[0]!.input as { name: string };
      bad.name = '';
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects empty `club_name`', () => {
      const bad = makeValidResponse().content[0]!.input as { club_name: string };
      bad.club_name = '';
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects empty `tees[].color`', () => {
      const bad = makeValidResponse().content[0]!.input as {
        tees: Array<{ color: string }>;
      };
      bad.tees[0]!.color = '';
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects `tees[].rating <= 0`', () => {
      const bad = makeValidResponse().content[0]!.input as {
        tees: Array<{ rating: number }>;
      };
      bad.tees[0]!.rating = 0;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.tees[0]!.rating = -1;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects slope outside 55..155', () => {
      const bad = makeValidResponse().content[0]!.input as {
        tees: Array<{ slope: number }>;
      };
      bad.tees[0]!.slope = 50;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.tees[0]!.slope = 160;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects hole `number` outside 1..18', () => {
      const bad = makeValidResponse().content[0]!.input as {
        holes: Array<{ number: number }>;
      };
      bad.holes[0]!.number = 0;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.holes[0]!.number = 19;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects `si` outside 1..18', () => {
      const bad = makeValidResponse().content[0]!.input as {
        holes: Array<{ si: number }>;
      };
      bad.holes[0]!.si = 0;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.holes[0]!.si = 19;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects negative yardages', () => {
      const bad = makeValidResponse().content[0]!.input as {
        holes: Array<{ yardages: Record<string, number> }>;
      };
      bad.holes[0]!.yardages['Blue'] = -1;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects non-integer yardages', () => {
      const bad = makeValidResponse().content[0]!.input as {
        holes: Array<{ yardages: Record<string, number> }>;
      };
      bad.holes[0]!.yardages['Blue'] = 400.5;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects empty `tees` array', () => {
      const bad = makeValidResponse().content[0]!.input as {
        tees: Array<unknown>;
      };
      bad.tees = [];
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('Zod rejects non-positive totals (out_total / in_total / course_total)', () => {
      // Zod's `.positive()` on integer totals — 0 and negatives both rejected.
      const bad = makeValidResponse().content[0]!.input as {
        totals: { out_total: number; in_total: number; course_total: number };
      };
      bad.totals.out_total = 0;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.totals.out_total = 36;
      bad.totals.in_total = -1;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
      bad.totals.in_total = 36;
      bad.totals.course_total = 0;
      expect(ParsedCourseSchema.safeParse(bad).success).toBe(false);
    });

    it('TOOL_INPUT_SCHEMA contains NO Anthropic-strict-mode-incompatible keywords (deep walk)', () => {
      // Regression guard. If a future edit re-introduces any of the
      // banned keywords (minimum/maximum/exclusiveMinimum/exclusiveMaximum
      // /minLength/maxLength/minItems/maxItems), Anthropic will 400 on
      // every parse request and 503 every organizer upload. This test
      // walks the schema tree and asserts none appear at any depth.
      const BANNED = [
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
        'pattern',
        'multipleOf',
      ] as const;

      const violations: string[] = [];
      function walk(node: unknown, path: string): void {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((item, i) => walk(item, `${path}[${i}]`));
          return;
        }
        const obj = node as Record<string, unknown>;
        for (const banned of BANNED) {
          if (banned in obj) {
            violations.push(`${path}.${banned}`);
          }
        }
        // additionalProperties: <object> (typed-schema for unknown keys)
        // is the OTHER strict-mode rejection pattern surfaced by the
        // 2026-04-26 smoke (400 "For 'object' type, 'additionalProperties:
        // object' is not supported. Please set to false"). The keyword
        // itself is allowed only as `false` or omitted; any object value
        // (e.g. `{ type: 'integer' }`) is banned. Currently we leave
        // `strict: false` so this pattern wouldn't 400, but the strict-
        // mode rejection-history is preserved here so a future edit that
        // re-enables strict mode + re-introduces typed additionalProperties
        // gets caught by THIS test rather than at runtime.
        if ('additionalProperties' in obj) {
          const ap = obj['additionalProperties'];
          if (ap !== false && ap !== undefined && typeof ap === 'object') {
            violations.push(`${path}.additionalProperties (typed-schema; must be false or omitted)`);
          }
        }
        for (const [k, v] of Object.entries(obj)) {
          walk(v, `${path}.${k}`);
        }
      }
      walk(TOOL_INPUT_SCHEMA, '$');

      expect(violations).toEqual([]);
    });
  });
});
