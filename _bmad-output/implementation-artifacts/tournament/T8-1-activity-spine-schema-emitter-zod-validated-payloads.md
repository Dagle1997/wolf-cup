# T8-1: Activity Spine Schema + Emitter + Zod Payloads + ESLint Gate (FD-5, FR-C3, D3-2)

## Status

ready-for-dev

## Story

As a developer, I want the `activity` table + a typed `emitActivity(tx, event)` transaction helper + per-type Zod schemas validated BEFORE insert + an ESLint rule blocking direct table writes outside the helper, so that every downstream engagement surface (T8-2/T8-3/T8-4) reads from a single authoritative event spine with strong typing and no drift (FD-5, FR-C3, D3-2).

## v1 Scope

This is the foundational story for Epic T8 (Engagement Surfaces). It builds the activity-event spine that T8-2 (API + provider + toast/banner), T8-3 (player-home feed), and T8-4 (award trigger) will consume.

### Existing baseline that this story must rationalize

`apps/tournament-api/src/lib/activity.ts` was placed as a **no-op stub** by T5-6 with this signature:

```ts
emitActivity(tx, { type, actorPlayerId, payload, scope: { eventId?, roundId? } })
```

The stub's docstring explicitly says: *"T8 (activity spine epic) replaces ONLY the function body... If T8 ever needs a REQUIRED new field, that's a coordinated breaking change."* T8-1 IS the coordinated breaking change. The new typed emitter requires `eventId` (not optional) on every variant, which the stub's `scope.eventId?` does not enforce.

14 existing call sites across routes/services emit through the stub today (verified by grep: scores ×1, presses ×2, press-orchestrator ×1, round-lifecycle ×4, score-corrections ×1, scorer-assignments ×1, event-rule-edits ×1, sub-games ×1, gallery ×1, bets ×1). ALL must migrate to the new typed signature in this story — replacing the stub body without migrating call sites would leave the codebase uncompilable.

