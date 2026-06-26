/**
 * B0 — public "join with a code" screen. No Google login required.
 *
 * A player enters the per-player code their organizer gave them → POST
 * /api/join binds this device to that player (device cookie) → they're
 * authenticated app-wide via the requireSession device bridge, and we send
 * them to their event home.
 *
 * PUBLIC route — no beforeLoad auth check (the whole point is no SSO).
 */
import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [state, setState] = useState<
    | { kind: 'idle' | 'joining' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // One-click join: a personal link of the form /join?code=ABC123 (what the
  // organizer's "Copy invite" sends) pre-fills the code and submits on its own,
  // so tapping the texted link joins with no typing. A bad/expired code falls
  // back to the normal manual screen with the code pre-filled to retry.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('code');
    const trimmed = fromUrl?.trim();
    if (trimmed && trimmed.length >= 4) {
      setCode(trimmed);
      void submit(trimmed);
    }
  }, []);

  async function submit(codeOverride?: string) {
    const trimmed = (codeOverride ?? code).trim();
    if (trimmed.length < 4) {
      setState({ kind: 'error', message: 'Enter the code your organizer gave you.' });
      return;
    }
    setState({ kind: 'joining' });
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as { eventId?: string; code?: string } | null;
      if (res.status === 200 && body?.eventId) {
        void navigate({ to: '/events/$eventId', params: { eventId: body.eventId } });
        return;
      }
      if (res.status === 404) {
        setState({ kind: 'error', message: "That code didn't match. Double-check it and try again." });
        return;
      }
      if (res.status === 410) {
        setState({ kind: 'error', message: 'That event has been cancelled.' });
        return;
      }
      setState({ kind: 'error', message: 'Could not join. Try again.' });
    } catch {
      setState({ kind: 'error', message: 'Network error. Try again.' });
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--font-xl)' }}>🏌️ Join your event</h1>
      <p style={{ color: 'var(--color-text-muted)', margin: '8px 0 20px' }}>
        Enter the code your organizer texted you. No account needed.
      </p>
      <input
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        placeholder="e.g. K7M4PQ"
        aria-label="Join code"
        data-testid="join-code-input"
        style={{
          width: '100%',
          textAlign: 'center',
          fontSize: 'var(--font-2xl)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          minHeight: 'var(--control-height-lg)',
          padding: '0 12px',
        }}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={state.kind === 'joining'}
        data-testid="join-submit"
        style={{
          marginTop: 'var(--space-4)',
          width: '100%',
          minHeight: 'var(--control-height-lg)',
          background: 'var(--color-brand-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          fontWeight: 700,
          fontSize: 'var(--font-md)',
          cursor: 'pointer',
        }}
      >
        {state.kind === 'joining' ? 'Joining…' : 'Join'}
      </button>
      {state.kind === 'error' ? (
        <p role="alert" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>
          {state.message}
        </p>
      ) : null}
      <p style={{ marginTop: 'var(--space-5)', fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
        Have a Google account instead?{' '}
        <a href="/api/auth/google" style={{ color: 'var(--color-brand-primary)' }}>Sign in</a>
      </p>
    </div>
  );
}

export const Route = createFileRoute('/join')({
  // NO beforeLoad — public, no SSO (the point of B0).
  component: JoinPage,
});
