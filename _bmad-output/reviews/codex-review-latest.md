# Codex Review

- Generated: 2026-06-21T14:42:33.233Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md

## Summary

Holistically, the doc is close to architecture-ready: the ADR spine, risk register, journey set (now incl. Journey 5), and the FR/NFR blocks are individually strong. The remaining blockers are *cross-section coherence* issues that can mislead architecture/epic decomposition—mainly (1) Product Scope (MVP vs Growth) not reflecting the actual Product-A FR surface area, (2) a Journey-1 example that appears to promise cross-foursome head-to-head in Product A, and (3) team/provenance storage semantics not being specified at the data-model level despite FR29/NFR-D1 requiring pinned team composition. There’s also a small but concrete drift: the engine signature still says `scores` only in a couple places despite claims now being first-class inputs.

Overall risk: high

## Findings

1. [high] MVP/Product A scope list is out of sync with the Product-A FR surface area (likely to mis-sequence architecture → epics)
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:127-138
   - Confidence: high
   - Why it matters: The “Product Scope → MVP (Product A)” list enumerates only 5 items (engine generalization, seed, cascade+lock, migration, leaderboard mode switch). But the overall document (Journeys + Domain + later FR set) clearly positions additional must-ship Product-A capabilities as part of F1’s story goal (e.g., teams, on-course claims capture, per-hole breakdown/traceability, finalize/un-finalize + audit logging, fail-closed/unsettleable handling). If the architecture phase uses the MVP list as the authoritative build contract, you risk missing epics/components/tests for money-critical flows, or incorrectly deferring them as “nice-to-have.”
   - Suggested fix: Update **Product Scope** to explicitly list the major Product-A capabilities that are part of F1’s must-ship behavior (or explicitly mark them as already-shipped v1 functionality if that’s the intent). Also update **Growth/Product B** to include all B-tagged capabilities that appear in FRs (not just unlock UI), so the A/B boundary is consistent across the entire doc.

2. [high] Journey 1’s team-game example reads like cross-foursome head-to-head money in Product A, conflicting with the A/B split and FR5 narrative
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:144-156
   - Confidence: high
   - Why it matters: Journey 1 (Product A) says Josh sets each day’s team game as “**foursome-vs-foursome, per-hole win/lose, $20/man**” (line 146). Elsewhere, the doc’s scope framing and FR5 text distinguish MVP as intra-foursome 2v2 + event-level pots/standings, with *direct cross-foursome head-to-head money* deferred (Product B). If Journey 1 is read literally, it will drive architecture to design cross-foursome matchup settlement now (or create ambiguity about what “event-level pot/standing” means), which is a big scope and correctness surface.
   - Suggested fix: Make Journey 1’s example unambiguously **Product-A-compatible** (e.g., describe an event-level aggregated pot/standing rather than a per-hole cross-foursome matchup), or re-tag that part of the journey as **Product B** and ensure Success Criteria / Scope reflect that deferral. Align terminology across Journey 1, Product Scope, and the FRs (FR5 vs FR22/FR25).

3. [high] Teams are required to be pinned for provenance (FR29/NFR-D1), but the data model section doesn’t specify how team composition is stored/versioned/pinned
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:215-226
   - Confidence: high
   - Why it matters: The PRD states that a scored round pins config provenance (line 225) and separately that per-round pairings are append-only (line 224). However, teams (as distinct from pairings) are now a first-class concept in Journeys (Journey 5) and the later FR set (FR20–FR21, FR29 “pins… team composition”, and NFR-D1 “pinned config + team revisions”). Without an explicit storage/versioning plan for team composition (event/round/foursome scope, and whether team changes can be forward-effective mid-round like rule changes), architecture can’t correctly implement pin/re-pin, recompute, and audit logging semantics without making unstated product decisions.
   - Suggested fix: Add an explicit **Team Model & Provenance** subsection under Data Model/Durable History that answers: (1) where team assignments live (tables/entities), (2) what they key off (round_id? pairing_id? hole ranges?), (3) how they are versioned (append-only revisions) and referenced by a scored round to satisfy pinning, and (4) whether team changes mid-round are allowed and, if so, whether they follow the same correction/forward-effective semantics as rules (Diagram 2). If you want to defer these decisions to architecture, mark them explicitly as **arch-time decisions** (like the override-table note at line 220).