**`award.triggered` scope note (codex spec round-1 High #1):** the typed union has 13 variants; the 13th (`award.triggered`) has NO production emit site in T8-1 because T8-4 (Award Trigger Surfaces) is the producer. T8-1 ships the *type* + Zod schema so T8-4 can consume the spine without re-defining the variant. The integration test (Layer 6, AC #6) covers `award.triggered` as a synthetic emission to prove the type + Zod path works end-to-end before T8-4 wires up the real emit.

### Layer 1 — Schema (`apps/tournament-api/src/db/schema/activity.ts`, NEW)

```ts
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roundId: text('round_id').references(() => rounds.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorPlayerId: text('actor_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    feedIdx: index('idx_activity_event_created_id').on(
      t.eventId,
      desc(t.createdAt),
      desc(t.id),
    ),
  }),
);
export type Activity = typeof activity.$inferSelect;
```

**Notes on the schema:**
- `event_id NOT NULL` is the load-bearing invariant from the Codex High finding in the epic. Every activity must scope to an event. Audit-only events (e.g. `install_prompt.shown`) live in `audit_log`, NOT here.
- The CHECK constraint enumerating the 13 v1 types is enforced at the application layer via the discriminated union + Zod schemas (Layer 2). SQLite CHECK on a TEXT column is fragile across migration ordering and Drizzle support — we mirror the audit-log posture (no SQL CHECK, type-system + helper enforces).
- Composite index `(event_id, created_at DESC, id DESC)` supports T8-2's live polling (`?after=cursor`) AND historical backfill (`?before=cursor`); the `id DESC` tiebreaker keeps the cursor stable across same-`createdAt` rows.
- Cascade on `event_id` and `round_id` deletes follows the existing tournament-api FK posture (gallery, sub-game, etc., all cascade on event/round delete).
- `actor_player_id RESTRICT` matches `audit_log` — players are shared infrastructure and shouldn't be silently nulled out by activity FK semantics.
- `ecosystemColumns()` provides `tenant_id` (default 'guyan') and `context_id` (caller-set; the emitter sets `context_id = 'activity:<event_id>'`).

**Migration `0010_activity_spine.sql`** (NEW, generated via `pnpm --filter @tournament/api db:generate` from the Drizzle schema change). The SQL contains exactly: CREATE TABLE activity (...) + CREATE INDEX idx_activity_event_created_id (...). No data migration. Drizzle's `meta/_journal.json` and `meta/0010_snapshot.json` are auto-updated by the generator and MUST be committed alongside the SQL file.

Schema barrel: `apps/tournament-api/src/db/schema/index.ts` re-exports `activity` so the runtime can `import { activity } from '../db/schema/index.js'` (matches the existing audit-log pattern).

### Layer 2 — Discriminated union types (`apps/tournament-api/src/engine/types/activity-events.ts`, NEW)

```ts
import { z } from 'zod';

export interface ActivityEventBase {
  eventId: string;       // REQUIRED — matches DB NOT NULL
  roundId?: string;
  actorPlayerId?: string;
}

export type ActivityEvent =
  | ScoreCommittedEvent
  | ScoreCorrectedEvent
  | ScorerTransferredEvent
  | RoundFinalizedEvent
  | RoundCancelledEvent
  | PressAutoFiredEvent
  | PressManualFiredEvent
  | PressManualUndoneEvent
  | BetCreatedEvent
  | RuleSetRevisedEvent
  | SubgameComputedEvent
  | GalleryUploadedEvent
  | AwardTriggeredEvent;

export type ActivityType = ActivityEvent['type'];

export const ACTIVITY_TYPES = [
  'score.committed',
  'score.corrected',
  'scorer.transferred',
  'round.finalized',
  'round.cancelled',
  'press.auto_fired',
  'press.manual_fired',
  'press.manual_undone',
  'bet.created',
  'rule_set.revised',
  'subgame.computed',
  'gallery.uploaded',
  'award.triggered',
] as const satisfies readonly ActivityType[];

export const activityEventSchemas = { /* ... per-type Zod schemas, see below ... */ } as const;
```

**Variant shapes** (consumer-critical fields inlined; T8-2/T8-3/T8-4 read these without joining course/round/score data):

- `ScoreCommittedEvent` — `eventId, roundId, holeNumber, playerId, grossStrokes, par, toPar, isBirdieOrBetter, scorerPlayerId, actorPlayerId`. `par + toPar + isBirdieOrBetter` precomputed by the emitting route (see scores.ts migration in Layer 4 — adds a course-revision lookup).
- `ScoreCorrectedEvent` — `eventId, roundId, holeNumber, playerId, priorGross, newGross, actorPlayerId` (renames the existing stub-emit's `prior`/`new` to `priorGross`/`newGross` per epic spec).
- `ScorerTransferredEvent` — `eventId, roundId, foursomeNumber, fromPlayerId, toPlayerId, actorPlayerId`.
- `RoundFinalizedEvent` — `eventId, roundId, actorPlayerId`. Empty payload otherwise.
- `RoundCancelledEvent` — `eventId, roundId, actorPlayerId`. Empty payload otherwise.
- `PressAutoFiredEvent` — `eventId, roundId, triggerHole, team?, betId?, trigger, multiplier`. Either `team` (team press) OR `betId` (individual-bet press) is populated; per epic spec; Zod schema enforces the XOR.
- `PressManualFiredEvent` — `eventId, roundId, fromHole, team, multiplier, filedByPlayerId`.
- `PressManualUndoneEvent` — `eventId, roundId, pressId, undoneByPlayerId`.
- `BetCreatedEvent` — `eventId, betId, playerAId, playerBId, betType, stakePerHoleCents, actorPlayerId`. (No roundId — bets are event-scoped.)
- `RuleSetRevisedEvent` — `eventId, ruleSetId, revisionId, effectiveFromRoundId?, effectiveFromHole?, configDiffSummary?, actorPlayerId`.
- `SubgameComputedEvent` — `eventId, roundId, subGameId, subGameResultId, totalPotCents, actorPlayerId`.
- `GalleryUploadedEvent` — `eventId, roundId?, photoId, actorPlayerId`. (Round-scoped gallery upload includes roundId; event-only gallery uploads omit it.)
- `AwardTriggeredEvent` — `eventId, roundId?, awardType: 'first_birdie_of_event' | 'first_eagle_of_event', playerId, context: { holeNumber, grossStrokes, par }`. v1 award types fixed (skins_pot_streak deferred to v1.5 per T8-4 epic spec).

**ID typing decision (codex-anticipated question).** All ID fields use `string` (not branded types like `EventId`, `RoundId`). Tournament-api has no existing branded ID types and introducing them is out of scope for T8-1; ID fields throughout the codebase are typed as `string` today.

`activityEventSchemas: Record<ActivityType, z.ZodSchema>` — one Zod schema per type, matching the TS shape exactly. **Every schema is built with `.strict()`** (codex spec round-1 Med #5) so unknown keys are REJECTED, not silently passed through. This prevents payload drift into the persisted JSON.

#### Concrete Zod schema specification (codex spec round-1 High #2)

Common base validations applied via `.extend()` from a shared `activityEventBaseSchema`:
- `eventId: z.string().min(1)` — required, non-empty.
- `roundId: z.string().min(1).optional()` — present-or-undefined, never empty string.
- `actorPlayerId: z.string().min(1).optional()` — present-or-undefined, never empty string.

Per-variant validation (concrete ranges enumerated to make AC #2 / AC #6 directly implementable):

| Variant | Field-level validation |
|---|---|
| `score.committed` | `holeNumber: z.number().int().min(1).max(18)`; `grossStrokes: z.number().int().min(1).max(20)` (matches `score-entry.tsx` SCORE_RE); `par: z.number().int().min(3).max(5)`; `toPar: z.number().int().min(-2).max(17)` (logical bound: birdie eagle holes ≤ -2; max 17 strokes over par on a par-3 ace); `isBirdieOrBetter: z.boolean()`; `playerId: z.string().min(1)`; `scorerPlayerId: z.string().min(1)`; `roundId: z.string().min(1)` (required for this variant — non-base override). |
| `score.corrected` | `holeNumber: 1-18 int`; `playerId/actorPlayerId: non-empty string`; `priorGross + newGross: z.number().int().min(1).max(20)`. `roundId required`. |
| `scorer.transferred` | `foursomeNumber: z.number().int().min(1).max(20)`; `fromPlayerId/toPlayerId: non-empty string`. `roundId required`. |
| `round.finalized` / `round.cancelled` | `roundId required`. No additional payload fields. |
| `press.auto_fired` | `triggerHole: 1-18 int`; `team: z.enum(['teamA','teamB']).optional()`; `betId: non-empty string optional`; `trigger: non-empty string`; `multiplier: z.number().int().min(1).max(8)`. `.refine(d => (d.team === undefined) !== (d.betId === undefined), 'team XOR betId must be populated')`. `roundId required`. |
| `press.manual_fired` | `fromHole: 1-18 int`; `team: z.enum(['teamA','teamB'])`; `multiplier: 1-8 int`; `filedByPlayerId: non-empty string`. `roundId required`. |
| `press.manual_undone` | `pressId: non-empty string`; `undoneByPlayerId: non-empty string`. `roundId required`. |
| `bet.created` | `betId/playerAId/playerBId: non-empty string`; `betType: z.string().min(1)`; `stakePerHoleCents: z.number().int().min(1)`. `roundId NOT used`. |
| `rule_set.revised` | `ruleSetId/revisionId: non-empty string`; `effectiveFromRoundId: optional non-empty string`; `effectiveFromHole: 1-18 int optional`; `configDiffSummary: optional string`. |
| `subgame.computed` | `subGameId/subGameResultId: non-empty string`; `totalPotCents: z.number().int().min(0)`. `roundId required`. |
| `gallery.uploaded` | `photoId: non-empty string`. `roundId optional`. |
| `award.triggered` | `awardType: z.enum(['first_birdie_of_event','first_eagle_of_event'])`; `playerId: non-empty string`; `context: z.object({ holeNumber: 1-18 int, grossStrokes: 1-20 int, par: 3-5 int }).strict()`. `roundId optional`. |

The `team` XOR `betId` rule on `press.auto_fired` is enforced via `.refine`, NOT a Zod discriminated union (the type column is the actual discriminator and we don't want sub-discrimination noise). The refine message becomes the ZodError when invalid.

Note on Zod version: tournament-api uses `zod` ^3.24 (verified in package.json). All `.strict()`, `.refine`, `.extend()`, and `z.enum()` APIs are stable in that version.

### Layer 3 — Emitter (`apps/tournament-api/src/lib/activity.ts`, REWRITE)

**Path note (codex-anticipated question).** The epic spec text says `services/activity.ts`; tournament-api convention is `lib/audit-log.ts`, `lib/activity.ts` (existing stub). We keep the file at `lib/activity.ts` to match repo convention; the ESLint allowlist references this same path. No file move.

```ts
export async function emitActivity(
  tx: Tx | Db,
  event: ActivityEvent,
): Promise<void> {
  const schema = activityEventSchemas[event.type];
  // With `.strict()` schemas, an unknown key on the input `event`
  // throws ZodError BEFORE this line (Zod's strict mode FAILS on
  // unknown keys; it does NOT silently strip them). So `parsed` is
  // structurally identical to the typed variant shape — using `parsed`
  // for both column population AND the JSON serialization defends
  // against any future relaxation of `.strict()` to `.passthrough()`
  // by guaranteeing the persisted payload only ever contains schema-
  // declared fields (codex spec round-1 Med #5).
  const parsed = schema.parse(event);

  await tx.insert(activity).values({
    id: randomUUID(),
    eventId: parsed.eventId,
    roundId: parsed.roundId ?? null,
    type: parsed.type,
    actorPlayerId: parsed.actorPlayerId ?? null,
    payloadJson: JSON.stringify(parsed),
    createdAt: Date.now(), // ms-since-epoch UTC, matches existing tournament-api convention (audit_log, gallery, install-prompt)
    tenantId: TENANT_ID,
    contextId: `activity:${parsed.eventId}`,
  });
}
```

**Timestamp unit (codex spec round-1 Med #6).** `created_at` is `INTEGER` ms-since-epoch UTC via `Date.now()`. Matches every other tournament-api timestamp column (audit_log, gallery, install-prompt) and Wolf Cup ancestors. T8-2's opaque cursor will encode this as `base64(JSON.stringify({ createdAt: <ms-int>, id: <uuid> }))` — same unit, no transformation. Documented here so the cursor implementation in T8-2 doesn't drift to seconds-or-ISO.

Old `EmitActivityArgs` interface and stub body are DELETED. Any caller still passing the old shape (`{ type, actorPlayerId, payload, scope }`) will fail TypeScript compilation — that's the breaking change.

`emitActivity` MUST be called inside a `db.transaction(...)` callback (the `tx` parameter is `Tx`, not `Db`). At type level the signature accepts both; the docstring documents that callers should always pass a transaction so a Zod parse failure rolls back the surrounding side effects (score insert, press insert, etc.). The type-level enforcement is a v1.5 polish (would require a brand on Tx) — out of scope for T8-1.

### Layer 4 — Migrate all 14 call sites

Every existing call site reshapes to the new typed signature:

| File | Type | Migration notes |
|---|---|---|
| `routes/scores.ts:453` | `score.committed` | Add course-revision par lookup inside the score-commit transaction; compute `toPar = grossStrokes - par` and `isBirdieOrBetter = toPar < 0`. Add `scorerPlayerId: player.id` to the typed payload. Skip emit when `round.eventId === null` (already the existing pattern at line 451-452). **Lookup chain (codex spec round-1 High #3 evidence)**: `rounds.eventRoundId → event_rounds.courseRevisionId → course_holes WHERE course_revision_id = ? AND hole_number = ?`. The `chk_rounds_event_pairing` schema CHECK constraint (`apps/tournament-api/src/db/schema/scoring.ts:91`) guarantees `(eventId IS NULL) = (eventRoundId IS NULL)`, so any round with `eventId !== null` ALSO has `eventRoundId !== null` — the chain never breaks. `course_holes` has the `uniq_course_holes_revision_hole_number` UNIQUE index (`apps/tournament-api/src/db/schema/courses.ts:143`) so the lookup is O(1). Concrete Drizzle pattern: `tx.select({ par: courseHoles.par }).from(courseHoles).innerJoin(eventRounds, eq(eventRounds.courseRevisionId, courseHoles.courseRevisionId)).where(and(eq(eventRounds.id, round.eventRoundId!), eq(courseHoles.holeNumber, holeNumber), eq(courseHoles.tenantId, TENANT_ID))).limit(1)`. |
| `routes/presses.ts:305` | `press.manual_fired` | Reshape to typed payload (rename `startHole` → `fromHole`, drop `roundId` ambiguity). Add `filedByPlayerId: player.id`. |
| `routes/presses.ts:462` | `press.manual_undone` | Reshape: rename `startHole` field; rename payload to `{eventId, roundId, pressId, undoneByPlayerId}`. |
| `services/press-orchestrator.ts:531` | `press.auto_fired` or `press.manual_fired` | Reshape to typed payload; the `auto_fired` path requires `triggerHole` (currently emits `holeNumber`); the existing `team` field is preserved. The XOR `team` vs `betId` is enforced by the Zod schema. |
| `routes/round-lifecycle.ts:163` | `round.completed` | **DROP** this emit. `round.completed` is NOT in the v1 13-type enum (epic spec). The stub was no-op anyway, so deletion preserves observable behavior. The state transition is still recorded in `audit_log` via writeAudit. |
| `routes/round-lifecycle.ts:251` | `round.complete_rolled_back` | **DROP** this emit. Same rationale. |
| `routes/round-lifecycle.ts:396` | `round.finalized` | Add `eventId: round.eventId` to the typed payload (looked up from the round row already fetched). Skip emit when `round.eventId === null`. |
| `routes/round-lifecycle.ts:505` | `round.cancelled` | Same migration as `round.finalized`. |
| `routes/score-corrections.ts:351` | `score.corrected` | Rename payload `prior` → `priorGross`, `new` → `newGross`. Add `eventId` from the round row already fetched. Skip emit when `round.eventId === null`. |
| `routes/scorer-assignments.ts:401` | `scorer.transferred` | Add `eventId` from the round row. Skip emit when `round.eventId === null`. |
| `routes/event-rule-edits.ts:341` | `rule_set.revised` | Already passes `eventId`; reshape inline payload to match typed variant (move `effectiveFromRoundId/effectiveFromHole/configDiffSummary` to top-level fields per the typed shape). |
| `routes/sub-games.ts:153` | `subgame.computed` | Already passes `{roundId, eventId}`; reshape to typed payload. |
| `routes/gallery.ts:235` | `gallery.uploaded` | Already passes `{eventId, roundId?}`; reshape to typed payload. |
| `routes/bets.ts:297` | `bet.created` | Already passes `eventId`; reshape to typed payload. |

**Skip-on-null-eventId pattern.** Every call site whose round may have `eventId === null` (legacy non-event rounds) MUST guard the emit:

```ts
if (round.eventId !== null) {
  await emitActivity(tx, {
    type: '...',
    eventId: round.eventId,
    /* ... */
  });
}
```

This is already the pattern in `scores.ts:451-452` for the stub emit. We apply it consistently across migrated call sites. The activity feed is best-effort observability for tournament events; legacy non-event rounds simply don't produce activity rows.

### Layer 5 — ESLint gate (`apps/tournament-api/eslint.config.js`)

**Codex spec round-1 High #4 — broaden the original selector.** The first-pass selector `CallExpression[callee.property.name='insert'] > Identifier[name='activity']` had three blind spots:

1. Only blocked `insert` — a careless caller could `tx.update(activity)` or `tx.delete(activity)` and bypass the gate.
2. Only blocked `obj.insert(activity)` member-call shape — a destructured `const insert = tx.insert; insert(activity)` would slip past.
3. Drizzle's chain shape `tx.insert(activity).values({...})` was actually OK with the original selector (the `>` direct-child does match the argument), but a chain like `tx.insert(activity, opts)` would also match unintended call shapes.

Concrete rule (extends to all three Drizzle write methods):

```js
{
  files: ['src/**/*.ts'],
  ignores: ['src/lib/activity.ts', 'src/lib/activity.test.ts', 'src/lib/activity.eslint-rule.test.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(insert|update|delete)$/] > Identifier[name='activity']",
        message: 'Direct writes to the activity table are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
      },
      {
        selector: "CallExpression[callee.type='Identifier'][callee.name=/^(insert|update|delete)$/] > Identifier[name='activity']",
        message: 'Direct destructured writes to the activity table are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
      },
    ],
  },
},
```

The first selector matches `tx.insert(activity)` / `db.insert(activity)` / etc.; the regex `/^(insert|update|delete)$/` extends coverage to update/delete. The second selector matches the destructured-const path. The allowlist file list explicitly includes the new RuleTester test file too.

**Closing the rename-bypass (codex spec round-2 Med #3).** A determined caller could still write `const writeRow = tx.insert; writeRow(activity)` and the destructured selector wouldn't fire (it matches the literal name `insert|update|delete`). To prevent rename-bypass at the boundary, ALSO add a `no-restricted-imports` rule blocking the `activity` named export from `db/schema/index.js` and `db/schema/activity.js` outside the allowlist:

```js
{
  files: ['src/**/*.ts'],
  ignores: ['src/lib/activity.ts', 'src/lib/activity.test.ts', 'src/lib/activity.eslint-rule.test.ts', 'src/lib/__fixtures__/activity-direct-write-violation.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        // Existing @wolf-cup/engine restriction stays — this BLOCK is added alongside, not replacing.
        // Block direct imports of the `activity` schema export outside the emitter.
      ],
      patterns: [
        {
          group: ['*db/schema*'],
          importNames: ['activity'],
          message: 'Direct `activity` schema imports are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
      ],
    }],
  },
}
```

If you cannot import `activity`, you cannot write `tx.insert(activity)` regardless of how the call shape is renamed/destructured. This makes the no-restricted-syntax rule the second layer of defense rather than the only one. Note: the existing `no-restricted-imports` rule for `@wolf-cup/engine` (eslint.config.js:14-23) MUST be merged with this addition — both rules run under the same `no-restricted-imports` config (ESLint allows only one configuration per rule per files-block; merge into a single `paths`/`patterns` set).

The fixture file at `src/lib/__fixtures__/activity-direct-write-violation.ts` MUST import the `activity` symbol to exercise the syntax rule, so it's added to the same `ignores` allowlist as the emitter file.

**Test approach (codex spec round-1 High #4 — RuleTester limitations).** RuleTester is suitable for testing the rule's `selector` correctness in isolation but does NOT exercise flat-config `ignores` behavior (it tests rules, not configs). The integration test plan is therefore TWO-PRONGED:

1. **`apps/tournament-api/src/lib/activity.eslint-rule.test.ts`** — RuleTester unit-tests for the SELECTOR: (a) `tx.insert(activity).values(...)` fails the rule; (b) `tx.update(activity).set(...)` fails; (c) `tx.delete(activity).where(...)` fails; (d) destructured `insert(activity)` fails; (e) `tx.insert(otherTable)` is unaffected; (f) `insert(otherTable)` (destructured, different table) is unaffected.

2. **`apps/tournament-api/src/lib/__fixtures__/activity-direct-write-violation.ts`** + a vitest test that runs `eslint` programmatically on this fixture path — exercises the FLAT-CONFIG-IGNORES behavior end-to-end. The fixture file contains `import { activity } from '../../db/schema/index.js'; declare const tx: any; tx.insert(activity).values({} as never);`. The vitest test imports `Linter` or `ESLint` from `eslint`, runs the lint, and asserts the rule fires on the fixture but does NOT fire on `lib/activity.ts` itself (allowlist effective). The fixture's directory is gitignored from the tournament-api `tsc --noEmit` glob via tsconfig `exclude` so it doesn't block typecheck (the fixture references nonexistent runtime types — `declare const tx: any` is a deliberate hack to keep the fixture single-line and lint-focused).

Vitest test module pseudocode (codex spec round-2 Low #5 — absolute paths via `path.resolve` so the test is CWD-independent):
```ts
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '../..'); // points to apps/tournament-api
const eslint = new ESLint({
  cwd: apiRoot,
  overrideConfigFile: resolve(apiRoot, 'eslint.config.js'),
});
const fixturePath = resolve(apiRoot, 'src/lib/__fixtures__/activity-direct-write-violation.ts');
const results = await eslint.lintFiles([fixturePath]);
expect(results[0].messages.some(m => m.ruleId === 'no-restricted-syntax')).toBe(true);
```

### Layer 6 — Integration tests (`apps/tournament-api/src/lib/activity.test.ts`, REWRITE)

Existing stub test (asserting "no rows written") is replaced by per-type integration tests:

1. **Each of the 13 event types — valid payload inserts correctly.** For each `ActivityType`, build a valid event payload, call `emitActivity(tx, event)`, then SELECT from `activity` and assert: `event_id`, `round_id`, `type`, `actor_player_id`, `payload_json` round-trip identically. 13 tests.
2. **Invalid payload per type — Zod throws, no insert.** For each `ActivityType`, pass an invalid payload (e.g., negative `grossStrokes`, missing `eventId`, wrong field type). Assert `emitActivity` throws `ZodError` and the row count in `activity` is unchanged. 13 tests (or one parameterized matrix).
3. **Missing `eventId` — base-shape enforcement.** Pass an event with `eventId` undefined. Assert ZodError; no insert.
4. **Invalid type — discriminator violation.** Pass `{ type: 'not.a.real.type', eventId: '...' }`. Assert ZodError ('invalid_union_discriminator' or equivalent).
5. **Transaction rollback on Zod throw.** Build a transaction that does `tx.insert(events)` (legitimate) THEN `emitActivity(tx, badEvent)`. Assert the surrounding `events` insert is also rolled back (the bad event's throw bubbles up past the outer transaction).
6. **ESLint rule test.** Add a fixture file `src/lib/__fixtures__/activity-direct-write-violation.ts` (gitignored from `eslint .` via the rule's allowlist? — no, the fixture file should be lint-failing). Run `pnpm --filter @tournament/api lint` against the fixture; assert the rule fires. v1 alternative: use eslint's `RuleTester` API in a unit test against the rule itself with synthetic source strings — cleaner and doesn't pollute the build with intentionally-failing files.

For test #6 (RuleTester), the test file is `apps/tournament-api/src/lib/activity.eslint-rule.test.ts` and it consumes `RuleTester` from `eslint` directly with a flat-config-compatible setup.

### Layer 7 — Sprint-status hygiene (BUNDLED with this story per Josh's call after T7-7)

While editing `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`:
- Flip stale epic status flags: `epic-T1: in-progress → done`, `epic-T2: in-progress → done`, `epic-T5: in-progress → done`, `epic-T7: in-progress → done`. All four epics have every story `done`; the in-progress flag is purely stale.
- Flip `epic-T8: backlog → in-progress` (will happen automatically via create-story; documenting here for completeness).
- Flip T8-1 status: `backlog → ready-for-dev → in-progress → review → done` through the cycle.

These are pure yaml hygiene; bundling them into the T8-1 commit avoids a one-line standalone "cleanup" commit.

## Acceptance Criteria

**AC #1 — Schema + migration.**

**Given** `apps/tournament-api/src/db/schema/activity.ts`
**When** inspected
**Then** it defines the `activity` table with: `id PK`, `event_id FK → events.id ON DELETE CASCADE NOT NULL`, `round_id FK → rounds.id ON DELETE CASCADE NULLABLE`, `type TEXT NOT NULL`, `actor_player_id FK → players.id ON DELETE RESTRICT NULLABLE`, `payload_json TEXT NOT NULL`, `created_at INTEGER NOT NULL`, plus `tenant_id` and `context_id` from `ecosystemColumns()`. Composite index `idx_activity_event_created_id (event_id, created_at DESC, id DESC)` is declared. Schema is exported from `apps/tournament-api/src/db/schema/index.ts`.

**Given** `apps/tournament-api/src/db/migrations/0010_activity_spine.sql`
**When** inspected
**Then** it contains the CREATE TABLE statement matching the Drizzle schema and the CREATE INDEX statement for `idx_activity_event_created_id`. The Drizzle journal/snapshot files (`meta/_journal.json`, `meta/0010_snapshot.json`) are also part of the commit. `pnpm --filter @tournament/api test` runs the migration successfully against the in-memory test DB.

**AC #2 — Discriminated union types + Zod schemas.**

**Given** `apps/tournament-api/src/engine/types/activity-events.ts`
**When** inspected
**Then** it exports: (a) `ActivityEventBase` interface with `eventId: string` REQUIRED + `roundId?: string` + `actorPlayerId?: string`; (b) discriminated union `ActivityEvent` with one variant per `ActivityType` value (13 types listed above); (c) `ACTIVITY_TYPES` readonly tuple of the 13 strings, typed `as const satisfies readonly ActivityType[]` so adding a new type without updating the tuple fails compilation; (d) `activityEventSchemas: Record<ActivityType, z.ZodSchema>` mapping each type to a Zod schema that matches the corresponding TS shape; (e) the `press.auto_fired` Zod schema enforces the `team`-XOR-`betId` rule via `z.refine`.

**AC #3 — Typed emitter replaces stub.**

**Given** `apps/tournament-api/src/lib/activity.ts`
**When** inspected
**Then** the OLD stub interface `EmitActivityArgs` is deleted; the OLD no-op body is deleted; the new export is `emitActivity(tx: Tx | Db, event: ActivityEvent): Promise<void>` which: (a) looks up `activityEventSchemas[event.type]`; (b) calls `const parsed = schema.parse(event)` — a parse failure throws `ZodError` and the calling transaction rolls back; (c) inserts into `activity` with `id = randomUUID()`, `event_id = parsed.eventId`, `round_id = parsed.roundId ?? null`, `type = parsed.type`, `actor_player_id = parsed.actorPlayerId ?? null`, `payload_json = JSON.stringify(parsed)`, `created_at = Date.now()`, `tenant_id = 'guyan'`, `context_id = 'activity:' + parsed.eventId`. Using `parsed` (NOT the input `event`) for column population AND for the JSON-serialized payload is the load-bearing rule that prevents unknown-key drift into the persisted JSON.

**AC #4 — All call sites migrated to typed signature.**

**Given** the 14 existing `emitActivity` call sites enumerated in Layer 4
**When** inspected
**Then** each call passes a typed `ActivityEvent` matching its declared variant. Specifically: `score.committed` includes `par + toPar + isBirdieOrBetter + scorerPlayerId` computed from a course-revision lookup at score-commit time inside the same transaction. `score.corrected` uses `priorGross/newGross`. All event-scoped types include `eventId`. `round.completed` and `round.complete_rolled_back` emit calls are DELETED (not in v1 enum; were stub no-ops). All sites where `round.eventId` may be null guard the emit with an `if (round.eventId !== null)` check.

**Given** `pnpm --filter @tournament/api typecheck`
**When** run
**Then** it exits 0 — every call site compiles against the new typed signature.

**AC #5 — ESLint rule blocks direct table writes.**

**Given** `apps/tournament-api/eslint.config.js`
**When** inspected
**Then** it contains TWO `no-restricted-syntax` rule entries (one for the member-call shape `tx.insert(activity)`, one for the destructured-call shape `insert(activity)`). Each entry's selector uses a regex that matches `insert | update | delete` so the gate covers all three Drizzle write methods (codex spec round-1 High #4). The flat-config block's `ignores` allowlist contains `src/lib/activity.ts`, `src/lib/activity.test.ts`, and `src/lib/activity.eslint-rule.test.ts`. The rule message names `emitActivity()` from `src/lib/activity.ts` as the legitimate path.

**Given** `apps/tournament-api/src/lib/activity.eslint-rule.test.ts` (NEW, RuleTester selector tests)
**When** run
**Then** asserts: (a) `tx.insert(activity).values(...)` fails the rule; (b) `tx.update(activity).set(...)` fails; (c) `tx.delete(activity).where(...)` fails; (d) destructured `insert(activity)` (after `const insert = tx.insert`) fails; (e) `tx.insert(otherTable).values(...)` is unaffected; (f) `insert(otherTable)` (destructured, different table) is unaffected.

**Given** `apps/tournament-api/src/lib/__fixtures__/activity-direct-write-violation.ts` (NEW, lint fixture) AND a vitest test runner that programmatically invokes ESLint against the fixture
**When** the vitest test runs
**Then** asserts: (a) the fixture's `tx.insert(activity).values(...)` line fails with `ruleId === 'no-restricted-syntax'`; (b) `lib/activity.ts` (the legitimate writer) lints clean — proving the flat-config `ignores` allowlist is effective end-to-end (NOT just at the RuleTester level). The fixture path is excluded from `tsconfig.json`'s typecheck via the per-app `exclude` array so the fixture's `declare const tx: any` hack does not affect typecheck.

**AC #6 — Per-type integration tests.**

**Given** `apps/tournament-api/src/lib/activity.test.ts` (REWRITTEN)
**When** run
**Then** verifies:
- Each of the 13 event types: valid payload inserts a row with all columns populated correctly (event_id, round_id, type, actor_player_id, payload_json round-trip, created_at numeric).
- Each of the 13 event types: invalid payload throws `ZodError`, row count in `activity` unchanged.
- Missing `eventId` (base-shape violation): throws `ZodError`.
- Invalid `type` (discriminator violation): throws `ZodError`.
- Transaction rollback: a tx that runs `emitActivity` with a bad event AFTER an unrelated insert rolls BOTH back.
- Coverage: every variant in the discriminated union has at least one valid + one invalid test (asserted via a helper that reads `ACTIVITY_TYPES` and confirms the test suite exercised each).

**AC #7 — Sprint-status hygiene cleanup bundled.**

**Given** `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`
**When** inspected after this story commits
**Then** the stale `in-progress` flags on `epic-T1`, `epic-T2`, `epic-T5`, `epic-T7` are flipped to `done` (every story under each is already `done`). `epic-T8` is `in-progress`. T8-1's row is `done`. No other epic or story status values change.

## Tasks / Subtasks

- [ ] **Task 1 — Schema + migration (AC #1).**
  - [ ] Write `apps/tournament-api/src/db/schema/activity.ts` per Layer 1.
  - [ ] Add `activity` to `apps/tournament-api/src/db/schema/index.ts` barrel export.
  - [ ] Run `pnpm --filter @tournament/api db:generate` (or the equivalent drizzle-kit invocation used in this repo) to generate `0010_activity_spine.sql` + journal + snapshot. Verify the generated SQL matches the schema.

- [ ] **Task 2 — Discriminated union types + Zod schemas (AC #2).**
  - [ ] Create `apps/tournament-api/src/engine/types/` directory if it doesn't exist.
  - [ ] Write `apps/tournament-api/src/engine/types/activity-events.ts` exporting `ActivityEventBase`, the 13 variant interfaces, the `ActivityEvent` discriminated union, `ActivityType`, `ACTIVITY_TYPES` tuple, and `activityEventSchemas` record.
  - [ ] Verify the TypeScript shapes match the Zod schemas (e.g., a `z.infer<typeof activityEventSchemas['score.committed']>` extends `ScoreCommittedEvent`).

- [ ] **Task 3 — Typed emitter (AC #3).**
  - [ ] Rewrite `apps/tournament-api/src/lib/activity.ts` per Layer 3.
  - [ ] Delete `EmitActivityArgs` interface and the old no-op body.

- [ ] **Task 4 — Migrate 14 call sites (AC #4).**
  - [ ] `routes/scores.ts` — add course-revision par lookup; reshape emit to typed `score.committed` with par/toPar/isBirdieOrBetter/scorerPlayerId.
  - [ ] `routes/presses.ts` — reshape both emits.
  - [ ] `services/press-orchestrator.ts` — reshape emit (auto_fired vs manual_fired branch).
  - [ ] `routes/round-lifecycle.ts` — DROP `round.completed` + `round.complete_rolled_back` emits; reshape `round.finalized` + `round.cancelled` (add eventId).
  - [ ] `routes/score-corrections.ts` — rename payload fields; add eventId.
  - [ ] `routes/scorer-assignments.ts` — add eventId.
  - [ ] `routes/event-rule-edits.ts`, `routes/sub-games.ts`, `routes/gallery.ts`, `routes/bets.ts` — reshape to typed variants.
  - [ ] Apply `if (round.eventId !== null)` guard at every site whose round may have null eventId.
  - [ ] Update `routes/event-rule-edits.integration.test.ts` (the existing test that spies on `emitActivity`) to match the new typed call shape.
  - [ ] `pnpm --filter @tournament/api typecheck` exits 0.

- [ ] **Task 5 — ESLint rule (AC #5).**
  - [ ] Add `no-restricted-syntax` rule + allowlist to `apps/tournament-api/eslint.config.js`.
  - [ ] Write `apps/tournament-api/src/lib/activity.eslint-rule.test.ts` using ESLint's `RuleTester` to verify the rule fires outside the allowlist and skips inside.

- [ ] **Task 6 — Integration tests (AC #6).**
  - [ ] Rewrite `apps/tournament-api/src/lib/activity.test.ts` per Layer 6.
  - [ ] Per-type valid + invalid + base-shape-missing + discriminator-violation + transaction-rollback assertions.

- [ ] **Task 7 — Regression sweep.**
  - [ ] `pnpm --filter @tournament/api test` — every previously-passing test still passes (875 baseline + new activity tests).
  - [ ] `pnpm -r typecheck` and `pnpm -r lint` — clean.
  - [ ] No tournament-web or engine changes; this is a tournament-api-only story.

- [ ] **Task 8 — Sprint-status hygiene (AC #7).**
  - [ ] Flip `epic-T1`, `epic-T2`, `epic-T5`, `epic-T7` from `in-progress` to `done` in sprint-status.yaml.

## Files this story will edit

- apps/tournament-api/src/db/schema/activity.ts
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/db/migrations/0010_activity_spine.sql
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/db/migrations/meta/0010_snapshot.json
- apps/tournament-api/src/engine/types/activity-events.ts
- apps/tournament-api/src/lib/activity.ts
- apps/tournament-api/src/lib/activity.test.ts
- apps/tournament-api/src/lib/activity.eslint-rule.test.ts
- apps/tournament-api/src/lib/__fixtures__/activity-direct-write-violation.ts
- apps/tournament-api/eslint.config.js
- apps/tournament-api/tsconfig.json
- apps/tournament-api/src/routes/scores.ts
- apps/tournament-api/src/routes/presses.ts
- apps/tournament-api/src/routes/round-lifecycle.ts
- apps/tournament-api/src/routes/score-corrections.ts
- apps/tournament-api/src/routes/scorer-assignments.ts
- apps/tournament-api/src/routes/event-rule-edits.ts
- apps/tournament-api/src/routes/event-rule-edits.integration.test.ts
- apps/tournament-api/src/routes/sub-games.ts
- apps/tournament-api/src/routes/gallery.ts
- apps/tournament-api/src/routes/bets.ts
- apps/tournament-api/src/services/press-orchestrator.ts
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Notes

### Architectural alignment

- **FD-5** (FR-C3, app-creates-pull): activity spine feeds the in-app feed; no push notifications, no email. T8-1 builds the spine; T8-2/T8-3 build the read surfaces.
- **D3-2** (loud failure): Zod-parse-throws inside the transaction is the literal embodiment. A bad payload rolls back the surrounding score/press/etc. insert, NOT a partial commit with bad data.
- **FD-6 ecosystem columns** (`tenant_id`, `context_id`): the activity table carries them via `ecosystemColumns()`. Emitter sets `context_id = 'activity:' + event.eventId` so a future cross-tenant query can scope by event.
- **No SQLite CHECK on type column**: app-layer Zod + the discriminated union enforce the 13-type allowlist. Mirrors `audit_log.entityType`'s posture (no CHECK; AUDIT_ENTITY_TYPES + writeAudit signature is the gate).

### Key references

- **Existing audit-log emitter** (`apps/tournament-api/src/lib/audit-log.ts`): shape model for `emitActivity`. `writeAudit(tx, args)` is the parallel pattern. T8-1's emitter is more strict (Zod parse before insert, discriminated union at type level vs. audit-log's polymorphic `payload: unknown`).
- **Stub emitter** (`apps/tournament-api/src/lib/activity.ts`): the file this story rewrites. Stub's docstring authorizes the breaking change.
- **Score-commit transaction** (`apps/tournament-api/src/routes/scores.ts:259-475`): the largest call-site migration. Course-revision par lookup is the new wrinkle — needs to query `course_revisions` and find the par for the specific holeNumber inside the same transaction.
- **Event rule-edit integration test** (`apps/tournament-api/src/routes/event-rule-edits.integration.test.ts:350`): spies on `emitActivity`. Migration must update the spy assertion to the new typed shape.

### Risk acceptance

- **Migration scope is large (14 call sites + ~22 files).** This is the unavoidable cost of T5-6's "stub now, migrate in T8.1" decision. The stub's docstring explicitly authorized this. Codex review should flag if any call site is missed.
- **Course-revision lookup at score-commit time adds one query per score-post.** The query is keyed on the round's `course_revision_id` (already known) and filtered to the specific hole — O(1) on an indexed table. No measurable perf impact at the Pinehurst scale (4 foursomes × 18 holes = 72 score-posts per round).
- **`round.completed` and `round.complete_rolled_back` emits are DROPPED.** These types are NOT in the v1 13-type enum. Per the epic spec's "Activity-type scope note", the v1 enum was deliberately scoped to types with concrete consumer surface (T8-2/T8-3 toast/banner/feed). State transitions like `round.completed` are recorded in `audit_log` (via writeAudit) and the round-state table itself; the activity feed doesn't show them. v1.5 can re-add via a spec amendment.
- **`emitActivity` accepts `Tx | Db`** at type level — a caller could pass `db` directly (no transaction) and a Zod throw would NOT roll back any sibling writes. This is a v1.5 polish concern (would require a Tx brand). For v1, code review enforces "always pass tx".

### Followups

- **Branded ID types** (`EventId`, `RoundId`, `PlayerId`, etc.): introducing them across tournament-api is a separate refactor story. T8-1 uses plain `string` to match existing convention.
- **`round.completed` + `round.complete_rolled_back`** activity types: deferred to v1.5 if/when a UI surface needs them. Audit log + round-state table cover the bookkeeping today.
- **Type-level `Tx`-only enforcement** for `emitActivity`: branded `Transaction` type would catch "called with `db` not tx" mistakes at compile time. v1.5.
- **Activity-table cleanup retention**: no retention policy in v1. Activities accumulate indefinitely. v1.5 retention story (e.g., delete after event completion + 30 days) when growth becomes a concern.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

### Completion Notes List

### File List
