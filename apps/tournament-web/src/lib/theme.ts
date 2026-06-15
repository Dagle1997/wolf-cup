/**
 * Theme management — light / dark / system.
 *
 * "system" (default) follows the OS via `prefers-color-scheme`; "light" /
 * "dark" are explicit overrides remembered in localStorage. The resolved
 * theme is applied by toggling a `.dark` class on <html>, which flips the
 * color tokens defined in index.css (Tailwind's dark variant keys off the
 * same class).
 *
 * The FIRST application happens in an inline <script> in index.html (before
 * React mounts) to avoid a flash of the wrong theme; this module owns the
 * runtime API + the system-change listener.
 */

export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'tournament-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage unavailable (private mode) — fall through to default */
  }
  return 'system';
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function resolveIsDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && prefersDark());
}

export function applyResolvedTheme(pref: ThemePref): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolveIsDark(pref));
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* ignore persistence failure — still apply for this session */
  }
  applyResolvedTheme(pref);
}

/**
 * Apply the stored preference and keep it in sync with OS changes while the
 * user is on "system". Returns an unsubscribe fn. Safe to call once at boot.
 */
export function initTheme(): () => void {
  applyResolvedTheme(getThemePref());
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemePref() === 'system') applyResolvedTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
