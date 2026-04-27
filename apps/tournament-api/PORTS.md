# Ports — tournament-api

Tracks files ported from Wolf Cup (`apps/api/**`) into tournament-api. Per the engine-boundary rule (FD-1 / FD-2), tournament-api may NOT import from Wolf Cup directly; instead, source files are copied with a provenance header and tracked here for future "re-sync against upstream" reviews.

When upstream Wolf Cup changes a ported source file, the `Last-checked-for-updates` column is the signal to re-evaluate whether the port needs an update.

| Target file | Source file | Source commit | Ported-on date | Deltas | Last-checked-for-updates |
|---|---|---|---|---|---|
| `apps/tournament-api/src/lib/ghin-client.ts` | `apps/api/src/lib/ghin-client.ts` | `3a38700303bd71a86c6de3621088fe161469d8b0` | 2026-04-27 | env reads via `src/lib/env.ts` (was `process.env`). **KNOWN LIMITATION:** state='WV' hardcoded upstream regardless of any future `?state=` query param value (preserved from source for v1 byte-for-byte parity). | 2026-04-27 |
