## architect — round 1

Scope: Phase 3 (instrument the OAuth grant/refresh path) working-tree changes vs `main` —
`src/auth/auth-manager.ts`, `src/client/datto-rmm-client.ts`, and
`tests/unit/auth/auth-manager.test.ts`. Phases 1–2 (`src/http/observer.ts`,
`src/http/http-observer.ts`, `createHttpClient`) reviewed only as consumed surface. `git diff main`
was used (the Phase-3 edits are unstaged; `git diff main...HEAD` does not show them).

Overall the implementation is faithful to the plan and design: the shared `observer.ts` primitives
(`captureRequest`/`fireRequest`/`fireResponse`/`fireError`) are reused with no new shared plumbing
(Decision 2); the terminal-event exclusivity is correct (`fireResponse` fires on the resolved 2xx
strictly before `safeParse`, so a malformed-token 2xx emits exactly one terminal event and never
`onError` — Decision 4 rule 3); `fireError` hands off the raw caught `err` before the
`DattoApiError` mapping (R8); the `httpObserver` field is threaded raw/unmasked into both
`AuthManager` and `createHttpClient` (Decision 6/R9); and every pre-existing `performRefresh` line
(the `issuedAt` TTL anchor, both log calls, the mapping/rethrow, the malformed-response throw) is
preserved. The dependency direction (`auth` → `http/observer`) is intended and introduces no cycle.

Analysis of the axes surfaced three low-severity issues, all concerning **fidelity/consistency
between the grant instrumentation and the shared-instance instrumentation it is meant to mirror**,
plus one coverage gap. None blocks correctness of the happy path.

### Notes on axes with no finding
- **Terminal-event selection / raw-error pass-through:** correct and well-tested (identity
  `not.toBe` against the thrown `DattoApiError`, `statusCode` present on 401 / absent on transport
  failure).
- **Security (raw API key in body, raw error to `onError`):** intended and documented (R9,
  Decision 6); swallow-`warn` carries only the callback name, no payload. No new leak surface.
- **Single-terminal invariant:** every path after `fireRequest` reaches exactly one of
  `fireResponse`/`fireError`; no path skips both, and a throwing callback is swallowed.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Open | Architecture | `src/auth/auth-manager.ts:162` | The grant's observed `url` is composed by **manual concatenation** `` `${this.config.apiUrl}${GRANT_PATH}` ``, whereas the shared instance deliberately uses `instance.getUri(requestConfig)` (`src/http/http-client.ts:388`) to match exactly what axios dispatches. When `apiUrl` carries a trailing slash — which `dattoRmmClientConfigSchema`'s `z.url()` accepts — the two diverge: the capture yields `https://host//auth/oauth/token` (double slash) while axios's `combineURLs(baseURL, GRANT_PATH)` dispatches `https://host/auth/oauth/token`. The design's justification for manual concat ("no query params ever attached there, so no divergence", Decision 5) considered only query strings, not baseURL slash-normalization, so the audit artifact can misrepresent the URL that actually went over the wire. | Compose the captured `url` via the grant client's own resolver — `this.grantClient.getUri({ url: GRANT_PATH })` — so the observed URL is normalized identically to the dispatched one, matching the shared-instance approach. If the reviser judges this a design-pinned choice, escalate for a ruling. |
| architect-r1-f2 | Low | Open | Architecture | `src/auth/auth-manager.ts:163` vs `:82` | The captured request headers hardcode a second copy of `{ "Content-Type": "application/x-www-form-urlencoded" }`, duplicating the literal set on the `grantClient` in the constructor. These are two independent sources of truth for the grant's on-the-wire Content-Type: change the wire header (the constructor) and the observed header silently diverges from what was actually sent, quietly breaking the observer's wire-fidelity contract with no failing test. | Extract a single module-level constant (e.g. `const GRANT_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" }`) and reference it from both the `grantClient` constructor headers and the `captureRequest` call, so the observed header cannot drift from the dispatched one. |
| architect-r1-f3 | Low | Open | Architecture | `tests/unit/auth/auth-manager.test.ts` (new `describe`) | The single-flight/observer interaction is untested: no case asserts that N concurrent `getToken()` calls against an empty cache — which share one `performRefresh` and thus one physical grant — fire `onRequest`/`onResponse` **exactly once**, not once per caller. This is the grant-side of R2 ("once per physical HTTP attempt"); a future refactor moving a `fire*` call out of `performRefresh` into `refreshToken`/`getToken` would multiply events per caller with no test catching it. The existing single-flight test proves one round-trip but asserts nothing about the observer. | Add a test that fires several concurrent `getToken()` calls with a shared observer and asserts the collected events are exactly `["request","response"]` (one grant, one event pair), pinning the per-attempt invariant on the grant path. |
