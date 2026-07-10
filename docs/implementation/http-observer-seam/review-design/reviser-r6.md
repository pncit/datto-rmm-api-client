## reviser — round 6 (design revision)

Applied triage-r6 Cluster M as the sole route this round. engineer-r4 raised no
finding; design-auditor produced no r4 turn (its lineage stays Closed). One Open
finding, routed `Remediate`, fixed by a wording-only tightening of a single
Decision 4 rule-2 clause. Diffed the bullet before/after: only the residual
negative clause's *expression* changed — the positive "reached dispatch / stash
written … independent of which callbacks the consumer supplied — Decision 5" gate,
the `!axios.isAxiosError`-guard placement, and the two named non-dispatched paths
(rate-limiter `acquire()` rejection; Bearer interceptor `getToken()`
`DattoApiError`) are byte-for-byte preserved, per the chain-watch.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| architect-r4-f1 | Fix | Genuine in-scope prose residue of the Cluster K reword sitting on the load-bearing Decision 4 rule-2 gate. Recast the trailing negative clause as a property of the *gate* rather than of a non-existent attempt class: replaced "*not* for an attempt whose consumer merely supplied an `onRequest` callback" with "the gate keys off the stash, not off which of the three callbacks the consumer configured" (`design.md:174`). Removes the apples-to-oranges negation a Planner could read as the inverse of intent while stating the true stash-keyed invariant positively. No mechanism, rule-content, or downstream (plan/test) change — the positive gate, guard placement, and both non-dispatched paths survive untouched; the `:250`/`:252` Success Criteria and their `:259` `npm test` assertions still hold verbatim. Tightening, not padding. |
