## typescript-cop — round 1

Scope: `git diff 71f93e8` (Phase 7's commit) against the working tree, restricted to Phase 8's own
files — the five new resources (`audit-resource.ts`, `filter-resource.ts`, `filter-schema.ts`,
`user-resource.ts`, `activity-log-resource.ts`, `system-resource.ts`), `datto-rmm-client.ts`'s
finalization, the new `operation-map.ts`/`public-types.ts`/rewritten `index.ts`, the old-surface
deletion, and the associated new/changed tests (`coverage-map.test.ts`, `surface.test.ts`,
`surface-pin.ts`, extended `schema-mirror-pin.ts`, the five new resource test files).

No prior `typescript-cop` turn exists for this phase, so there is nothing to carry forward.

Checked every new resource method's hand-written or generated request/response schema against its
declared TS return type field-for-field (not just trusting the compile-time pins): `AuditResource`'s
four schemas against `PrinterAudit`/`ESXiHostAudit`/`DeviceAudit`/`Software`, `FilterResource`'s
extracted `filterSchema` against `Filter` (including its enum member set), `UserResource`'s
`authUserSchema`/`resetApiKeysResponse` against `AuthUser`/`AuthUserKey`, `ActivityLogResource`'s
`activityLogSchema` against `ActivityLog` (including its nested `SiteBasicDto`/`UserDto` shapes and
`entity` enum), and `SystemResource`'s three generated schemas against `StatusResponse`/
`RateStatusResponse`/`PaginationConfiguration` — every one matches. `narrow<T>` is applied
consistently with the established Phase 6/7 idiom (post-validation compile-time re-assertion, not a
runtime-unchecked boundary cast) at every one of the 13 new resource-method return sites, with no
new `as`/`any`/non-null-assertion introduced anywhere in the five new resource files, `operation-
map.ts`, `public-types.ts`, or `index.ts`.

Cross-checked `public-types.ts`'s curated re-export list against every one of the ten `*Resource`
classes' actual public method signatures (not just the five new ones) — every parameter/return type
any method names resolves in the list, and the two deliberately-excluded raw generated names
(`VariableCreationRequest`, `GetDeviceAuditByMacAddressParams`) are correctly absent, matching
`surface-pin.ts`'s `@ts-expect-error` pins.

`ActivityLogResource`'s `activityLogSchema` joins `filterSchema` on the key-set-only
`schema-mirror-pin.ts` comparison rather than full structural `Equal`; this is the identical,
already-adjudicated pattern `typescript-cop-r1-f2` established and closed for `Filter` in Phase 7
(scoped to the one enum field's open/closed asymmetry), applied here to `ActivityLog`'s own single
enum field (`entity`) — not a new gap.

`coverage-map.test.ts`'s generic reflective driver (`client[ns][method](...)` via a documented
`unknown`-typed cast) is test-only, confined to one file, and extensively justified against the
uniform method-argument convention it relies on — consistent with the skill's tolerance for
documented, scoped, test-only reflection over production type holes.

No floating promises, no missing exhaustiveness cases (no new discriminated-union `switch`
statements), and no boundary input treated as strongly-typed without validation were found in this
phase's changes — every new resource method routes through `BaseResource`'s existing validated
`http*`/`paginate` primitives, unchanged in this phase beyond a doc-comment reword.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
