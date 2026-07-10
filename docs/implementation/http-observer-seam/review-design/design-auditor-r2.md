## design-auditor — round 2

Continuing the review. I read my r1 turn, the reviser's r1 dispositions (all five findings marked
`Fixed`), and the triage. I re-verified each claimed fix against the current `design.md` and
re-checked the underlying mechanics against `src/http/http-client.ts` and `src/auth/auth-manager.ts`.

### Re-verification of r1 findings (all marked `Fixed` by the reviser)

- **f1** (interceptor ordering) — Decision 5 (¶ at design.md:173) and the Schema-and-wiring paragraph
  (design.md:201) now pin: observer request interceptor registered **first** in `createHttpClient` →
  runs **last** under axios LIFO → after the rate-limit interceptor and after `AuthManager.attachTo`'s
  later-registered Bearer interceptor. Matches the code: `createHttpClient` registers the rate-limit
  request interceptor (http-client.ts:350) and `attachTo` registers the Bearer interceptor from a
  separate module afterward (auth-manager.ts:84). Success Criterion + Verification added
  (design.md:230,239). Resolved.
- **f2** (capture-and-stash vs. re-reading `response.config`) — Decision 5 now states `onRequest`
  captures method/url/headers/body and stashes them with the timestamp on per-attempt state, and the
  terminal events reuse the stash (design.md:175), reinforced by a rejected alternative (design.md:185)
  and a Success Criterion (design.md:229). Resolved.
- **f3** (R5 self-contradiction) — R5 reworded to two unambiguous cases: form/urlencoded = serialized
  string, JSON request = pre-serialization object, JSON response = parsed object (design.md:45);
  Key Concepts and the payload comment agree (design.md:89,101). Resolved.
- **f4** (unverified `durationMs` throttle-exclusion) — Success Criterion + Verification added
  (design.md:231,239). Resolved.
- **f5** (grant Basic-header caveat only in Risks) — relocated into Decision 5 (design.md:179) and the
  `onRequest.headers` comment (design.md:100), with Success Criteria/Verification coverage
  (design.md:230,239). Matches the code: `performRefresh` passes `auth:{username,password}` so axios
  applies the Basic header internally (auth-manager.ts:149-153). Resolved.

### New issue this round

Verifying the grant path against Decision 4's terminal-selection rule surfaced one unhandled path —
the grant's post-2xx malformed-token-response failure (auth-manager.ts:166-178) — raised below as f1.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Closed | Feasibility | Decision 5 / Schema and wiring | ratified: mechanism pinned — observer request interceptor registered first → runs last under axios LIFO, after rate-limit and after `AuthManager.attachTo`'s Bearer interceptor; verified against http-client.ts:350 and auth-manager.ts:84; Success Criterion + Verification added. | — |
| design-auditor-r1-f2 | Medium | Closed | Feasibility | Decision 5 / Callback payloads | ratified: `onRequest` now captures-and-stashes method/url/headers/body with the timestamp on per-attempt state and terminal events reuse the stash instead of re-reading `response.config`; rejected-alternative and Success Criterion added. | — |
| design-auditor-r1-f3 | Medium | Closed | Completeness | Requirements R5 | ratified: R5 reworded into two non-contradictory cases (form/urlencoded serialized string; JSON pre-serialization object; JSON response parsed object); Key Concepts and payload comment now agree. | — |
| design-auditor-r1-f4 | Low | Closed | SuccessCriteria | Success Criteria / Verification | ratified: Success Criterion + Verification now assert an injected pre-dispatch throttle delay is excluded from `durationMs` (timestamp taken after `rateLimiter.acquire`). | — |
| design-auditor-r1-f5 | Low | Closed | Completeness | Decision 5 / Callback payloads | ratified: grant Basic-header caveat relocated into the contract (Decision 5 + payload comment), with the API key riding in the captured body; verified against auth-manager.ts:149-153; Success Criteria/Verification updated. | — |
| design-auditor-r2-f1 | Medium | Open | DesignDecision | Decision 4 / Non-Goals / grant path | Decision 4 states the terminal event is selected by HTTP outcome and names only `DattoValidationError` (raised in `BaseResource` after a 2xx) as the post-exchange failure that does **not** fire `onError`. But the grant path has a structurally identical, unaddressed case: after a **2xx** POST, `performRefresh` runs `tokenResponseSchema.safeParse` and, on a malformed body, throws a `DattoApiError` (auth-manager.ts:166-178) — *not* a `DattoValidationError` and *not* covered by the `BaseResource` carve-out. Under "one terminal event per attempt, selected by HTTP status," that attempt received a 2xx and must fire `onResponse` (carrying the raw 2xx token-response body), and the subsequent malformed-token `DattoApiError` must **not** fire `onError`. A Planner instrumenting `performRefresh` could naturally wrap the whole method's `try` and fire `onError` from any throw, which would make a malformed-2xx grant emit `onError` (or a double terminal), violating the terminal-event invariant. | Tighten Decision 4 (do not add a section): state that the grant attempt's terminal event is selected by the HTTP status of the token POST, not by whether `performRefresh` throws — so a 2xx grant with a malformed token body fires `onResponse` and its post-2xx `DattoApiError` is *not* an `onError`, mirroring the `DattoValidationError` carve-out. Add the grant malformed-2xx case to the Non-Goals list of non-firing failures and to the Verification test matrix. |
