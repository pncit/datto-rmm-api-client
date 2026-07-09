## engineer — round 9

Plan Review Mode, round 9 (in-progress review). Read my `engineer-r1`…`engineer-r8` turns and the
only disposition landed since round 8 — `reviser-r13`, which **Accept**ed all three still-Open r8
findings (`engineer-r8-f1`, `-f2`, `-f3`) and folded them into the plan. Architect r8 had no Open
findings. Re-verified each fix against the current `plan.md` and re-swept the five engineer axes
(DRY/reuse, abstraction/complexity, error handling & logging, naming/intent, configuration & magic
values) over the three r13-edited spans (Phase 2 Step 4 l.159–160, Phase 6 Step 3 l.437, Phase 9
Step 3 l.610 + example l.629–635) and their downstream consistency.

**Verification of the three r13 fixes:**

- **`engineer-r8-f1`** (Accept, verified): Phase 6 Step 3 (l.437) now introduces a single per-entity
  registry `OVERRIDE_ENTITIES = [{ name, schema, widenedFields }, …] as const` in
  `schema-overrides/types.ts`, pairing each override **schema object** with its `widenedFields`.
  Phase 9's guard prose (l.610) and example (l.629–635) iterate it and feed each entry's `schema`
  straight to `enumFieldPaths(schema: z.ZodType)`. `enumFieldPaths` stays `z.ZodType`-typed, so
  `schema-leniency.ts` never imports the override registry — the layering inversion and the
  string-has-no-`_zod.def` bug are both gone. Ratified → `Closed`.
- **`engineer-r8-f2`** (Accept, verified): Phase 2 Step 4 (l.159) now throws only when the shared
  transitively-reachable component **"whose own schema (or a nested schema within it) declares an
  `enum`"** — enum-free shares (address/pagination/metadata sub-objects) are silently allowed, so a
  benign share no longer fails `npm run generate`. Widening is a strict no-op on an enum-free schema,
  so the filter introduces no false negative (nothing to over-widen absent an enum), and `$ref`'d
  enum components are still caught by name via the reachability sets. Test l.202 updated: cases (i)/(ii)
  use enum-bearing shares (throw), new case (iii) proves an enum-free share does not throw. Ratified → `Closed`.
- **`engineer-r8-f3`** (Accept, verified): Phase 2 Step 4 gains a fail-loud message contract (l.160):
  `throw new Error(...)` **names the offending intersecting `#/components/schemas/*` component(s)** and,
  for each, the request-body/response operation(s) reaching it — mirroring the patch-spec named-anchor
  precedent (l.153/l.187). Test l.202 asserts the message names the offending component(s). Ratified → `Closed`.

**New-issue sweep (r13 edits).** No new findings. The enum-detection required by the r8-f2 filter is a
JSON-spec walk inside the codemod guard, a genuinely different representation from the zod-level
`enumFieldPaths`, so it is not a DRY duplication to consolidate. The completeness guard enumerates
enums on the **override** schema, which is exactly the set `parseLenient` widens at runtime, so tying
it to `widenedFields` correctly verifies the type-graft/runtime-widening alignment. `deviceResponseSchema`/
`alertResponseSchema` referenced by the registry are consistent with l.436/l.502 usage. All
earlier-Closed findings (`engineer-r1-f1…f16`, `engineer-r2-f1…f5`, `engineer-r3-f1…f2`, `engineer-r5-f1`,
`engineer-r7-f1…f2`) verified non-regressed on re-read and carried forward by ID (not re-tabled, per
carry-forward discipline).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r8-f1 | Medium | Closed | Naming | Phase 6 Step 3 l.437; Phase 9 Step 3 l.610 + example l.629–635 | — | Ratified: single per-entity `OVERRIDE_ENTITIES = [{ name, schema, widenedFields }]` registry in `schema-overrides/types.ts` is the one place graft and guard read; Phase 9 iterates it feeding each `schema` to `enumFieldPaths(schema: z.ZodType)`. Guard is now implementable (schema, not name string) with no `schema-leniency.ts`→override reverse dependency. |
| engineer-r8-f2 | Medium | Closed | Complexity | Phase 2 Step 4 l.159; test l.202 | — | Ratified: transitive widen-guard throw restricted to shared components that (directly or via a nested inline schema) declare an `enum`; enum-free shares silently allowed, so no spurious `npm run generate` break. Filter adds no false negative (widening is a no-op absent an enum). Tests updated to enum-bearing throw cases (i)/(ii) plus enum-free no-throw case (iii). |
| engineer-r8-f3 | Low | Closed | ErrorHandling | Phase 2 Step 4 l.160; test l.202 | — | Ratified: fail-loud `throw` now has a self-locating message contract naming the offending intersecting component(s) and the request/response operations reaching each, mirroring patch-spec's named-anchor error; test asserts the message names the offending component(s). |
