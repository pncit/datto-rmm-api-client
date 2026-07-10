## engineer — round 5 (design review)

Fifth engineer turn. My r1 (f1–f3), r2 (f1–f2), and r3 (f1) findings all landed
across the reviser rounds and were re-verified in r4; none re-opened. Since r4 the
only change is reviser-r6's Cluster M edit — a wording-only tightening of Decision 4
rule 2's residual negative clause (architect-r4-f1). I read triage-r6, reviser-r6,
and architect-r5, then re-read the design once and ran my axes selectively over the
edited locus and its satellites, honouring the triage chain-watch (Cluster M must not
perturb the Cluster J/K rules; this is the loop's most edit-sensitive locus).

### Verification of the Cluster M edit

- **architect-r4-f1 remediation (Resolved).** Decision 4 rule 2 (`design.md:174`)
  now reads as a single positive gate: the shared-instance `onError` "fires **only
  for an attempt that reached dispatch** — i.e. whose per-attempt stash was written …
  independent of which callbacks the consumer supplied — Decision 5); the gate keys
  off the stash, not off which of the three callbacks the consumer configured — which
  the implementation realizes by placing the `onError` call **after**
  `handleResponseError`'s `!axios.isAxiosError` rethrow guard." The old
  apples-to-oranges negative clause ("*not* for an attempt whose consumer merely
  supplied an `onRequest` callback") is gone, recast as a property of the gate. A
  Planner extracting the gate can no longer read the inverse-of-intent ("supplying
  `onRequest` suppresses `onError`").
- **Chain-watch discharged.** Diffed the bullet against the r4 text: only the trailing
  clause's expression changed. Rule 1 (wire-status terminal selection), rule 3
  (post-2xx incl. grant malformed-token carve-out), the `!axios.isAxiosError`-guard
  placement, and both named non-dispatched paths (rate-limiter `acquire()` rejection;
  Bearer interceptor `getToken()` `DattoApiError`) are byte-for-byte intact. The
  Decision 5 capture-and-stash decoupling (`:187`) the gate sits atop is untouched,
  and the `:250`/`:252` Success Criteria and their `:259` `npm test` assertions still
  bind the invariant verbatim. No mechanism, rule-content, or downstream change — a
  pure prose tightening.

### Axis notes

- **(A) terminal-selection mechanics — converged.** The one-dispatched-attempt ⇒
  one-terminal-event invariant is stated once (Decision 4), keyed off the stash, and
  consistent with Decision 5's dispatch-point capture. The gate now reads as one
  coherent positive rule after three successive rounds on this bullet; no residue
  left.
- **(B) feasibility — no re-check needed.** The Cluster M edit is prose-only and
  touches no source-grounded claim. The capture-point / LIFO-ordering claims I
  grounded against `http-client.ts` in r4 are unchanged and still hold.
- **(C) prose economy — no regression.** The reword removed a clause rather than
  adding one; the bullet is marginally shorter and unambiguous. No new duplication or
  over-length introduced.

No new findings this round. On the axes I own — feasibility, correctness of the
terminal-selection/stash mechanics, and prose economy — the design is converged and
implementable as written. I decline to manufacture findings against a settled,
ratified spine. Selective, not exhaustive.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| — | — | — | — | — | No new findings. Prior engineer findings (r1 f1–f3, r2 f1–f2, r3 f1) all Resolved; reviser-r6's Cluster M fix to Decision 4 rule 2 (`design.md:174`) verified content-preserving against the Cluster J/K invariants. | None — no action required. |
