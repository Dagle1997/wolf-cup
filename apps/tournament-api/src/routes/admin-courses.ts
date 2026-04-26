/**
 * T2-3 admin-courses router. Single route: POST /api/admin/courses/parse-pdf.
 *
 * Uploads a scorecard PDF → Anthropic Vision → structured JSON. Output is
 * NOT persisted (T2.5's admin UI persists after human review).
 *
 * Middleware chain (order matters):
 *   requireSession → requireOrganizer → bodyLimit → handler
 *
 * - Auth BEFORE bodyLimit: anonymous / non-organizer callers are rejected
 *   via header-only reads (cookie check) without consuming any request body,
 *   minimizing DoS surface to authenticated attackers (organizer-only in v1).
 * - bodyLimit: 10 MiB + 64 KiB multipart-framing slack. Strict 10 MiB
 *   PDF-file ceiling is enforced by the post-parse handler check —
 *   bodyLimit rejects total body >10.06 MiB so an actual 10 MiB PDF passes
 *   through. The middleware's default 413 is mapped to the route's
 *   consistent 400 `file_too_large` shape via onError.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import {
  type ParsedCourse,
  ParserError,
  detectContentKind,
  parseCoursePdf,
} from '../lib/course-parser.js';

// 10 MiB (strict PDF-file ceiling enforced at the handler-level post-parse
// check). The bodyLimit middleware cap below adds 64 KiB multipart-framing
// slack so a 10 MiB PDF wrapped in multipart headers still passes through.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const BODY_LIMIT_MAX_BYTES = MAX_PDF_BYTES + 65_536;

// MIME-class allowlist for the soft pre-filter (T2-3a). Magic-byte
// detection is authoritative; this just rejects obvious non-payload MIMEs
// before we waste cycles buffering. HEIC/HEIF/GIF are deliberately
// included so the request reaches `detectContentKind` where we return
// the friendly tailored error codes (`unsupported_mime_heic`/`_gif`).
// Without HEIC/HEIF/GIF in this list those friendly codes would be
// unreachable — the request would be rejected at this stage with a
// generic `wrong_mime`. (Round-1 codex HIGH #1 — preserved as a regression
// hazard via test coverage.)
const ACCEPTED_MIMES = new Set([
  '',                          // some clients omit per-part Content-Type
  'application/pdf',           // T2-3 baseline
  'application/octet-stream',  // de-facto default in many clients
  'image/jpeg',                // T2-3a
  'image/jpg',                 // T2-3a — non-standard alias some clients emit
  'image/png',                 // T2-3a
  'image/webp',                // T2-3a
  'image/heic',                // T2-3a — accepted at MIME stage so magic-byte can return unsupported_mime_heic
  'image/heif',                // T2-3a — same family as HEIC; magic-byte returns unsupported_mime_heic
  'image/gif',                 // T2-3a — accepted at MIME stage so magic-byte can return unsupported_mime_gif
]);

export const adminCoursesRouter = new Hono();

adminCoursesRouter.post(
  '/courses/parse-pdf',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: BODY_LIMIT_MAX_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_upload', code: 'file_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');

    // Parse multipart body. Hono's parseBody returns a plain object where
    // file fields are `File` (Web Fetch API) instances.
    const body = await c.req.parseBody({ all: false });
    const pdf = body['pdf'];

    if (!pdf || !(pdf instanceof File)) {
      return c.json(
        { error: 'bad_upload', code: 'missing_file', requestId },
        400,
      );
    }

    // Defense-in-depth size re-check (bodyLimit already rejected
    // oversize bodies, but a runtime / parser quirk could bypass it).
    if (pdf.size > MAX_PDF_BYTES) {
      return c.json(
        { error: 'bad_upload', code: 'file_too_large', requestId },
        400,
      );
    }

    // MIME validation (SOFT pre-filter) — extract full type/subtype,
    // lowercase, trim, and check against ACCEPTED_MIMES. Empty +
    // application/octet-stream tolerated (some clients omit MIME or
    // default to octet-stream). HEIC/HEIF/GIF accepted here so the
    // request reaches `detectContentKind` where it returns the friendly
    // tailored error code rather than generic wrong_mime.
    const mainType = (pdf.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ACCEPTED_MIMES.has(mainType)) {
      return c.json(
        { error: 'bad_upload', code: 'wrong_mime', requestId },
        400,
      );
    }

    // Buffer once. 10 MiB max is bounded by the checks above.
    const bytes = new Uint8Array(await pdf.arrayBuffer());

    // Magic-byte detection (T2-3a) — bytes-only authoritative classifier.
    // Declared MIME from the prior step is NOT re-consulted: if the bytes
    // start with %PDF we parse as PDF regardless of declared MIME, and
    // vice versa. This matches T2-3's posture (broad MIME accept, trust
    // bytes). Discriminator narrowed exhaustively below — TypeScript
    // would fail to compile if a new MagicByteResult variant were added
    // without updating this switch.
    const detected = detectContentKind(bytes);
    let parseKind: { kind: 'pdf' } | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
    let inputKind: 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
    switch (detected.kind) {
      case 'pdf':
        parseKind = { kind: 'pdf' };
        inputKind = 'pdf';
        break;
      case 'image':
        parseKind = { kind: 'image', mime: detected.mime };
        inputKind = detected.mime;
        break;
      case 'unsupported_image':
        return c.json(
          {
            error: 'bad_upload',
            code: detected.mime === 'image/heic'
              ? 'unsupported_mime_heic'
              : 'unsupported_mime_gif',
            requestId,
          },
          400,
        );
      case 'mismatch':
        return c.json(
          { error: 'bad_upload', code: 'wrong_magic', requestId },
          400,
        );
    }

    // Invoke parser. Any failure → 503. Sub-codes are logged for
    // operator diagnosis but NOT leaked to the client.
    let parsed: ParsedCourse;
    try {
      parsed = await parseCoursePdf(bytes, parseKind);
    } catch (err) {
      const errorCode =
        err instanceof ParserError ? err.code : 'unknown';
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      // Per AC #8, surface the underlying cause via `toString()` so the
      // operator log captures the SDK error class name + status, not just
      // its `.message`. Stays in logs only — never sent in the HTTP body.
      // Reads `.cause` off any `Error` (not just `ParserError`) so the
      // defense-in-depth path keeps cause context too.
      const causeValue =
        err instanceof Error
          ? (err as Error & { cause?: unknown }).cause
          : undefined;
      const cause = causeValue !== undefined ? String(causeValue) : undefined;
      log.error({
        event: 'vision_parse_failed',
        fileSize: pdf.size,
        errorCode,
        errorMessage,
        ...(cause !== undefined ? { cause } : {}),
      });
      return c.json(
        {
          error: 'parser_unavailable',
          code: 'vision_api_failed',
          requestId,
        },
        503,
      );
    }

    log.info({
      event: 'vision_parse_success',
      fileSize: pdf.size,
      inputKind, // T2-3a: 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
      courseName: parsed.name,
      teeCount: parsed.tees.length,
      holeCount: parsed.holes.length,
    });

    return c.json(parsed, 200);
  },
);
