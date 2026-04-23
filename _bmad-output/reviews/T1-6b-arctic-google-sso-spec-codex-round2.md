# Codex Review

- Generated: 2026-04-22T21:02:52.538Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md

## Summary

Round-1 items appear largely closed: API-agnostic `id_token` extraction, cookie clear attribute parity split into explicit helper functions, `error=` handling with a declined redirect, URL normalization via `new URL(...)`, expanded test plan, and a more permissive PKCE/state cookie validator. 

Remaining spec-gate concerns are primarily (1) libsql UNIQUE-violation detection being specified with likely-wrong/ambiguous error fields, and (2) `id_token` decoding doing zero claim validation beyond `sub` while also explicitly skipping signature verification. There are also smaller delivery/test brittleness concerns around the `/auth/declined` page dependency and an overly-specific assertion about Google’s auth URL.

Overall risk: medium

## Findings

1. [high] AC #9 libsql UNIQUE-violation catch is likely specified with incorrect/ambiguous error properties (may not be implementable as written)
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:93-100
   - Confidence: high
   - Why it matters: The race-safe bind flow hinges on reliably detecting UNIQUE/PK constraint violations so the loser request can re-SELECT and proceed. AC #9 currently states libsql throws `LibsqlError` with `code: 'SQLITE_CONSTRAINT'` and `extendedCode: 'SQLITE_CONSTRAINT_UNIQUE'` (value `2067` / `1555`). In `@libsql/client`, the exposed fields are commonly `code` as the *specific* string (often already `SQLITE_CONSTRAINT_UNIQUE`), plus numeric fields like `rawCode`/`rawExtendedCode` (2067 for UNIQUE, 1555 for PRIMARYKEY). If an implementer follows the spec literally and those fields don’t exist / don’t match, the code will misclassify the conflict as “unknown” and return 500 under race, defeating the purpose of AC #9.
   - Suggested fix: Tighten AC #9 to the concrete, testable predicates actually available in the chosen libsql client. Example spec language: catch `e instanceof LibsqlError` and treat as conflict if `(e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.rawExtendedCode === 2067 || e.rawExtendedCode === 1555)` (or whatever exact field names exist in your installed `@libsql/client`). If you want to be version-robust, specify: “treat as UNIQUE/PK conflict if `code` contains `'CONSTRAINT_UNIQUE'`/`'CONSTRAINT_PRIMARYKEY'` OR numeric extended code is 2067/1555.” Update AC #11’s race test to assert against the same predicate.

2. [medium] ID token handling validates only `sub` and explicitly skips signature verification; no `iss`/`aud`/`exp` checks are required
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:63-75
   - Confidence: medium
   - Why it matters: Even if you intentionally skip JWT signature verification (per AC #6 step 6), the spec currently requires no validation of standard ID token claims (`iss`, `aud`, `exp`). If anything in the token exchange plumbing is misconfigured (wrong client, wrong issuer endpoint, unexpected token shape across arctic versions) or the response is tampered with in transit in a way TLS doesn’t catch at the application boundary (e.g., compromised trust store / proxy), the system could bind the wrong identity. Verifying these claims is low-cost (pure JSON checks) and materially reduces the blast radius of misconfiguration.
   - Suggested fix: Amend AC #6 step 6 to also decode and validate at least: `iss` is one of Google’s expected issuers, `aud` equals `env.GOOGLE_OAUTH_CLIENT_ID` (or contains it if array), and `exp` is a number in the future with a small clock-skew allowance. Keep signature verification skipped if that’s a deliberate decision, but require these claim checks and define the error mapping (likely the same 502 `oauth_invalid_id_token`).

3. [medium] `/auth/declined` redirect is a cross-app dependency that may ship as a 404 unless tournament-web work is scheduled
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:55
   - Confidence: high
   - Why it matters: AC #6 step 1 hard-depends on tournament-web serving `${PUBLIC_APP_URL}/auth/declined`. The spec notes it’s out of scope and can be a stub, but without an explicit ticket/AC in tournament-web, production will redirect users to a missing page on consent cancel. That’s a user-visible regression on a common path (people do cancel).
   - Suggested fix: Add an explicit follow-up task/story for tournament-web to add `/auth/declined` (even a static page), or change the redirect target to something guaranteed to exist today (e.g. `new URL('/?auth=declined', PUBLIC_APP_URL)`), with tournament-web optionally rendering a banner based on the query param.

4. [low] Test expectation for Google authorization URL is likely too specific and could be brittle across arctic/Google endpoint variations
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:111-113
   - Confidence: high
   - Why it matters: AC #11 expects the redirect URL to start with `https://accounts.google.com/o/oauth2/v2/auth?`. Depending on arctic version/provider implementation, Google may use different auth paths (`/o/oauth2/auth`, `/o/oauth2/v2/auth`) and parameter ordering/encoding will vary. A too-specific string-prefix assertion can cause false-negative tests unrelated to functional correctness.
   - Suggested fix: Specify the test should parse the URL and assert on stable invariants: `url.origin === 'https://accounts.google.com'` and `url.pathname` matches an allowed set/pattern, plus required query params exist (`client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `code_challenge`, `code_challenge_method`).

5. [low] Intermediate OAuth cookies are not required to be cleared on non-declined error exits (missing params/cookies/state mismatch)
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:56-58
   - Confidence: medium
   - Why it matters: On several 400 exits (missing params, missing cookies, state mismatch), the spec does not require emitting clear-cookie headers. While not strictly necessary, leaving stale state/verifier cookies can create confusing subsequent failures (e.g., if the user replays an old callback URL) and retains unneeded sensitive intermediate material longer than required.
   - Suggested fix: Consider requiring `oauthFlowClearHeader(...)` to be emitted on all callback terminal branches (both success and any error), or at least on `oauth_missing_params` and `oauth_state_mismatch`. Update AC #11 to cover the chosen behavior.

## Strengths

- AC #6 callback flow is significantly clearer and now includes the provider-declined (`error=`) path with cookie clearing and a user-friendly redirect (lines 55-55).
- Cookie clearing attribute parity is explicitly required and test-covered, addressing a common real-world bug where cookies don’t actually clear in production (lines 46-49, 120-121).
- URL normalization via `new URL(..., PUBLIC_APP_URL)` is correctly specified for both callback construction and final redirect, avoiding trailing-slash and path-component pitfalls (lines 28-31, 80-81).
- Expanded test plan (≥12 route cases + smoke tests) meaningfully improves regression protection, including malformed `id_token` and bind race coverage (lines 108-123).

## Warnings

None.
