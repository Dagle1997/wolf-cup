import { describe, expect, test } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  InvalidCursorError,
} from './activity-cursor.js';

describe('activity-cursor', () => {
  test('round-trip: encode then decode yields the original payload', () => {
    const pos = {
      createdAt: 1778000000000,
      id: '12345678-1234-4234-8234-123456789012',
    };
    const enc = encodeCursor(pos);
    const dec = decodeCursor(enc);
    expect(dec).toEqual(pos);
  });

  test('encoded cursor is base64url (no +, /, or padding)', () => {
    const enc = encodeCursor({
      createdAt: 1778000000000,
      id: '12345678-1234-4234-8234-123456789012',
    });
    expect(enc).not.toMatch(/[+/=]/);
  });

  test('decode rejects empty string', () => {
    expect(() => decodeCursor('')).toThrow(InvalidCursorError);
  });

  test('decode rejects non-base64 garbage', () => {
    // Strings with characters outside base64url alphabet decode to
    // unexpected JSON; we test that whatever falls out fails the JSON
    // or shape gate.
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(InvalidCursorError);
  });

  test('decode rejects valid base64 of non-JSON', () => {
    const notJson = Buffer.from('hello world', 'utf8').toString('base64url');
    expect(() => decodeCursor(notJson)).toThrow(InvalidCursorError);
  });

  test('decode rejects valid JSON missing createdAt', () => {
    const bad = Buffer.from(
      JSON.stringify({ id: '12345678-1234-4234-8234-123456789012' }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/createdAt/);
  });

  test('decode rejects valid JSON missing id', () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: 1778000000000 }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/id/);
  });

  test('decode rejects createdAt that is not an integer', () => {
    const bad = Buffer.from(
      JSON.stringify({
        createdAt: 1.5,
        id: '12345678-1234-4234-8234-123456789012',
      }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/integer/);
  });

  test('decode rejects id that is not a UUID', () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: 1778000000000, id: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/UUID/);
  });

  test('decode rejects array payload', () => {
    const bad = Buffer.from(
      JSON.stringify([1778000000000, '12345678-1234-4234-8234-123456789012']),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });
});
