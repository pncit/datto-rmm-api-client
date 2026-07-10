## architect — round 3

I read my r1/r2 turns, triage-r4, reviser-r4 (which applied Cluster J — the
Decision 4 restructure carrying my r2-f1 plus engineer-r2-f1/f2), and engineer-r2.
This round I confirm my r2 finding landed and re-ran the PublicAPI / Boundaries /
Architecture axes over the restructured Decision 4 and its satellite sites,
checking specifically that the structure-only edit dropped no load-bearing rule.
The design remains sound and converged; core decisions unchanged. One new Low
finding, on the PublicAPI axis.

### Resolution of my round-2 finding

- **architect-r2-f1 (Resolved).** The Decision 4 **Decision** block now carries
  the gate mechanism as a scannable three-item numbered list (`:171–175`):
  rule 1 = dispatched → wire-status selection; rule 2 = non-dispatched → no
  terminal event, `onError` fires only for an attempt that fired `onRequest`
  (stash exists), realized by placing the call after the `!axios.isAxiosError`
  guard, naming both non-dispatched paths; rule 3 = post-2xx carve-out. The
  **Rationale** (`:177`) is trimmed to *why* (honest concrete type, non-dispatched
  gate honesty, grant `onResponse`-before-`safeParse` pointer, retried-attempt
  cost) and states the "already fired `onResponse`" invariant once. The
  load-bearing placement rule is no longer buried. I verified against triage-r4's
  chain-watch that all four fragile sub-rules survive: (1) observer interceptor
  first→last per Decision 5 (`:174`, `:185`); (2) `onError` after the
  `!isAxiosError` guard, gated on stash-exists (`:174`); (3) grant `onResponse`
  before `safeParse` (`:177`); (4) wire-status terminal selection (`:173`). No
  rule dropped. engineer-r2-f2's satellite reductions also landed: Non-Goals
  (`:32`) and Success-Criteria (`:249–250`) now carry "(see Decision 4)" pointers
  with the re-derived mechanism prose cut, Verification (`:258`) retains its
  concrete test-assertion wording.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r3-f1 | Low | Open | PublicAPI | `DattoHttpHeaders` alias (`:98`) vs export enumeration (`:95`), Key Concepts (`:89`) | The event payloads use a named `DattoHttpHeaders` alias for every header field (`:98`, `:103/110/113/120/122`), but the design's export commitment enumerates exactly **four** public types — `DattoHttpObserver` plus the three event types (`:95`, `:240`, `:257`) — leaving `DattoHttpHeaders` out. Since the exported event types reference the alias by name in their public signatures, the surface is under-specified: either the alias is part of the published contract (a consumer writing a standalone header-handling helper wants an importable name to annotate it) and should be in the export set, or it is internal and the event fields should inline the `Record<string, string \| string[] \| undefined>` form so no dangling alias leaks. The doc itself uses both forms — the inline `Record` at Key Concepts (`:89`) and the alias in the payload block (`:98`) — so the intended surface is ambiguous. This is the same export-completeness gap class as my resolved r1-f1 (named-but-unexported payloads), one level down. | Pick one form and state it: either add `DattoHttpHeaders` to the exported set (making it "five" everywhere the "four" count appears — `:95`, `:240`, `:257`) so a consumer can annotate a header helper, or drop the alias and inline the `Record<…>` in the four event fields. Reconcile Key Concepts (`:89`) to whichever is chosen. Tightening the existing surface, not adding capability. |
