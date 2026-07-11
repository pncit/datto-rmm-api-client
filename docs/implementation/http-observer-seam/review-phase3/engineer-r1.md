## engineer — round 1

Scope: Phase 3 — instrument the OAuth grant/refresh path. Reviewed the Phase 3 diff vs
`origin/main`: `src/auth/auth-manager.ts` (config field + `captureRequest`/`fireRequest`/
`fireResponse`/`fireError` wiring in `performRefresh`), `src/client/datto-rmm-client.ts` (threading
`validated.httpObserver` into `AuthManager`), and `tests/unit/auth/auth-manager.test.ts` (new
`AuthManager — httpObserver` block). The shared primitives in `observer.ts`/`http-observer.ts` and
the config-schema/`index.ts` exports are prior-phase surface and out of scope here except where
Phase 3 consumes them.

The implementation is clean and closely tracks the pinned plan: the terminal-event ordering
(`fireResponse` before `safeParse`, `fireError` handing off the raw caught error before the
`DattoApiError` mapping) is correct, every pre-existing log/mapping line is preserved, and the
callback-isolation guarantee is exercised end-to-end. Findings below are maintainability/fidelity
polish and one test-symmetry gap — no correctness blockers.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Open | MagicValues | `src/auth/auth-manager.ts:82` and `:163` | The `Content-Type: application/x-www-form-urlencoded` string is now written twice — once as the `grantClient` default header (constructor) and once in the observer `captureRequest` headers. These are meant to be the *same* wire header, but nothing ties them together: if the grant's content type ever changes, the constructor drives the actual request while the capture silently keeps misreporting the old value to an audit consumer. | Hoist the value to a module constant (e.g. `const GRANT_CONTENT_TYPE = "application/x-www-form-urlencoded";` beside `GRANT_PATH`) and reference it in both the `axios.create` headers and the `captureRequest` headers so the observed header cannot drift from the dispatched one. |
| engineer-r1-f2 | Low | Open | Complexity | `src/auth/auth-manager.ts:162` | The observed request/response `url` is built by naive concatenation `` `${this.config.apiUrl}${GRANT_PATH}` ``. `apiUrl` is validated only as a URL (`datto-client-config.ts:39-40`), not normalized, so a consumer-supplied trailing slash (`https://host/`) yields `https://host//auth/oauth/token` in the event, whereas axios's own `combineURLs(baseURL, path)` collapses it to the single-slash form actually put on the wire. The event then misrepresents the dispatched URL — the one place the grant path reconstructs the URL by hand instead of reading axios's resolved value (as the shared-instance interceptor does). | Normalize before concatenating (e.g. strip a trailing `/` from `apiUrl`, or reuse the same `combineURLs`-equivalent axios applies) so the captured URL matches the wire in the trailing-slash case. At minimum, add a normalization step; this is cheap and removes a silent fidelity divergence unique to the grant site. |
| engineer-r1-f3 | Low | Open | ErrorHandling | `tests/unit/auth/auth-manager.test.ts:391-420` (401 and transport-failure tests) | The two error-path tests register **only** `onError`, so they assert `onError` fires but never prove the terminal-event *exclusivity* on that path — i.e. that `onResponse` does not also fire. The malformed-2xx test (its counterpart) does this correctly by registering all three callbacks and asserting the exact sequence `["request","response"]`. The asymmetry leaves a regression where `fireResponse` leaks onto the error path unguarded by the suite. | In the 401 test, register all three callbacks (as the success/malformed tests do) and assert the captured event kinds are exactly `["request","error"]`, mirroring the malformed-2xx test's exclusivity check. |
