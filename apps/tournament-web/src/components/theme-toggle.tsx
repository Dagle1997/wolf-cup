/**
 * Theme toggle — cycles Light → Dark → System (System = follow the OS).
 * Persists via lib/theme.ts. Lives in GlobalNav so it's reachable on every
 * non-suppressed page.
 */
import { useEffect, useState } from 'react';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

const NEXT: Record<ThemePref, ThemePref> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABEL: Record<ThemePref, { icon: string; text: string }> = {
  light: { icon: '☀️', text: 'Light' },
  dark: { icon: '🌙', text: 'Dark' },
  system: { icon: '🖥️', text: 'Auto' },
};

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');

  // Hydrate from storage after mount (avoids SSR/initial-render mismatch).
  useEffect(() => {
    setPref(getThemePref());
  }, []);

  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    setThemePref(next);
  }

  const { icon, text } = LABEL[pref];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${text}. Tap to change.`}
      title={`Theme: ${text}`}
      data-testid="theme-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 'var(--control-height)',
        padding: '0 8px',
        background: 'transparent',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 'var(--font-sm)',
      }}
    >
      <span aria-hidden>{icon}</span>
      <span>{text}</span>
    </button>
  );
}
