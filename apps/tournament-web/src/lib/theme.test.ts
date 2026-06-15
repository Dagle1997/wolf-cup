import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getThemePref,
  resolveIsDark,
  setThemePref,
  THEME_STORAGE_KEY,
} from './theme';

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('default preference is system when nothing stored', () => {
    expect(getThemePref()).toBe('system');
  });

  test('getThemePref returns a stored valid value, ignores garbage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getThemePref()).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'nonsense');
    expect(getThemePref()).toBe('system');
  });

  test('resolveIsDark: explicit overrides win; system follows the OS', () => {
    mockMatchMedia(false);
    expect(resolveIsDark('dark')).toBe(true);
    expect(resolveIsDark('light')).toBe(false);
    expect(resolveIsDark('system')).toBe(false);
    mockMatchMedia(true);
    expect(resolveIsDark('system')).toBe(true);
    expect(resolveIsDark('light')).toBe(false); // override beats OS
  });

  test('setThemePref persists and toggles the .dark class', () => {
    mockMatchMedia(false);
    setThemePref('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setThemePref('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // system + OS dark → class on
    mockMatchMedia(true);
    setThemePref('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
