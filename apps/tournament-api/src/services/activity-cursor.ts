/**
 * T8-2 activity-feed cursor codec. Used by the GET /api/events/:eventId/activity
 * endpoint AND any future consumer that needs to round-trip a stable
 * pagination handle.
 *
 * Cursor format: `base64url(JSON.stringify({createdAt, id}))`. Compound
 * `(createdAt, id)` lets the SQL pagination tie-break same-millisecond
 * rows via `id ASC` (after-mode) or `id DESC` (before-mode).
 *
 * The cursor is OPAQUE to the client. Server is the only legitimate
 * encoder/decoder. Malformed input → throws `InvalidCursorError`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export interface CursorPosition {
  createdAt: number;
  id: string;
}

export function encodeCursor(pos: CursorPosition): string {
  const payload = JSON.stringify({ createdAt: pos.createdAt, id: pos.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPosition {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new InvalidCursorError('cursor must be a non-empty string');
  }
  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError('cursor is not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError('cursor payload is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new InvalidCursorError('cursor payload must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['createdAt'] !== 'number' || !Number.isInteger(obj['createdAt'])) {
    throw new InvalidCursorError('cursor.createdAt must be an integer');
  }
  if (typeof obj['id'] !== 'string' || !UUID_RE.test(obj['id'])) {
    throw new InvalidCursorError('cursor.id must be a UUID');
  }
  return { createdAt: obj['createdAt'], id: obj['id'] };
}
