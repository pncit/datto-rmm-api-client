## engineer — round 1

Code-review of the Phase 7 diff (`git diff main`): the five `*Resource` classes
(`account`/`site`/`device`/`alert`/`job`), the three shared helpers (`narrow.ts`,
`void-response.ts`, `variable-schema.ts`), the `DattoRmmClient` scaffold, the doc-only
`datto-client-config.ts` change, the `schema-leniency.ts` `objectCatchall` fix, and the six new
test files. No prior `engineer` turn exists in this review dir, so this is a fresh round-1 (the
`implementation-auditor` thread's four findings are its own and already Closed there — not carried
here).

I verified, against `spec/openapi.json` and the generated tree: every hand-written path/verb; every
`paginate` `arrayKey` (`devices`/`variables`/`alerts`/`components`/`dnetSiteMappings`/`filters`/
`jobComponents` all correct); every `WriteOpKey`; the six hand-mirrored item schemas'
value types (`componentSchema`, `dnetSiteMappingSchema`, `deviceNetworkInterfaceSchema`,
`filterSchema` incl. `z.iso.datetime()` matching the generated schema, `jobComponentSchema`,
`variableSchema` — all faithful today); `updateProxyResponse` genuinely being the `SiteSettings`
shape; the `httpPut`/`httpPost` bodiless-vs-bodied overload arities at every call site; and the
`schema-leniency.ts` `objectCatchall` `never`-exclusion. Those are all sound. The findings below are
the residual issues.

### Analysis notes (not findings)
- Construction order in `DattoRmmClient` (logger → rate limiter → auth → axios → `attachTo`) matches
  the layer docs; the single shared axios instance and single masked logger are threaded to all five
  resources correctly.
- `voidResponseSchema = z.unknown()` and the `z.void()` correction are justified and correct.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | Logging | `tests/unit/client/resources/device-resource.test.ts:174-193` (`setUdf()`'s "R20 end-to-end" masking test) | This test is presented (phase notes §7/§8) as the proof that UDF masking holds end-to-end through the real `withUdfMasking → BaseResource → parseLenient` path, but it cannot fail. `setUdf`'s response is validated against `voidResponseSchema` (`z.unknown()`), whose `cleanAndDiagnoseResponse` `default` case strips nothing and emits no leniency diagnostic — so the `{ udf: {...}, extra: "stripped" }` reply produces **no** log call carrying the raw value, and `BaseResource` never logs the request body either. The assertion loops over sink calls that never contain `S3CR3T-VALUE` regardless of whether masking runs, so it would still pass with `withUdfMasking` removed. It does not exercise the masking boundary it claims to. | Drive the raw UDF value through a path that actually logs it, then assert the sink saw a masked form: e.g. validate a response against a UDF-bearing schema that strips/degrades (so a `debug`/`warn` diagnostic carries `meta`), or use a dropped-array-item flow whose `meta` includes the UDF, or assert the `withUdfMasking` decorator was invoked with the value. |
| engineer-r1-f2 | Low | Open | DRY | `tests/unit/client/resources/{account,site,device,alert,job}-resource.test.ts` (each top ~30 lines) | `BASE_URL`, `createMockLogger()`, `createTrackedAxios()` (the `rateDescriptor`-capturing request interceptor), and `makeResource()` are copy-pasted verbatim across all five new resource test files (and re-declared again in the Phase-6 `base-resource.test.ts`/`paginate.test.ts`). Any change to how a resource is constructed or how descriptors are captured must be edited in five+ places; they can silently drift. | Extract the shared harness into one `tests/unit/client/resources/test-harness.ts` (exporting `BASE_URL`, `createMockLogger`, `createTrackedAxios`, and a generic `makeResource(Ctor, logger?)`) and import it from each resource test. |
| engineer-r1-f3 | Low | Open | Documentation | `tests/unit/client/datto-rmm-client.test.ts:70-89` (end-to-end integration test) | The test title claims the call "honors the read rate limit through the real transport stack," but the body asserts only the auth-token fetch and `Authorization: Bearer` header — nothing about rate limiting is observed or asserted. The name overstates what the test proves. | Either add an assertion that the read went through the rate limiter (e.g. capture the `RateDescriptor`/limiter interaction), or drop the rate-limit clause from the test name so it describes what it actually verifies. |
| engineer-r1-f4 | Low | Open | Complexity | `tests/generated/schema-mirror-pin.ts` (guarding `componentSchema`/`dnetSiteMappingSchema`/`deviceNetworkInterfaceSchema`/`filterSchema`/`jobComponentSchema`/`variableSchema`) | The drift guard added for the six hand-mirrored item schemas compares only top-level `keyof` (key-set equality). It therefore does **not** catch a generated **value-type** change (e.g. `Component.id` number→string) or any **nested-shape** drift (e.g. `componentSchema.variables[].direction`, `deviceNetworkInterfaceSchema.nics[]`) — precisely the fields a regeneration could alter while `parseLenient` silently mis-coerces or drops them, leaving the declared return type lying. The "single source of truth" protection the pin advertises is only partial. (Values are all correct today — this is the missing coverage, not a current mismatch.) | Derive each item schema from the generated envelope's own array element (one source, no mirror to drift) — e.g. reuse the inline element already present in `getComponentsResponse`/`getDnetSiteMappingsResponse`/`getJobComponentsResponse`/`getSiteDevicesWithNetworkInterfaceResponse`/`getSiteDeviceFiltersResponse`/`getSiteVariablesResponse` — or extend the pin to a deep structural comparison that excludes only the documented `Filter["type"]` open/closed-enum asymmetry. |
