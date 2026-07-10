## design-auditor — round 1

Round 1; review directory was empty. I read the design and verified every current-state claim
against the actual source (`src/http/http-client.ts`, `src/auth/auth-manager.ts`,
`src/client/datto-client-config.ts`, `src/client/datto-rmm-client.ts`, `src/logging/logger.ts`,
`src/client/resources/base-resource.ts`, `src/http/axios-augment.d.ts`, `src/index.ts`).

### Current State Verification

| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| Shared instance in `http-client.ts`/`createHttpClient` carries rate-limit request interceptor + `handleResponseError` response interceptor | Verified | — |
| `AuthManager.attachTo` adds a Bearer request interceptor to the shared instance | Verified | — |
| Retries re-invoke `instance.request(config)`, re-running the full interceptor chain (each attempt a distinct pass) | Verified | — |
| Non-2xx arrives at `handleResponseError` as `AxiosError`; every terminal failure mapped to `DattoApiError` | Verified | — |
| Retried statuses (401/429/5xx/network) sleep + retry **without** constructing a `DattoApiError` | Verified | Confirmed: all three branches `return instance.request(config)` with no error built. |
| Grant client is a bare axios instance with none of the shared interceptors | Verified | — |
| `performRefresh` builds body as `new URLSearchParams({...}).toString()` and wraps the call in a mapping `try/catch` | Verified | — |
| Pagination issues `this.axios.get` per page through the shared instance | Verified | — |
| `dattoRmmClientConfigSchema` is a `z.strictObject` rejecting unknown keys incl. `axiosInstance` | Verified | — |
| Logger validated shape-only and wrapped in `withUdfMasking`; body/header-free | Verified | `dattoLoggerSchema` is `z.object` (non-strict), not `strictObject` — minor vs. the design's "strict object" wording (see r1-f5). |
| `axios-augment.d.ts` `rateDescriptor` augment is the precedent for internal per-request state kept out of `dist` | Verified | — |
| `src/index.ts` re-exports factory, config/logger types, error hierarchy, `public-types` | Verified | — |

### Notes

Requirements table exists and every R1–R10 traces to a decision (and back). Tracking line present
(`None`). Migration/breaking-change analysis (purely additive) is accurate against the code. The
findings below are the substantive gaps.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Open | Feasibility | Decision 2 / Decision 5 / Schema and wiring | The design asserts `onRequest` fires "after rate-limit acquisition and after the auth headers are attached," but the shared instance's auth Bearer interceptor is registered by a *separate* module (`AuthManager.attachTo`) **after** `createHttpClient` builds the instance, and axios runs request interceptors in **reverse** registration order (LIFO). Achieving post-auth/post-throttle observation is non-obvious and left unspecified — a Planner could easily place the observer where it runs *before* the auth header is set. | Specify the mechanism: the observer request-interceptor must be registered **first** inside `createHttpClient` (so it executes last, after both the rate-limit interceptor and the later-attached auth interceptor). Pin it in Decision 5 and cover with the test already named in Risk row 3 (assert the observed shared-instance request carries the `Authorization: Bearer` header). |
| design-auditor-r1-f2 | Medium | Open | Feasibility | Decision 2 / Schema and wiring / Callback payloads | The terminal events (`onResponse`/`onError`) carry `requestHeaders`/`requestBody`, but the design only calls out stashing "the dispatch timestamp" via the augment pattern. On the response side, axios has already overwritten `config.data` with the **serialized** body (transformRequest runs after request interceptors) and normalized `config.headers` — so reading request fields from `response.config` at the terminal event yields the serialized JSON string (not the object R5 intends) and post-normalization headers, which may not match what `onRequest` observed. | State that `onRequest` captures method/url/headers/body and **stashes them** (alongside the timestamp) on the per-attempt internal state, and that `onResponse`/`onError` reuse that captured payload rather than re-reading `response.config`, so the request fields are identical across the attempt's events. |
| design-auditor-r1-f3 | Medium | Open | Completeness | Requirements R5 | R5 is internally contradictory for JSON: it requires bodies "as sent/received on the wire" and "never pre-parsed away from the wire form," yet also "the object/parsed form for JSON." The literal wire form of a JSON body is the serialized string; the object is the *pre-serialization* form. As written a Planner cannot tell whether a JSON write's `requestBody` should be the object or the serialized string. | Clarify R5 (and the payload comment) that JSON request bodies are delivered as the **pre-serialization object** (the developer-facing form) — explicitly *not* the literal wire bytes — while form/urlencoded is the serialized string; drop or reword the "never pre-parsed away from the wire form" clause so it doesn't contradict the JSON case. |
| design-auditor-r1-f4 | Low | Open | SuccessCriteria | Success Criteria / Verification | Decision 5 makes `durationMs` = wire time (dispatch→response), explicitly **excluding** rate-limiter throttle wait — a stated behavioral guarantee — but no success criterion or test verifies it. | Add a verification that `durationMs` measures dispatch→response and excludes rate-limiter throttle time (e.g. inject a throttle delay and assert it is not folded into `durationMs`). |
| design-auditor-r1-f5 | Low | Open | Completeness | Decision 5 / Callback payloads / Risks row 2 | Decision 5 and the `onRequest` payload comment claim the callback observes "the final on-the-wire headers (including the bearer token)," but for the grant call the `Authorization` Basic header is applied by axios internally from the per-request `auth:` option and never appears in the captured header map — a caveat that lives only in the Risks table, not where the contract is specified. A Planner writing tests from Decision 5 would wrongly expect the grant's `Authorization` header to be present. | Locate the best-effort header caveat where the contract is defined (Decision 5 / payload doc), not only in Risks: `Authorization: Bearer` is present on shared-instance requests, but the grant's `Authorization: Basic` (the non-secret `public-client:public` pair) is absent by design; the API key rides in the captured body. |
