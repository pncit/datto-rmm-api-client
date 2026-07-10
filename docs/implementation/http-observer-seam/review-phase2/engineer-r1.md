## engineer — round 1

Code Review Mode, exhaustive, round 1. Scope: the Phase 2 diff against the Phase 1
tip (`git diff faf57e9`) — `src/http/http-client.ts`, `src/client/datto-rmm-client.ts`,
and `tests/unit/http/http-client.test.ts`. The Phase 1 helper modules (`observer.ts`,
`http-observer.ts`, `axios-augment.d.ts`, config schema) were reviewed under
`review-phase1/` and are out of this phase's scope except where Phase 2 consumes them.

Overall the wiring is clean and matches the plan's pinned mechanism (LIFO registration
order, the 6th-positional `handleResponseError` param, direct `error.config` stash read,
`fireError` placed right after the `isAxiosError` guard). The one material problem is that
the observed request `url` is composed by naive string concatenation
(`` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``) inside the request
interceptor, which does **not** reproduce the URL axios actually dispatches — it drops the
serialized `requestConfig.params` query string entirely. Because the observer runs at
interceptor time (before axios serializes `params` into the query), every GET that carries
query parameters — including every filtered list call and pagination's **first** page (see
`BaseResource.paginate`, which passes the first page's cursor via `params:` and only inlines
`pathname + search` into the `url` for *subsequent* pages) — is observed with a URL that
omits its query string. That silently contradicts the published contract
(`DattoHttpRequestEvent.url`: "The absolute resolved request URL (`baseURL` + path) exactly
as dispatched") and undercuts the audit/compliance purpose of the seam. The new tests never
exercise a request with `params`, so the gap is uncovered.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | High | Open | Complexity | `src/http/http-client.ts` observer request interceptor (~L382–387) | The observed `url` is built as `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``, which omits `requestConfig.params`. At interceptor time axios has **not** yet serialized `params` into the query string, so every request dispatched with query params (all filtered list GETs, and `paginate`'s first page — which passes its cursor via `params:` in `base-resource.ts` L549–551) is observed with a URL missing its entire query string. This violates `DattoHttpRequestEvent.url`'s "exactly as dispatched" contract and defeats faithful auditing (R4/wire fidelity). No test covers a request with `params`, so it is uncaught. | Compose the observed URL from what axios will actually send, e.g. `instance.getUri(requestConfig)` (the `instance` is in scope in the interceptor closure) — it runs `buildFullPath(baseURL, url)` and appends the serialized `params`, yielding the true absolute URL with query string. Add a test that fires a GET with `params` (and one asserting a paginated first page's cursor appears in the observed `url`) to lock the fidelity in. |
| engineer-r1-f2 | Low | Open | Complexity | `src/http/http-client.ts` observer request interceptor (~L384) | The same naive `baseURL + url` concatenation also diverges from axios's own `combineURLs`/`buildFullPath` in two edge cases: (a) a slash mismatch (`baseURL` with a trailing `/` and a `url` with a leading `/`) yields a `//` the dispatched URL never has; (b) a `url` that is itself absolute (`http(s)://…`) — which axios treats as authoritative and dispatches *ignoring* `baseURL` — is observed as `baseURL + absoluteUrl`, a nonexistent address. Current callers route through `resolveNextPageUrl`, which normalizes to a clean relative `pathname + search`, so production paths avoid this today; but the interceptor sits on the shared instance and is generic to any caller. | Resolved by the same fix as f1 — `instance.getUri(requestConfig)` delegates URL joining/absolute-detection to axios, so the observed URL cannot drift from the dispatched one. If f1 is fixed via `getUri`, close this as subsumed. |
