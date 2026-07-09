## mediator — round 2 (Mode A)

Artifact: `docs/implementation/full-api-surface/plan.md` (Phase 8). One escalated finding this round,
`implementation-auditor-r2-f1`. It is Low severity but lands in the **Requirements Gap** category — a
stale-plan-prose defect in an artifact the reviser does not own, requiring an authoring decision by
the planner. Per the ruling boundary (only Medium/Low *judgment* disputes may be ruled; Requirements
and Research gaps are always human), it goes to the human. I re-verified every disputed factual claim
against the working tree; all check out (see dossier).

| ID | Decision | Ruling / question |
|----|----------|-------------------|
| implementation-auditor-r2-f1 | Human | After r1-f3 (Closed) removed `filter-create`/`filter-delete` from the code, `plan.md:355` still lists both in the "complete key set" seeded into `WRITE_LIMITS`, and `plan.md:569` still uses `filter-delete` as the canonical bodiless-`DELETE` example. The closed `WriteOpKey` union and the 57/57 coverage-map test now prove no such operations exist, so the plan prose is stale. Drop `'filter-create': 100`/`'filter-delete': 100` from the `plan.md:355` key set, and replace the `plan.md:569` bodiless-`DELETE` example with a real delete call site (`SiteResource.deleteVariable`, opKey `site-variable-set`). Plan-artifact edit outside the reviser's remit — same class as r1-f2/r1-f4. Does not block Phase 8's code correctness (independently proven); blocks only the plan record's accuracy. |

---

### Dossier — implementation-auditor-r2-f1

**Dispute.** The auditor found (Low, Plan Adherence → Requirements Gap) that closing r1-f3 (removal of
the dead `filter-create`/`filter-delete` `WriteOpKey` entries from the code) left the **plan** still
citing those operations as live. The reviser agreed and escalated rather than fix, on the grounds that
the authoritative text lives in `plan.md` (which the reviser does not own) and that no human ruling for
this specific finding was recorded this round (only r1-f2 and r1-f4 were ruled). No dispute of substance
between auditor and reviser — both want the same planner edit.

**Independent verification (this tree):**
- `grep -n "filter-create\|filter-delete" plan.md` → matches at **`plan.md:355`** ("The complete key
  set … `'filter-create': 100`, `'filter-delete': 100`") and **`plan.md:569`** ("`filter-delete` is a
  `DELETE` (`httpDelete` carries an `opKey` but sends no validated body)"). Both citations are real and
  exactly as described.
- `git grep "filter-create\|filter-delete" -- src/ tests/` → **empty**. The code no longer references
  either key anywhere; consistent with r1-f3 being genuinely Closed.
- The recommended replacement opKey is real: `site-variable-set` is a live `WriteOpKey`
  (`src/rate-limit/rate-limits.ts:28`) and `SiteResource.deleteVariable` reuses it as a bodiless
  `DELETE` (`src/client/resources/site-resource.ts:90,231`) — so it is a valid, delivered substitute
  for the stale `filter-delete` example at `plan.md:569`.

So the finding is factually correct: the plan prose contradicts the delivered closed union, and the
proposed fix references only operations that actually exist.

**Why human, not ruled.** Categorized Requirements Gap. The fix is an edit to a plan artifact
(`plan.md`) outside the reviser's remit, and choosing the exact reconciliation (drop the two keys and
re-word the bodiless-`DELETE` example vs. any alternative phrasing) is an authoring decision that is the
planner's call, not a judgment the mediator may substitute for the code owner. This is the identical
class of plan-artifact discrepancy already routed to the human as r1-f2 and r1-f4; it should be
reconciled in the same pass so the Phase 8 plan record is internally consistent.

**Recommendation to the human/planner.** In `plan.md:355`, drop `'filter-create': 100` and
`'filter-delete': 100` from the "complete key set" for `WRITE_LIMITS`. In `plan.md:569`, replace the
`filter-delete` bodiless-`DELETE` example with `SiteResource.deleteVariable` (opKey `site-variable-set`),
so the plan matches the delivered closed `WriteOpKey` union and the 57/57 coverage map. This blocks only
the accuracy of the plan record, not Phase 8's correctness, which is independently guaranteed by the
closed union and the coverage-map test.
