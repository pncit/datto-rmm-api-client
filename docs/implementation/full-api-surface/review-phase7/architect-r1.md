## architect — round 1

Scope: reviewed the Phase 7 working tree (`git diff main`) — the five `*Resource` classes
(`account`/`site`/`device`/`alert`/`job`), the three shared helpers (`narrow.ts`, `void-response.ts`,
`variable-schema.ts`), the `DattoRmmClient` scaffold (`datto-rmm-client.ts`), the doc-only
`datto-client-config.ts` change, and the `schema-leniency.ts` catchall fix — against the design's
public-surface section (Decision 5, "Public surface"), plan Phase 7, and `BaseResource` (Phase 6).
Read the prior `implementation-auditor` r1/r2 and `reviser-r1` turns: auditor findings f1–f4 were
all dispositioned `Fixed` and re-ratified `Closed`; I am not re-raising them. I independently verified
against `spec/openapi.json` that **every** hand-written path, verb, pagination `arrayKey`
(`devices`/`variables`/`components`/`dnetSiteMappings`/`sites`/`filters`/`alerts`/`jobComponents`),
and write `opKey` is correct, and that the namespace-grouping asymmetry (scoped device lists on their
scope resource, all alert lists rehomed to `alerts`) is faithful to the design's own two worked
examples (`client.account.devices()` and `client.alerts.openForSite(siteUid)`), not an implementor
extrapolation. Those axes are clean. The two findings below are structural.

Axes covered: architecture & boundaries (ownership, layering, abstractions/coupling); data
model/schema; public API & breaking changes; performance/hot paths; security/data handling. No axis
left unfinished.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|--------------------------|
| architect-r1-f1 | Medium | Open | Abstractions & Coupling | `src/client/resources/base-resource.ts:11-28` (`coerceSchema` + its doc), `src/client/resources/narrow.ts`, every resource method | Phase 7 introduces `narrow<T>(value: unknown): T` as the mechanism every resource method uses to turn a primitive's `Lenient<T>` result into its clean declared return type — but `BaseResource`'s own prescriptive doc (`coerceSchema`, lines 11-28) names a *different* mechanism for that exact job ("A resource method … declaring `Promise<Device>` passes `coerceSchema<Device>(deviceResponseSchema)` to `httpGet`/… so the primitive's generic response type matches the method's own declared return type"). No resource in this phase uses `coerceSchema` (verified: its only references are its own unit test and prose in `types.ts`); all use `narrow`. Worse, the doc is now *misleading*, not merely superseded: `validateResponse`/`httpGet`/`paginate` **always** return `Lenient<T>` regardless of the schema's own generic, so `coerceSchema<Device>(schema)` would yield `Lenient<Device>` — it *cannot* deliver the clean `Device` return the doc claims, which is precisely why `narrow` exists. The result is two competing, doc-sanctioned casting idioms for one responsibility and a prescriptive comment in the base class that describes a workflow the codebase abandoned — a maintainability seam the Phase 8 implementor will trip on (which pattern do I follow?). | Pick one idiom and make the base class self-consistent. Since `coerceSchema` can't produce the un-wrapped return type the resource layer needs, either (a) delete `coerceSchema` and its test and rewrite `BaseResource`'s lines 11-28 to name `narrow` (in `resources/narrow.ts`) as *the* documented re-assertion mechanism, or (b) if `coerceSchema` is retained for a non-resource caller, strike the "so the primitive's generic response type matches the method's own declared return type" claim and cross-reference `narrow` as the actual resource-layer mechanism. Do not leave both patterns doc-blessed for the same job. |
| architect-r1-f2 | Low | Open | Package Boundaries | `account-resource.ts:30,53` (`componentSchema`, `dnetSiteMappingSchema`), `site-resource.ts:45,78` (`deviceNetworkInterfaceSchema`, `filterSchema`), `job-resource.ts:21` (`jobComponentSchema`) | These five hand-mirrored item schemas are `export const` in their resource modules **solely** so `tests/generated/schema-mirror-pin.ts` can reference them (auditor-r1-f2's fix); nothing else consumes them. They are internal validation details, not resource API, yet they now sit in the resource module's export surface — the same surface Phase 8 will barrel/re-export when it wires `src/index.ts`. If that barrel uses `export *` (a real risk, and how `schema-overrides/index.ts` already aggregates), these leak into the published `1.0.0` API as accidental public exports that must then be supported forever. There is no enforcement (no barrel yet, no API-extractor) preventing that. | Signal intent and contain the leak now: add `/** @internal */` to each of the five exported item schemas, and record (in the resource class doc or Phase 8 notes) that Phase 8's resources barrel must export only the `*Resource` classes and the `DattoRmmClient`, never `export *` from these files. |
