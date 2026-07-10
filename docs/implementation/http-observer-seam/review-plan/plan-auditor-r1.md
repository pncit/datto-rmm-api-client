## plan-auditor — round 1

Round 1 audit of `docs/implementation/http-observer-seam/plan.md` against the design document and
the current repository. Empty review directory — this is a fresh review.

### Reality checks (verified against the repo)

- `src/http/http-client.ts` — confirmed: rate-limit request interceptor registered first in
  `createHttpClient`; response interceptor pair `((response) => response, handleResponseError)`;
  `handleResponseError` opens with `if (!axios.isAxiosError(error)) throw error;`; retries re-run
  via `instance.request(config)` reusing the same config; `build403Error`/`buildRateLimitError`
  are module-private; `error.config` is already read as `RetryTrackedConfig`. The plan's Phase 2
  edits and the "fire onError after the guard" placement are grounded.
- Interceptor LIFO ordering: registration order becomes observer(1st)→rate-limit(2nd) in
  `createHttpClient`, then Bearer(3rd) in `attachTo`. Axios builds the request chain by `unshift`,
  so execution is Bearer → rate-limit → observer. The observer therefore runs **last** (post-auth,
  post-throttle) and preserves the *existing* Bearer-before-rate-limit order — the plan's Decision-5
  mechanism and its "changes nothing" claim both hold.
- `body: requestConfig.data` is the pre-serialization object at interceptor time (request
  interceptors run before `transformRequest`) — R5 for JSON writes is sound.
- Lazy-refresh path: `handleResponseError`'s own doc (lines 238–245) already asserts axios routes a
  request-interceptor throw to the response reject handler, and the Bearer throw aborts the chain
  before the observer interceptor runs (no stash) — Decision 4 rule 2 is grounded in existing repo
  behavior.
- `src/auth/auth-manager.ts` — confirmed: bare `grantClient`, `body.toString()`, `try/catch`
  mapping (axios→`fromAxiosError`, non-axios→`DattoApiError(statusCode:0)`), `safeParse` after the
  2xx. Phase 3 edits fit.
- `src/http/axios-augment.d.ts` — confirmed: already a module file (has a top-level `import type`),
  so adding an `ObserverCapture` type import keeps the existing module-augmentation semantics; it
  is not imported by any index-graph value module, so it stays out of `dist`.
- `src/client/datto-client-config.ts` / `src/index.ts` / `src/client/datto-rmm-client.ts` /
  `tests/generated/surface-pin.ts` / `src/errors/index.ts` — all confirmed as described; the
  `DattoApiError.fromAxiosError` static exists.
- `z.function({input,output}).optional()` inside a `z.strictObject`: executed against the installed
  `zod@4.4.3` — validates, passes the callback through **invocable**, delivers the raw arg
  untouched, rejects `axiosInstance`, and accepts an empty object. Plan Assumption #2 / R10 confirmed.
- `tests/integration/` exists and the vitest `include: ["tests/**/*.test.ts"]` glob covers the new
  Phase 4 integration file. Toolchain: `npm run typecheck`, `npm test` (vitest), `npm run build`
  (tsup) all exist.

### Design Alignment

| Design Requirement | Plan Coverage | Gap/Deviation |
|--------------------|---------------|---------------|
| R1 config `httpObserver`, absence inert | P1 S2/S3, schema + strict-reject | Covered |
| R2 once per physical attempt (429→retry→200) | P2 S2/S4 (stash overwrite + fire-after-guard), P4 tests | Covered |
| R3 grant observed, body as urlencoded string | P3 S2, P4 test | Covered |
| R4 each pagination page observed | P2 (shared-instance instrumentation), P4 test | Covered (falls out — verified `paginate` uses `this.axios.get`) |
| R5 wire-fidelity bodies | P1/P2/P3 (pre-serialization object; grant string) | Covered |
| R6 onResponse 2xx / onError else | P2 S3/S4, P3 S3/S4 | Covered |
| R7 callback throw/rejection swallowed | P1 S5 `invokeObserver`, P2/P3 tests | Covered |
| R8 `onError.error` always mapped `DattoApiError` | P1 S5, P2 S4, P3 S4 | Covered (but see f1 — mapping-helper contract inconsistent) |
| R9 raw, unmasked delivery | P1 doc, P2 S5 / P3 S5 unmasked threading | Covered |
| R10 strict schema accepts observer, rejects unknown/`axiosInstance` | P1 S2, P1 tests | Covered (verified in zod) |
| Five types exported from `src/index.ts` (Success Criteria) | P1 S3 via `index.ts` direct | See f3 — design line 267 also says `public-types` is extended; plan deliberately does not |

