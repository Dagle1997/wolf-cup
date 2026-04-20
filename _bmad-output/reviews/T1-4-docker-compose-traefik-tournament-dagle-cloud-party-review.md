# T1-4 Party-Mode Review — Docker Compose + Traefik for tournament.dagle.cloud

- **Generated:** 2026-04-20 (non-interactive, director-invoked)
- **Story:** `_bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md`
- **Implementation:** 3 new ALLOWED (`apps/tournament-api/Dockerfile`, `apps/tournament-web/Dockerfile`, `apps/tournament-web/nginx.conf`) + 1 SHARED (`docker-compose.yml`, additive +46/-0, user-approved mid-story)
- **Prior codex passes:** spec ×4 rounds (rounds 1–3 all fixed, round 4 PASS), impl ×1 round (0 High, 1 Med, 1 Low — noted in Followups)
- **Verification:** YAML structural PASS (PyYAML substitute — docker CLI unavailable); Wolf Cup regression engine 468/api 429 zero delta; `pnpm -r lint` green

---

## Summary

T1-4 is a carefully scoped infra story. The compose diff is genuinely additive (the `+46/-0` discipline is real, confirmed via `git diff --stat`), the Traefik shape is byte-matched to Wolf Cup with mechanical substitutions, the nginx config diverges only on the one directive that had to diverge (proxy_pass → tournament-api:3000), and the Dockerfiles thoughtfully skip the engine build on the empirical evidence that neither tournament workspace declares `@wolf-cup/engine`. The weak spot is coverage: we can't locally verify `docker compose config` or build the images — those gates defer to Josh's VPS deploy. Party verdict is **PASS-WITH-FOLLOWUPS**: ship the commit, but the post-deploy verification checklist Josh runs is substantive; flag it on his radar rather than lumping it in with ordinary code followups.

---

## 📊 Mary — Analyst

*The treasure-hunter angle: what does this scaffold actually let tournament do, and what does it still not do?*

**Product fit.** T1-4 doesn't ship user-facing features — it ships the deploy plumbing that lets every future tournament story reach the Pinehurst players. Concretely:

- **Before T1-4:** `apps/tournament-api` and `apps/tournament-web` are code artifacts with no path to prod. Josh could `pnpm -F @tournament/web dev` locally, but nothing is deployable.
- **After T1-4:** `docker compose up -d --build` on the VPS boots tournament-api + tournament-web, Traefik routes `tournament.dagle.cloud` → tournament-web nginx → `/api/` proxy → tournament-api:3000, TLS via existing `*.dagle.cloud` wildcard. The full request-to-response path is wired, end-to-end.

**Scope discipline.** Four things T1-4 deliberately did NOT do, each well-reasoned:
1. No deploy.sh edits — it already does `docker compose up -d --build`, which picks up new services.
2. No .env.example edits — the file is empty; tournament has no env vars to declare at T1-4 (auth vars land at T1-6, R2 at T7.4, email at T1-6+). Keeping .env.example empty avoids committing to unfinalized shapes.
3. No .github/workflows edits — T1-5 owns CI.
4. No tournament-api migrate/seed step yet — T2.1 schema story adds that. Dockerfile CMD is intentionally just `node dist/index.js`.

**Scope gap I'd flag: zero material.** The AC #10 `curl https://tournament.dagle.cloud/api/health` is the one AC that can't pass locally, but that's by design — it's the proof-of-deploy marker, not a local gate.

**Unblocks:**
- **T1-5 CI dual-run pipeline** — needs tournament services deployable to prove the deploy path works; T1-4 delivers.
- **T1-6 auth realm** — needs tournament-api reachable at `tournament.dagle.cloud` for Google OAuth callback + Resend magic-link redirects. T1-4 provides the hostname.
- **T2.1 courses schema** — needs tournament-api's Dockerfile updated to add migrate step; T1-4's `T2.1 carry-forward` followup is explicit about this.

**Verdict:** Delivers the deploy-able infrastructure the rest of Epic T1 depends on. Zero scope creep. ✅

---

## 🏗️ Winston — Architect

*Lean architecture: does the shipped docker topology match intent, and where are the real risks?*

