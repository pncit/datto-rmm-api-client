## implementation-auditor — round 1

Audit of Phase 2 ("Instrument the shared axios instance") against `plan.md` and `design.md`.
Scope reviewed via `git diff`: `src/http/http-client.ts`, `src/client/datto-rmm-client.ts`,
`tests/unit/http/http-client.test.ts`. Phase 1 artifacts (`src/http/http-observer.ts`,
`src/http/observer.ts`, `src/http/axios-augment.d.ts`) were read for context only; they are
unchanged by this phase and already reviewed in `review-phase1/`.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1 — Add `httpObserver` to `HttpClientConfig`, threaded raw, with raw/unmasked doc comment | ✅ Implemented | New optional `readonly httpObserver?: DattoHttpObserver`; doc comment explicitly contrasts with the always-masked `logger` (satisfies engineer-r1-f8). |
| 2 — Register observer request interceptor FIRST, capture via shared `captureRequest`, absolute URL, stash, fire `onRequest` | ✅ Implemented | Registered inside `if (config.httpObserver)` before the rate-limit interceptor; `url` composed as `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``; capture built only through `captureRequest` (no inline uppercasing/normalization); `requestConfig.__dattoObserverCapture` unconditionally overwritten; conditional registration gives zero overhead when absent. |
| 3 — Fire `onResponse` from the fulfilled response handler when a stash is present | ✅ Implemented | Fulfilled handler reads `response.config.__dattoObserverCapture` and calls `fireResponse` before returning the response unchanged. |
| 4 — Fire `onError` once per dispatched attempt in `handleResponseError` (6th positional param before `error`), raw pass-through | ✅ Implemented | New `httpObserver` param inserted after `logger`, before `error`; stash read directly off `error.config?.__dattoObserverCapture` (no `RetryTrackedConfig` cast); `fireError(logger, httpObserver, capture, error)` placed immediately after the `!axios.isAxiosError` guard and before all retry/throw branches; raw `AxiosError` handed straight through (no `mapObserverError`). |
| 5 — Thread `validated.httpObserver` from `DattoRmmClient` into `createHttpClient` unmasked | ✅ Implemented | Passed raw into the `createHttpClient` config with an explanatory comment; correctly NOT passed to `AuthManager` (that is Phase 3). |

### Verification of behavioral guarantees
- **LIFO ordering / post-throttle, post-auth capture (Decision 5):** registration order is observer → rate-limit (both in `createHttpClient`) → Bearer (`attachTo`, after return). Under axios LIFO the observer interceptor runs last, so `startedAt` is stamped after rate-limit `acquire()` resolves and after the Bearer header is attached. Confirmed against `datto-rmm-client.ts` (`attachTo` runs after `createHttpClient` returns).
- **Pre-serialization body (R5):** the observer interceptor runs before axios's `transformRequest`, so `requestConfig.data` is the object, not the serialized string. Verified by the JSON-write test.
- **Per-attempt fidelity (R2):** the terminal `onError` fires and reads attempt N's stash *before* `instance.request(config)` re-dispatches and the observer interceptor overwrites the stash for attempt N+1. The unconditional overwrite prevents stale-capture leakage on a reused config object. `429 → retry → 200` trace yields `request, error, request, response`, matching the test.
- **Non-dispatched exclusion (Decision 4 rule 2):** placing `fireError` after the `!axios.isAxiosError` guard excludes the rate-limiter reject and the Bearer `getToken()` `DattoApiError` (both non-axios rejects rethrown by the guard). No stash is written for those paths.
- **Terminal-selection & raw error (R6/R8):** fulfilled handler ⇒ `onResponse` (2xx only, per axios default `validateStatus`); rejected handler ⇒ `onError` for every dispatched non-2xx/transport failure with the raw `AxiosError`; `fireError` adds response fields only when `error.response` exists. `durationMs` excludes throttle because `startedAt` is post-`acquire`.
- **Raw/unmasked delivery (Decision 6/R9):** observer threaded raw at both the client and `HttpClientConfig` boundary; the masked `logger` is used only for the swallow-`warn`.
- **No regression:** the previously bare `(response) => response` fulfilled handler now performs an undefined-safe property read + branch; functionally identical when no observer is configured (covered by the "absent" sanity test).

### Test quality
Every Phase 2 test bullet in the plan is covered by the new `describe("createHttpClient — httpObserver")` block: 2xx request/response with Bearer + numeric `durationMs`; `429 → 200` two-attempt ordering; pre-serialization JSON body plus stash-equals-terminal assertion; absolute-URL on every event; transport-failure raw error with absent `statusCode` (×`maxAttempts`) and non-2xx raw `AxiosError` with `statusCode`; throttle-exclusion via a mocked delaying `acquire`; `onError`-only capture-independence; throwing/rejecting callback isolation with one `warn` each (async rejection flushed via a microtask turn); plus an additive "absent observer ⇒ no interceptor, no stash" sanity test. Assertions check identity/shape, not just presence, and confirm the observed error is not a `DattoApiError` (`axios.isAxiosError(...) === true`), proving R8 at the transport level.

### Drift Report
**Out-of-scope changes:** None. All changes are confined to the three files the plan names; `AuthManager` is untouched (Phase 3), and no auth/rate-limit/retry/error-mapping logic below the `fireError` insertion point was modified.
**Acceptable Phase 2 necessities:** The `const observer = config.httpObserver` local binding inside the registration `if` (documented in notes §6) is a benign readability narrowing with no behavioral effect. The `import axios` change in the test file (from `import type`) is required for the `axios.isAxiosError` runtime assertions.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|

No findings. Phase 2 implements all five steps faithfully, matches the plan's pinned mechanisms
(LIFO registration order, 6th-positional-param signature, direct `error.config` stash read, raw
error pass-through), preserves existing transport behavior, holds scope, and its tests cover every
scenario the plan enumerates.
