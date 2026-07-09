## architect — round 7

Plan Review Mode, round 7 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8), `architect-r2` (f9–f12), `architect-r3-f13`, `architect-r4-f14`,
and `architect-r5-f15` all ratified `Closed` through r6. The one outstanding item, `architect-r6-f16`
(the top-level `Omit`/`Pick` graft could not widen `Device`'s **nested** enums
`antivirus.antivirusStatus`/`patchManagement.patchStatus`, and the completeness guard either missed the
hazard or deadlocked), was dispositioned **Accept** by `reviser-r11`. I re-verified the fix against the
current plan text and ratify it → `Closed`:

- Phase 6 Step 3 (l.436) redefines the constant to list the **containing top-level property** whose
  subtree holds an open enum anywhere: `DEVICE_ENUM_FIELDS = ['deviceClass', 'antivirus', 'patchManagement'] as const`.
  Because `Pick<GeneratedDevice, 'antivirus'>` re-adds the **whole** already-widened `antivirus`
  sub-object, the nested `antivirusStatus`/`patchStatus` enums widen with the top-level `deviceClass`
  — no nested-field `Pick` key needed, so the graft neither misses nor deadlocks. The soundness
  constraint (reconciled `udf`/`alertContext` carry no enums and don't overlap a grafted subtree) is
  recorded, and l.161 now reads "at every nesting depth."
- Phase 9 Step 3 (l.608–609, example l.617–632) drives the truly-novel-value compile assertion over
  top-level **and** nested fields (`Device['antivirus']['antivirusStatus']`, etc.) and replaces the
  completeness guard with a **recursive** one binding every enum field's containing top-level property
  to `ENUM_FIELDS`. The "same field set at every depth" property is now a verified gate.

Fresh axis pass on the revised plan:

- **(a) Boundaries/dependency direction:** `src/defaults.ts` layering, the auth-transport isolation
  (f3), the curated `public-types.ts` boundary (f1/f2), and the `WriteOpKey`/limiter boundary (f6) all
  hold. **One new issue** on the codegen boundary: the Phase 2 widen guard that verifies the
  request/response schema-sharing assumption is shallow (checks only top-level requestBody `$ref`s),
  so it does not verify the assumption it claims to (f1, new).
- **(b) Data model & schema:** the f14/f15/f16 graft is now sound at every depth for override-touched
  entities; the closed-enum `z.infer` value remains assignable to the widened annotated type (valid
  upcast). No new data-model issue.
- **(c) Public API surface:** curated `public-types.ts` + `surface.test.ts` + coverage-map gate
  unaffected. No new issue.
- **(d) Migration/phase sequencing:** `GeneratedDevice` (Phase 2, codemod-widened at every depth)
  exists before Phase 6 consumes its widened `antivirus`/`patchManagement` subtrees; sequencing holds.
  No new issue.
- **(e) Performance & hot paths:** strip/widen and per-call drop aggregation remain bounded; eager
  `paginate` buffering acknowledged (streaming deferred). No new issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r6-f16 | Medium | Closed | DataModel | Phase 6 Step 3 (l.436), Phase 9 Step 3 (l.608–609, example l.617–632), l.161 | — | ratified: `DEVICE_ENUM_FIELDS` now lists the **containing top-level** field (`['deviceClass','antivirus','patchManagement']`) so `Pick<GeneratedDevice, 'antivirus'>` grafts the whole widened subtree and the nested `antivirusStatus`/`patchStatus` enums widen with it; the recursive Phase 9 guard binds every enum field (top-level and nested) to `ENUM_FIELDS` and the novel-value assertion runs over all of them. Graft neither misses nor deadlocks; the "same field set at every depth" claim is a verified gate. |
| architect-r7-f1 | Low | Open | Boundaries | Phase 2 Step 4 (l.159 "Verify the load-bearing assumption" guard) + widen scope (l.158); interacts with the Phase 6 graft `Pick<GeneratedDevice, …>` (l.436) | The enum-widening codemod widens **every** exported model type in `src/generated/types/**` whose name lacks a request-side suffix — including **nested** component-schema types (e.g. a `DeviceAntivirus`/`*Status` object type referenced by `Device`), which is exactly what makes the f16 nested-subtree graft work. The guard added to protect the request side (l.159) walks each operation's `requestBody.content['application/json'].schema` and throws only if that **top-level** requestBody `$ref`s a `#/components/schemas/*` name that also appears as a response schema `$ref`. This check is **shallow**: it inspects only the top-level request-body ref, not the schema's **transitive/nested** `$ref`s. If a write body's shape (`*Body`, which the suffix rule correctly leaves closed) references a **nested** component schema (`{ status: { $ref: '#/components/schemas/SomeEnumHolder' } }`) that is *also* reached from a response, the codemod widens `SomeEnumHolder` (it has no request suffix), and the request body's TS type — which references `SomeEnumHolder` — inherits the widened `EnumUnion | (string & {})` on that field. The guard passes (the top-level `*Body` ref is not itself a response schema), so the "load-bearing assumption … no request body `$ref`s a component schema also used as a response" is only *partially* verified: it is verified for direct refs, not nested ones. Consequence: for such a shared nested enum, the compile-time **request** contract is silently over-widened — a caller can pass a novel string that type-checks but is then rejected at runtime by the strict `validateRequest`/write-body override (Phase 6). No data-integrity or response-side impact (strict zod still enforces the write; response widening is intended), and it only bites if Datto's small write set actually shares a nested component schema with a response — plausibly none, hence **Low**. But the plan bills this guard as proving the assumption "do not just trust it," and as written it does not cover the transitive case the assumption actually spans. | Make the guard **recurse**: walk each request body's full schema graph (resolving nested `$ref`s) and collect every `#/components/schemas/*` name it transitively reaches, then throw if any of those names is also reachable from any response schema. That closes the gap the top-level check leaves and makes the guard verify the assumption it claims. Alternatively, tighten the codemod so it widens a component type only when that type is not transitively reachable from any request body (deriving the request-reachable set once), and keep the recursive assertion as the guard. At minimum, state explicitly in Phase 2 Step 4 that the guard covers only **top-level** request-body refs and that shared **nested** component schemas are an unverified assumption (so the residual risk is documented rather than implied-covered). |
