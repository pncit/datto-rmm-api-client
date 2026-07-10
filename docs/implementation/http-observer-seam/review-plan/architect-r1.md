## architect — round 1

First architect round on this plan. No prior `architect` turn exists; the review dir carries
`plan-auditor` and `reviser` turns whose four findings (fireError signature, axios exit-gate,
export location, dist-invariant gating) are all `Closed`/ruled — I do not re-raise them.

I reviewed decisions, not code, across the five plan axes: (a) module boundaries & dependency
direction, (b) data model & schema, (c) public API surface, (d) migration / phase sequencing,
(e) performance & hot paths. I grounded the boundary/data-model claims against the real transport:
`src/http/http-client.ts` (`handleResponseError`, `build403Error`, `buildRateLimitError`),
`src/auth/auth-manager.ts` (`performRefresh`), and `src/http/axios-augment.d.ts`.

Axes with no findings: (a) — the augmentation-import and internal-helper placement are sound
(`axios-augment.d.ts` already imports a type from a value module today and stays out of `dist`, so
extending it with `ObserverCapture` is precedented; `observer.ts` introduces a new `src/auth →
src/http` edge but no cycle and no violation of the codebase's one guarded direction, "http must
not depend on auth"). (c) public API — five axios-free types, `DattoApiError` is already public,
`void`-returning callback types accept accidentally-async `Promise<void>` returns. (e) performance
— interceptor registered only when `httpObserver` is present (zero overhead otherwise); per-attempt
allocation and the retry-path `DattoApiError` construction are bounded and design-acknowledged.

Findings below sit on axes (b) data model / (a) boundaries and (d) sequencing.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | DataModel | Phase 1 S5 + Phase 2 S4 (`mapObserverError`) vs `http-client.ts:285-330` | `mapObserverError(error, build403)` maps `403 → build403 : else → DattoApiError.fromAxiosError`, but the real `handleResponseError` maps a **terminal 429** (Retry-After over `MAX_RETRY_AFTER_MS`, or attempts exhausted) via `buildRateLimitError(waitMs, error)` — carrying `"…rate limit exceeded"`, `retryAfterMs`, and rate-limit `code`. The observer's `onError.error` for that same attempt is the generic `fromAxiosError` (same `statusCode 429`, but no `retryAfterMs`/rate-limit message/code), so the audit artifact's error object diverges from what the client actually throws to the caller. Decision 4's "already mapped to a `DattoApiError` before use, so the guarantee is honest" is violated for rate-limit failures. Structurally, `mapObserverError` cannot reproduce `buildRateLimitError` because it lacks the `waitMs`/retry context that only `handleResponseError` holds. | Produce the `onError` mapped error at the site that has the retry context: fire `onError` from `handleResponseError` using the same `DattoApiError` the client will throw/act on (terminal 429 → `buildRateLimitError(waitMs, error)`; 403 → `build403Error`; else → `fromAxiosError`), rather than re-deriving it in `observer.ts`. If the retried-vs-terminal distinction must stay in the helper, thread the computed `waitMs` and a rate-limit branch into `mapObserverError` and add a unit test asserting a terminal-429 `onError.error` equals `buildRateLimitError`'s shape. |
| architect-r1-f2 | Medium | Open | DataModel | Phase 2 S2 example (`url: requestConfig.url ?? ""`) and Phase 3 S2 (`url: GRANT_PATH`); design `DattoHttpRequestEvent.url` | The captured `url` is the **relative** request path (`requestConfig.url` for the shared instance, `GRANT_PATH` for the grant); `baseURL`/`apiUrl` is never concatenated. The seam's stated purpose is an audit artifact of "every outbound HTTP exchange," but the delivered `url` omits the host/base, so a consumer cannot record the actual endpoint from the event alone. Neither the design payload comment nor the plan resolves whether `url` is relative or absolute. | Decide and pin it in the plan (and design payload comment): either deliver the resolved absolute URL — capture `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` (and `apiUrl + GRANT_PATH` on the grant) — or explicitly document `url` as the base-relative path and note that consumers must prepend the configured `apiUrl`. Add a test asserting the captured `url` matches the chosen contract. |
| architect-r1-f3 | Low | Open | Architecture | Phase 1 S5 (observer.ts export enumeration) vs Phase 2 S4 usage | `mapObserverError` is imported by Phase 2 (`fireError(logger, httpObserver, cap, error, mapObserverError(error, build403Error))`) and appears in the Phase 1 example block, but Phase 1 S5's enumerated `observer.ts` export surface lists only `ObserverCapture, normalizeHeaders, invokeObserver, fireRequest, fireResponse, fireError` — `mapObserverError` is absent, leaving the module's public-of-module surface under-specified for the implementor. Phase 1 tests also do not exercise its 403-vs-else branch. | Add `mapObserverError` to Phase 1 S5's enumerated exports, and add a Phase 1 unit test covering both branches (403 → `build403Error`; non-403 → `fromAxiosError`) — which also becomes the regression anchor for the f1 fix. |
