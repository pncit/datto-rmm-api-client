## typescript-cop — round 2

Scope: `git diff 9b53c42` (the Phase 6 baseline, matching round 1's scoping) re-read in full against
the current working tree, with particular attention to everything the reviser's round-2 turn
(`reviser-r2.md`) touched on top of my round-1 turn's baseline — `git diff f16d9fb` isolates that
delta precisely: doc-only rewording in `base-resource.ts`/`narrow.ts` (`architect-r1-f1`), `@internal`
doc additions to the five hand-mirrored item schemas in `account-resource.ts`/`job-resource.ts`/
`site-resource.ts` (`architect-r1-f2`), the `objectCatchall` fix in `schema-leniency.ts` and the
full-`Equal` upgrade to five of six `schema-mirror-pin.ts` pins (my own `typescript-cop-r1-f1`/`f2`),
and the test-only changes (`test-harness.ts` extraction, the rewritten `device-resource.test.ts` R20
test, and the new rate-limit end-to-end test in `datto-rmm-client.test.ts`). Confirmed clean via
`npm run typecheck` (0 errors) — static analysis only, no test execution.

**Both round-1 findings verified fixed, not just claimed:**

- **`typescript-cop-r1-f1`** — `objectCatchall` (`schema-leniency.ts:96-99`) now reads
  `getDef(schema).catchall as z.ZodType | undefined` instead of casting `(schema as any)._zod.def
  .catchall` directly. The single typed `_zod.def` accessor the module's own header doc requires is
  restored, with no behavior change (verified `getDef` returns the identical `_zod.def` object).
  **→ Closed (ratified).**
- **`typescript-cop-r1-f2`** — `schema-mirror-pin.ts` now uses full `Equal<T, z.infer<typeof schema>>`
  for the five enum-free mirrors (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`,
  `JobComponent`, `Variable`), independently re-verified against every nested type each one pulls in
  (`ComponentVariable`, `NetworkInterface`, `DevicesType`, `JobComponentVariable`) — none carries an
  enum field, so full equality is sound for all five today. `Filter`/`filterSchema` alone correctly
  stays on the weaker key-set-only comparison, scoped in both the file doc and an inline comment to
  the one documented `Filter["type"]` open/closed-enum asymmetry that full equality would otherwise
  spuriously fail on. **→ Closed (ratified).**

No new issues introduced by the round-2 revisions. The `base-resource.ts`/`narrow.ts` changes are
prose-only (clarifying `coerceSchema` vs. `narrow`'s respective jobs per `architect-r1-f1`, already
independently confirmed accurate in my round-1 turn) with zero code/type changes. The five `@internal`
doc additions (`architect-r1-f2`) add no runtime or type surface. The `test-harness.ts` extraction is
a mechanical, type-preserving refactor (`makeResource<R extends BaseResource>(Ctor: new (axios:
AxiosInstance, logger: DattoLogger) => R, ...)` is correctly generic and constrained — no widening
versus the five hand-copied versions it replaces). The rewritten `device-resource.test.ts` R20 test and
the new `datto-rmm-client.test.ts` rate-limit test are sound: no floating promises (`vi.
advanceTimersByTimeAsync` and the `second` promise are both correctly awaited/chained), `finally { vi.
useRealTimers() }` correctly guards fake-timer cleanup against an assertion throw mid-test, and the
`as unknown as Parameters<...>[1]` casts remain confined to deliberate negative-validation test cases.

No other findings surfaced on this full re-read: every resource method's `narrow<T>` application,
`httpPost`/`httpPut`/`httpPatch` overload dispatch, `paginate`'s params typing, async correctness, and
public export hygiene remain as verified in round 1 — nothing in this round's diff touched any of that
surface's logic.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | `src/validation/schema-leniency.ts:96-99` (`objectCatchall`) | Ratified: now routes through `getDef()` instead of a direct `(schema as any)._zod.def.catchall` cast, restoring the module's single typed internal-access chokepoint. | — |
| typescript-cop-r1-f2 | Low | Closed | Exhaustiveness | `tests/generated/schema-mirror-pin.ts` | Ratified: five of six mirrors now use full `Equal<T, z.infer<typeof schema>>` (verified sound — none of the five carries an enum field, including nested types); `Filter`/`filterSchema` correctly stays key-set-only, scoped to its one documented enum-widening asymmetry. | — |

No new findings this round.
