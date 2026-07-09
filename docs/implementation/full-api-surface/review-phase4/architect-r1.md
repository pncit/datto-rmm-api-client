## architect — round 1

Scope: Phase 4 additions only — `src/validation/schema-leniency.ts`, `src/validation/diagnostics.ts`
and their unit tests — read directly against `design.md` (R5/R7/R20), `plan.md` Phase 4, and the
generated response schemas under `src/generated/schemas/**`. Prior turns in this review dir are from
the implementation-auditor and reviser; their four round-1 findings are dispositioned `Fixed` and
ratified `Closed` by implementation-auditor-r2. I re-verified those closures against the code and do
not reopen them. What follows are new, architect-axis findings.

### Axes walked (no finding)
- **Boundaries / ownership.** All Zod-v4 `_zod.def` introspection stays isolated to
  `schema-leniency.ts`; `enumFieldPaths` reuses the one walk rather than opening a second site.
  `DiagnosticsCollector` is a clean, single-responsibility primitive in its own file. No cross-layer
  import, no boundary violation.
- **Data model / type contract.** The open-enum split is sound: generated runtime zod schemas are
  closed (`zod.enum([...])`) and widened at parse time, while the generated *types* are already open
  (`DeviceDeviceClass = ... | (string & {})`), so `parseLenient`'s `cleaned as T` return does not lie
  about out-of-set enum values. Verified against `deviceDeviceClass.ts` + the device zod schema.
- **Public API / breaking.** Module is standalone and unconsumed until Phase 6; nothing published yet.
- **Security (R20).** Both diagnostic messages are static text; every wire-derived value rides in
  `meta`. Correct.
- **Intersection/union blind spots.** `addCatchallRecursive`'s `default:` branch returns unknown node
  types unchanged (no leniency applied inside them). I checked whether Datto schemas can hit it:
  `grep` finds zero `intersection` / `.and(` / `z.union` / `discriminatedUnion` / `lazy` in
  `src/generated/schemas/**`, so this is inert today. The union invariant is already documented
  (auditor f4). No finding.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|--------------------------|
| architect-r1-f1 | Medium | Open | Correctness / Diagnostics | `src/validation/schema-leniency.ts:302-318` (`array` case sets `collectionSize = parsed.length`, threaded down), `src/validation/diagnostics.ts:67-76` (`record` folds with `Math.max`) | The `collectionSize`/`total` fix from auditor-f1 is correct only for a diagnostic whose *nearest enclosing array is also the top-level collection being iterated* (e.g. `devices[i].deviceClass`). For any field nested **below a second array**, `total` is set to the innermost array's length and then aggregated across the outer collection with `Math.max`, which reintroduces the exact "meaningless denominator / `count` can exceed `total`" defect f1 claimed to close — one level deeper. This is **live**, not latent: `getDeviceResolvedAlertsResponse` = `{ pageDetails, alerts: [ { priority: enum, responseActions: [ { actionType: enum } ] } ] }`. A widened `responseActions.actionType` across a page of alerts records at path `alerts.responseActions.actionType` (index dropped) with `collectionSize` = *that one alert's* `responseActions.length`. Aggregated across the whole page, `count` = total widened actionTypes over all alerts, but `total` = `Math.max` of any single alert's `responseActions` length — so 100 alerts each with one widened action yields `{ count: 100, total: 1 }`. `actionType` is precisely an open-enum degradation target (R5), so the design's own primary use case emits a nonsensical ratio here. No test exercises a doubly-nested array; every aggregation test tops out at one array level. | Make `total` the count of items actually examined for that field-group, accumulated across every enclosing-array iteration that feeds the group — i.e. when the walk enters an array, *add* its length into the denominator for diagnostics recorded beneath it (per group), rather than overwriting with the nearest array's length and `Math.max`-ing at record time. (Equivalently: track a per-group examined-count and increment it once per element visited at the field's structural position.) Then add a doubly-nested-array test — e.g. widened `actionType` across many alerts' `responseActions` — asserting `count <= total` and a `total` equal to the number of `responseActions` objects examined across the page. |
| architect-r1-f2 | Low | Open | Documentation correctness | `src/validation/diagnostics.ts:63-65` (`record` JSDoc) | The JSDoc asserts "every occurrence within one `parseLenient` call is expected to report the same collection size, so this [`Math.max`] is defensive rather than load-bearing." Per f1 that statement is false: for a field beneath a nested array, occurrences legitimately report *different* collection sizes within a single call (each alert's `responseActions.length`), so `Math.max` is load-bearing and, as written, produces a wrong denominator. A future maintainer (Phase 6, when wiring `validateResponse`/`validateArrayResponse`) will trust this comment and reason incorrectly about `total`. | Correct the comment to state that occurrences at a nested position *can* report differing collection sizes and describe the actual denominator semantics chosen when f1 is resolved (do not leave "defensive, same size expected"); keep the code comment and the `parseLenient`/`detectUnknownProperties` docs at `:240-247` consistent with the fixed behavior. |

No other architectural issues: the port is faithful, `_zod.def` isolation holds, the type/runtime
enum split is sound, and scope is clean (only `src/validation/**` and its tests added).
