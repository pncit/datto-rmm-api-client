## architect — round 2

In-progress review. Both round-1 findings were routed `Remediate` and marked `Fixed` by
`reviser-r1.md`; I re-verified each against the branch diff (`git diff main`) and the current file
contents.

- **architect-r1-f1** — Ratified. `README.md`'s "⚠️ Raw, un-redacted delivery" paragraph now
  enumerates "the `Authorization: Bearer` token on every resource request **and the API key and API
  secret** in the OAuth token grant's request body," and the mirror JSDoc at
  `src/http/http-observer.ts:84-89` now reads "the API key and API secret in the OAuth grant's form
  body." Both enumerations now name all three credentials the grant body/headers actually carry
  (`auth-manager.ts` sends `username: apiKey` / `password: apiSecret`; the integration test asserts
  `params.get("password") === "test-secret"` at `http-observer.test.ts:115`). The API secret is no
  longer omitted from either at-risk list.
- **architect-r1-f2** — Ratified. The `onResponse`/`onError` bullets in the "Observing HTTP
  exchanges" section now state the request-side fields appear **renamed** as
  `requestHeaders`/`requestBody` (explicitly "not `headers`/`body`"), that both terminal events also
  carry `method`/`url`, and that `durationMs` is on both. Every field name in the two bullets now
  matches the exported `DattoHttpResponseEvent` / `DattoHttpErrorEvent` interfaces
  (`src/http/http-observer.ts:32-76`) exactly; no bullet references an unrenamed `headers`/`body` on
  a terminal event.

No new architectural findings. Phase 4 still adds no production code beyond the two JSDoc words
covered by f1; the README's "five exported types … none of which reference axios" claim matches
`src/index.ts:14-20` exactly, and the integration suite continues to drive the fully-assembled
client through the single public entry point (`createDattoRmmClient` via `@/index`) without reaching
into either transport layer. All axes re-checked; nothing outstanding.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | Security | `README.md` "Raw, un-redacted delivery"; `src/http/http-observer.ts:84-89` | Ratified: API secret now enumerated in both the README warning and the mirror JSDoc; all three raw-delivered credentials named. | Fix confirmed against the diff; no further action. |
| architect-r1-f2 | Low | Closed | PublicAPI | `README.md` "Observing HTTP exchanges" per-callback bullets | Ratified: `onResponse`/`onError` bullets now name the renamed `requestHeaders`/`requestBody` (and `method`/`url`, `durationMs`) on terminal events; prose field names match the exported types. | Fix confirmed against the diff; no further action. |
