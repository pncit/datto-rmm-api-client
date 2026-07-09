## architect — round 5

Plan Review Mode, round 5 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8) and `architect-r2` (f9–f12) ratified `Closed` through r2/r3;
`architect-r3-f13` (defaults-module placement / import cycle) ratified `Closed` in r4. The one
outstanding item, `architect-r4-f14` (the override-derived entity type cannot carry the R5 open-enum
widening via `z.infer` alone), was dispositioned **Accept** by `reviser-r9`. I re-verified the fix
against the current plan text and ratify it → `Closed`:

- Phase 6 Step 3 (l.436) now defines the reconciled type as an explicit intersection taking the
  open-enum fields from the codemod-widened `src/generated/types` type and everything else from
  `z.infer<override>` (`type Device = Omit<z.infer<typeof deviceResponseSchema>, 'deviceClass'> &
  Pick<GeneratedDevice, 'deviceClass'>`), driven by a per-entity `ENUM_FIELDS` constant; the stale
  "the override schemas compose in the widened enums" claim is gone.
- Phase 9 assertion (l.608 prose, l.617 example) now uses a **truly novel** value (`'quantumdevice'`)
  against the override-derived `Device['deviceClass']`, so it no longer passes trivially on an existing
  member.
- Phase 7 import comment (l.496) describes the type as the `z.infer` base plus the widened-enum graft.

New axis pass on the revised plan (changes were confined to the Phase 6/7/9 type-graft mechanism —
the data-model axis):

- **(a) Boundaries/dependency direction:** `schema-overrides/types.ts` now imports the codemod-widened
  `GeneratedDevice` from `src/generated/types` to build the reconciled type. This is an internal import
  (not a re-export), so it does not reintroduce the f2 uncurated-surface hazard; the curated
  `public-types.ts` boundary holds. The intersection uses the generated type only for its enum fields
  and the override `z.infer` for everything else, so the reconciled entity stays the single runtime
  source. No new boundary issue.
- **(b) Data model & schema:** the intersection mechanism is mechanically sound (`string`-degraded
  runtime value is assignable to the `EnumUnion | (string & {})` compile type). **One new gap:** the
  hand-maintained `ENUM_FIELDS` list has no completeness guard, and the plan overstates what the Phase 9
  single-field assertion proves (f15, new).
- **(c) Public API surface:** curated `public-types.ts` + `surface.test.ts` gate unaffected; no new issue.
- **(d) Migration/phase sequencing:** `GeneratedDevice` (Phase 2 output, codemod-widened) exists before
  Phase 6 consumes it; sequencing holds. No new issue.
- **(e) Performance & hot paths:** unchanged by the type-only revision; strip/widen and drop aggregation
  remain bounded. No new issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r4-f14 | Medium | Closed | DataModel | Phase 6 Step 3 (l.435–438), Phase 9 (l.608/l.617), Phase 7 (l.496) | — | ratified: reconciled entity type is now an explicit intersection grafting the codemod-widened generated enum field(s) onto the `z.infer<override>` base (per `ENUM_FIELDS`); Phase 9 assertion uses a truly novel value against the override-derived type. `z.infer`/R5 shapes now agree. |
| architect-r5-f15 | Low | Open | DataModel | Phase 6 Step 3 (l.436 "The per-entity `ENUM_FIELDS` list is a documented constant in `types.ts`; Phase 9's enum-alignment test … guards that the graft and the runtime widening cover **the same field set**") vs Phase 9 Step 3 (l.608) / example (l.614–620) | The f14 fix makes each override-touched entity's open-enum fields depend on a **hand-maintained** `ENUM_FIELDS` constant: a field listed there gets the codemod-widened generated type (open `(string & {})`), a field omitted keeps the **closed** `z.infer<override>` enum. But the Phase 9 alignment test only exercises **one** field — `Device['deviceClass']` — so it cannot "guard that the graft and the runtime widening cover the same field set" as l.436 claims. Two consequences: (1) the plan's stated guard is overstated — a single-field assertion does not prove set-equality; (2) a future enum field added to an override-touched entity (`Device`/`Alert`) by a spec refresh, if not manually added to `ENUM_FIELDS`, would be typed **closed** at compile time while `parseLenient` widens it at runtime — silently reviving for that field the exact "compile-time claims an exhaustiveness the runtime relaxes" hazard R5 exists to kill, undetected because no test covers it and there is no completeness check binding `ENUM_FIELDS` to the actual enum fields present on the reconciled entities. Scope is narrow (only override-touched `Device`/`Alert`; non-override entities carry the codemod widening automatically), hence Low. | Either (a) add a completeness guard so a drift is caught: a test that enumerates the enum-typed fields of each override-touched entity (e.g. from the generated type or the override schema) and asserts each is present in that entity's `ENUM_FIELDS` (and covered by the novel-value assertion), turning the l.436 "same field set" claim into a verified gate; or (b) drive the Phase 9 novel-value assertion over **every** field in `ENUM_FIELDS` (not just `deviceClass`) and document that reconciling a new override entity requires adding its enum fields to `ENUM_FIELDS` and a corresponding assertion. Also soften the l.436 wording so it does not claim the current single-field test guards the whole field set. |
