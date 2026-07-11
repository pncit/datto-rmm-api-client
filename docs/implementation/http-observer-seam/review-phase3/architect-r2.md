## architect — round 2

In-progress review of Phase 3 (instrument the OAuth grant/refresh path). Re-verified each of my
round-1 findings against the working tree; the reviser (`reviser-r1.md`) marked all three `Fixed`, and
each fix holds:

- **architect-r1-f1 (grant URL fidelity).** The human ruling amended design.md Decision 5 to mandate
  composing the observed `url` via the grant client's own resolver, and the code follows it:
  `performRefresh` now sets `url: this.grantClient.getUri({ url: GRANT_PATH })`
  (`src/auth/auth-manager.ts:163`), which runs axios's own `buildFullPath`/`combineURLs` against the
  instance's `baseURL: config.apiUrl` (`:81`), so the capture matches the dispatched wire URL under a
  trailing-slash `apiUrl`. The manual concatenation is gone (grep finds no `${apiUrl}${GRANT_PATH}`).
  A dedicated trailing-slash test (`tests/unit/auth/auth-manager.test.ts:373-391`) asserts
  `requestEvent.url` is the single-slash form and `.not.toContain("//auth")`, and the slash-free
  `BASE_URL` assertion (`:352`) is preserved. Ratified → Closed.
- **architect-r1-f2 (Content-Type duplication).** `const GRANT_CONTENT_TYPE` is hoisted beside
  `GRANT_PATH` (`:44`) and referenced from both the `grantClient` constructor header (`:83`) and the
  `captureRequest` header (`:164`); the literal `"application/x-www-form-urlencoded"` now appears
  exactly once in the file (grep confirmed). Single source of truth for the wire header restored.
  Ratified → Closed.
- **architect-r1-f3 (single-flight observer invariant untested).** A concurrency test
  (`tests/unit/auth/auth-manager.test.ts:393-417`) fires three simultaneous `getToken()` calls against
  a cold cache under one shared observer (`.once()` grant scope) and asserts the collected event kinds
  are exactly `["request","response"]` — pinning one event pair per physical grant, not per caller. It
  fails if a `fire*` call moves out of `performRefresh`. Ratified → Closed.

No new architectural, boundary, data-flow, public-API, or performance issues in the fixes: the grant
path still routes every capture/normalization/callback through the shared `observer.ts` primitives
(no new plumbing), `getUri` is a pure resolver call adding no coupling, the hoisted constant is
module-private, and the `httpObserver` threading into `AuthManager`/`createHttpClient`
(`src/client/datto-rmm-client.ts:78,90`) remains raw/unmasked per Decision 6/R9. Terminal-event
exclusivity (`fireResponse` before `safeParse`; `fireError` handing off the raw caught error) is
unchanged and fully covered. No carried-forward `Open` findings remain and no new findings arise.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Closed | Architecture | `src/auth/auth-manager.ts:163` | Ratified: observed `url` now composed via `this.grantClient.getUri({ url: GRANT_PATH })` per the amended design Decision 5, matching the dispatched wire URL under a trailing-slash `apiUrl`; verified by the new trailing-slash test asserting no `//auth`, with the slash-free `BASE_URL` assertion preserved. | No further action. |
| architect-r1-f2 | Low | Closed | Architecture | `src/auth/auth-manager.ts:44,83,164` | Ratified: `GRANT_CONTENT_TYPE` hoisted and referenced at both the constructor header and the `captureRequest` header; the Content-Type literal appears exactly once in the file (grep-confirmed), so the observed header can no longer drift from the dispatched one. | No further action. |
| architect-r1-f3 | Low | Closed | Architecture | `tests/unit/auth/auth-manager.test.ts:393-417` | Ratified: added a concurrency test firing three simultaneous `getToken()` calls under one shared observer against a cold cache, asserting collected event kinds are exactly `["request","response"]` — pinning the once-per-physical-grant invariant on the grant path. | No further action. |
