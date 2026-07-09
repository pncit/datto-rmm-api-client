## architect — round 8

Plan Review Mode, round 8 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8), `architect-r2` (f9–f12), `architect-r3-f13`, `architect-r4-f14`,
`architect-r5-f15`, and `architect-r6-f16` are all ratified `Closed` through r6/r7. The single
outstanding item, `architect-r7-f1` (the Phase 2 widen-guard was **shallow** — it verified the
request/response schema-sharing assumption only for the top-level `requestBody` `$ref`, not for the
**transitive/nested** component-schema refs the codemod actually widens), was dispositioned **Accept**
by `reviser-r12`. I re-verified the fix against the current plan text and ratify it → `Closed`:

- Phase 2 Step 4 (l.159) now titles the guard "Verify the load-bearing assumption … *transitively*,
  not just at the top level," and specifies it **resolves `$ref`s recursively** (through
  `properties`/`items`/`allOf`/`oneOf`/`anyOf`/`additionalProperties`, with a visited-set for cycles),
  collects the **full transitive** `#/components/schemas/*` set reachable from every request body and
  from every response, and **throws** if those sets intersect. This is exactly the recursion the
  finding called for and makes the guard verify the assumption at every depth.
- The Notes (l.161) now read "at every nesting depth," and `widen-enums.test.ts` (l.201) adds a second
  case proving a request body that reaches a shared component schema **only transitively** (via a
  nested property `$ref`) still makes the guard throw — so the recursive behavior is itself gated.

Fresh axis pass on the r12-revised plan (also cross-checking the two engineer fixes landed in the same
edit — `enumFieldPaths` homed in `schema-leniency.ts`, and the `*_ENUM_FIELDS` → `*_WIDENED_FIELDS`
rename — for any architectural fallout):

- **(a) Boundaries / dependency direction:** the r12 edit **strengthens** the boundary rather than
  eroding it: `enumFieldPaths` is now an exported helper of `src/validation/schema-leniency.ts` built on
  that module's existing `addCatchallRecursive`/`detectUnknownProperties` walk (Phase 4 Step 1, l.306),
  and the Phase 9 completeness guard imports it (l.609) — so **all** `_zod.def` introspection stays in
  the one isolated module and the guard cannot desync from the walker that widens enums at runtime. The
  transitive guard reads the transient `spec/openapi.patched.json` (written in Phase 2) or, in test,
  operates on inline spec fragments (l.201) — no dependency on a git-ignored artifact from test code.
  No new boundary issue.
- **(b) Data model & schema:** the f14/f15/f16 graft remains sound at every depth; the constant rename
  to `*_WIDENED_FIELDS` aligns the name with its "containing top-level property whose subtree holds an
  open enum" semantics without changing the type algebra. No new data-model issue.
- **(c) Public API surface:** `enumFieldPaths` broadens the *internal* `schema-leniency.ts` surface only;
  it is not added to the curated `public-types.ts`/barrel, so no public-API leak. No new issue.
- **(d) Migration / phase sequencing:** `enumFieldPaths` is defined in Phase 4 Step 1 and consumed in
  Phase 9 (Phase 4 → Phase 9); the transitive guard reads the patched spec written earlier in Phase 2.
  Ordering holds. No new issue.
- **(e) Performance & hot paths:** the transitive guard and the completeness guard are generate-time /
  test-time only (bounded by the spec's component/operation count), not runtime hot paths. No new issue.

No new architectural findings this round; the plan has converged on the axes I own.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r7-f1 | Low | Closed | Boundaries | Phase 2 Step 4 (l.159 guard), Notes (l.161), test (l.201) | — | ratified: the widen-guard now **resolves `$ref`s recursively** (through `properties`/`items`/`allOf`/`oneOf`/`anyOf`/`additionalProperties`, visited-set for cycles), collects the **full transitive** `#/components/schemas/*` set reachable from every request body and every response, and throws if they intersect — verifying the load-bearing assumption at every depth, not just the top-level `requestBody` ref. `widen-enums.test.ts` (l.201) adds a case proving a **transitively/nested** shared ref also throws. Gap closed. |
