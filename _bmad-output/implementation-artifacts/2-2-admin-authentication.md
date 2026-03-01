# Story 2.2: Admin Authentication

Status: done

## Story

As an admin (Jason or Josh),
I want to log in with my username and password and receive a secure session cookie,
so that I can access protected admin routes and log out when done.

## Acceptance Criteria

1. `POST /api/admin/login` accepts `{ username, password }` JSON body validated by Zod; returns `{ adminId, username }` with HTTP 200 and sets a `session` cookie (`httpOnly`, `SameSite=Strict`, `Secure` in production) on success.

2. `POST /api/admin/login` returns `{ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }` HTTP 401 when username does not exist or password does not match the bcrypt hash.

3. `POST /api/admin/login` returns `{ error: "...", code: "VALIDATION_ERROR", issues: [...] }` HTTP 400 when the request body fails Zod validation (missing fields, wrong types).

4. `POST /api/admin/logout` (protected by `adminAuthMiddleware`) deletes the current session from the `sessions` table, clears the `session` cookie, and returns `{ success: true }` HTTP 200.

5. `POST /api/admin/logout` returns HTTP 401 if called without a valid session cookie (enforced by `adminAuthMiddleware`).

6. Session ID is a UUID (`crypto.randomUUID()`); stored in the `sessions` table with `expires_at = Date.now() + 24h`; returned as the `session` cookie value.

7. `apps/api/src/schemas/admin.ts` exports `loginSchema` (Zod): `{ username: z.string().min(1), password: z.string().min(1) }`.

8. Auth routes are registered on the Hono app in `apps/api/src/index.ts` under `/api/admin`.

9. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

10. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

11. Vitest is configured for `apps/api`; `pnpm --filter @wolf-cup/api test` runs and passes tests covering: successful login, wrong password, unknown user, validation error, successful logout, unauthenticated logout attempt.

## Tasks / Subtasks

