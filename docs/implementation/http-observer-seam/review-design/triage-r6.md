# Mediator — Round Triage r6 (design stage)

Reviewers assimilated this round: `architect-r4`, `engineer-r4`. `design-auditor`
produced no r4 turn — its latest is `design-auditor-r3`, which raised nothing and
ratified its last Open item (`design-auditor-r2-f1`) Closed; that whole lineage
stays Closed and carries no route row.

Both new reviewers first re-verified that the r5 remediations (Cluster K —
`engineer-r3-f1`'s capture-and-stash decoupling; Cluster L — `architect-r3-f1`'s
`DattoHttpHeaders` export reconciliation, Option A) landed faithfully:

- **`engineer-r3-f1` (Resolved, not re-opened).** Decision 5 (`design.md:187`) now
  states the client captures-and-stashes at the dispatch point "**independent of
  which of the three callbacks the consumer supplied**," names it a client-internal
  step, and calls out the `onError`-only / `onResponse`-only consumer; rule 2
  (`:174`) gates on "reached dispatch (stash written)." engineer-r4 re-ran gate
  content-equivalence (A), capture-point feasibility grounded against
  `http-client.ts:341–348` (B), and export-count consistency (C) — all pass. No
  route row.
- **`architect-r3-f1` (Resolved, not re-opened).** Cluster L took Option A;
  `DattoHttpHeaders` is now the fifth exported type, reconciled at Key Concepts
  (`:87/:89`), payload block (`:95`), Success Criteria (`:240`), Verification
  (`:258`); no stray "four" survives. No route row.