4. [medium] Engine/domain signature drift: `computeFoursome` is still described as scores-only in places, contradicting the new claims-first model
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:194-233
   - Confidence: high
   - Why it matters: Domain Patterns state `computeFoursome(itsOwnConfig, itsOwnScores) → foursomeLedger` (line 196) and the Engine section repeats scores-only (line 229), but Journey 5 and Diagram 1 clearly make **claims** (greenie/polie/sandie) part of the compute inputs (Diagram 1 uses `itsOwnScores+claims`, line 275). This kind of drift is exactly what causes downstream architecture and test harnesses to omit a required input dimension, which is money correctness critical.
   - Suggested fix: Update all occurrences of the compute signature to consistently include claims (and, if teams are not derivable from config alone, include team composition/pinned team revision as an explicit input too). Ensure the “structural isolation by signature” argument remains true after adding claims/teams (i.e., still cannot read other foursomes’ data).

5. [low] Dangling internal reference: “inherits NFR-D8” doesn’t match the NFR section naming in this document
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:194-199
   - Confidence: high
   - Why it matters: The Domain Patterns section says “inherits NFR-D8” (line 195), but the NFR taxonomy in this PRD is C1–C8, T1, D1–D3, etc. This is small, but it undermines trust in cross-references when architecture/QA trace requirements to test gates.
   - Suggested fix: Replace “NFR-D8” with the correct NFR id(s) in this doc (likely NFR-C2 purity + NFR-D3 reconstructability and/or NFR-D2 atomicity) or remove the id reference if it’s meant as a general statement.

6. [medium] Product B scope description doesn’t enumerate all B-tagged capabilities, risking scope drift later
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:136-138
   - Confidence: high
   - Why it matters: Growth/Product B is summarized as “per-foursome self-service unlock + adjust UI” (lines 136–138). But the later FR list includes additional Product B capabilities (notably cross-foursome/cross-group team games and SettlementEdge-style settlement). If Growth scope doesn’t list these explicitly, architecture may not leave the right seams—or, conversely, may accidentally pull them into MVP because they appear elsewhere in the doc.
   - Suggested fix: Expand the **Growth — Product B** scope section to explicitly list the B-tagged capability buckets (self-serve foursome overrides; cross-foursome/cross-group settlement path/SettlementEdges) and any hard “must-not-foreclose” seams needed in Product A.

7. [medium] Traceability gap: at least one Success Criterion is not explicitly backed by an FR (could be dropped during epic creation)
   - File: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md:87-96
   - Confidence: medium
   - Why it matters: Success Criteria include “**The dead ‘No rule set seeded’ card is gone**” (line 94) and the ≤5 min setup guardrail (line 90). While the doc implies these through other sections, they are not clearly mapped to a specific FR id in the FR list. Given the PRD’s own “capability contract” stance, lack of explicit trace raises the risk that architecture/epics focus on the engine/cascade and omit the concrete UX removal of the dead-end entry point (which is positioned as a primary value unlock).
   - Suggested fix: Add explicit FR(s) (or a short Traceability table) mapping key Success Criteria to FR/NFR ids—especially the “dead card removed / always a working create/seed path” and the time-on-task guardrail (if it is meant to be enforced via UX constraints like preset-first + zero blank-slate).

## Strengths

- ADR spine + risk register align well with the later recompute/finalize posture (correction vs forward-effective vs frozen) and the migration dual-read + golden gate.
- Journey set is now complete for the new MVP additions (Journey 5), and the Journey Requirements Summary properly calls out teams/claims/breakdown as a top-level requirement.
- The “Required Clarity Artifact” (plain-language provenance + Mermaid diagrams) is exactly the kind of architecture-unblocking content that prevents pin/re-pin confusion downstream.
- Correctness posture is strong and architecture-friendly: golden fixtures + property/fuzz invariants + integer-cents purity + order-independence + deterministic remainder allocation.
- Security/privacy stance is clear at the doc level: money bounded to authenticated roster members; separation of money vs public stats is explicitly called out for forward compatibility.

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md
