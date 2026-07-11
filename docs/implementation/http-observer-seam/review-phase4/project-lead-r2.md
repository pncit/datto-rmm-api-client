## project-lead — round 2

### Requirements Coverage
(Phase 4's declared requirements per the plan: R2, R3, R4, R6, R8, R9 — "end-to-end verification of behavior wired in Phases 1–3.")

| Requirement | Status | Notes |
|-------------|--------|-------|
| R2 (fire once per physical attempt; retries never collapsed) | Fully Met | Unchanged from round 1 — `429 → retry → 200` assembled-client test asserts the terminal subsequence `[onError(429), onResponse(200)]`. |
| R3 (OAuth grant/refresh observed) | Fully Met | Unchanged from round 1. |
| R4 (each pagination page observed) | Fully Met | Unchanged from round 1. |
| R6 (`onResponse` for 2xx, `onError` for non-2xx/no-response) | Fully Met | Unchanged from round 1. |
| R8 (`onError.error` is the raw, unmapped error) | Fully Met | Unchanged from round 1. |
| R9 (raw, un-redacted delivery — bearer token in headers, API key in body) | Fully Met | Closes the round-1 gap: the grant test now asserts the account request's `headers["Authorization"]` equals the real `Bearer tok-1` produced by the genuine `AuthManager.attachTo` interceptor composing with the observer interceptor through the real assembled client (`tests/integration/http-observer.test.ts:141-143`), and separately asserts the grant request's headers carry no `authorization`/`Authorization` key. Both halves of R9 are now verified end-to-end. |

### Verification of round-1 findings

- **project-lead-r1-f1** (High — R9 bearer-token half never asserted end-to-end): the reviser added the assertion described above. Verified against the current diff and against the header-casing precedent already established in `tests/unit/http/http-client.test.ts:569,819` (`requestEvent.headers.Authorization` / `errorEvents[0]!.requestHeaders.Authorization`), which confirms `normalizeHeaders`'s `AxiosHeaders.toJSON()` path preserves the `Authorization` casing this new assertion depends on. Closed (ratified).
- **project-lead-r1-f2** (Medium — README "Upgrading from 0.1.x" item 4 gave 0.1.x axios-injectors no pointer to the replacement): the reviser added a one-line cross-reference to the `#observing-http-exchanges-httpobserver` anchor immediately after the `axiosInstance`-removal sentence (`README.md:564-566`); the anchor resolves to the actual section heading. Closed (ratified).

### New findings this round

None. Re-reviewing the full round's diff (the type-safe `eventsOf` refactor, the two new header assertions, the README/JSDoc credential-enumeration and terminal-field-naming corrections, and the phase-4 notes updates) against the plan's Phase 4 goal, the design's R2–R9/Success Criteria, and this repo's rollout/dependency posture surfaces no further requirements, behavior-vs-intent, scope, risk, or dependency issues. No new dependency was introduced; no production (`src/**`) file changed this phase, consistent with its own scope statement; the changes are confined to the integration test file, `README.md`, and the one already-flagged JSDoc block.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
