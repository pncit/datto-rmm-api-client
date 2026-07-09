## engineer — round 5

Plan Review Mode, round 5 (in-progress review). Read my `engineer-r1`…`engineer-r4` turns plus the
only dispositions landed since round 4 (`architect-r4-f14` → `reviser-r9`, and `plan-auditor-r6`),
then re-verified each against the current `plan.md` and re-swept the five engineer axes (DRY/reuse,
abstraction/complexity, error handling & logging, naming/intent, configuration & magic values) for
issues **introduced or exposed by the round-9 enum-graft edit**. Architecture/data-model and
requirements-coverage concerns remain deferred to `/architect` and `/project-lead`.

**Ratification of prior findings (all remain `Closed`).** `engineer-r1-f1…f16`, `engineer-r2-f1…f5`,
`engineer-r3-f1…f2` were each `Accept`ed and verified present in the plan in prior rounds; none
regressed on re-read. Carried forward by ID, not re-raised.

**Cross-check of the `architect-r4-f14` fix (`reviser-r9`).** The Phase 6 Step 3 reconciled-type
mechanism now grafts the codemod-widened generated enum field onto the `z.infer<override>` base via
an explicit intersection (`Omit<z.infer<typeof deviceResponseSchema>, 'deviceClass'> &
Pick<GeneratedDevice, 'deviceClass'>`), driven by a documented per-entity `ENUM_FIELDS` constant in
`types.ts`; the Phase 9 alignment assertion (l.606, l.617–618) now uses a truly novel value
(`'quantumdevice'`) against the override-derived `Device['deviceClass']`. The mechanism is sound and
internally consistent, and the Phase 7 import comment (l.496) was updated to match. One residual
single-source concern this edit introduces is raised below (Low).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r3-f1 | Medium | Closed | ErrorHandling | Phase 8 coverage-map (l.567–568) | Ratified in r4 — sample-body requirement scoped to override-declaring writes; bodiless writes exempt. No regression. | No further action. |
| engineer-r3-f2 | Low | Closed | ErrorHandling | Phase 5 Step 4 (l.368) | Ratified in r4 — `AuthManager` catches the bare instance's `AxiosError` and rethrows `DattoApiError.fromAxiosError(err)`. No regression. | No further action. |
| engineer-r5-f1 | Low | Open | MagicValues | Phase 6 Step 3 (l.436, the reconciled-type graft) vs Phase 9 enum-alignment test (l.606, l.617–618) | The r9 fix creates **two sources for the same "which fields are open enums" set**: (a) the runtime `ENUM_FIELDS` constant documented in `types.ts`, and (b) the hand-written type-level literals inside `Omit<z.infer<…>, 'deviceClass'> & Pick<GeneratedDevice, 'deviceClass'>`, repeated per entity. Because the `Omit`/`Pick` key literals are written by hand rather than derived from `ENUM_FIELDS`, adding an open-enum field (e.g. an `Alert` enum "as applicable") to one but not the other silently desyncs the graft from the documented set — exactly the single-source discipline the plan invokes everywhere else (`WriteOpKey`, `DEFAULT_RETRY`, `src/defaults.ts`). The plan states Phase 9 "guards that the graft and the runtime widening cover the same field set," but the only concrete compile-time assertion (l.617–618) exercises `Device['deviceClass']`; the `Alert` open-enum fields the plan flags "as applicable" get **no** novel-value assertion, so a missing `Alert` graft would pass the exit gate. | Drive the `Omit`/`Pick` keys from the constant so there is one source, e.g. `type Device = Omit<z.infer<typeof deviceResponseSchema>, typeof DEVICE_ENUM_FIELDS[number]> & Pick<GeneratedDevice, typeof DEVICE_ENUM_FIELDS[number]>` with `ENUM_FIELDS` declared `as const`. And extend the Phase 9 alignment test to assert a truly-novel value against **each** entity's `ENUM_FIELDS` (not only `Device['deviceClass']`) so the "same field set" guard actually covers every override-touched entity. |
