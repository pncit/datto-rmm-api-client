## architect — round 4

Plan Review Mode, round 4 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8) and `architect-r2` (f9–f12) all ratified `Closed` through r2/r3.
`architect-r3-f13` (defaults-module placement / `client → http → client` cycle) was dispositioned
**Accept** by `reviser-r8` — I re-verified against the current plan (`src/defaults.ts` is now top-level
and layer-neutral; Phase 3 Step 4 line ~247 carries the cycle-breaking rationale; the coexistence
new-paths list line 38, the Files list line 250, and the Phase 5 Step 3(b)/Step 4 import references all
point at `src/defaults.ts`), and ratify it → `Closed`.

New axis pass on the revised plan:

- **(a) Boundaries/dependency direction:** `src/defaults.ts` relocation resolves the last cycle; the
  rate-limit table correctly stays under `src/rate-limit/`. No new boundary issue.
- **(b) Data model & schema:** one new inconsistency — the f1 "reconciled `z.infer` is the single
  source of truth" resolution and the R5 codemod enum-widening produce **different type shapes** for
  the same response-enum field, and the plan asserts (Phase 6 Step 3, "R4/R5 alignment") that the
  override schemas "compose in" the widened open enums, but `z.infer` of a composed zod schema cannot
  carry a TS-only `(string & {})` widening (f14, new).
- **(c) Public API surface:** curated `public-types.ts` + `surface.test.ts` gate hold; no new issue.
- **(d) Migration/phase sequencing:** `module`/`moduleResolution` pairing and coexistence invariant
  hold; `src/defaults.ts` created in Phase 3 before its Phase 5 consumers. No new issue.
- **(e) Performance & hot paths:** strip/widen and drop aggregation both bounded; no new issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r3-f13 | Medium | Closed | Boundaries | Phase 3 Step 4 / `src/defaults.ts` | — | ratified: cross-cutting scalars moved to a top-level, layer-neutral `src/defaults.ts`; `src/http/` and `src/auth/` now depend **downward** on it, breaking the `client → http → client` directory cycle. Coexistence new-paths list, Files list, and Phase 5 import references all updated consistently. |
| architect-r4-f14 | Medium | Open | DataModel | Phase 6 Step 3 (l.435 "Reconciled entity types are the single source of truth (R4/R5 alignment)… export the public TypeScript type from the override schema's `z.infer`… and for the codemod-widened open enums, which the override schemas compose in") vs Phase 2 Step 4 codemod (widens `src/generated/types/**` only) + design R5 / Success Criteria (l.502–504) | For entities the override module reconciles (`Device`, `Alert`), the f1 fix makes the **public type** `z.infer<typeof deviceResponseSchema>`. The R5 open-enum widening (`EnumUnion \| (string & {})`) is produced by the Phase 2 codemod that rewrites **`src/generated/types/**` only** — a TS-type-level transform with no runtime/zod representation. `z.infer` is derived from the zod schema's runtime structure, **not** from the separately-widened generated `types/**` file, so the override-derived `Device['deviceClass']` inherits the **closed** generated enum, not the widened form. The plan's parenthetical claim that "the override schemas compose in" the widened enums is not mechanically achievable: composing generated zod enums yields either a closed union (a novel value fails to type-check — reintroducing the exact "compile-time claims an exhaustiveness the runtime relaxes" hazard R5 exists to eliminate, for the flagship `deviceClass`/`Alert` entities) or, via `.or(z.string())`, a collapsed plain `string` (loses the literal members R5 wants for autocomplete). Neither is the R5 shape. Corollary: the Phase 9 compile-time assertion (l.614 `const dc: Device['deviceClass'] = 'rmmnetworkdevice'`) uses an **existing** enum member, so it type-checks even against a closed enum and would **not** catch this loss — the alignment test doesn't exercise a truly novel value against the override-derived type. | Specify the mechanism that grafts the codemod-widened generated **field** types onto the override-derived entity type so `z.infer` and R5 agree — e.g. define the public entity type as an intersection/override that takes the reconciled fields from `z.infer<override>` and the open-enum fields from the codemod-widened generated type (`type Device = Omit<z.infer<typeof deviceResponseSchema>, 'deviceClass'> & Pick<GeneratedDevice, 'deviceClass'>`), or otherwise state how the `(string & {})` widening reaches the exported reconciled type. Then change the Phase 9 enum-alignment assertion to use a **truly novel** value (e.g. `'quantumdevice'`, as Phase 4 l.330 already does) against the override-derived `Device['deviceClass']`, so the test actually guards the widening for override-touched entities rather than passing trivially on an existing member. |
