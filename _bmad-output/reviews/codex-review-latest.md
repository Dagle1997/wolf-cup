# Codex Review

- Generated: 2026-04-22T17:33:29.749Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/web/src/components/CtpPrompt.tsx, apps/web/src/routes/score-entry-hole.tsx

## Summary

PASS. Round-4 items appear closed: focus-dump snap now runs in a useLayoutEffect (CtpPrompt.tsx:122-130), the panel no longer suppresses the focus indicator (CtpPrompt.tsx:175), and the backdrop interaction now uses pointer events (CtpPrompt.tsx:141-162). No substantive blockers found for commit; only minor, mostly-conditional compat/a11y nits noted below.

Overall risk: low

## Findings

1. [medium] Backdrop-dismiss relies on Pointer Events; older browsers without pointer events may no longer dismiss via backdrop tap/click
   - File: apps/web/src/components/CtpPrompt.tsx:139-162
   - Confidence: medium
   - Why it matters: The dismiss guard flag is only set in onPointerDown (line 141+). If Pointer Events aren’t supported (e.g., older iOS Safari / embedded webviews), onPointerDown won’t fire, mouseDownOnBackdrop stays false, and the onClick handler (line 148+) will never close the modal via backdrop interaction. That’s a functional regression in those environments.
   - Suggested fix: If you need to support non-Pointer-Events browsers, add a fallback onMouseDown that mirrors the onPointerDown logic (or set the flag in onClick via a different strategy). Keep the current pointer handlers for modern devices.

2. [low] ARIA dialog role is on the backdrop container rather than the focusable panel element
   - File: apps/web/src/components/CtpPrompt.tsx:139-176
   - Confidence: medium
   - Why it matters: The element with role="dialog"/aria-modal (line 163-166) is the full-screen backdrop wrapper, while focus is intentionally moved into controls/panel (line 59-60, 128-129). Many screen readers work fine by inferring the nearest dialog ancestor, but the more robust pattern is to put role/aria-* on the actual dialog panel node itself to ensure consistent announcement/semantics.
   - Suggested fix: Consider moving role="dialog", aria-modal, and aria-labelledby from the outer backdrop <div> onto the inner panel <div> (panelRef), while keeping the backdrop click handlers on the outer element.

## Strengths

- The useLayoutEffect focus-snap (CtpPrompt.tsx:122-130) correctly targets the earliest safe window (post-DOM-mutation, pre-paint) to mitigate focus-dump during disable transitions.
- Panel focus indicator fix is solid: focus:outline-none paired with focus-visible ring styling (CtpPrompt.tsx:175) maintains keyboard visibility without adding tab stops.
- Pointer-based backdrop interaction with pointer-cancel reset (CtpPrompt.tsx:141-162) is a pragmatic improvement over mouse-only handlers and addresses touch/pen inputs.

## Warnings

- Truncated file content for review: apps/web/src/routes/score-entry-hole.tsx
