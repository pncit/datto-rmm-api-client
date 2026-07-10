## architect — round 1

First architect round on this design. I read the prior `design-auditor` (r1–r3) and mediator
turns; that reviewer converged on grant-path terminal-event semantics, R5 body forms, interceptor
ordering, and the Basic-header caveat — all Closed, and I do not re-litigate them. My pass applies
the PublicAPI / Boundaries / Architecture axes those turns did not center, grounded in
`src/http/http-client.ts` and `src/auth/auth-manager.ts`.

The design is sound and well-scoped: the observer-seam-over-instance-injection choice (Decision 1),
dual-layer instrumentation (Decision 2), and status-driven terminal selection (Decisions 3/4) are
the right shape, and the LIFO interceptor-ordering mechanism (Decision 5) checks out against the
real registration sites (`createHttpClient` registers rate-limit first; `AuthManager.attachTo`
registers Bearer later, from a separate module — so an observer interceptor registered first in
`createHttpClient` does run last). Three findings below are about the *contract surface* and
*implementation-structure* the design commits to, not its core decisions.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | PublicAPI | Callback payloads (`:95–126`) vs Success Criteria (`:224`) | Success Criteria commits that "`DattoHttpObserver` **and its payload types** are exported from `src/index.ts`," but the three event payloads are defined as **anonymous inline object types** embedded in each method signature — there are no named payload types to export. A consumer who writes a callback as a standalone named function (rather than an inline literal on the config object) has no exported type to annotate its parameter with, and must hand-duplicate the shape. The stated criterion is unachievable as the interface is currently drawn. | Name the three payloads (e.g. `DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), have `DattoHttpObserver` reference them, and export them from `src/index.ts` / `public-types`. Tightening the interface, not adding surface. |
| architect-r1-f2 | Medium | Open | Architecture | Decision 2 (`:142–150`), Schema and wiring (`:199–203`) | The seam is instrumented at **two independent sites** — the shared-instance interceptor and the grant call site inside `performRefresh` — that must independently reproduce identical behavior: `AxiosHeaders`→plain-`Record` normalization (`:89`), the capture-and-stash payload assembly (`:175`), and the invoke-and-swallow-with-`warn` wrapper (`:82`). The design specifies each behavior in prose but names no shared implementation, so the two sites can silently drift (e.g. one normalizes a multi-value header differently, or one path awaits a callback the R7 wrapper elsewhere never awaits). This is a duplication/consistency risk inherent to Decision 2 that the design leaves unowned. | State that a single internal helper (e.g. `src/http/observer.ts`) provides the swallow-wrapper, the header normalizer, and the payload assembler, consumed by both the interceptor and `performRefresh`, so the two instrumentation points cannot diverge. Keep it internal (never in published types), like `axios-augment.d.ts`. |
| architect-r1-f3 | Low | Open | Architecture | Decision 5 stash rule (`:172–175`), retry re-dispatch (`http-client.ts:279/309/326`) | Retries re-issue via `instance.request(config)` reusing the **same config object**, so the observer's stashed capture (payload + dispatch timestamp) from attempt N persists on that object into attempt N+1. Correctness currently holds only because the request interceptor re-fires and **overwrites** the stash before attempt N+1's terminal event reads it, and the terminal `onError` fires inside `handleResponseError` before the retry re-dispatch overwrites. The design does not state this per-pass-overwrite invariant, leaving an implementation footgun: a stash written conditionally (e.g. "only if absent") would make attempt N+1's terminal event report attempt N's stale request fields/duration, silently breaking R2 per-attempt fidelity. | Add one sentence to Decision 5: the stash is unconditionally overwritten on every interceptor pass (idempotent re-capture), and terminal events read it before the next pass re-dispatches — so a config object reused across retries never leaks a prior attempt's capture. |