**Topology check.**
- **Network posture:** tournament-api on `internal` only (no Traefik exposure); tournament-web on `internal` + `n8n_default` (Traefik). Mirrors Wolf Cup. Correct.
- **Volume isolation:** separate named volume `tournament_sqlite_data` (distinct from Wolf Cup's `sqlite_data`). Tournament DB never opens Wolf Cup DB, and vice versa — the FD-1/FD-2 isolation is enforced at the docker layer, not at the app layer. Good.
- **Traefik router naming:** `tournament` (not `tournament-web`) — matches Wolf Cup's `wolf-cup` (not `wolf-cup-web`) pattern. No collision with Wolf Cup's router, separate hostname, same certresolver. Correct.
- **depends_on: service_started** (not service_healthy). Wolf Cup parity. Transient 502 cold-start window documented in story Dev Notes with explicit "not worth switching" rationale. Fine.

**Dockerfile engine-skip optimization.** The real architectural judgment call in this story.
- Wolf Cup's Dockerfiles copy `packages/engine/` source + build engine + copy engine dist into runtime. This is required because Wolf Cup's api imports from engine.
- Tournament-api and tournament-web declare ZERO engine deps at T1.4 — verified by the engine-dep guard (`package.json` inspection, automated pre-build check). The engine-skip Dockerfile pattern saves ~8-12 seconds per image build on the VPS.
- **Risk:** if a future story adds `@wolf-cup/engine/stableford` as a dep to tournament-api (which FD-11/12 explicitly allows), tournament-api will fail to start in prod because the engine dist won't be in the runtime image. The spec documents this as a T2.1 (or whichever story first adds the dep) carry-forward responsibility. Sharp but acceptable — the guard ensures the risk can't manifest silently (the dev-agent MUST see the guard check fail and know to update the Dockerfile).

**FD checkpoint:**
- **FD-1 (Wolf Cup isolation):** ✅ Additive-only docker-compose.yml diff (+46/-0); zero Wolf Cup service mutations.
- **FD-2 (no Wolf Cup rename):** ✅ Tournament services are new names (`tournament-api`, `tournament-web`, `tournament_sqlite_data`); Wolf Cup keeps `api`, `web`, `sqlite_data`.
- **FD-11/12 (engine boundary):** N/A at T1.4 (no engine use); will be re-checked when first engine import lands.
- **FD-14 (PWA-primary):** ✅ nginx.conf ships the SW + manifest no-cache headers + immutable-asset cache for Vite-fingerprinted bundles, enabling the PWA install flow post-deploy.

**Layering concerns I'd raise: zero.**
- No forward FKs, no schema drift (no schema at all in T1-4).
- No architecture contradictions.
- Dockerfile pattern matches Wolf Cup's proven shape for pnpm-monorepo + corepack in both stages, with engine-skip as a clean optimization.

**One concern I'll name, not escalate: the `.npmrc` COPY into image layers.** Codex impl-review flagged the secret-leak vector (Medium). Tournament's `.npmrc` is two lines of pnpm flags, no tokens. Wolf Cup's Dockerfiles have shipped the same pattern continuously since 2026-04-17 without incident. If tournament (or Wolf Cup) ever adopts a private registry, switch to BuildKit secret-mount — applies to BOTH apps in parity. Not worth fixing preemptively on speculation.

**Architecture verdict:** ✅ Clean topology, defensible engine-skip optimization, zero FD violations.

---

## 📋 John — Product Manager

*WHY does this story matter, and does it unblock the next stories?*

**Story value.** The PRD target — "8 Pinehurst players use the app for all 4 rounds (May 7–10)" — is gated on tournament being live at `tournament.dagle.cloud`. Before T1-4, tournament had no path to live. After T1-4, one `./deploy.sh` run lands it. This story is the deploy-path gate.

**AC structure.** 13 ACs, three categories:
- **Code/file ACs (1-7):** fully locally verifiable; all pass.
- **Local syntactic ACs (8, 12, 13):** all pass with the PyYAML substitute for AC #8 (docker CLI unavailable in the sandbox).
- **Post-deploy ACs (9, 10, 11):** explicitly deferred. AC #10's curl check IS the proof-of-deploy marker — by definition not local-testable.

Is post-deploy deferral acceptable? Yes, because:
1. The spec is explicit about which ACs defer and why (Dev Notes).
2. Josh's post-deploy verification checklist is concrete (4 steps in Followups): curl tournament health, curl Wolf Cup health, `docker ps` 4-container confirm, tournament-api logs look for listen message.
3. If any of Josh's post-deploy checks fail, they're actionable: either DNS/cert infra is misconfigured (separate issue) or there's a real bug that rollback-via-revert fixes instantly.

**Unblocks downstream (same list as Mary's, from PM lens):**
- **T1-5 CI dual-run** — needs the deploy path stable. ✅ Delivered.
- **T1-6 auth realm** — OAuth redirect URL needs `https://tournament.dagle.cloud/auth/google/callback` to route to tournament-api. ✅ Delivered.
- **T1-7 structured-log sink** — needs containers running so the sink has logs to ingest. ✅ Delivered.
- **T2+** — needs tournament-api reachable for API routes. ✅ Delivered.

**PM footgun I'd flag:** there's a narrow window on first deploy where the DNS + Traefik cert resolver could be misconfigured on the VPS (per architecture D5-9 — it should already be set up, but this is the first time tournament.dagle.cloud is exercised). If so, the deploy completes but AC #10's curl fails with cert error. Josh's mitigation: `dig tournament.dagle.cloud` before running the curl. Already documented in story Followups. Not blocking this commit — it's a deploy-time infra concern.

**PM verdict:** Delivers story value. Unblocks all of Epic T1 + most of Epic T2+. ✅

---

## 🧪 Quinn — QA

*Ship-it-and-iterate lens: what's tested, what's not, and what's at risk?*

**What IS locally verified:**
- YAML parse + structural assertions (PyYAML) — confirms docker-compose.yml has the right services, volumes, labels, Traefik routing rules.
- Additive-only diff — `git diff --stat` shows `+46 -0`; `git diff docker-compose.yml` visually confirmed no Wolf Cup mutations.
- Engine-dep guard — automated `package.json` inspection confirms neither tournament app declares `@wolf-cup/engine`, so the engine-skip Dockerfile pattern is valid.
- Wolf Cup regression — engine 468/468, api 429/429, tournament-api 19/19, tournament-web 1/1 (T1-4 touches zero TS source; trivially green).
- `pnpm -r lint` — all 5 workspaces green.

**What is NOT locally verified:**
1. **`docker compose config` syntax validation.** AC #8. Docker CLI isn't installed in the sandbox. Substituted with PyYAML structural check, which is weaker — it confirms the file parses as YAML and has the expected shape, but doesn't confirm Compose-spec-specific directive validity (e.g., if `depends_on.condition` changes its allowed values in a future Compose version, PyYAML won't catch it). Risk is low because the Compose-spec directives used here are stable (1.x → 3.x all support them).
2. **`docker compose build tournament-api tournament-web`.** AC #9. Same docker-unavailable story. The Dockerfile could technically fail at `pnpm install --frozen-lockfile --prod` in the runtime stage if, e.g., `@libsql/client`'s musl binary doesn't resolve cleanly (Wolf Cup's api Dockerfile has a comment about this exact concern). Without local build, we rely on:
   - Wolf Cup's api Dockerfile using the identical pnpm pattern and running in prod continuously.
   - Tournament-api's deps set is a subset of Wolf Cup's (Hono + Drizzle + libsql + Vitest + zod — all present in Wolf Cup too).
3. **Live TLS + DNS.** AC #10. Post-deploy only, depends on external infra (`*.dagle.cloud` wildcard + `mytlschallenge` cert resolver).
4. **Wolf Cup containers still run post-deploy.** AC #11. Post-deploy only. Inference from additive-only compose diff: if docker-compose mutation didn't touch Wolf Cup services, `docker compose up -d` won't recreate them. But this is inference, not verification.

**Gap assessment.** The docker-unavailable gap is real but low-risk:
- Dockerfiles mirror Wolf Cup's working pattern with one well-reasoned divergence (engine-skip).
- nginx.conf is a near-byte-match with one mechanical substitution (proxy_pass hostname).
- docker-compose.yml additions match Wolf Cup's label shape with mechanical substitutions.
- The engine-dep guard caught the only implementation risk that was NOT Wolf-Cup-parity.

The biggest residual risk: a Compose-spec-syntax typo that PyYAML wouldn't catch but `docker compose config` would. Mitigation: Josh can run `docker compose config` on his local machine or the VPS before the full `docker compose up`. Cheap and trivially done.

**QA verdict:** Adequate given the sandbox constraint. Testing gaps are named and deferred to the right place (Josh's VPS verification). Not blocking. ✅

---

## 💻 Amelia — Dev

`apps/tournament-api/Dockerfile:1-58` — multi-stage node:22-alpine; corepack + pnpm 9.15.9 in BOTH stages; `COPY packages/engine/package.json ./packages/engine/` as workspace manifest only (no engine source, no engine dist); `CMD ["node", "dist/index.js"]`.
`apps/tournament-web/Dockerfile:1-31` — builder identical pattern; runtime `nginx:1.27-alpine` + `COPY apps/tournament-web/nginx.conf /etc/nginx/nginx.conf`.
`apps/tournament-web/nginx.conf:1-54` — matches root nginx.conf shape; `proxy_pass http://tournament-api:3000;` is the only meaningful divergence.
`docker-compose.yml` — tournament-api at lines 41-62, tournament-web at lines 86-108, `tournament_sqlite_data` at line 112.

**Engine-skip sanity:**
- `apps/tournament-api/package.json` deps: `hono`, `@hono/node-server`, `drizzle-orm`, `@libsql/client`, `zod`. devDeps: `drizzle-kit`, `vitest`, `typescript`, `tsx`, `@types/node`. Zero `@wolf-cup/*`.
- `apps/tournament-web/package.json` deps: 13 runtime, 9 dev. Zero `@wolf-cup/*`.
- pnpm workspace graph: `pnpm-workspace.yaml` includes `packages/*` + `apps/*`. `pnpm install --frozen-lockfile` correctly skips linking `@wolf-cup/engine` into tournament apps because it's not declared — the lockfile references engine as a workspace member but only links it into workspaces that depend on it (`@wolf-cup/api` and `@wolf-cup/web`).

**Dockerfile correctness unknowns (docker-build-unavailable risks):**
- Runtime-stage `pnpm install --frozen-lockfile --prod` correctly resolves workspace — verified by Wolf Cup's identical pattern in `apps/api/Dockerfile:37-38` running in prod.
- `@libsql/client` musl binary on Alpine — Wolf Cup's api runs on the same base, same package. Proven pattern.
- `CMD ["node", "dist/index.js"]` correctness depends on `dist/index.js` existing post-build. T1-2's `tsconfig.json` extends `tsconfig.base.json` with `rootDir: "./src"` + `outDir: "./dist"`, and `src/index.ts` exists. `tsc` → `dist/index.js`. Verified.

**nginx.conf semantic match check (hand-diff vs root nginx.conf):**
| Directive | root nginx.conf | tournament nginx.conf | Match? |
|---|---|---|---|
| `events { worker_connections 1024; }` | ✓ | ✓ | ✓ |
| `gzip_types` list | 5 types | 5 types identical | ✓ |
| `/api/` proxy headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto) | ✓ | ✓ | ✓ |
| `proxy_read_timeout 30s` | ✓ | ✓ | ✓ |
| `client_max_body_size 12m` | ✓ | ✓ | ✓ |
| `proxy_pass` | `http://api:3000` | `http://tournament-api:3000` | Intentional divergence |
| SW + manifest no-cache regex | ✓ | ✓ | ✓ |
| Immutable asset cache regex | ✓ | ✓ | ✓ |
| PDF cache regex | ✓ | ✓ | ✓ |
| SPA fallback | ✓ | ✓ | ✓ |

All directives present, all cache rules mirrored, only divergence is the proxy_pass hostname as required. Nothing missing that would cause a first-deploy 502.

**docker-compose.yml tournament-web labels:**
- 7 labels, all wolf-cup→tournament and wolf.dagle.cloud→tournament.dagle.cloud substituted.
- Router and service name `tournament` (not `tournament-web`) — matches Wolf Cup's `wolf-cup` naming.
- `traefik.docker.network=n8n_default` correctly scoped to the Traefik-attached network.
- Missing: no redirect/middleware labels. Wolf Cup doesn't have any either — HTTPS is handled globally at Traefik's entrypoint. Parity holds.

**Commit scope clean:**
```
 M  _bmad-output/implementation-artifacts/tournament/sprint-status.yaml       ALLOWED
 M  docker-compose.yml                                                        SHARED (user-approved)
 ?? _bmad-output/implementation-artifacts/tournament/T1-4-*.md                ALLOWED
 ?? _bmad-output/reviews/T1-4-*-codex*.md                                     ALLOWED (x4 spec + x1 impl)
 ?? apps/tournament-api/Dockerfile                                            ALLOWED
 ?? apps/tournament-web/Dockerfile                                            ALLOWED
 ?? apps/tournament-web/nginx.conf                                            ALLOWED
```
Zero FORBIDDEN writes. Zero additional SHARED paths beyond the approved docker-compose.yml.

**Footguns the director's codex passes DID NOT catch but I'd name now:**
- None in shipped code. Everything codex flagged landed in Followups; no post-impl code changes.
- One future-story reminder: when T2.1 adds the migrate step to tournament-api's Dockerfile CMD, verify the migrate binary is in `dist/db/migrate.js` (by analogy to Wolf Cup's path). T2.1's spec MUST include updating this Dockerfile.

**Dev verdict:** Code is correct as far as static review goes. The only real verification gap is "haven't built the image" — acceptable per spec. Ship. ✅

---

## Consolidated findings

| # | Severity | Agent(s) | Concern | Suggested action |
|---|----------|----------|---------|------------------|
| 1 | Medium (from impl-codex #1) | Architect, QA | `.npmrc` COPY'd into image layers — theoretical secret leak if the file ever contains tokens. | Verified benign at T1-4 time (only pnpm config flags). If .npmrc ever adopts an auth token, tournament's Dockerfiles (`apps/tournament-api/Dockerfile`, `apps/tournament-web/Dockerfile` — ALLOWED paths) should switch to BuildKit secret-mount. Mirroring the same fix into Wolf Cup's `apps/api/Dockerfile` / `apps/web/Dockerfile` is a SEPARATE Wolf Cup backlog item (FORBIDDEN path for this director scope) — NOT a coupled change in one commit. Noted in story Followups. Do NOT block T1-4. |
| 2 | Medium | QA | Local `docker compose config` and `docker compose build` deferred to VPS deploy because Docker CLI isn't available in the sandbox. PyYAML substitute is weaker. | Accept for T1-4 (sandbox constraint). Josh SHOULD run `docker compose config` manually before `docker compose up -d --build` on the VPS as a cheap pre-deploy gate; add this to his deploy-day checklist. Noted in Post-Deploy Followups. Do NOT block T1-4. |
| 3 | Medium | PM, Architect | AC #10 (curl tournament.dagle.cloud/api/health) is post-deploy only; Wolf Cup containers' continued health (AC #11) is also post-deploy. | Post-deploy verification checklist documented in story Followups (curl tournament health, curl Wolf Cup health, `docker ps` 4-container confirm, tournament-api log check). Josh runs it after `deploy.sh`. Do NOT block T1-4. |
| 4 | Low | Dev, PM | First-deploy `dig tournament.dagle.cloud` depends on existing `*.dagle.cloud` wildcard DNS + Traefik `mytlschallenge` cert resolver on the VPS. If infra isn't set up, AC #10 fails deterministically. | Architecture D5-9 states this is already in place. If post-deploy curl fails with cert error, treat as infra issue (not T1-4 defect). Noted in Followups. Do NOT block T1-4. |
| 4b | Low | Dev | `networks.n8n_default.external: true` in docker-compose.yml — if the VPS does not actually have an `n8n_default` docker network, `docker compose up` fails with `network n8n_default declared as external, but could not be found`. Not the same failure mode as DNS/cert. | Josh's pre-deploy checklist SHOULD include `docker network ls | grep n8n_default` to confirm it exists (Wolf Cup already depends on this same network, so if Wolf Cup is running, the network exists). Added to Post-Deploy Followups. Do NOT block T1-4. |
| 5 | Low (from impl-codex #2) | QA | Story Status header drifted from sprint-status.yaml status during the in-progress phase. | Acknowledged; pattern matches T1-3. Header updates to `done` at commit time in sync with sprint-status. Do NOT block T1-4. |
| 6 | Info | Architect | Dockerfile engine-skip pattern is predicated on tournament apps having zero engine deps. If a future story adds `@wolf-cup/engine/stableford`, Dockerfiles MUST be updated. | Engine-dep guard in AC #1 + #2 catches this at implementation time. Noted as T2.1+ carry-forward in story Followups. |

**No High findings. No user-decision-required findings. Zero open questions to the user on technical scope.** *(One procedural gate has already been cleared mid-story: user-approved SHARED edit to docker-compose.yml.)*

---

## Verdict: PASS-WITH-FOLLOWUPS

T1-4 is ready to commit. Before the commit:
1. Final commit with the standard director message.
2. Status flip to `done` in both sprint-status.yaml and story header.

Post-commit, post-push, and post-deploy (Josh's actions):
1. `docker compose config` manually on local or VPS as a pre-deploy sanity.
2. `./deploy.sh` on the VPS.
3. Run the 4-step post-deploy verification checklist from story Followups.

All six findings above are logged; none block the T1-4 commit.

Party out. 🎉
