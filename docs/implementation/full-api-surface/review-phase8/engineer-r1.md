## engineer — round 1

Scope reviewed: the Phase 8 diff (`git diff 71f93e8..HEAD`) — the five new resource classes
(`AuditResource`, `FilterResource`, `UserResource`, `ActivityLogResource`, `SystemResource`), the
shared `filter-schema.ts` extraction, `operation-map.ts`, the finalized `DattoRmmClient` +
`createDattoRmmClient`, the new `src/index.ts` barrel and curated `src/public-types.ts`, the
old-surface deletion, and the accompanying tests (`coverage-map.test.ts`, `surface.test.ts`,
`surface-pin.ts`, per-resource nock tests).

This is a clean, tightly-scoped phase. The new resources follow the Phase 6/7 conventions
faithfully (`http*`/`paginate` primitives, `narrow<T>` at each return site, `@internal` item
schemas), the barrel curation is enforced by direct named re-export rather than a fragile test, and
`coverage-map.test.ts` is a genuine mechanical completeness guard (spec-derived set equality plus
per-op intercept-hit) rather than a hand-counted claim. I verified independently that every
`paginate` `arrayKey` (`software`/`filters`/`users`/`activities`) matches the committed spec's own
`SoftwarePage`/`FiltersPage`/`UsersPage`/`ActivityLogsPage` envelope keys, that the hand-written
item schemas (`softwareSchema`, `authUserSchema`) mirror the generated types field-for-field, that
`OPERATION_MAP` totals 57 and equals the spec `(method, path)` set, and that lenient parsing's
catchall preservation means the minimal item schemas do not silently drop wire fields. No
correctness, error-handling, complexity, or dead-code issues found in the new code.

One material naming-consistency issue is below. It is the only engineer-lens finding; I did not
manufacture others to pad the list.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Open | Naming | `src/client/resources/audit-resource.ts:45,55,65,76,94` | `AuditResource`'s public methods redundantly repeat the noun the `client.audit` namespace already supplies: `client.audit.getPrinterAudit()`, `getEsxiHostAudit()`, `getDeviceAudit()`, `getDeviceAuditSoftware()`, `getDeviceAuditByMacAddress()` — every method restates `Audit`, and three restate `Device`. This is inconsistent with the codebase's own established convention of dropping the namespace/entity noun: `client.jobs.getComponents()`/`getResults()`/`getStdOut()` (not `getJobComponents`), `client.devices.getByMacAddress()` (not `getDeviceByMacAddress`), and — introduced in *this same phase* — `client.filters.defaults()`/`custom()`, whose JSDoc explicitly justifies dropping the redundant `Filters` suffix because "the namespace already supplies the noun." `AuditResource` is the sole namespace that keeps the noun, and it does so with no documented rationale, on the last-mile public surface right before the breaking `1.0.0`. Note `client.audit.getDeviceAuditByMacAddress()` is especially wordy next to the parallel `client.devices.getByMacAddress()`. | Either (a) drop the redundant `Audit`/`Device` noun the `audit` namespace supplies — e.g. `getPrinter()`, `getEsxiHost()`, `getDevice()`, `getDeviceSoftware()`, `getDeviceByMacAddress()` — matching `client.jobs.getComponents()`/`getResults()` and the `FilterResource` rationale this phase already documents; or (b) if the verbose operationId-mirroring names are a deliberate disambiguation choice, add a JSDoc note on `AuditResource` recording that decision the way `FilterResource`'s class doc records its inverse one, so the divergence is intentional-and-explained rather than an oversight. Do it now, since renaming after `1.0.0` is a breaking change. |
