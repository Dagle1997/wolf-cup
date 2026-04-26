# Codex Review

- Generated: 2026-04-26T18:06:21.998Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-web/package.json, apps/tournament-web/vitest.config.ts, apps/tournament-web/src/test-setup.ts, apps/tournament-web/src/routes/admin.courses.upload.tsx, apps/tournament-web/src/routes/admin.courses.upload.test.tsx, apps/tournament-web/src/routeTree.gen.ts, _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Summary

Core story behavior is largely present: /api/auth/status contract is implemented and well-tested; the upload page component has the 4-state UI and error-code→message mapping; web test infra is wired (jsdom + setupFiles) and 4 component tests exist.

However, there are two concrete spec→code gaps/risks that warrant changes before commit:
1) The auth-status loader does not implement the spec’s TanStack Query caching/retry contract (Risk Acceptance §3), so navigation will refetch every time and there’s no explicit retry=0/staleTime=30s behavior.
2) The upload cancel/unmount behavior can still allow late responses to set state after the user cancels (race) and doesn’t abort an in-flight request on unmount.

Also: auth.ts introduces a second cookie parser that duplicates an existing helper in the same file, increasing divergence risk.

Verdict: NEEDS-CHANGES (medium issues).

Overall risk: medium

## Findings

1. [medium] Auth-status loader does not implement the specified TanStack Query caching/retry contract (staleTime=30s, retry=0)
   - File: apps/tournament-web/src/routes/admin.courses.upload.tsx:44-57
   - Confidence: high
   - Why it matters: The story spec explicitly calls for caching auth-status per-tab with TanStack Query (staleTime: 30s) and no retries on failure. The current implementation always performs a raw fetch in beforeLoad via loadAuthStatus(), so repeated route transitions will refetch and you lose the defined retry/staleness semantics. This is a spec conformance gap and may become a performance/UX issue once multiple admin routes exist.
   - Suggested fix: Refactor loadAuthStatus() to use the app’s QueryClient (likely already exists given src/lib/query-client.test.ts) and define a query with { staleTime: 30_000, retry: 0 }.

Example shape (adapt to your project’s existing queryClient wiring):
```ts
import { queryOptions } from '@tanstack/react-query'
import { queryClient } from '../lib/query-client'

const authStatusQuery = queryOptions({
  queryKey: ['authStatus'],
  queryFn: loadAuthStatusRaw, // your current 5-step fetch implementation
  staleTime: 30_000,
  retry: 0,
})

export const Route = createFileRoute('/admin/courses/upload')({
  beforeLoad: async () => {
    const status = await queryClient.ensureQueryData(authStatusQuery)
    ...
  },
})
```
If your router context provides a queryClient, prefer that instead of importing a singleton.

Keep the 5-step fetch failure collapsing logic inside the queryFn so the query never throws (or set `throwOnError: false`).

2. [medium] Cancel/unmount race: a late fetch resolution can still set success/error state after user cancels; request not aborted on unmount
   - File: apps/tournament-web/src/routes/admin.courses.upload.tsx:93-140
   - Confidence: high
   - Why it matters: AC #7 expects cancel to return to idle with no error. Today, onCancel() aborts and reset() sets idle, but there’s no guard preventing the in-flight onSubmit() continuation from calling setState({kind:'success'|'error'}) if the response resolves before the abort takes effect (or if abort happens after response is already available). Additionally, if the component unmounts mid-upload (navigation away), the request is not aborted, which can cause unnecessary work and potential state updates after unmount in some edge conditions.
   - Suggested fix: Add a request identity guard + unmount cleanup:

1) Track an incrementing requestId in a ref; only update state if it matches.
2) Abort on unmount.

Sketch:
```ts
const reqIdRef = useRef(0)
useEffect(() => () => abortRef.current?.abort(), [])

async function onSubmit(e: React.FormEvent) {
  ...
  const myReqId = ++reqIdRef.current
  const ac = new AbortController()
  abortRef.current = ac
  setState({ kind: 'uploading' })

  try {
    const res = await fetch(...)
    if (ac.signal.aborted) return
    if (myReqId !== reqIdRef.current) return

    if (res.ok) {
      const data = await res.json()
      if (myReqId === reqIdRef.current) setState({ kind: 'success', data })
      return
    }
    const errBody = await res.json().catch(() => null)
    if (myReqId === reqIdRef.current) setState({ kind: 'error', ... })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    if (myReqId === reqIdRef.current) setState({ kind: 'error', ... })
  } finally {
    if (abortRef.current === ac) abortRef.current = null
  }
}

function onCancel() {
  reqIdRef.current++
  abortRef.current?.abort()
  reset()
}
```
This ensures cancel always “wins”.

3. [low] Duplicate cookie parsing helpers in auth.ts (extractCookieValue vs existing extractCookie) increases divergence risk
   - File: apps/tournament-api/src/routes/auth.ts:68-104
   - Confidence: high
   - Why it matters: The file already contains extractCookie(header, name) at lines 524-536, which is effectively identical logic to the new extractCookieValue() at lines 92-104. Duplicated helpers in the same module tend to drift, leading to inconsistent parsing behavior across endpoints over time.
   - Suggested fix: Remove extractCookieValue() and reuse the existing private extractCookie() for SESSION_COOKIE_NAME as well:
```ts
const sessionId = extractCookie(cookieHeader, SESSION_COOKIE_NAME)
```
If you want a name specific to “value”, rename extractCookie once and use it for both session + oauth cookies (still private to the module).

## Strengths

- /api/auth/status contract is implemented defensively (missing/invalid cookie → {player:null}; invalid session → {player:null}; valid → {id,isOrganizer}) and backed by 4 focused tests.
- The 5-step loader contract for fetch/ok/json/shape-collapse is implemented and avoids throwing on malformed responses.
- Upload UI implements the 4-state model (idle/uploading/success/error) with user-friendly code→message mapping and a generic fallback.
- Web test setup is correctly switched to jsdom and uses a single setupFiles entry; component tests use stubGlobal(fetch) per test and assert state transitions.

## Warnings

None.
