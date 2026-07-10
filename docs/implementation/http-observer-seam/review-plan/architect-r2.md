## architect — round 2

In-progress review. I read my `architect-r1` turn and the reviser's round-1/round-2 dispositions
(both marked all my findings `Fixed`), then re-verified each `Fixed`/ruled claim against the current
`plan.md` and `design.md`. I then re-ran the five plan axes (boundaries & dependency direction; data
model & schema; public API surface; migration/phase sequencing; performance & hot paths) over the
*revised* plan — with particular attention to the two structural changes the revisions introduced
(the `mapObserverError` removal + raw `unknown` error pass-through, and the shared `captureRequest`
assembler) — to confirm they did not open new inconsistencies.

Re-verification of my round-1 findings:

- **architect-r1-f1** (rate-limit error divergence) — resolved by the human ruling that dropped the
  `DattoApiError` guarantee and typed `onError.error` as `unknown`. The plan now hands the raw
  transport error straight through (`fireError(logger, observer, capture, rawError: unknown)`), with
  no in-observer mapping, so the "observed error diverges from the thrown error" concern is moot by
  construction — the seam no longer claims to reproduce the client's mapped error at all. Design R8 /
  Decision 4 and the plan are mutually consistent on this. **Conceded to the ruling → Closed.**
- **architect-r1-f2** (relative vs absolute `url`) — ratified. Phase 2 S2 captures
  `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``, Phase 3 S2 captures
  `` `${this.config.apiUrl}${GRANT_PATH}` `` (both routed through `captureRequest`), the design payload
  comment pins the absolute resolved URL, and Phase 2/3/4 tests assert it. **Ratified → Closed.**
- **architect-r1-f3** (`observer.ts` export surface under-specified) — ratified. Phase 1 S5 now
  enumerates the complete surface (`ObserverCapture`, `normalizeHeaders`, `captureRequest`,
  `invokeObserver`, `fireRequest`, `fireResponse`, `fireError`); `mapObserverError` is removed
  everywhere and the mooted branch test is replaced by the `fireError` raw-pass-through test.
  **Ratified → Closed.**

New-issue pass (no new findings): the two non-dispatched exclusion paths (rate-limiter reject; Bearer
`getToken()` throw) still correctly yield no shared-instance `onError` under the LIFO ordering
(observer registered first → runs last, after the throwing request interceptors), so the
"one dispatched attempt ⇒ one terminal event" invariant holds; the per-attempt stash overwrite +
read ordering across a retry is sound (`onError` fires at the top of `handleResponseError` before the
re-dispatch that overwrites the stash); `error.config?.__dattoObserverCapture` reads the same
augmented config the interceptor stashed onto; grant `onResponse` fires before `safeParse`;
`durationMs` excludes throttle because `startedAt` is stamped in the last-running observer
interceptor. Boundaries, data model, public surface (five axios-free types), sequencing, and hot-path
overhead (gated on `httpObserver` presence) are all clean on this axis pass. Converged — no new
findings this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | DataModel | Phase 1 S5 / Phase 2 S4 (`onError.error`) | Rate-limit/`onError` mapped-error divergence. | Conceded to the human `unknown`-error ruling: the plan now hands off the raw transport error with no in-observer mapping (`fireError(..., rawError: unknown)`), so there is no re-derived error to diverge; design R8/Decision 4 and the plan agree. No further action. |
| architect-r1-f2 | Medium | Closed | DataModel | Phase 2 S2, Phase 3 S2, design payload | Captured `url` was the bare relative path. | Ratified: absolute resolved URL captured at both sites via `captureRequest` (`baseURL+url`; `apiUrl+GRANT_PATH`), pinned in the design payload comment, and asserted in Phase 2/3/4 tests. |
| architect-r1-f3 | Low | Closed | Architecture | Phase 1 S5 export enumeration | `observer.ts` module surface under-specified (`mapObserverError` absent from the enumeration yet used downstream). | Ratified: complete surface enumerated; `mapObserverError` removed everywhere per the `unknown` ruling; the branch test is replaced by the `fireError` raw-pass-through test. |
