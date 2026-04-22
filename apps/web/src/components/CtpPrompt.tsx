import { useEffect, useLayoutEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type CtpPromptPlayer = { id: number; name: string };

type Props = {
  open: boolean;
  holeNumber: number;
  groupPlayers: CtpPromptPlayer[];
  // undefined = this group has not answered yet (fresh prompt).
  // null       = this group already answered "nobody".
  // number     = this group already picked a player.
  existingWinnerPlayerId: number | null | undefined;
  // Tracks in-flight mutation target to spin only the tapped button:
  //   'none'  = the "Nobody" button
  //   number  = that player's button
  //   null    = idle
  submittingFor: 'none' | number | null;
  error: string | null;
  onSubmit: (winnerPlayerId: number | null) => void;
  onClose: () => void;
};

export function CtpPrompt({
  open,
  holeNumber,
  groupPlayers,
  existingWinnerPlayerId,
  submittingFor,
  error,
  onSubmit,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const noneBtnRef = useRef<HTMLButtonElement | null>(null);
  // Tracks whether a drag-like press STARTED on the backdrop. Only then does
  // a mouseup/click on the backdrop count as a dismiss. This avoids the
  // common bug where the user selects text inside the panel and the pointer
  // ends on the backdrop, which would otherwise dismiss.
  const mouseDownOnBackdrop = useRef(false);

  // Esc to dismiss. Registered only while open so we don't leak listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && submittingFor === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submittingFor, onClose]);

  // On open: capture the element that had focus, move focus into the dialog
  // (the "Nobody" button — the most common answer). On close: restore focus.
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    // Small rAF to let the panel mount before focusing.
    const raf = requestAnimationFrame(() => noneBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      // Focus restore can throw if the previously-focused element was removed
      // from the DOM or became unfocusable (e.g., conditional render during
      // submit). Wrap so cleanup never crashes the unmount.
      try {
        prevFocus?.focus?.();
      } catch {
        /* element gone or unfocusable — acceptable */
      }
    };
  }, [open]);

  // Focus trap: Tab/Shift-Tab cycling scoped to elements inside the panel.
  // Handles three cases:
  //   1. No focusables (all controls disabled mid-submit): pin focus to the
  //      panel itself via tabIndex={-1}.
  //   2. Focus is outside the panel (e.g., a previously-focused button
  //      became disabled and the browser moved focus to document.body):
  //      snap to the first focusable or the panel.
  //   3. Normal tab cycle: wrap from last → first / first → last.
  useEffect(() => {
    if (!open) return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const active = document.activeElement;
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => window.removeEventListener('keydown', onTab);
  }, [open]);

  // When submission starts and the currently-focused element is about to
  // become disabled, browsers (Chrome) dump focus to document.body — which
  // lives outside our panel. Pre-empt that by snapping focus to the panel
  // itself. useLayoutEffect runs synchronously after DOM mutations but
  // before the browser paints, which is the earliest safe window to catch
  // the focus-dump. The focus trap's keydown handler is a belt-and-suspenders
  // fallback for any case this misses.
  useLayoutEffect(() => {
    if (!open) return;
    if (submittingFor === null) return;
    const active = document.activeElement;
    const panel = panelRef.current;
    if (panel && (!active || !panel.contains(active))) {
      panel.focus();
    }
  }, [open, submittingFor]);

  if (!open) return null;

  const hasExistingAnswer = existingWinnerPlayerId !== undefined;
  const title = hasExistingAnswer ? 'Change answer?' : 'Closest to Pin?';
  const subtitle = `Hole ${holeNumber} — who was closest to the pin?`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onPointerDown={(e) => {
        // Pointer events unify mouse + touch + pen. Dragging from inside
        // the panel to outside (e.g., text selection) will have pointerdown
        // fire on the panel, not the backdrop — so mouseDownOnBackdrop stays
        // false and the subsequent click is ignored.
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (
          mouseDownOnBackdrop.current &&
          e.target === e.currentTarget &&
          submittingFor === null
        ) {
          onClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
      onPointerCancel={() => {
        // Touchscreen cancels (e.g., swipe-to-scroll) should reset the flag
        // so a subsequent click doesn't mistakenly dismiss.
        mouseDownOnBackdrop.current = false;
      }}
      aria-hidden={false}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ctp-prompt-title"
        // tabIndex={-1} makes the panel a programmatic focus target without
        // adding it to the natural tab order. Used as a focus anchor when
        // all controls are disabled during a submit. focus-visible styles
        // keep the focus indicator visible for keyboard users who land on
        // the panel directly (via the trap's no-focusable fallback).
        tabIndex={-1}
        className="w-full max-w-md bg-background rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 id="ctp-prompt-title" className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submittingFor !== null}
            className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{subtitle}</p>

        {/* "Nobody" is the common answer at CTP — lead with it. */}
        <Button
          ref={noneBtnRef}
          variant={existingWinnerPlayerId === null ? 'default' : 'outline'}
          className="w-full mb-3 py-5 text-base"
          onClick={() => onSubmit(null)}
          disabled={submittingFor !== null}
        >
          {submittingFor === 'none' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Nobody — missed the green
        </Button>

        <div className="grid grid-cols-2 gap-2">
          {groupPlayers.map((player) => {
            const isSelected = existingWinnerPlayerId === player.id;
            return (
              <Button
                key={player.id}
                variant={isSelected ? 'default' : 'secondary'}
                className="py-5 text-sm"
                onClick={() => onSubmit(player.id)}
                disabled={submittingFor !== null}
              >
                {submittingFor === player.id && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {player.name}
              </Button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
