## architect — round 4

I read my r1/r2/r3 turns, triage-r5, and reviser-r5 (which applied Cluster K —
engineer-r3-f1's capture-and-stash decoupling — and Cluster L — my r3-f1's
`DattoHttpHeaders` export reconciliation). This round I confirm my r3 finding
landed, then re-ran the PublicAPI / Boundaries / Architecture axes over the two
just-edited loci (Decision 4 rule 2 and Decision 5's capture-and-stash prose, plus
the five-type export sites) to catch anything the edits introduced. The design
remains sound and converged; core decisions unchanged. One new Low finding, a
readability residue of the Cluster K reword.

### Resolution of my round-3 finding

- **architect-r3-f1 (Resolved).** Cluster L took Option A: `DattoHttpHeaders` is now
  an exported public type. All five sites reconcile — Key Concepts (`:87`, with the
  inline `Record<…>` retained only as the parenthetical definition at `:89`), the
  payload-block enumeration (`:95`), Success Criteria (`:240`), and Verification
  (`:258`) all say **five** public types and name the alias; a grep for `four`
  finds no stray count. A consumer can now import a name to annotate a standalone
  header helper, matching the design's own rationale for exporting the named
  payloads. Surface is internally consistent.

I also verified Cluster K (engineer-r3-f1) landed without disturbing the Cluster J
rules: Decision 5 (`:187`) now states the client captures-and-stashes at the
dispatch point **whenever `httpObserver` is present, independent of which callbacks
the consumer supplied**, with `onRequest` (if present) merely *invoked* from that
same point; the two named non-dispatched paths, the `!axios.isAxiosError`-guard
placement, and the wire-status/post-2xx sub-rules are untouched. The mechanism is
correct. My finding below is purely about how the rule-2 gate is now *worded*.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r4-f1 | Low | Open | Architecture | Decision 4 rule 2 (`:174`) | The Cluster K reword correctly re-keys the shared-instance `onError` gate onto "reached dispatch — i.e. whose per-attempt stash was written," but the decoupling left a trailing negative clause that juxtaposes two non-comparable categories: "*not* for an attempt whose consumer merely supplied an `onRequest` callback." An attempt is or isn't dispatched regardless of *which callbacks the config carries*; "an attempt whose consumer merely supplied an `onRequest` callback" is not a distinct class of attempt, so negating it reads, on a literal pass, as "an attempt where `onRequest` was supplied does not fire `onError`" — the opposite of the intent. The clause is trying to negate the *old* "fired `onRequest`" mental model (that Cluster K replaced), but sits inside the *new* positive gate, so a Planner extracting the gate from `:174` meets one apples-to-oranges negation right where the load-bearing rule lives. This is a phrasing residue of the reword, not a mechanism error — the parenthetical two lines up ("independent of which callbacks the consumer supplied — Decision 5") already states the true invariant positively and correctly. | Drop the "*not* for an attempt whose consumer merely supplied an `onRequest` callback" clause, or recast it as a property of the *gate* rather than of an *attempt*: e.g. "…the gate keys off the stash, not off which of the three callbacks the consumer configured." Leave the positive "stash written / reached dispatch" gate and the `!axios.isAxiosError`-guard placement as the operative rule. Tightening the expression only; no behavior or rule-content change. |