- [x] Task 1: Add vitest to apps/api (AC: #11)
  - [x] Add `vitest` and `@vitest/coverage-v8` to `devDependencies` in `apps/api/package.json`
  - [x] Add `"test": "vitest run"` script to `apps/api/package.json`
  - [x] Create `apps/api/vitest.config.ts` with `test: { environment: 'node' }`
  - [x] Verify `pnpm --filter @wolf-cup/api test` runs (empty suite is OK at this point)

- [x] Task 2: Create login Zod schema (AC: #7)
  - [x] Create `apps/api/src/schemas/admin.ts`
  - [x] Export `loginSchema`: `z.object({ username: z.string().min(1), password: z.string().min(1) })`
  - [x] Export inferred type: `export type LoginBody = z.infer<typeof loginSchema>`

- [x] Task 3: Implement auth routes (AC: #1, #2, #3, #4, #5, #6)
  - [x] Create `apps/api/src/routes/admin/auth.ts`
  - [x] Implement `POST /login`:
    - Parse and validate body with `loginSchema`; return 400 with Zod issues on failure
    - Query `admins` table by `username`; return 401 if not found
    - `bcrypt.compare(password, admin.passwordHash)`; return 401 if false
    - Generate session: `id = crypto.randomUUID()`, `expiresAt = Date.now() + SESSION_TTL_MS`
    - Insert into `sessions` table
    - Set `session` cookie: `httpOnly: true`, `sameSite: 'Strict'`, `secure: process.env.NODE_ENV === 'production'`, `maxAge: SESSION_TTL_MS / 1000`, `path: '/'`
    - Return `{ adminId: admin.id, username: admin.username }` HTTP 200
  - [x] Implement `POST /logout` (protected by `adminAuthMiddleware`):
    - Read `session` cookie value
    - Delete session from `sessions` table by ID
    - Clear `session` cookie (set `maxAge: 0`)
    - Return `{ success: true }` HTTP 200
  - [x] Export a Hono router from `auth.ts` (use `new Hono()` sub-app pattern)

- [x] Task 4: Register routes in app (AC: #8)
  - [x] Import auth router in `apps/api/src/index.ts`
  - [x] Mount at `/api/admin`: `app.route('/api/admin', adminAuthRouter)`

- [x] Task 5: Write tests (AC: #11)
  - [x] Create `apps/api/src/routes/admin/auth.test.ts`
  - [x] Set up test helper: create in-memory DB (`file::memory:?cache=shared` libsql URL), run migration, seed one test admin
  - [x] Test: `POST /api/admin/login` with valid credentials → 200 + session cookie set
  - [x] Test: `POST /api/admin/login` with wrong password → 401 INVALID_CREDENTIALS
  - [x] Test: `POST /api/admin/login` with unknown username → 401 INVALID_CREDENTIALS
  - [x] Test: `POST /api/admin/login` with missing body fields → 400 VALIDATION_ERROR
  - [x] Test: `POST /api/admin/logout` with valid session cookie → 200 + session deleted from DB
  - [x] Test: `POST /api/admin/logout` without cookie → 401 UNAUTHORIZED

- [x] Task 6: Typecheck and lint (AC: #9, #10)
  - [x] Run `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] Run `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] Run `pnpm --filter @wolf-cup/api test` — all 6 tests pass

## Dev Notes

### What Story 2.1 Already Provides
- `admins` table: `id`, `username`, `password_hash`, `created_at`
- `sessions` table: `id` (UUID text PK), `admin_id`, `created_at`, `expires_at`
- `adminAuthMiddleware`: reads `session` cookie → validates sessions table → sets `c.get('adminId')` → sliding expiry
- `db` singleton (`@libsql/client` + Drizzle)
- `Variables` type in `src/types.ts`
- Seed script creating Jason + Josh admins

### Route Structure Pattern
Use Hono sub-app pattern for clean route organization:
```ts
// src/routes/admin/auth.ts
import { Hono } from 'hono';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();
app.post('/login', async (c) => { ... });
app.post('/logout', adminAuthMiddleware, async (c) => { ... });
export default app;

// src/index.ts
import adminAuthRouter from './routes/admin/auth.js';
app.route('/api/admin', adminAuthRouter);
// Results in: POST /api/admin/login, POST /api/admin/logout
```

### Cookie Configuration
```ts
import { setCookie, deleteCookie } from 'hono/cookie';

// On login:
setCookie(c, 'session', sessionId, {
  httpOnly: true,
  sameSite: 'Strict',
  secure: process.env['NODE_ENV'] === 'production',
  maxAge: SESSION_TTL_MS / 1000,  // seconds
  path: '/',
});

// On logout:
deleteCookie(c, 'session', { path: '/' });
```

### SESSION_TTL_MS constant
Define once in `src/routes/admin/auth.ts` or extract to `src/constants.ts`. The middleware already has its own copy. For now, define locally in the auth routes file.

### Zod Validation Error Response
```ts
import { z } from 'zod';
const result = loginSchema.safeParse(await c.req.json());
if (!result.success) {
  return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues }, 400);
}
```

### Test Setup Strategy
For unit/integration tests, override `DB_PATH` to use an in-memory libsql URL, run the migration programmatically, and seed a test admin. Use `app.request()` from Hono to make test requests:
```ts
import { app } from '../../index.js';  // or import the sub-app directly
const res = await app.request('/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'testadmin', password: 'testpass' }),
});
```

**Important:** The test DB needs to be isolated from `db/index.ts` singleton. Consider exporting a `createApp(db)` factory or mocking the db module. The simplest approach for this story: import the sub-router directly and use dependency injection, OR use environment variables to redirect to a test DB before the module loads.

### Security Notes
- Never return different error messages for "user not found" vs "wrong password" — both return 401 INVALID_CREDENTIALS (prevents user enumeration)
- `bcrypt.compare` is timing-safe — no need for additional timing attack mitigation
- `Secure` cookie flag: only set in production; local dev uses HTTP

### Project Structure Notes
Files to create/modify:
- `apps/api/package.json` — add vitest, test script
- `apps/api/vitest.config.ts` — new
- `apps/api/src/schemas/admin.ts` — new
- `apps/api/src/routes/admin/auth.ts` — new
- `apps/api/src/routes/admin/auth.test.ts` — new
- `apps/api/src/index.ts` — register admin auth router

### References
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication]
- [Source: _bmad-output/planning-artifacts/architecture.md#API Layer]
- FR63: Admin panel restricted to Jason and Josh (session auth)
- NFR22: Session auth with sliding expiry
- NFR23: Entry codes invalidated when new code set or round closed
- Story 2.1 Dev Agent Record (middleware + schema already implemented)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `vi.mock` async factory used to create in-memory libsql DB for test isolation; `drizzle-orm/libsql/migrator` used to run existing migration against the in-memory DB before tests.
- TypeScript error on `sessionMatch![1]` (type `string | undefined`): fixed with `!` non-null assertion since the regex capture group is required.

### Completion Notes List

- All 7 tests pass covering: valid login, wrong password, unknown username, validation error, malformed JSON body, valid logout (session deleted from DB + cookie cleared), unauthenticated logout.
- Test isolation: `vi.mock` replaces `db` singleton with in-memory libsql DB; migration runs in `beforeAll`; sessions table cleaned in `afterEach`.
- Code review fixes: added `SameSite=Strict` assertion to login cookie test (M1); added `Set-Cookie` clear assertion to logout test (M2); added malformed JSON test (L2).
- `pnpm --filter @wolf-cup/api typecheck` — zero errors.
- `pnpm --filter @wolf-cup/api lint` — zero errors.
- `pnpm --filter @wolf-cup/api test` — 7/7 pass.

### File List

- `apps/api/package.json`
- `apps/api/vitest.config.ts`
- `apps/api/src/schemas/admin.ts`
- `apps/api/src/routes/admin/auth.ts`
- `apps/api/src/routes/admin/auth.test.ts`
- `apps/api/src/index.ts`
- `pnpm-lock.yaml`
