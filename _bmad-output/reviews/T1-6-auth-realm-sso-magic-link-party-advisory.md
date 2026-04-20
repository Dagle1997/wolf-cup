# T1-6 Party Advisory — 4 Design Forks + Scope Check

- **Generated:** 2026-04-20 (non-interactive, advisory only — does NOT resolve the pending gate)
- **Gate marker:** `_bmad-output/implementation-artifacts/tournament/.director-pending-gate.json` (still pending Josh's decision)
- **Purpose:** crystallize each agent's pick on the 4 forks + scope so Josh can see where the party agrees and where it's genuinely split

## Summary

Party converges 4/5 on a minimum-viable-auth-now shape: **1c + 2b + 3a + 4a + s2** — defer magic-link, store OAuth identities in a separate table, make cookies env-aware, validate `next`, and split the story into three smaller cycles. The one material dissent is Amelia (Dev), who argues for **1b + s1** (stub magic-link inside a single cycle) to avoid the ceremony cost of two extra director cycles when T2.3/T2.5 are waiting. Forks 2/3/4 get unanimous picks across all agents. Fork 1 + scope are the only real disagreements.

## Per-agent picks

### 📊 Mary — Analyst

| Q | Pick | Rationale |
|---|------|-----------|
| 1 | **1c (defer magic-link)** | Magic-link without an email column is solving a shape, not a user journey; ship it when the schema can support it end-to-end. |
| 2 | **2b (oauth_identities table)** | Preserves the epic's "T1.6 minimal players slice, T3.1 extends" narrative exactly; zero rewording upstream. |
| 3 | **3a (env-aware)** | Dev/test cookies matter for the 10+ integration tests AC #16 requires; Secure-only-in-prod is standard. |
| 4 | **4a (validate next)** | Even if unused at v1, baking this in costs ~5 LOC and prevents a real phishing class. |
| s | **s2 (split)** | Smaller stories move faster through gates and let Josh review SSO + schema in isolation before magic-link design is locked. |

### 🏗️ Winston — Architect

| Q | Pick | Rationale |
|---|------|-----------|
| 1 | **1c** | Partial magic-link ships schema that encodes a half-baked data model (nullable FKs, placeholder rows) — that shape will haunt every query against magic_link_tokens until v2 rewrites it. |
| 2 | **2b** | Many-to-many (one player ↔ N OAuth providers in future) is the right relational shape anyway; denormalizing into a `google_sub` column on players is premature optimization that contradicts FD-7 (future Apple SSO). |
| 3 | **3a** | Cookie attributes as env-aware is the architecture's implicit model (env.NODE_ENV already gates other behavior); prod-only is fragile. |
| 4 | **4a** | Open-redirect hardening is a fixed cost regardless of when you pay it; pay it now while the callback handler is under active review. |
| s | **s2** | One coherent-as-possible slice per cycle; T1-6a (schema foundation) is load-bearing for T2 regardless, so ship it first and unblock the epic. |

### 📋 John — Product Manager

| Q | Pick | Rationale |
|---|------|-----------|
| 1 | **1c** | Pinehurst is 8 Google-account-holding golf buddies; they'll all use SSO. Magic-link is a fallback that matters for future non-Google invitees, not for the May 7 trip. Defer. |
| 2 | **2b** | No user-visible cost; pure backend shape choice; aligns with epic wording. |
| 3 | **3a** | Shipping a feature that integration tests can't exercise is a red flag for QA cycles; env-aware is the pragmatic call. |
| 4 | **4a** | Security hygiene, cheap. |
| s | **s2** | Faster feedback to Josh on the spec/commit cycle; 1 big story = 1 big blast radius if something needs reworking. T1-6a unblocks T2 without waiting on OAuth polish. |

### 🧪 Quinn — QA

| Q | Pick | Rationale |
|---|------|-----------|
| 1 | **1c** | Testing magic-link-with-placeholder-players is an awkward test surface — stubs over stubs over nullable FKs; testing "it's not here yet" is cleaner. |
| 2 | **2b** | Easier to write focused tests against an `oauth_identities` table than against a column on `players`; future Apple SSO lands as rows, not schema changes. |
| 3 | **3a** | Hard to test cookies in integration tests without env-aware attributes; this is the difference between CI green and flaky auth tests. |
| 4 | **4a** | One extra unit test to cover the validator; worth the minute. |
| s | **s2** | Each sub-story has its own focused test suite; one mega-story means one mega test review session — harder to do well. |

### 💻 Amelia — Dev

| Q | Pick | Rationale |
|---|------|-----------|
| 1 | **1b (stub-only)** | `magic_link_tokens.player_id` nullable is ~3 lines of schema + a 501 consume handler. Avoids opening a new story just to revisit this file later — single round of churn on `auth.ts`. |
| 2 | **2b** | Same as others; keeps churn minimal. One new schema file, one clean table. |
| 3 | **3a** | Spec literally can't be impl'd-and-tested without this. Env-aware is table stakes. |
| 4 | **4a** | Four lines including the test. Non-issue. |
| s | **s1 (keep whole)** | Three stories = three director cycles = three spec+codex+impl+party+commit passes = ~3× the director-ceremony cost for the same end-state. Prefer one cycle with good internal scoping. |

## Consolidated party-consensus

| Fork | Party pick (majority) | Dissent | Why the majority |
|------|----------------------|---------|------------------|
| 1 | **1c — defer magic-link** | Amelia: 1b (stub-only) | 4 of 5 agents see magic-link-without-email as half-baked; Amelia's 1b is defensible if Josh strongly prefers one cycle, but every other lens flags the schema/test/product ergonomics. |
| 2 | **2b — oauth_identities table** | None | Unanimous. Aligns with epic, keeps players minimal, supports future Apple SSO without migration. |
| 3 | **3a — env-aware cookies** | None | Unanimous. Required for integration tests per AC #16; standard production pattern. |
| 4 | **4a — validate next** | None | Unanimous. Cheap + security-obvious. |
| Scope | **s2 — split into T1-6a/b(/c)** | Amelia: s1 (keep whole) | 4 of 5 prefer smaller cycles for review ergonomics + T2 unblocking speed. Amelia's s1 minimizes ceremony overhead — legit if Josh values throughput over granular checkpoints. |

## Tradeoff summary (if Josh accepts consensus)

**Going with 1c + 2b + 3a + 4a + s2 means:**
- **Wins:** smaller reviewable commits, clean separation of SSO from magic-link, epic AC preserved verbatim, oauth_identities table aligns with future Apple SSO (FD-4 latent), integration tests actually runnable locally, open-redirect hardened, dev experience stays unbroken.
- **Costs:** two extra director cycles beyond T1-6a (= ~2× the codex-round + gate-approval ceremony), magic-link ship date slips to post-T3.1 (accepted because Pinehurst is all Google accounts), slightly more schema files (oauth_identities + magic_link_tokens deferred).

**If Josh picks Amelia's dissent (1b + s1):**
- **Wins:** single director cycle, fewer approval gates, ~2-3 hours of ceremony saved, magic-link schema + rate limiter land now even if endpoints are stubs.
- **Costs:** magic_link_tokens ships with a nullable FK (schema debt), the stub endpoints will be touched again at T3.1 (two rounds of codex on the same file), integration tests cover "it 501s" rather than real behavior, larger single commit = harder to review + revert if a later AC surfaces a bug.

**If Josh wants something in the middle:**
- **1c + s2** but keep a single `T1-6b` story for OAuth: skip magic-link entirely at T1-6 + T1-6a, revisit magic-link after T3.1 lands email column. Clean scope, zero nullable-FK debt, still 2 director cycles instead of 3. This is probably the best-of-both-worlds option.

---

*This advisory does NOT resolve the pending gate. Josh's reply (e.g. `1c, 2b, 3a, 4a, s2` or any variation) triggers spec rewrite + re-codex.*
