## reviser — round 3 (design revision)

Applied the r3 triage plan in root-cause-first order (F → G → H → E → I). All six
Open findings routed `Remediate`; each is an in-scope gap tightened by direct edit
to `design.md`, none deferred as additive. No finding was routed `Challenge`, so a
row exists for every Open finding.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| architect-r1-f2 | Fix | Cluster F (spine). Decision 2 instruments two independent sites that must reproduce identical header-normalization, capture-and-stash, and swallow-with-`warn` behavior. Named a single internal helper `src/http/observer.ts` owning the three primitives, consumed by both the shared-instance interceptor and `performRefresh`; stated it stays internal like `axios-augment.d.ts`. Edited Decision 2 and Schema-and-wiring. Tightening, not new surface. |
| engineer-r1-f1 | Fix | Cluster G. Restated Decision 4's `onError` gate as a mechanism: fires only for an attempt that fired `onRequest` (stash exists), realized by placing the call after `handleResponseError`'s `!axios.isAxiosError` guard. Named **both** non-dispatched paths (rate-limiter `acquire()` rejection and the Bearer interceptor's grant-failure `DattoApiError`) and why neither fires `onError`; dropped "the one code path." Noted complementarity with the r2-f1 wire-status rule. Added a Success-Criteria/test case for once-only grant `onError`. |
| engineer-r1-f2 | Fix | Cluster G. Located `onResponse`: stated it fires from the shared instance's fulfilled response handler (the identity `(response) => response` slot), reading the per-attempt stash, symmetric to `onError` in the rejected handler. One sentence in Decision 5; added a 2xx-fires-`onResponse` verification bullet. |
| architect-r1-f3 | Fix | Cluster H. Added the per-pass overwrite invariant to Decision 5: the stash is unconditionally overwritten on every interceptor pass (idempotent re-capture), retries reuse the same config object, terminal events read before the next re-dispatch — a conditional stash would leak attempt N's fields into N+1, breaking R2. |
| architect-r1-f1 | Fix | Cluster E. Named the three payloads (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), had `DattoHttpObserver` reference them by name, and stated all four export from `src/index.ts`/`public-types`. Updated Key Concepts, Success Criteria, and the typecheck gate. Makes the existing export criterion achievable; not new public surface. |
| engineer-r1-f3 | Fix | Cluster I. Tightened R7 and Risks row 5: the return value is not awaited, but a thenable return gets a `.catch` (unawaited) that logs once at `warn` and swallows — so neither a synchronous `throw` nor an async rejection propagates or delays the request. Removed the "ignored" wording that contradicted the swallow guarantee; extended the observer-isolation test to the async-rejection case. |
