## engineer — round 2 (design review)

Second engineer turn. My three r1 findings all landed in the r3 revision and I re-verified each
against the current text — none re-opened:

- **engineer-r1-f1 (Resolved).** Decision 4's `onError` gate is now stated as a mechanism ("fires
  **only for an attempt that fired `onRequest`**… after `handleResponseError`'s `!axios.isAxiosError`
  rethrow guard") and names **both** non-dispatched paths (rate-limiter `acquire()` rejection and the
  Bearer interceptor's grant-failure `DattoApiError`); "the one code path" is gone (design.md:173,
  Verification :246).
- **engineer-r1-f2 (Resolved).** `onResponse` is now located at the shared instance's fulfilled
  response handler (the identity `(response) => response` slot), reading the per-attempt stash,
  symmetric to `onError` in the rejected handler (design.md:183; SC :247).
- **engineer-r1-f3 (Resolved).** R7 no longer says "ignored"; it now specifies the return value is
  **not awaited** but a thenable gets an unawaited `.catch` that logs once at `warn` and swallows,
  matching Risks row 5 (design.md:47, :274).

I then re-read the design once and ran three axes over the *post-revision* text: (A) grant-path
terminal-event scoping vs. the whole-`try` anti-pattern, (B) shared-instance run-order / throttle
exclusion, (C) prose economy of the sections my r1 remediations expanded. (A) and (B) check out —
the run order [Bearer, rate-limit, observer-last] correctly puts `onRequest` after auth attach and
after `acquire()`, and Decision 4 explicitly forbids instrumenting the whole `performRefresh` `try`,
so grant terminal selection follows wire status. The residual findings are both on axis (C):
tightening, not correctness. Selective, not exhaustive — the design is sound.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| engineer-r2-f1 | Low | Open | Clarity | Decision 4 rationale (design.md:173) | The Decision 4 **Rationale** is a single ~600-word paragraph that now absorbs the r1-f1 remediation (the non-dispatched `onError` gate + both paths), the r2-f1 wire-status rule, the grant malformed-2xx ordering constraint, and the retried-attempt `DattoApiError` cost — four distinct arguments fused into one run-on block. The load-bearing sentence ("the shared-instance `onError` fires **only for an attempt that fired `onRequest`**… after `handleResponseError`'s `!axios.isAxiosError` rethrow guard") is buried mid-paragraph behind two other clauses, so a Planner skimming for the actual placement rule can miss it — the same under-specification risk the remediation set out to remove. This is over-length, not a factual gap. | Split the paragraph along its natural seams: (1) why the concrete `DattoApiError` type is honest; (2) the wire-status selection rule for **dispatched** attempts; (3) the non-dispatched gate ("fires only for an attempt that fired `onRequest`" → after the `!isAxiosError` guard) naming the two paths; (4) the grant fire-`onResponse`-before-`safeParse` ordering. Lead each sub-point with its rule so the placement mechanism is scannable. No content added or removed — purely restructuring. |
| engineer-r2-f2 | Low | Open | Duplication | Non-Goals (design.md:32) · Decision 4 (:171–173) · Success Criteria (:245–246) · Verification (:254) | The two grant special-cases — (a) malformed-2xx-token fires `onResponse` only (never `onError`) and (b) the lazy-refresh Bearer-interceptor failure fires `onError` exactly once on the grant attempt — are each restated in near-full prose in four places: Non-Goals, Decision 4's Non-Goals-echoing sentence and its Rationale, a Success-Criteria bullet, and a Verification bullet. The malformed-token narrative ("`performRefresh` throws a `DattoApiError` after `safeParse` rejects the 2xx body… fires exactly one terminal event — `onResponse` with the raw response body") appears three times almost verbatim (:32, :171, :245). Beyond requirements-traceability value, this is redundancy that raises the drift cost of any future edit — a change to the rule must be chased across four sites. | Keep the **authoritative** statement of each case in Decision 4 (rationale + mechanism), and reduce the Non-Goals / Success-Criteria / Verification occurrences to short cross-referencing pointers (e.g. "malformed-2xx grant → one `onResponse`, no `onError` — see Decision 4") rather than re-narrating the full mechanism. Verification may retain the concrete *test assertion* wording; the prose *explanation* need not be re-derived there. |
