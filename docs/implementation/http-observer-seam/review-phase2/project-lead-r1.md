## project-lead — round 1

Reviewed via `git diff main` scoped to Phase 2's stated files: `src/http/http-client.ts`,
`src/client/datto-rmm-client.ts`, `tests/unit/http/http-client.test.ts` (Phase 1's
`src/http/observer.ts`, `src/http/http-observer.ts`, `src/http/axios-augment.d.ts` were read
for context only — unchanged by this phase). No prior `project-lead` turn exists for this phase
(the review directory holds only `implementation-auditor-r1.md`), so this is a from-scratch round 1.

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| R2 — fire once per physical HTTP attempt, retries never collapsed | Fully Met | `fireError` is called unconditionally (when a stash is present) immediately after the `!axios.isAxiosError` guard, before any status branching — so every dispatched attempt (403, 401-pre-retry, 429-pre-retry, 5xx/network-pre-retry, and the final throw) fires exactly one terminal event before any retry re-dispatches and re-runs the observer's request interceptor. Verified against the `429 → retry → 200` test (`request, error, request, response`) and the transport-failure test asserting `maxAttempts` distinct `onError` events. |
| R4 — each pagination page observed as its own request + terminal event | Fully Met | Falls out for free: `DattoRmmClient` threads `validated.httpObserver` into the single `createHttpClient` instance every resource (including `BaseResource.paginate`) shares — no special-cased pagination code was needed or added. |
| R5 — wire-fidelity bodies (pre-serialization object for JSON) | Fully Met | The observer's request interceptor reads `requestConfig.data` before axios's `transformRequest` runs, and the terminal events reuse the stash rather than re-reading `response.config`. Verified by the JSON-write test (`typeof body !== "string"`) and the stash-equals-terminal assertion. |
| R6 — `onResponse` on 2xx, `onError` on non-2xx/no-response, response fields present iff a response was received | Fully Met | Fulfilled response handler fires `onResponse`; rejected handler's `fireError` (Phase 1) adds `statusCode`/response fields only when `axios.isAxiosError(rawError) && rawError.response`. Verified for both a 404 (`statusCode` present) and a transport failure (`statusCode` absent). |
| R7 — callback throw/rejection never alters, delays, or fails the request | Fully Met | Routed exclusively through Phase 1's `invokeObserver`/`fireRequest`/`fireResponse`/`fireError`; this phase adds a transport-level test (throwing `onRequest` + rejecting `onResponse`) proving the real request still succeeds and exactly one `warn` is logged per failure. |
| R8 — `onError.error` is the raw, unmapped request error | Fully Met | `fireError(logger, httpObserver, capture, error)` hands the raw `AxiosError` straight through; no `mapObserverError` call exists at this site. Tests assert the observed error is not a `DattoApiError` while the SDK still throws its mapped `DattoApiError` to the caller. |
| R9 — raw, un-redacted delivery | Fully Met | `httpObserver` is threaded into `createHttpClient`'s config as a sibling of (never routed through) the masked `logger`; the doc comments on both `HttpClientConfig.httpObserver` and the `DattoRmmClient` wiring site explicitly call out the raw/unmasked contrast with `logger`. |

### Behavior vs Intent / Risk / Scope
- **LIFO ordering mechanism verified correct.** Registration order across the two modules is observer → rate-limit (both in `createHttpClient`) → Bearer (`AuthManager.attachTo`, registered later on the same instance from `DattoRmmClient`'s constructor). Axios's request-interceptor chain executes in reverse-registration order, so the observer — registered first — runs last, after throttle acquisition and after the `Authorization` header is attached, exactly as Decision 5 requires. This was traced against axios's actual chain-building semantics (`unshift` per registered interceptor), not just the plan's assertion.
- **No cross-attempt/cross-request leakage.** The per-attempt stash lives on the request's own `config` object, not on any module-level or instance-level mutable state, so concurrent unrelated requests through the same shared instance cannot clobber each other's capture; a retried attempt's unconditional overwrite of the *same* reused config object is the only place a stash is intentionally replaced, and it is replaced (and the prior terminal event fired) before the next dispatch — matches R2.
- **Rollout risk is well-contained for a shared-infra change.** The instrumentation touches the one axios instance every resource request flows through, but it is strictly additive and opt-in: the observer interceptor is registered only `if (config.httpObserver)`, the fulfilled/rejected handlers no-op on an absent stash, and a dedicated test confirms omitting `httpObserver` registers no interceptor and leaves `__dattoObserverCapture` unset. No feature flag beyond the config field itself is warranted given this zero-overhead-when-absent design and the additive-only verification.
- **Scope discipline held.** Diff touches exactly the three files the plan's Phase 2 names (plus the phase's own process artifacts); no auth/rate-limit/retry/error-mapping logic below the new `fireError` call was altered, and no unrelated refactor rode along.
- **No new dependencies introduced.**

No findings raised this round — the implementation matches the plan's pinned mechanisms (interceptor registration order, the 6th-positional-parameter signature, the direct `error.config` stash read, unmapped raw-error pass-through) and the design's decisions exactly, with test coverage matching every scenario the plan's Tests section for this phase enumerates.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
