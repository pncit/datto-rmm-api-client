## architect — round 2

I read my r1 turn, reviser-r3 (which applied all six r1 findings — my f1/f2/f3 plus engineer
f1/f3/f2 — as direct edits), triage-r3, and design-auditor-r3 (which ratified its own lineage and
raised nothing new). This round I confirm my three findings landed, then re-run the PublicAPI /
Boundaries / Architecture axes over the *revised* sections to catch anything the edits introduced.
The core decisions are unchanged and remain sound. One finding, about the readability cost of how
the Cluster-G edit was folded into Decision 4.

### Resolution of my round-1 findings

- **architect-r1-f1 (Resolved).** The three payloads are now named types (`DattoHttpRequestEvent` /
  `DattoHttpResponseEvent` / `DattoHttpErrorEvent`, `:100–128`), `DattoHttpObserver` references them
  by name (`:130–134`), and Key Concepts (`:87`), Success Criteria (`:236`), and the typecheck gate
  (`:253`) all commit to their export. The export criterion is now achievable as drawn.
- **architect-r1-f2 (Resolved).** A single internal helper `src/http/observer.ts` is now named in
  Decision 2 (`:152–154`) and Schema-and-wiring (`:215`), owning the swallow-wrapper, the header
  normalizer, and the capture-and-stash assembler, consumed by both instrumentation sites and kept
  out of published types like `axios-augment.d.ts`. The two-site drift risk is owned.
- **architect-r1-f3 (Resolved).** Decision 5 (`:185`) now pins the unconditional per-pass overwrite
  invariant (idempotent re-capture; terminal events read before the next re-dispatch), closing the
  conditional-stash footgun.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r2-f1 | Low | Open | Architecture | Decision 4 rationale (`:173`), Decision (`:171`), Non-Goals (`:32`) | The Cluster-G edit was absorbed into Decision 4's **Rationale** as one ~40-line, single-paragraph wall that now carries the doc's densest mechanism (the two complementary gates: wire-status for dispatched attempts, `onRequest`-stash-exists for non-dispatched) **and** repeats material already stated verbatim elsewhere. "The attempt already fired `onResponse`, so the later throw is not a terminal event" appears in the Decision block (`:171`), is repeated ~three times inside the rationale (`:173`), and again in Non-Goals (`:32`) and Success Criteria (`:245`). The result is that the load-bearing rule — *shared-instance `onError` fires only after the `!axios.isAxiosError` guard, i.e. only for an attempt with a stash* — is buried mid-paragraph behind the restated post-2xx material. This is a tightening/duplication issue, not a correctness one: the content is right, but a Planner extracting the actual gate from `:173` has to mine it out of prose that re-argues the same point four ways. | Split the mechanism out of the prose: move the **gate rule** (dispatched → wire status; non-dispatched → fired-`onRequest`/stash-exists, realized by placing `onError` after the `!isAxiosError` guard; the two named non-dispatched paths) into the **Decision** block or a short bulleted list, and cut the Rationale to *why* the gate is honest (structured error, retried-attempt cost) without re-deriving the post-2xx carve-out already owned by `:171`/`:32`. Prefer stating the "already fired `onResponse`" invariant once and cross-referencing it. Tightening only; no scope change. |
