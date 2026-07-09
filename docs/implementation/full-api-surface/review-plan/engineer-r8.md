## engineer — round 8

Plan Review Mode, round 8 (in-progress review). Read my `engineer-r1`…`engineer-r7` turns and the
only disposition landed since round 7 — `reviser-r12`, which **Accept**ed all three still-Open
findings (`architect-r7-f1`, `engineer-r7-f1`, `engineer-r7-f2`) and folded them into the plan:

- **`engineer-r7-f1`** (Accept, verified): Phase 9 Step 3 (l.609) + example (l.629–630) now state the
  recursive enum enumerator `enumFieldPaths` is an **exported helper of
  `src/validation/schema-leniency.ts`** built on the existing `addCatchallRecursive`/`detectUnknownProperties`
  walk, imported by the guard — keeping all `_zod.def` access in one isolated module. Ratified → `Closed`.
- **`engineer-r7-f2`** (Accept, verified): `DEVICE_ENUM_FIELDS`/`ALERT_ENUM_FIELDS`/`ENUM_FIELDS`
  renamed to `DEVICE_WIDENED_FIELDS`/`ALERT_WIDENED_FIELDS`/`WIDENED_FIELDS` throughout (Phase 6 Step 3
  l.436, Phase 9 Step 3 l.609 + example l.628), with the one-line note that each entry is the
  *containing top-level property* whose subtree holds an open enum, not the enum field itself.
  Ratified → `Closed`.
- **`architect-r7-f1`** (Accept, verified): Phase 2 Step 4 (l.159) now specifies a **transitive**
  `$ref`-resolving guard (through `properties`/`items`/`allOf`/`oneOf`/`anyOf`/`additionalProperties`
  with a visited-set), and `widen-enums.test.ts` (l.201) gains a nested/transitive throw case.
  (Architect-owned; noted only for context, not re-adjudicated here.)

Re-swept the five engineer axes (DRY/reuse, abstraction/complexity, error handling & logging,
naming/intent, configuration & magic values) over the three r12-edited sections. All earlier-Closed
findings (`engineer-r1-f1…f16`, `engineer-r2-f1…f5`, `engineer-r3-f1…f2`, `engineer-r5-f1`) verified
non-regressed and carried forward by ID (not re-tabled per carry-forward discipline). The r12 edits
resolve their targets but expose three new issues, raised below.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r7-f1 | Medium | Closed | DRY | Phase 9 Step 3 l.609; example l.629–630 | — | Ratified: `enumFieldPaths` homed as an exported helper of `src/validation/schema-leniency.ts` on the existing walk, imported by the Phase 9 guard; single `_zod.def`-isolation boundary preserved and the guard cannot desync from the runtime widener. |
| engineer-r7-f2 | Low | Closed | Naming | Phase 6 Step 3 l.436; Phase 9 Step 3 l.609 + example l.628 | — | Ratified: constants renamed `*_WIDENED_FIELDS` with the note that each entry is the containing top-level property (not the enum field); name now matches the recursive guard's semantics and can't mislead the implementor into re-closing nested enums. |
| engineer-r8-f1 | Medium | Open | Naming | Phase 9 Step 3 example l.628–630 (`Object.entries(WIDENED_FIELDS)` → `enumFieldPaths(entity)`) vs. the helper's home/contract at l.609 | The completeness-guard example iterates `Object.entries(WIDENED_FIELDS)`, binding `entity` to the **map key — a string entity name** (`"Device"`, `"Alert"`), then calls `enumFieldPaths(entity)`. But per l.609 `enumFieldPaths` lives in `schema-leniency.ts` and enumerates enum nodes by structurally introspecting a **zod schema** (`_zod.def`), so it needs the entity's *override schema*, not its name string. As written the guard is not implementable: a string has no `_zod.def`. Two silent forks the implementor is left to invent — (a) make `enumFieldPaths` accept an entity-name string and internally resolve name→schema, which forces `schema-leniency.ts` (a Phase 4 validation module) to **reverse-depend on the Phase 6 override registry**, a layering inversion the plan nowhere sanctions; or (b) keep it schema-typed and thread a schema in, but the plan states **no** entity-name→override-schema map exists (`WIDENED_FIELDS` carries only field-name arrays). Either way the guard cannot desync-check the constant against the actual schemas without a source that pairs them. | Specify a single per-entity registry (e.g. in `schema-overrides/types.ts`) mapping each override-touched entity to `{ schema, widenedFields }` — the one place Phase 6's graft and Phase 9's guard both read — and rewrite the example to iterate it: `for (const { schema, widenedFields } of OVERRIDE_ENTITIES) for (const path of enumFieldPaths(schema)) expect(widenedFields).toContain(topLevelOf(path))`. Keep `enumFieldPaths` typed to accept a `z.ZodType` (not a name string) so `schema-leniency.ts` never imports the override registry (no reverse dependency). |
| engineer-r8-f2 | Medium | Open | Complexity | Phase 2 Step 4 transitive guard, l.159 ("throw if those two sets intersect") | The transitive guard throws when the request-reachable and response-reachable `#/components/schemas/*` **name sets intersect**, with no filter for whether the shared schema actually **carries an enum**. Widening is a no-op on an enum-free component, so a benign shared nested sub-object — an address/pagination/metadata object commonly referenced by both a write body and a response — is harmless yet trips the guard and **fails `npm run generate` for nothing**. The shallow top-level check this replaced rarely reached such shared sub-objects; recursing through `properties`/`items`/`allOf`/… now dives into exactly the deep, widely-shared building blocks, so the false-positive surface is materially larger. The guard's stated purpose is to catch a shared schema that could be *over-widened*; an enum-free shared schema cannot be, so throwing on it is a spurious build break forcing a non-fix. | Restrict the throw to shared schemas that actually contain an enum: intersect only over transitively-reachable component names **whose schema (or a nested schema within it) declares an `enum`**, so the guard fires precisely when over-widening is possible and stays silent on benign non-enum shares. Update `widen-enums.test.ts` case (ii) (l.201) so its shared transitive schema carries an enum (making the throw meaningful) and add a case proving a shared **enum-free** component does **not** throw. |
| engineer-r8-f3 | Low | Open | ErrorHandling | Phase 2 Step 4 transitive guard, l.159 ("then **throw**") | The fail-loud throw is specified without a message contract, yet it exists to "force an explicit fix." Phase 2's sibling fail-loud (patch-spec, l.153/l.187) sets the precedent of naming the offending anchors (`missing expected schema fields: …`). The widen guard should likewise name **which** component schema(s) are shared and by which request-body/response operations, or the maintainer gets an opaque build failure with no pointer to the schema to split. | State that the guard's `throw new Error(...)` message enumerates the intersecting `#/components/schemas/*` name(s) (and, ideally, the request/response paths that reach each), mirroring patch-spec's named-anchor error, so the failure is self-locating. |
