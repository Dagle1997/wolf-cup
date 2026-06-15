import { randomInt } from 'node:crypto';

/**
 * Per-player join codes (B0). Short, human-typeable, read-aloud-friendly.
 * Alphabet excludes look-alikes (0/O, 1/I/L) so a code texted or printed
 * isn't mis-typed. 6 chars over 31 symbols ≈ 887M combinations — collisions
 * are vanishingly rare and the DB UNIQUE on `code` is the backstop (callers
 * retry on the rare clash).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CODE_LEN = 6;

export function generateJoinCode(len = CODE_LEN): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Normalize user input for lookup: uppercase, strip anything not in the
 * alphabet (spaces, dashes the UI may add for readability). Returns '' if
 * nothing usable remains.
 */
export function normalizeJoinCode(input: string): string {
  const up = input.toUpperCase();
  let out = '';
  for (const ch of up) if (ALPHABET.includes(ch)) out += ch;
  return out;
}
