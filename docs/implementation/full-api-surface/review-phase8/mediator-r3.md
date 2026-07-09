## mediator — round 3 (Mode A)

Artifact: `docs/implementation/full-api-surface/plan.md` (Phase 8). Two escalated findings this round.
Both land in the **Requirements Gap** category — defects in the `plan.md`/`design.md` requirements
record that the reviser does not own, each needing a planner-side prose edit and (for
`project-lead-r1-f1`) an authoring decision. Per the ruling boundary (only Medium/Low *judgment*
disputes may be ruled; Requirements and Research gaps are always human), both go to the human. This is
the identical class already routed to the human as `implementation-auditor-r1-f2`/`r1-f4`/`r2-f1` in
this same directory. I re-verified every disputed factual claim against the working tree; all check out
(see dossiers).

| ID | Decision | Ruling / question |
|----|----------|-------------------|
| architect-r1-f2 | Human | `design.md:452-454`'s "Public surface" section still states `src/index.ts` exports "the generated types," but Phase 8 ships a curated `public-types.ts` re-exported by name (no `export * from './generated/types'`), per the approved `plan.md:543-544`. Reword `design.md:452-454` to say `src/index.ts` exports a curated subset of entity/response types re-exported by name from `public-types.ts` (never a wildcard), cross-referencing `plan.md:543-544`. Design-artifact prose edit outside the reviser's remit; does not block Phase 8 code correctness (barrel already matches the plan-mandated curated surface). |
| project-lead-r1-f1 | Human | `plan.md:531` says the package no longer exports the "three" 0.1.x methods and `design.md:476-478`'s Breaking Changes list names only `getAccountDevices`/`getDeviceByUid`/`updateDeviceUdfs` — both omit the retired fourth method `invalidateToken`, which `surface.test.ts:99` already asserts is absent. Needs (1) a `plan.md`/`design.md` prose correction (outside remit) and (2) an authoring decision only the human/planner can make: whether dropping `invalidateToken` with no public replacement (proactive invalidation now reachable only via internal `AuthManager.invalidate()`, wired solely to the automatic 401 handler) is a deliberate design choice or a capability gap Phase 10's README migration guide (R18) must flag. Does not block Phase 8 code correctness. |

---

### Dossier — architect-r1-f2

**Dispute.** The architect found (Low, PublicAPI → Requirements Gap) that `design.md`'s authoritative
"Public surface" section still describes `src/index.ts` as exporting "the generated types," which
contradicts the delivered curated `public-types.ts`. The reviser agreed and escalated rather than fix,
on the grounds that the defect lives in `design.md` (which the reviser does not own) and no human ruling
was supplied for this finding this round. No dispute of substance between architect and reviser — both
want the same planner-side design edit.

**Independent verification (this tree):**
- `design.md:452-454` reads: "`src/index.ts` exports `createDattoRmmClient`, `DattoRmmClient`, the
  config and logger types, the error classes, and **the generated types**." Confirmed verbatim.
- `src/index.ts:23` is `export * from "./public-types";` — the sole type re-export path. There is **no**
  `export * from './generated/types'` anywhere in `src/index.ts` or `src/public-types.ts`
  (`git grep "export \* from"` on both files returns only the `./public-types` line). `public-types.ts`
  re-exports generated types **by name**, per `plan.md:543-544`, which explicitly forbids the wildcard.
- So the design prose "the generated types" (implying a wildcard re-export of the full generated
  surface) misdescribes the delivered/plan-mandated curated-by-name surface. Factually correct finding.

**Why human, not ruled.** Categorized Requirements Gap. The fix is an edit to a design artifact
(`design.md`) outside the reviser's remit, and choosing the exact reconciliation wording is an authoring
decision that is the planner's call, not a judgment the mediator may substitute for the code owner. Same
class already routed to the human as `implementation-auditor-r1-f2`/`r1-f4`/`r2-f1`; reconcile in the
same pass so the Phase 8 design record is internally consistent.

**Recommendation to the human/planner.** Reword `design.md:452-454` to state that `src/index.ts` exports
a **curated subset** of entity/response types re-exported **by name** from `public-types.ts` — never a
wildcard re-export of the generated types — cross-referencing `plan.md:543-544`. This blocks only the
design record's accuracy, not Phase 8's correctness, which is independently verified by
`surface-pin.ts`'s compile-time pins and `surface.test.ts`.

---

### Dossier — project-lead-r1-f1

**Dispute.** The project-lead found (Medium, BehaviorIntent → Requirements Gap) that both `plan.md:531`
and `design.md`'s Breaking Changes list undercount the retired 0.1.x surface: the deleted flat client
exposed **four** public methods (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`,
`invalidateToken`), but the plan says "three" and the design names only the first three. The reviser
agreed and escalated rather than fix, on the grounds that (a) the authoritative text lives in
`plan.md`/`design.md` (not the reviser's remit) and (b) closing it requires an authoring decision about
whether the dropped capability is intentional. No dispute of substance between project-lead and reviser
— both want the same planner edit plus the human's intentional/unintentional determination.

**Independent verification (this tree):**
- `plan.md:531` (Goal) reads "the package no longer exports `Result`/`ProblemError`/**the three** 0.1.x
  methods (R19)." Confirmed.
- `design.md:476-478` (Breaking Changes) names only `getAccountDevices` / `getDeviceByUid` /
  `updateDeviceUdfs`; `invalidateToken` appears nowhere in that list. Confirmed.
- `tests/unit/client/surface.test.ts:99` asserts `expect(client.invalidateToken).toBeUndefined();` — the
  code correctly retires the fourth method, so the deficit is in the requirements record, not the code.
- `AuthManager.invalidate()` still exists internally (`src/auth/auth-manager.ts:197`, delegating to
  `token-store.ts:31`), and `git grep "invalidateToken"` finds it only in the surface-test assertion —
  no public method invokes proactive invalidation. So proactive invalidation is reachable only via the
  internal 401 `onUnauthorized` path; there is no public replacement. Finding is factually correct.

**Why human, not ruled.** Categorized Requirements Gap. Two components are outside the mediator's ruling
authority: (1) the fix is an edit to `plan.md`/`design.md` outside the reviser's remit (same class as
`r1-f2`/`r1-f4`/`r2-f1`), and (2) it turns on an authoring decision only the human/planner can make —
whether dropping `invalidateToken` with no public replacement is a deliberate design choice
(superseded by automatic 401 handling) or a capability gap that Phase 10's README migration guide (R18)
must flag for consumers who rotate `apiSecret` mid-process.

**Recommendation to the human/planner.** Correct `plan.md:531` from "three" to "four" (or name all four
retired methods), add `invalidateToken` to `design.md`'s Breaking Changes list, and record there the
intentional/unintentional determination — so Phase 10's R18 migration guide has a complete, accurate
retired-method list to write upgrade guidance from rather than discovering the fourth method while
drafting docs. This blocks only the requirements record's completeness ahead of Phase 10; Phase 8's own
code correctness is independently verified by `surface.test.ts`'s absence assertion.