Every R-ID is claimed by at least one phase and its steps deliver it. No uncovered R-ID.

### Missing decisions

- Dependencies: none new — verified (`nock`/`vitest` already dev deps; no runtime add).
- Documentation: README section scheduled in Phase 4 S2. Adequate.
- Acceptance criteria: exit gates + per-phase tests map to Success Criteria. Adequate, except the
  gate-coverage gap in f4 and the self-defeating gate in f2.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | Medium | Open | Consistency | The shared `fireError` helper is given two incompatible contracts. Phase 1 S5 says `fireError` maps internally (403→`build403Error`, else `fromAxiosError`) and the Phase 2 example passes the **mapper function** `build403Error` as the 5th arg; the Phase 3 example passes an **already-constructed `DattoApiError`** (`mapped`) as the 5th arg. The grant path cannot use `fireError`'s internal mapping (it has no 403/`build403Error` concept and maps non-axios errors to `DattoApiError(statusCode:0, "…authentication failed")`, not `fromAxiosError`). One helper cannot accept both a mapper fn and a pre-mapped error in the same position. | Pin a single signature. Recommend `fireError(logger, observer, capture, rawError, mappedError: DattoApiError)` where each caller pre-maps: the shared instance via the existing `mapObserverError(error, build403Error)`, the grant via its own `mapped`. Update Phase 1 S5's description and the Phase 2 example to pre-map rather than pass `build403Error`. |
| plan-auditor-r1-f2 | High | Open | Consistency | Phase 1's opinionated example for `src/http/http-observer.ts` includes the comment `error: DattoApiError; // always mapped; never a raw axios error`, which contains the substring "axios". The Phase 1 and Phase 4 exit gates run `! grep -iq 'axios' src/http/http-observer.ts` (case-insensitive, whole-file). If the implementor copies the example verbatim (or writes any doc comment mentioning axios), that gate fails and the phase is non-executable as written. | Make the gate match an actual axios *import/type usage* instead of any substring — e.g. `! grep -Eq "from ['\"]axios['\"]" src/http/http-observer.ts` (and/or a `\bAxios[A-Z]` type check) — and/or strip the word "axios" from the example doc comment. Reconcile the example and the gate so a faithful implementation passes. |
| plan-auditor-r1-f3 | High | Open | DesignAlignment | Design "What Stays the Same" (line 267) states the curated `public-types` surface is "extended … by the new observer types," and lines 87/95 say the types are exported "from `src/index.ts` / `public-types`." Phase 1 S3 deliberately routes all five types through `index.ts` only and explicitly does **not** touch `public-types.ts` (citing the `DattoLogger` precedent, which is verified in the repo). The package-root surface is identical either way, but the plan diverges from the design's literal statement. | Planner to disposition: either add the five types to `public-types.ts` per the design, or `Accept` the `index.ts`-direct placement (it matches the verified `DattoLogger` precedent — the cleaner option) and note that design line 267 should be corrected to say the types are exported directly from `index.ts` alongside `DattoLogger`. |
| plan-auditor-r1-f4 | Low | Open | Test | Phase 2 and Phase 3 exit gates run only `npm run typecheck` + `npm test`. But Phase 2 (`http-client.ts`) and Phase 3 (`auth-manager.ts`) are exactly where `src/http/observer.ts` — which `import`s axios — first becomes reachable from the `index.ts` value graph. A regression that leaked an axios type or a `declare module` into `dist/index.d.ts` would not surface until the Phase 4 gate, two phases downstream of where it was introduced. | Add `npm run build`, `! grep -q 'declare module' dist/index.d.ts`, and the axios-free surface check to the Phase 2 and Phase 3 exit gates so the dist invariant is verified at the phase that introduces the risk. |
