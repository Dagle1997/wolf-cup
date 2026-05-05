/**
 * T7-6 in-app install prompt component.
 *
 * Renders ONLY when:
 *   - PWA is not already installed (caller passes isStandalone)
 *   - device's install_prompt_shown_at is null (caller passes the value)
 *   - the player has completed at least one mutation in this session
 *   - the platform supports prompting (iOS Safari card OR Android
 *     Chrome `beforeinstallprompt` button)
 *
 * On any path that surfaces the prompt to the user (render OR unmount-
 * before-interaction), `props.onShown()` is invoked exactly ONCE via
 * `stampOnce`. Multiple paths to the same stamp (codex spec round-2
 * Med #2) are guarded by `useRef`.
 *
 * Stale-event handling (codex spec round-2 Med #1): if `prompt()` throws
 * because the captured event has gone stale, fall back to the iOS
 * instructions card ONLY when the iOS UA matches; never show iOS-shaped
 * UI to a non-iOS user.
 */

import { useEffect, useRef, useState } from 'react';

export type InstallPromptProps = {
  installPromptShownAt: number | null;
  hasMutatedThisSession: boolean;
  isStandalone: boolean;
  beforeInstallEvent: BeforeInstallPromptEvent | null;
  userAgent: string;
  onShown: () => void;
};

const IOS_RE = /iPad|iPhone|iPod/i;

export function isIosUserAgent(ua: string): boolean {
  return IOS_RE.test(ua);
}

export function InstallPrompt(props: InstallPromptProps) {
  const {
    installPromptShownAt,
    hasMutatedThisSession,
    isStandalone,
    beforeInstallEvent,
    userAgent,
    onShown,
  } = props;

  const hasStampedRef = useRef(false);
  const stampOnce = useRef(() => {
    if (hasStampedRef.current) return;
    hasStampedRef.current = true;
    onShown();
  });
  // Keep the latest onShown reachable via the ref (the closure baked at
  // mount would otherwise call a stale callback when parent re-renders).
  stampOnce.current = () => {
    if (hasStampedRef.current) return;
    hasStampedRef.current = true;
    onShown();
  };

  // Suppression rules — short-circuit BEFORE any render side effects.
  const shouldRender =
    !isStandalone &&
    installPromptShownAt === null &&
    hasMutatedThisSession;

  // Defense-in-depth: if the user closes the tab without interacting with
  // a rendered prompt, stamp anyway so the per-device one-shot invariant
  // holds. The ref guard prevents double-stamping under React 18 strict-
  // mode double-mount.
  useEffect(() => {
    if (!shouldRender) return;
    return () => {
      stampOnce.current();
    };
  }, [shouldRender]);

  if (!shouldRender) return null;

  const isIos = isIosUserAgent(userAgent);

  // Branch 1: Android-shape (Chromium with deferred event).
  if (beforeInstallEvent !== null && !isIos) {
    return (
      <AndroidInstallButton
        beforeInstallEvent={beforeInstallEvent}
        onShown={() => stampOnce.current()}
        onStaleFallback={() => {
          // Codex round-2 Med #1 + round-3 Med #2: this branch is reached
          // ONLY when !isIos, so falling back to stamp-and-suppress is the
          // correct behavior (never show iOS card to a non-iOS user).
          stampOnce.current();
        }}
      />
    );
  }

  // Branch 2: iOS-shape (no event API; instructions card).
  if (isIos) {
    return <IosInstructionsCard onDismiss={() => stampOnce.current()} />;
  }

  // Branch 3: unsupported (no event AND not iOS) — render null. Component
  // is mounted (effect ran), but the user sees nothing. Unmount stamps via
  // the cleanup so the device's column flips on next nav.
  return null;
}

function AndroidInstallButton({
  beforeInstallEvent,
  onShown,
  onStaleFallback,
}: {
  beforeInstallEvent: BeforeInstallPromptEvent;
  onShown: () => void;
  onStaleFallback: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="dialog"
      aria-label="Install app"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1200,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>Install Tournament</strong>
        <div style={{ fontSize: '0.85rem', color: '#555' }}>
          Add to your home screen for one-tap access.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onShown()}
          disabled={busy}
          style={{ background: 'transparent', border: 'none', padding: '6px 10px' }}
        >
          Not now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              try {
                await beforeInstallEvent.prompt();
                window.__deferredInstallPrompt = undefined;
                onShown();
              } catch {
                // Stale event or runtime denied. Let the parent stamp +
                // unmount; the busy flag is cleared in `finally` so the
                // button doesn't lock if the parent's unmount is delayed
                // (codex impl-codex round-1 Med #3).
                onStaleFallback();
              }
            } finally {
              setBusy(false);
            }
          }}
          style={{
            background: '#0a5',
            color: '#fff',
            border: 0,
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Install
        </button>
      </div>
    </div>
  );
}

function IosInstructionsCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Install app"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1200,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>Install Tournament</strong>
        <div style={{ fontSize: '0.85rem', color: '#555' }}>
          Tap the Share icon, then "Add to Home Screen".
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onDismiss()}
          style={{
            background: '#0a5',
            color: '#fff',
            border: 0,
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
