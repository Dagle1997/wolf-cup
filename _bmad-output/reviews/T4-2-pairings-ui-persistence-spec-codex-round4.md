# Codex Review

- Generated: 2026-04-27T21:23:35.909Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md

## Summary

Round-3 fixes appear to be reflected in this spec: middleware chain/order is explicitly documented (requireSession → requireOrganizer → bodyLimit → handler), lockedRounds mapping is now pinned to the (event_id, round_number) uniqueness, and the Regenerate visibility/“trip-critical” guarantee is clarified as build-time (no runtime flag). Remaining issues are mostly spec-level ambiguities/risks that could cause implementation drift.

Overall risk: medium

## Findings

1. [medium] Auth-before-bodyLimit order can weaken protection against anonymous oversized-body DoS (and spec’s rationale is slightly inaccurate)
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:204-212
   - Confidence: high
   - Why it matters: With the documented chain (requireSession/requireOrganizer before bodyLimit), an anonymous client’s oversized request will return 401 (as intended for precedence), but bodyLimit will not run for that request. If upstream layers (proxy/server/framework) don’t enforce a hard max body size, this can leave you exposed to bandwidth/memory pressure from large unauthenticated POSTs. Also, the text “don’t process unauthenticated bytes” is not strictly true: you still receive the bytes; you just avoid parsing JSON/Zod.
   - Suggested fix: Keep the precedence if it’s a product requirement, but explicitly require an infrastructure/server-level max body size for all requests (preferred), or add a global body-size limit middleware earlier in the stack (before auth) that rejects egregiously large bodies while still allowing the route-specific 16KB check post-auth. Adjust the wording to reflect “don’t parse unauthenticated bodies” rather than “don’t process bytes.”

2. [medium] Hardcoded tenant_id default 'guyan' in schema section risks drift vs TENANT_ID-scoped behavior
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:27-38
   - Confidence: high
   - Why it matters: Risk §3’s schema sketch sets `tenant_id` default to the literal `'guyan'`, while later sections assert all queries are scoped by `tenant_id = TENANT_ID` (line 352) and that cross-tenant access returns 404. If the app’s tenant is not always 'guyan' (or changes in tests), this default can create incorrect writes (wrong tenant) or mask missing tenant assignment in inserts.
   - Suggested fix: Either (a) remove the hardcoded default from the spec and require tenant_id always be explicitly set from TENANT_ID in inserts, or (b) explicitly justify that tournament is single-tenant and TENANT_ID is always 'guyan'. Ensure ACs/tests cover cross-tenant writes/reads so a wrong default can’t slip through.

3. [low] Regenerate button visibility wording could still be misread as requiring runtime feature-detection
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:13-15
   - Confidence: high
   - Why it matters: The Story section correctly states “unconditionally available” because T4-1 is shipped and that absence would be compile-time (no import). However AC #6 still includes “HIDE if T4-1 not imported / available” (line 255), which some implementers may interpret as adding a runtime capability check/flag (contrary to the stated constraint).
   - Suggested fix: Change AC #6 phrasing to explicitly say “Only omitted in the hypothetical build where T4-1 is not imported (compile-time); no runtime feature detection/flagging.”

## Strengths

- Round-3 middleware precedence/order is now explicitly stated and tied to an existing pattern reference (T3-3/T3-9).
- lockedRounds mapping ambiguity is resolved with a concrete uniqueness guarantee on (event_id, round_number) and a clear server resolution query.
- Trip-critical guarantee vs shipped T4-1 is documented clearly as a build-time contract (no runtime flag), reducing implementation ambiguity.
- Path footprint/allowlist is explicit and appropriately narrow (no SHARED / no lockfile).

## Warnings

None.
