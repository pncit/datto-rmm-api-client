## engineer — round 7

Plan Review Mode, round 7 (in-progress review). Read my `engineer-r1`…`engineer-r6` turns and the
only disposition landed since round 6 — `reviser-r11`, which `Accept`ed `architect-r6-f16` and
reworked the Phase 6 Step 3 reconciled-type graft plus the Phase 9 completeness guard to handle the
**nested** `Device` enums (`antivirus.antivirusStatus`, `patchManagement.patchStatus`). Re-verified
that edit against the current `plan.md` and re-swept the five engineer axes (DRY/reuse,
abstraction/complexity, error handling & logging, naming/intent, configuration & magic values) for
anything the round-11 edit introduced or exposed. Architecture/data-model and requirements-coverage
concerns remain deferred to `/architect` and `/project-lead`.

**Ratification of prior findings (all remain `Closed`).** `engineer-r1-f1…f16`, `engineer-r2-f1…f5`,
`engineer-r3-f1…f2`, and `engineer-r5-f1` were each `Accept`ed/ratified in prior rounds and verified
present; none regressed on re-read. Carried forward by ID, not re-listed (per carry-forward
discipline, earlier-Closed findings are not re-tabled).

**Cross-check of the `architect-r6-f16` fix (`reviser-r11`).** The graft now takes the whole
enum-bearing *containing top-level subtree* from the widened generated type via
`DEVICE_ENUM_FIELDS = ['deviceClass', 'antivirus', 'patchManagement'] as const` and
`Pick<GeneratedDevice, typeof DEVICE_ENUM_FIELDS[number]>`, and Phase 9 replaces the top-level-only
completeness guard with a **recursive** one (`enumFieldPaths` / `topLevelOf`, example l.628–632). The
mechanism is sound and closes the nested-enum-typed-closed hazard. Re-sweeping the axes exposed two
issues the widened constant/guard now surface, raised below.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r7-f1 | Medium | Open | DRY | Phase 9 Step 3 recursive completeness guard (l.609) and example `enumFieldPaths(entity)` (l.629); vs the `_zod.def`-isolation invariant (Phase 4 Step 1, l.306) | The r11 guard must **recursively enumerate every enum-typed field at every depth** of each override-touched entity to assert its containing top-level property is in `ENUM_FIELDS`. TS types are not enumerable at runtime, so `enumFieldPaths` can only get this by structurally introspecting the (override/generated) **zod** schema for `enum` nodes at arbitrary depth — i.e. the same `_zod.def` access the plan deliberately confines to `schema-leniency.ts` ("keeps all `_zod.def` access isolated here, per the risk-mitigation in the design"). As written, Phase 9 introduces a **second, parallel `_zod.def` introspection site** in test code, defeating the single-isolation-boundary mitigation that exists so a Zod major-version bump only breaks one file. The plan never says where `enumFieldPaths` lives or that it must reuse the walker. | State that `enumFieldPaths` (the recursive enum-node enumerator) is an **exported helper of `src/validation/schema-leniency.ts`** built on the existing `addCatchallRecursive`/`detectUnknownProperties` walk (which already visits every `enum` node at every depth), and that the Phase 9 guard imports it — so all zod-internal access stays in the one isolated module and the guard cannot desync from the walker that actually widens enums at runtime. |
| engineer-r7-f2 | Low | Open | Naming | Phase 6 Step 3 (l.436), `DEVICE_ENUM_FIELDS`/`ALERT_ENUM_FIELDS`/`ENUM_FIELDS`; consumed at Phase 9 l.609, example l.628 | After r11 the constant no longer lists enum fields — it lists the **top-level properties whose subtree contains an open enum somewhere** (`antivirus` and `patchManagement` are sub-objects, not enums). The name `…_ENUM_FIELDS` now contradicts its contents. An implementor working from the constant name (not the dense l.436 paragraph) is invited to populate it with literal enum-typed fields — either the nested names `antivirusStatus`/`patchStatus` (which are not top-level `Pick` keys and won't compile) or just `['deviceClass']` (omitting the containing fields), reviving the exact nested-enum-typed-closed bug r11 just fixed. The misleading name is load-bearing because the `Omit`/`Pick` graft and the recursive guard both key off it. | Rename to convey "top-level fields grafted widened," e.g. `DEVICE_WIDENED_FIELDS` / `DEVICE_OPEN_ENUM_SUBTREES` (map `WIDENED_FIELDS`), and state in one line that each entry is the **containing top-level property** of any open enum (including nested), not the enum field itself — so the name matches the recursive guard's semantics and can't mislead the implementor into re-closing nested enums. |
