## architect — round 6

Plan Review Mode, round 6 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8), `architect-r2` (f9–f12), `architect-r3-f13`, and `architect-r4-f14`
all ratified `Closed` through r4/r5. The one outstanding item, `architect-r5-f15` (no completeness
guard binding `ENUM_FIELDS` to the actual enum fields present; single-field alignment assertion
overstated), was dispositioned **Accept** by `reviser-r10`. I re-verified the fix against the current
plan and ratify it → `Closed`:

- Phase 6 Step 3 (l.436) now drives the `Omit`/`Pick` graft key set from one `as const` per-entity
  constant (`DEVICE_ENUM_FIELDS = ['deviceClass'] as const`, keys = `typeof DEVICE_ENUM_FIELDS[number]`),
  making the constant the single source with no hand-repeated literals, and softens the overstated
  "single test guards the whole field set" wording.
- Phase 9 Step 3 (l.608–609) adds the completeness guard (enumerate each override-touched entity's
  actual enum-typed fields, assert each is in that entity's `ENUM_FIELDS`) and drives the
  truly-novel-value assertion over **every** field in **every** entity's `ENUM_FIELDS`.

New axis pass on the revised plan, this round grounded against the concrete `Device` shape the repo
already carries (`src/schemas.ts`), which the reconciled `deviceResponseSchema` supersedes but whose
field topology the spec-generated `Device` mirrors:

- **(a) Boundaries/dependency direction:** unchanged since r4; `src/defaults.ts` layering and the
  curated `public-types.ts` boundary hold. No new issue.
- **(b) Data model & schema:** the f14/f15 graft mechanism (top-level `Omit`/`Pick` keyed by
  `ENUM_FIELDS`) is **structurally unable to reach a nested enum field**, and `Device` — the flagship
  override-touched entity — demonstrably carries two nested enums (`antivirus.antivirusStatus`,
  `patchManagement.patchStatus`). This revives the exact R5 hazard the whole f14→f15 thread set out to
  kill, for those nested fields (f16, new).
- **(c) Public API surface:** curated `public-types.ts` + `surface.test.ts` + coverage-map gate
  unaffected. No new issue.
- **(d) Migration/phase sequencing:** unchanged; holds. No new issue.
- **(e) Performance & hot paths:** unchanged; strip/widen and drop aggregation remain bounded. No new
  issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r5-f15 | Low | Closed | DataModel | Phase 6 Step 3 (l.436), Phase 9 Step 3 (l.608–609) | — | ratified: `ENUM_FIELDS` is now the single `as const` source driving the `Omit`/`Pick` graft, and Phase 9 adds a completeness guard plus a per-field novel-value assertion over every entity's `ENUM_FIELDS`. The "same field set" claim is now a verified gate. |
| architect-r6-f16 | Medium | Open | DataModel | Phase 6 Step 3 (l.436 — `type Device = Omit<z.infer<typeof deviceResponseSchema>, typeof DEVICE_ENUM_FIELDS[number]> & Pick<GeneratedDevice, typeof DEVICE_ENUM_FIELDS[number]>`, `DEVICE_ENUM_FIELDS = ['deviceClass'] as const`); Phase 9 Step 3 completeness guard (l.608–609) + example (l.626–630 `enumFieldsOf`) | The f14/f15 graft grafts open-enum widening onto an override-touched entity **only for top-level enum fields**: `Omit<…, typeof DEVICE_ENUM_FIELDS[number]>` removes top-level keys and `Pick<GeneratedDevice, typeof DEVICE_ENUM_FIELDS[number]>` re-adds the *whole* top-level property from the codemod-widened generated type. A `Pick` key is a top-level property name — it **cannot** address a nested enum (`antivirus.antivirusStatus`), so a nested enum field cannot be listed in `DEVICE_ENUM_FIELDS` in a way the graft can act on. But `Device` (an override-touched entity, its `udf`/timestamps reconciled) demonstrably has **nested enum fields**: `src/schemas.ts` shows `antivirus.antivirusStatus` and `patchManagement.patchStatus` as enums nested inside `Device` (the design's own "25 enums… `antivirusStatus`, `patchStatus`" list, l.188). For those nested fields the reconciled `Device` type takes its `antivirus`/`patchManagement` sub-objects from `z.infer<deviceResponseSchema>`, whose composed generated `z.enum([...])` is **closed** (the codemod widening is TS-`types/**`-only and never reaches `z.infer`), while `parseLenient` widens the same nested enums to passthrough at runtime (Phase 4 Step 2). Result: the compile-time type claims exhaustiveness for `device.antivirus.antivirusStatus` / `device.patchManagement.patchStatus` that the runtime deliberately relaxes — the precise "compile-time claims an exhaustiveness the runtime relaxes" R5 hazard f14/f15 exists to eliminate, now unresolved for the nested enums of the flagship override-touched entity. The r10 completeness guard does not save this: (i) if `enumFieldsOf(entity)` walks only top-level fields, it passes while the nested hazard ships silently; (ii) if it recurses and surfaces `antivirusStatus`/`patchStatus`, it **fails with no valid resolution** — the top-level `Pick` graft cannot widen a nested field, so there is no `ENUM_FIELDS` entry that makes the assertion pass, deadlocking the exit gate. Scope: override-touched entities only (`Device`, and any other reconciled entity with nested enums); non-override entities use the generated type verbatim and carry the codemod widening at every depth, so they are unaffected. Real, not hypothetical — the two nested Device enums exist today. Medium: it is a compile-time type-safety defect (not runtime data loss — `parseLenient` still passes and does not drop the item), but it defeats the stated R5 guarantee for concrete fields on the primary entity and the guard as written either misses it or deadlocks. | Extend the graft so it composes at the correct depth for override-touched entities, and make the completeness guard match. Options: (a) define the reconciled entity type by **substituting the whole codemod-widened sub-object types** for the reconciled fields — i.e. take `antivirus`/`patchManagement` (and `deviceClass`) from `GeneratedDevice` and only the genuinely reconciled shapes (`udf` record, epoch-ms timestamps) from `z.infer<override>`, so every generated (already-widened) field/sub-tree flows from `GeneratedDevice` and the override contributes only what it actually changes; (b) if `Device`'s reconciled fields and its enum fields don't overlap by sub-tree, invert the base — derive `Device` from `GeneratedDevice` (fully widened) and `Omit`+`&` only the reconciled `udf`/timestamp fields from `z.infer<override>`; (c) at minimum, make `ENUM_FIELDS` and the completeness guard **recurse into nested objects** (dotted-path or per-sub-object entries) and specify a graft that can widen nested paths, then add `antivirus.antivirusStatus`/`patchManagement.patchStatus` to `DEVICE_ENUM_FIELDS` — otherwise state explicitly that override-touched entities must have **no nested enums** and prove it (which `Device` violates today). Also update the Phase 9 example so `enumFieldsOf` is defined to recurse, and add a nested-enum novel-value assertion (`device.antivirus.antivirusStatus = 'QuantumAV'`) so the gate actually exercises the nested path. |