The r5 chain-watch is therefore **discharged**: Cluster K landed without disturbing
the ratified Cluster J rules (both named non-dispatched paths, the
`!axios.isAxiosError`-guard placement, wire-status/post-2xx carve-outs are
byte-for-byte intact per engineer-r4's axis A), and Cluster L propagated cleanly to
the exit gates (five-type count internally consistent).

That leaves **one Open finding this round**: `architect-r4-f1` (Low, Architecture) —
a phrasing residue introduced by the Cluster K rule-2 reword. `engineer-r4` raises
**no** new finding. The single finding is not a Requirements/Research gap, not
High/Critical/Blocker; it is a direct `design.md` prose edit — this is the design
stage, so the remedy is an **untagged** `Remediate` (no upstream doc to amend;
never `Design Change:`/`Plan Change:`).

I re-derived the finding against the live text before routing:

- **architect-r4-f1 — rule-2's trailing negative clause juxtaposes non-comparable
  categories.** Confirmed. Decision 4 rule 2 (`design.md:174`) now correctly re-keys
  the shared-instance `onError` gate onto "**only for an attempt that reached
  dispatch** — i.e. whose per-attempt stash was written (which happens for every
  dispatched attempt whenever `httpObserver` is present, independent of which
  callbacks the consumer supplied — Decision 5)" — the positive gate and its
  parenthetical already state the true invariant correctly. But the sentence then
  appends "*not* for an attempt whose consumer merely supplied an `onRequest`
  callback." Whether an attempt is dispatched is independent of *which callbacks the
  config carries*, so "an attempt whose consumer merely supplied an `onRequest`
  callback" is not a distinct class of attempt; negating it reads, on a literal
  pass, as "an attempt where `onRequest` was supplied does not fire `onError`" — the
  inverse of intent. The clause is trying to negate the *old* "fired `onRequest`"
  model that Cluster K replaced, but now sits inside the *new* positive gate, right
  where the load-bearing rule lives. Phrasing residue of the reword, not a mechanism
  error. Correct, Low, directly applicable. **Remediate.**

The recommendation is sound and directly applicable by the reviser as a `design.md`
edit → **Remediate**. No Challenge (the finding is right; first turn on this locus —
the clause was created by the r5 reword — so the once-only challenge budget is
untouched and there is no reason to spend it). No Ruled (the reviewer's recommended
fix needs no binding correction or redirection; it does not conflict with any prior
ruling — none was issued in any round of this loop — nor with the Cluster J/K rules
it sits among). No Human (Low, non-gap).

## Route table

| ID | Route | Detail |
|----|-------|--------|
| architect-r4-f1 | Remediate | Cluster M. Verified: Decision 4 rule 2 (`design.md:174`) states the correct positive gate ("reached dispatch — i.e. whose per-attempt stash was written … independent of which callbacks the consumer supplied") but appends a trailing "*not* for an attempt whose consumer merely supplied an `onRequest` callback" clause that negates a non-class of attempt, reading literally as the inverse of intent. Remedy: **drop** the "*not* for an attempt whose consumer merely supplied an `onRequest` callback" clause, or recast it as a property of the *gate* rather than of an *attempt* (e.g. "…the gate keys off the stash, not off which of the three callbacks the consumer configured"). Preserve the positive "stash written / reached dispatch" gate, the two named non-dispatched paths, and the `!axios.isAxiosError`-guard placement exactly. Tightening the expression only — no behavior or rule-content change. |

## Remediation plan (root-cause-first)

### Cluster M — Rule-2 gate carries a residual negative clause from the Cluster K reword (architect-r4-f1)
**Root cause.** The r5 Cluster K edit re-keyed rule 2's gate from "fired
`onRequest`" to "reached dispatch (stash written)." It added the correct positive
gate and its parenthetical invariant, but retained (repointed) a trailing negative
clause whose subject — "an attempt whose consumer merely supplied an `onRequest`
callback" — belongs to the *old* callback-keyed mental model. Inside the new
stash-keyed gate that subject is not a distinct attempt class, so the negation is an
apples-to-oranges construction that a Planner extracting the gate could read as the
inverse of intent ("supplying `onRequest` suppresses `onError`"). Single locus,
single sentence.

**Scope of edit (design.md — direct edit, this is the design stage):**
- **Decision 4 rule 2 (`:174`).** Remove the "*not* for an attempt whose consumer
  merely supplied an `onRequest` callback" clause, **or** recast it as a statement
  about the *gate* (keys off the stash, not off which callbacks the consumer
  configured). Leave every other element of the bullet exactly as-is: the positive
  "only for an attempt that reached dispatch — stash written … independent of which
  callbacks the consumer supplied — Decision 5" gate, the placement of the `onError`
  call **after** `handleResponseError`'s `!axios.isAxiosError` rethrow guard, and
  the two genuinely non-dispatched paths (rate-limiter `acquire()` rejection; the
  Bearer request-interceptor `getToken()` `DattoApiError`). No other line moves.

**Verification.** No mechanism change — the existing terminal-selection and
`onError`-only Success Criteria (`:250`, `:252`) and their `npm test` assertions
(`:259`) still hold verbatim. The reviser should diff Decision 4 before/after to
confirm only the negative clause's *expression* changed and the rule content —
including the Cluster J and Cluster K invariants — is byte-for-byte preserved.

**Suggested order.** Single cluster; land directly. It touches one sentence of the
Decision 4 spine, so re-read the whole bullet after the edit to confirm the gate
still reads as one coherent positive rule.

## Chain watch

- **Cluster M must not perturb the Cluster J / Cluster K rules.** The edit sits on
  the exact Decision 4 rule-2 bullet that architect-r4 and engineer-r4 re-ratified
  this round. Only the residual negative clause may change; the positive
  stash-keyed gate, the `!axios.isAxiosError`-guard placement, the two named
  non-dispatched paths, the wire-status selection, and the post-2xx (incl. grant
  malformed-token) carve-out must survive untouched. Diff the bullet before/after
  for rule-content equivalence — this is a wording-only tightening, the third
  successive round to touch this one bullet, so it is now the loop's most
  edit-sensitive locus.
- **No propagation to plan/impl.** The finding is a pure prose residue with no
  mechanism, schema, export, or test-matrix consequence; nothing downstream depends
  on the clause being present or absent beyond the rule reading unambiguously.
- **No cross-reviewer conflict this round.** `engineer-r4` raised nothing and
  re-verified the same rule-2 bullet content-equivalent; `design-auditor` produced
  no turn and its lineage stays Closed; `architect-r4-f1` is the sole residual
  tightening finding and contradicts no prior ruling (none was issued in any round)
  or resolved finding. The design's substance is settled and converged — this is the
  last phrasing residue on an otherwise-ratified spine.

## Human dossiers

None — no finding was routed to Human this round.
