---
stepsCompleted: ['step-01-document-discovery', 'adversarial-codex-pass', 'verdict-accepted']
status: 'COMPLETE — validation accepted by Josh 2026-06-20 (option 1: adversarial pass + triage + verdict in lieu of the step-by-step checklist). PRD READY for architecture.'
workflowType: 'check-implementation-readiness'
target: 'prd-betting-action-line.md (Tournament "The Action" betting)'
date: '2026-06-20'
documentsAssessed:
  prd: '_bmad-output/planning-artifacts/tournament/prd-betting-action-line.md'
  architecture: 'NONE (betting-specific) — inherited context: tournament/architecture.md'
  ux: 'NONE (betting-specific) — event-setup-ux-backlog.md is a general backlog, not a UX spec'
  epics: 'NONE (betting-specific)'
---

# Implementation Readiness Assessment Report

**Date:** 2026-06-20
**Project:** Wolf-Cup (Tournament app — "The Action" betting feature)

## Document Inventory

**Target of assessment:** `tournament/prd-betting-action-line.md` (Tournament "The Action" betting PRD, completed 2026-06-20).

**PRD documents found in `planning-artifacts/`:**
- `tournament/prd-betting-action-line.md` — **TARGET** (this assessment).
- `tournament/prd.md` — Tournament v1 PRD (inherited context; separate scope).
- `tournament/prd-f1-rules-games.md` — paused F1 rules/games PRD (separate scope).
- `prd.md` (root) — Wolf Cup PRD (different app; not relevant).

**Architecture:** `tournament/architecture.md` — Tournament v1 architecture (inherited context). **No betting-specific architecture exists.**

**UX:** none. `tournament/event-setup-ux-backlog.md` is a general backlog, not a UX spec for this feature.

**Epics & Stories:** none for the betting feature. (`tournament/epics-phase1.md` covers Tournament v1.)

## Critical Issues

- **No duplicate-format conflicts** (no whole-vs-sharded duplication of the target PRD).
- **WARNING — betting-specific Architecture, UX, and Epics do not exist yet.** This is expected: only the PRD has been authored. The assessment proceeds as a **PRD-readiness** check (is the PRD complete enough to feed architecture + epic breakdown?), not a full four-document chain validation.

## External Adversarial Review (Codex gpt-5.5, high reasoning) — 2026-06-20

An adversarial settlement-correctness review was run on the FR/NFR contract before finishing. Result: **38 HIGH / 15 MED / 5 LOW**. Triaged into three buckets.

### Bucket A — PRD-level gaps FOLDED IN (PRD updated this session)
- **Bet scope binding** (round + explicit hole set) → new **FR48**; segments by course hole number → **FR15** revised.
- **Placement cutoff** (no betting on a known result) → new **FR49**.
- **Side↔subject mapping** ({stakeholder, subject} per side, no self-both-sides) → new **FR50**.
- **Subjects must be roster players in the scoped round** → new **FR51**.
- **Creator void only pre-score; segmented bets void as one parent** → **FR6** revised.
- **Per-hole match formula + no auto-press v1 + putts-basis invalid** → **FR12** revised.
- **UNSETTLEABLE terminal + organizer resolve; DNF/pickup handling** → new **FR52**.
- **Visibility is stakeholder+organizer based; subject not auto-shown stake** → new **FR53**.
- **Snake = distinct N-participant type; one per group/round; participants fixed pre-putt; settles only on complete putts; provisional otherwise** → new **FR54**.

### Bucket B — Snake product decisions RESOLVED by Josh (2026-06-20)
- **First-event 4-putt → starting + 1 increment** (e.g. $5→$6). General: first event = start + (putts−3)×incr; subsequent += (putts−2)×incr → **FR30** corrected (prior FR30 was wrong: implied first-4-putt = $5).
- **Same-hole multiple qualifiers → worst putt takes it** (4-putt > 3-putt, 5 > 4); **only on a putt-count tie** does "last one in the hole" decide (scorer affordance, since the app can't infer putting order from totals) → **FR29** revised.
- **No 3-putts all round → nobody holds it, no payout** → **FR30**.

### Bucket C — Correctly DEFERRED to the architecture / engine spec (NOT PRD altitude)
Codex's heaviest asks belong in the next phase and confirm the readiness verdict that architecture must precede build:
- Full settlement **state machine** (draft/live/provisional/settled/void/unsettleable/finalized).
- Signed **pairwise-balance convention** + canonical payer/payee derivation.
- **Net-by-segment / by-hole** exposed by the leaderboard service (settlement must not re-derive net) + **net-calc versioning** so a future leaderboard fix can't silently re-settle old bets.
- **Golden hand-calc fixtures** approved per bet type (incl. every Snake edge) — the NFR-C3 gate is untestable until these exist.
- **Audit payload schema** (actor, role, before/after, reason, request id, settlement delta).
- **Score-correction-after-payment** finalization / "changed since paid" handling.
- "**adjust**" semantics (collapse to organizer edit per FR4, or define as a first-class audited ledger input).
- Roster identity duplicate/merge behavior (double join-code identity → double settle-up row).

### Verdict
The PRD is **READY to feed architecture + epic breakdown.** The adversarial pass hardened the capability contract (FR1–FR54) and locked the Snake rules; the remaining findings are exactly the settlement-engine spec work the architecture phase exists to produce. Hard gate before any settlement code ships: **approved golden hand-calc fixtures** for every bet type and Snake edge (NFR-C1/C3/C4).
