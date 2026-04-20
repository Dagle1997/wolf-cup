import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { resolvePort } from './port.js';

describe('resolvePort', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  // --- missing input: no warning, silent fallback -----------------------

  test('defaults to 3000 when PORT is undefined', () => {
    expect(resolvePort(undefined)).toBe(3000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('defaults to 3000 when PORT is empty string', () => {
    expect(resolvePort('')).toBe(3000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // --- non-numeric inputs: parseInt would be permissive; guard rejects --

  test('rejects purely non-numeric input ("abc")', () => {
    expect(resolvePort('abc')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="abc"; falling back to 3000');
  });

  test('rejects partial-numeric input ("3001abc") — parseInt would accept', () => {
    expect(resolvePort('3001abc')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="3001abc"; falling back to 3000');
  });

  test('rejects float-form input ("3001.5")', () => {
    expect(resolvePort('3001.5')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="3001.5"; falling back to 3000');
  });

  test('rejects scientific-notation input ("3e3")', () => {
    expect(resolvePort('3e3')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="3e3"; falling back to 3000');
  });

  test('rejects leading-whitespace input (" 3001")', () => {
    expect(resolvePort(' 3001')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT=" 3001"; falling back to 3000');
  });

  test('rejects trailing-whitespace input ("3001 ")', () => {
    expect(resolvePort('3001 ')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="3001 "; falling back to 3000');
  });

  test('rejects leading-plus input ("+3001")', () => {
    expect(resolvePort('+3001')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="+3001"; falling back to 3000');
  });

  test('rejects negative-sign input ("-1")', () => {
    expect(resolvePort('-1')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="-1"; falling back to 3000');
  });

  test('rejects non-ASCII unicode digits (arabic-indic "\\u0660") — regex is ASCII-only by design', () => {
    // JS regex \d matches only [0-9] (ASCII), not Unicode digit categories.
    // This test locks in the ASCII-only contract: env vars carrying
    // non-ASCII digit characters are treated as invalid and fall back.
    expect(resolvePort('\u0660')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="\u0660"; falling back to 3000');
  });

  // --- out-of-range integers: regex passes, range check rejects ---------

  test('rejects zero ("0")', () => {
    expect(resolvePort('0')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="0"; falling back to 3000');
  });

  test('rejects PORT above 65535 ("99999")', () => {
    expect(resolvePort('99999')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Invalid PORT="99999"; falling back to 3000');
  });

  test('rejects very-large numeric string ("99999999999999999999")', () => {
    expect(resolvePort('99999999999999999999')).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid PORT="99999999999999999999"; falling back to 3000',
    );
  });

  // --- valid inputs: no warning ------------------------------------------

  test('accepts mid-range PORT ("3001")', () => {
    expect(resolvePort('3001')).toBe(3001);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('accepts upper boundary PORT ("65535")', () => {
    expect(resolvePort('65535')).toBe(65535);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('accepts lower boundary PORT ("1")', () => {
    expect(resolvePort('1')).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('accepts leading-zero PORT ("03001") — interpreted as decimal 3001', () => {
    expect(resolvePort('03001')).toBe(3001);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
