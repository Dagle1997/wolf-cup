/**
 * T11-1 ErrorCard — uniform error-display primitive with display-safe
 * extraction from arbitrary `error` shapes.
 *
 * Extraction precedence (locked per spec; step 4 gated post-party
 * per Josh's 2026-05-20 party-clarification decision to fall primitives
 * through to the literal fallback rather than render their JSON form):
 *   1. Error.message
 *   2. string passthrough
 *   3. { message: string } property on object
 *   4. JSON.stringify — ONLY for non-null objects (gated); try/catch
 *      around circular-ref throws; reject undefined return + '{}' literal
 *   5. literal 'Unknown error' fallback — catches every primitive
 *      (undefined, null, number, boolean, bigint, symbol, function)
 *      and every object that fell through step 4
 *
 * NEVER calls String(error) directly — yields '[object Object]' which is
 * bad UX. NEVER throws regardless of input.
 *
 * Optional onRetry prop renders a retry button below the message.
 */
import type { CSSProperties } from 'react';

export type ErrorCardProps = {
  error: unknown;
  title?: string;
  onRetry?: () => void;
};

const cardStyle: CSSProperties = {
  textAlign: 'center',
  padding: 24,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-danger)',
  borderRadius: 8,
};

function extractMessage(error: unknown): string {
  // Step 1: Error instance.
  if (error instanceof Error) return error.message;
  // Step 2: string passthrough.
  if (typeof error === 'string') return error;
  // Step 3: object with .message string.
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  // Step 4: JSON.stringify, defensively — ONLY for non-null objects.
  // T11-1 party-clarification (Josh decision 2026-05-20): primitives like
  // null / 42 / true / Symbol render as 'null' / '42' / 'true' under
  // JSON.stringify, which is technically per-spec but mediocre UX in an
  // error card. Gate JSON.stringify behind a non-null object check so
  // primitives fall through to the 'Unknown error' literal instead.
  if (typeof error === 'object' && error !== null) {
    try {
      const json = JSON.stringify(error);
      // JSON.stringify returns undefined for circular refs (not raised here
      // because we try/catch), and '{}' for empty plain objects with no
      // own enumerable keys.
      if (typeof json === 'string' && json !== '{}') {
        return json;
      }
    } catch {
      // Circular reference or other JSON failure — fall through.
    }
  }
  // Step 5: literal fallback. Reached for: undefined, null, numbers, booleans,
  // strings already short-circuited above (steps 1-3), bigints, symbols,
  // functions, empty {}, and any object that JSON.stringify failed on.
  return 'Unknown error';
}

export function ErrorCard({ error, title = 'Something went wrong', onRetry }: ErrorCardProps) {
  const message = extractMessage(error);
  return (
    <div role="alert" style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-lg)', color: 'var(--color-danger)' }}>
        {title}
      </h2>
      <p
        style={{
          margin: '8px 0 0 0',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--font-sm)',
          wordBreak: 'break-word',
        }}
      >
        {message}
      </p>
      {onRetry ? (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
