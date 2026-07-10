## architect — round 1

**Scope.** Phase 2 lives in the working tree (uncommitted): `src/http/http-client.ts`
(observer request interceptor, response-fulfilled `fireResponse`, `handleResponseError`'s new 6th
positional `httpObserver` param + `fireError`), `src/client/datto-rmm-client.ts` (threading
`validated.httpObserver` raw into `createHttpClient`), and `tests/unit/http/http-client.test.ts`
(new `describe` block). The Phase 1 primitives (`observer.ts`, `http-observer.ts`,
`axios-augment.d.ts`, config schema, index exports) are already committed and reviewed under
Phase 1; I read them only as the contract Phase 2 consumes.

**Architecture / boundaries — sound.** The instrumentation stays in the transport layer where it
belongs: `http-client.ts` owns dispatch, and every capture routes through the shared
`captureRequest`/`fireRequest`/`fireResponse`/`fireError` primitives (Decision 2) rather than
re-implementing method-uppercasing or header normalization inline, so this site cannot drift from
the Phase 3 grant site. No new cross-layer import or cycle: `http-client.ts` already sits below
`datto-rmm-client.ts`, and `observer.ts` (internal, axios-aware) is not exported from `index.ts`.
The raw/unmasked threading is deliberate and documented (Decision 6 / R9); `logger` stays masked,
`httpObserver` bypasses `withUdfMasking` — correct.

**Correctness of the firing model — verified.** I traced the interceptor chain: observer
registered first + rate-limit second + `AuthManager.attachTo`'s Bearer third (post-return) →
axios LIFO executes Bearer → rate-limit → observer, so the observer runs last (post-auth,
post-throttle), `startedAt` excludes throttle wait, and the stash is written **only** for
dispatched requests (a rate-limiter or `getToken()` reject aborts the chain before the observer
runs, so no stash and no `onError` — matching the `!axios.isAxiosError` guard exclusion).
`fireError` fires exactly once per dispatched attempt (placed above every retry/throw branch),
retries re-enter the full chain (`instance.request(config)` re-fires `onRequest` and re-stamps
`startedAt`, overwriting the stale stash), and only the terminal 2xx reaches the fulfilled handler
(`fireResponse`). R2 (retries never collapsed) and R8 (raw error, never re-mapped) hold.

**Pagination absolute-URL non-issue.** I checked whether the naive `` `${baseURL}${url}` ``
composition can double an absolute URL: `resolveNextPageUrl` (`base-resource.ts`) converts every
server `nextPageUrl` to a relative `pathname + search` before dispatch, so `requestConfig.url` is
always relative in practice. The composition matches the ruled design decision (architect-r1-f2)
and is correct for every real call path — no finding.

One genuine gap below (test coverage of the one observer-firing branch that has distinct
semantics). The implementation itself is faithful to the plan with no substantive defect found.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Open | Architecture | `tests/unit/http/http-client.test.ts` (new observer `describe`); behavior in `src/http/http-client.ts:292-303` | The 401 / `onUnauthorized` retry is the one `handleResponseError` branch that fires the observer through a *different* retry mechanism than backoff (it invokes `onUnauthorized`, sets `UNAUTHORIZED_RETRY_KEY`, and re-`request`s), and it produces an audit-visible sequence — `onRequest`, `onError(401)`, then `onRequest`/`onResponse` on the transparent retry with a freshly-attached (post-invalidation) Bearer token. Because `fireError` sits above the 401 branch, a 401 that is silently recovered still emits an `onError` event, which is a load-bearing R2 consequence a compliance consumer will see on every token-refresh cycle. No test in the new block exercises the 401 path with an observer, so this firing sequence is unverified and a future refactor of the 401 branch could silently drop or reorder it. | Add a test: instrument a client with an `onUnauthorized` hook and an observer, `nock` a `401` then `200`, and assert the event sequence is `onRequest`, `onError(statusCode:401)`, `onRequest`, `onResponse(statusCode:200)` — pinning that a transparently-retried 401 fires exactly one terminal `onError` before the successful retry. |
