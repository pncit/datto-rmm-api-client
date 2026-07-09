## engineer — round 8

Plan Review Mode, round 8 (in-progress review). Read my `engineer-r1`…`engineer-r7` turns and the
only disposition landed since round 7 — `reviser-r12`, which `Accept`ed all three round-7 findings
(`architect-r7-f1`, `engineer-r7-f1`, `engineer-r7-f2`) and folded them into the plan. Re-verified
each edit against the current `plan.md` and re-swept the five engineer axes (DRY/reuse,
abstraction/complexity, error handling & logging, naming/intent, configuration & magic values) for
anything the round-12 edit introduced or exposed. Architecture/data-model and requirements-coverage
concerns remain deferred to `/architect` and `/project-lead`.

**Ratification of my prior findings.**
- `engineer-r7-f1` (`enumFieldPaths` second `_zod.def` site) — `reviser-r12` `Accept`. Verified:
  Phase 4 Step 1 (l.306) now exports `enumFieldPaths(schema): string[]` from `schema-leniency.ts`,
  built on the existing `addCatchallRecursive`/`detectUnknownProperties` walk, and Phase 9 Step 3
  (l.609) + the example (l.629) state the guard imports it from there. All `_zod.def` access stays
  in one module. → **Closed** (ratified).
- `engineer-r7-f2` (`*_ENUM_FIELDS` misnomer) — `reviser-r12` `Accept`. Verified: renamed to
  `DEVICE_WIDENED_FIELDS`/`ALERT_WIDENED_FIELDS`/`WIDENED_FIELDS` throughout (Phase 6 Step 3 l.436,
  Phase 9 Step 3 l.609 + example l.627–631, Files note l.438), with the one-line note that each entry
  is the containing top-level property. `grep` confirms no `_ENUM_FIELDS` token survives. → **Closed**
  (ratified).

All earlier engineer findings (`r1-f1…f16`, `r2-f1…f5`, `r3-f1…f2`, `r5-f1`) remain `Closed` and are
not re-tabled per carry-forward discipline.

**New issue exposed by the r12 edit.** Homing `enumFieldPaths` in `schema-leniency.ts` fixed the
isolation concern but gave the helper a `(schema)` signature, and the Phase 9 example guard now calls
it with the wrong argument type — see `engineer-r8-f1` below.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r7-f1 | Medium | Closed | DRY | Phase 4 Step 1 (l.306); Phase 9 Step 3 (l.609, example l.629) | — | ratified: `enumFieldPaths(schema)` is now an exported helper of `schema-leniency.ts` reusing the existing recursive walk; the Phase 9 guard imports it, so all `_zod.def` introspection stays in one file and cannot desync from the runtime widener. |
| engineer-r7-f2 | Low | Closed | Naming | Phase 6 Step 3 (l.436, l.438); Phase 9 Step 3 (l.609, example l.627–631) | — | ratified: constants renamed to `*_WIDENED_FIELDS`/`WIDENED_FIELDS` throughout with a note that each entry is the containing top-level property whose subtree holds an open enum; no `_ENUM_FIELDS` token remains. |
| engineer-r8-f1 | Medium | Open | Documentation | Phase 9 Step 3 completeness-guard example, l.628–630 (`for (const [entity, fields] of Object.entries(WIDENED_FIELDS))` → `enumFieldPaths(entity)`); vs the helper contract at Phase 4 Step 1 l.306 (`enumFieldPaths(schema): string[]`) and the `WIDENED_FIELDS` map definition at l.436 | The r12-homed helper takes a **zod schema** (`enumFieldPaths(schema)`, introspects `_zod.def`), but the guard example iterates `Object.entries(WIDENED_FIELDS)` — whose keys are **entity name strings** (`'Device'`, `'Alert'`) and whose values are the top-level-field arrays — and passes that **name string** as `enumFieldPaths(entity)`. A string has no `_zod.def`, so the call as written cannot enumerate any enum node: the guard would either throw or (worse) return `[]` and vacuously **pass**, silently defeating the very completeness gate r11/r12 built. The plan specifies no mapping from an entity's name to its override zod schema anywhere — `WIDENED_FIELDS` carries only the field lists — so the guard is not implementable as exampled. This is the load-bearing gate that catches an omitted spec-refresh enum (the R5 hazard), and a vacuously-passing guard is arguably worse than none. | Give the guard access to each entity's override **schema**, not just its name. Simplest: define `WIDENED_FIELDS` as a map from entity name to `{ fields, schema }` (or add a parallel `OVERRIDE_SCHEMAS` map in `types.ts`), and write the example as `enumFieldPaths(schema)` — e.g. `for (const [entity, { fields, schema }] of Object.entries(WIDENED_FIELDS)) { for (const path of enumFieldPaths(schema)) expect(fields).toContain(topLevelOf(path)); }`. State in Phase 6 Step 3 (l.436) that the per-entity constant is paired with its override schema so the Phase 9 guard has a schema to introspect, keeping the guard's single source of truth (the `WIDENED_FIELDS` entry) coupled to the schema it must enumerate. |
