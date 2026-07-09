## architect — round 9

Plan Review Mode, round 9 (in-progress review of `full-api-surface/plan.md` against `design.md`).

**Prior state.** My r8 turn carried **no** `Open` findings: `architect-r1` (f1–f8), `-r2` (f9–f12),
`-r3-f13`, `-r4-f14`, `-r5-f15`, `-r6-f16`, and `-r7-f1` are all ratified `Closed` in earlier rounds
and are not re-listed here (carry-forward discipline: earlier-closed findings do not reappear).

**What changed since r8.** `reviser-r13` folded three Accepted engineer findings into the plan, all
touching areas on my axes, so I did a fresh axis pass over the revised text (Phase 2 Step 4 l.159,
Phase 6 Step 3 l.437 + Files l.439, Phase 9 l.610/l.629–634):

- **engineer-r8-f1 → `OVERRIDE_ENTITIES` registry (Phase 6 Step 3, l.437; Phase 9 guard, l.610/629).**
  This is a boundary *improvement*, not a regression. The Phase 9 completeness guard previously
  iterated `Object.entries(WIDENED_FIELDS)` binding a **name string**, then fed it to
  `enumFieldPaths`, which requires a `z.ZodType` (`_zod.def`) — unimplementable without a
  layering inversion (`schema-leniency.ts` reverse-depending on the Phase 6 override registry) or a
  nonexistent name→schema map. The new single per-entity registry
  `OVERRIDE_ENTITIES = [{ name, schema, widenedFields }, …] as const` in `schema-overrides/types.ts`
  carries the **override schema object** alongside its `widenedFields`, so the guard feeds each
  `schema` straight to `enumFieldPaths(schema: z.ZodType)` and `schema-leniency.ts` never imports the
  override registry. Dependency direction is preserved (Phase 4 ← nothing from Phase 6). I checked for
  a **new cycle**: `types.ts` references `deviceResponseSchema`/`alertResponseSchema` from the
  `*-overrides.ts` split files, but it already imported those same schemas for its `z.infer<override>`
  type definitions (l.436–437), so the registry adds no new import edge and no cycle. Placing a runtime
  `as const` value in `types.ts` is consistent with the `*_WIDENED_FIELDS` runtime constants already
  homed there (l.437/439). No boundary issue.
- **engineer-r8-f2 → enum-bearing filter on the transitive widen-guard (Phase 2 Step 4, l.159; test
  l.202).** Restricting the `throw` to a shared component **whose own or a nested schema declares an
  `enum`** correctly narrows the guard to exactly the over-widening-possible case (widening is a strict
  no-op on enum-free schemas), so a benign shared address/pagination/metadata sub-object no longer
  fails `npm run generate`. This does not weaken the load-bearing assumption the r7-f1 fix established:
  the recursion still resolves `$ref`s transitively; only the intersection predicate gained an
  enum-presence condition, which is sound because a non-enum shared component cannot be over-widened.
  No data-model or sequencing issue.
- **engineer-r8-f3 → fail-loud message contract (Phase 2 Step 4, l.159; test l.202).** The guard's
  `throw` now names the offending intersecting `#/components/schemas/*` component(s) and the reaching
  operation(s), mirroring the sibling `patch-spec` drift-message contract. This is a diagnostics/
  maintainability improvement with no architectural surface. No issue.

**Axis sweep on the r13-revised plan:** (a) boundaries/dependency direction — strengthened, no reverse
dependency, no new cycle; (b) data model & schema — the `Omit`/`Pick` graft and the enum-filtered
guard remain consistent at every depth, registry references (not duplicates) the same `*_WIDENED_FIELDS`
constants so single-source is intact; (c) public API surface — `OVERRIDE_ENTITIES` is an internal
`schema-overrides` value, not added to the curated barrel, no leak; (d) migration/phase sequencing —
registry defined in Phase 6, consumed in Phase 9 (Phase 6 → Phase 9), guard reads it forward; (e)
performance & hot paths — guard and registry iteration are generate-/test-time only. No new
architectural findings; the plan remains converged on the axes I own.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|

_No `Open` findings. All previously raised findings were ratified `Closed` in earlier rounds; the
`reviser-r13` edits introduce no new architectural issue on any plan-review axis._
