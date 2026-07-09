## typescript-cop — round 1

Scope: Phase 7's diff against the Phase 6 baseline (`git diff 9b53c42`, plus the untracked
`tests/generated/schema-mirror-pin.ts`) — the five new `*Resource` classes (`account`/`site`/
`device`/`alert`/`job`), the three shared helpers (`narrow.ts`, `void-response.ts`,
`variable-schema.ts`), the `DattoRmmClient` scaffold, the doc-only `datto-client-config.ts` change,
the `schema-leniency.ts` `objectCatchall` bug fix, the `rate-limits.ts`/`write-bodies.ts`/
`schema-overrides/index.ts` `site-update` additions, and every new/changed test file — read as they
stand now (post the reviser's round-1 fixes to `implementation-auditor-r1`'s four findings, all
ratified `Closed` by `implementation-auditor-r2`). Also re-verified the `Lenient<T>`→`T` narrowing
pattern (`narrow<T>`) against Phase 6's own `typescript-cop` history (`review-phase6/
typescript-cop-r1..r3.md`): that pattern — a resource method re-asserting `Lenient<T>` to its own
declared `T` at the return site — was explicitly designed, reviewed, and ratified in Phase 6 as the
intended idiom (`coerceSchema`'s sibling), so `narrow<T>`'s use across every resource method here is
not re-litigated. Confirmed clean via `npm run typecheck` and `npm run lint` (0 errors, the same 11
pre-existing warnings, all in the untouched old surface) — static analysis only, no test execution.

Two real issues found, both narrow and fixable; everything else — the five resource classes' schema/
type bindings, the `httpPost`/`httpPut` overload dispatch, `paginate`'s params typing (the generated
`Get*Params` are `type` aliases, which — unlike an `interface` — TypeScript treats as structurally
assignable to `Record<string, unknown>`, confirmed directly), async correctness (no floating
promises, no needless `async`), and the `SiteResource.update()`/`site-update` addition — is sound.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Open | TypeHole | `src/validation/schema-leniency.ts:96-99` (`objectCatchall`) | This Phase 7 addition reads `(schema as any)._zod.def.catchall` directly, bypassing the module's own `getDef()` accessor — the single, typed (`ZodInternalDef = { readonly type: string } & Record<string, unknown>`) chokepoint this exact file's header doc designates for all `_zod.def` access ("All Zod v4 internal access is isolated here") and that Phase 4's `typescript-cop-r1-f3` (`review-phase4/typescript-cop-r1.md`, Closed) specifically replaced a bare `any` return with, precisely so a future zod-internal rename surfaces through a typed `unknown` path instead of compiling silently. `objectShape`'s parallel `(schema as any).shape` cast is *not* a counter-precedent — its own doc comment explains `.shape` lives outside `_zod.def` entirely ("Zod v4 exposes this as `.shape`, not through `_zod.def`"), so it has no typed accessor to route through. `objectCatchall` has no such excuse: its own doc says the opposite — "Zod v4 gives every object node a `_zod.def.catchall`" — i.e. `.catchall` genuinely lives inside `_zod.def`, the exact territory `getDef()` exists to guard. A future zod bump that renames/restructures `_zod.def.catchall` now has two independent untyped call sites to silently break instead of one typed one, undoing the isolation guarantee this module's own doc asserts. | Replace the direct cast with `getDef(schema).catchall as z.ZodType \| undefined`, matching the existing `def.type`/other-slot access pattern (`nodeChildren`, etc.) elsewhere in this file — restores the single-accessor guarantee with no behavior change. |
| typescript-cop-r1-f2 | Low | Open | Exhaustiveness | `tests/generated/schema-mirror-pin.ts:56-80` | All six hand-mirrored item-schema pins (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `Filter`, `JobComponent`, `Variable`) use key-set-only equality (`Equal<keyof T, keyof z.infer<typeof schema>>`), with the file's own doc justifying this specifically for `Filter`/`filterSchema`'s enum-widening asymmetry (`Filter["type"]` is codemod-widened to `FilterType \| (string & {})` while `filterSchema`'s `z.enum([...])` stays closed). That justification applies to exactly one of the six mirrors. The other five (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `JobComponent`, `Variable`) contain no enum field at all (verified against their generated types) — a full deep `Equal<T, z.infer<typeof schema>>` pin would compile clean for all five today and would additionally catch a same-name-different-type field drift (e.g. a spec regeneration turning `Component.id` from `number` to `string`, or `DnetSiteMappingsDto.dattoNetworkingNetworkIds` from `number[]` to `string[]`) that key-set equality cannot detect, since it only compares field *names*. Weakening all six pins to the level only one of them requires leaves the other five with a strictly weaker guard than the codebase's own established idiom (`lenient-type-pin.ts`'s full-shape `Equal` checks) already proves is achievable. | Use a full `Equal<T, z.infer<typeof schema>>` pin for the five entities with no enum field (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `JobComponent`, `Variable`), and keep the key-set-only comparison (or a per-field `Omit`-the-enum-field variant) for `Filter`/`filterSchema` alone, so five of the six mirrors also catch a field's own type changing, not just a field being added or removed. |

No other findings: `narrow<T>` is applied consistently and correctly at every resource method's
return site (the Phase 6-ratified idiom, not re-opened here); every `httpPost`/`httpPut`/`httpDelete`
call is correctly awaited or returned (no floating promises); no new `any`/non-null assertions in any
resource file; the `objectCatchall` fix's *logic* is sound (verified `z.strictObject()`'s catchall is
a `ZodNever` at the zod v4 runtime level, so the `never`-exclusion correctly keeps every generated
write-body schema unaffected) — only its internal-access hygiene (f1) is at issue; `WriteOpKey`
typing (`site-update` addition) is closed and correctly consumed with no dead entry; every generated
`Get*Params`/body type flows through unmodified rather than an inline literal (round-1 auditor
findings, independently re-verified here); test-file casts (`as unknown as X`) are all confined to
deliberate negative-validation cases, never production code.
