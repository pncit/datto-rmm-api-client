## architect — round 1

Phase 4 is a close-out phase: it adds **no production code** (verified — `git status` shows only
`README.md` modified plus the untracked `tests/integration/http-observer.test.ts`; every `src/**`
change in the branch diff belongs to Phases 1–3). So the only architecture-relevant surfaces here
are (a) the accuracy of the **public-API documentation** the README now publishes for the
`httpObserver` seam, and (b) the boundary/maintainability posture of the new integration suite.

Both are in good shape. The integration test correctly exercises the assembled client through the
one public entry point (`@/index` → `createDattoRmmClient`) rather than reaching into either
transport layer, mirrors the repo's existing `surface.test.ts`/`fixtures.test.ts` conventions, and
isolates each scenario by `url` rather than a fragile global event count. The five exported types
named in the README match `src/index.ts` exactly, and the axios-free / per-attempt / per-page
claims are all accurate against `src/http/observer.ts` and `src/http/http-client.ts` (observer
request interceptor registered first → runs last in LIFO → fires post-throttle, post-auth, so the
"throttle wait excluded from `durationMs`" claim holds).

Two documentation-accuracy findings, both on the README section.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | Security | `README.md`, "Observing HTTP exchanges" → "⚠️ Raw, un-redacted delivery" paragraph | The headline security warning enumerates the credentials delivered raw as "the `Authorization: Bearer` token ... and the API key in the OAuth token grant's request body" — but the grant body also carries the **API secret** as the `password` field (`src/auth/auth-manager.ts:148` sends `password: this.config.apiSecret`; the new test at `http-observer.test.ts:99` asserts `password === "test-secret"`). The API secret is the single most sensitive credential of the three, yet it is the one omitted from the enumerated at-risk list a compliance reader anchors their redaction allowlist to. (The surrounding "This client redacts nothing" prose is correct but generic; the whole purpose of the bold enumeration is to name what leaks.) The mirror JSDoc in `src/http/http-observer.ts:87-88` has the same omission — align both. | Add the API secret to the enumerated list, e.g. "…the API key **and API secret** in the OAuth token grant's request body." Update the matching JSDoc warning in `src/http/http-observer.ts` for consistency. |
| architect-r1-f2 | Low | Open | PublicAPI | `README.md`, "Observing HTTP exchanges" → the three per-callback bullets | The `onRequest` bullet lists its payload as `method`, `url`, `headers`, `body`, but the `onResponse`/`onError` bullets describe themselves only as *"adding"* the response-side fields — never stating that on the terminal events the request-side fields are **renamed** to `requestHeaders`/`requestBody` (and that `method`/`url` are also carried). A consumer reading only the README bullets would reasonably write `e.headers`/`e.body` on a response/error event, which does not exist on those types (`src/http/http-observer.ts:38-41,58-61`). | State on the `onResponse`/`onError` bullets that the request-side fields appear as `requestHeaders`/`requestBody` (alongside `method`/`url`) on the terminal events, so the field names in the prose match the exported types. |
