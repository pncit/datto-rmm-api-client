## engineer — round 2

In-progress review. My round-1 turn carried a single engineer-lens finding, `engineer-r1-f1`
(the `AuditResource` methods redundantly repeating the `Audit`/`Device` noun the `client.audit`
namespace already supplies). The reviser marked it Fixed via option (a).

Re-verification of that fix:
- `src/client/resources/audit-resource.ts` now exposes `getPrinter`/`getEsxiHost`/`getDevice`/
  `getDeviceSoftware`/`getDeviceByMacAddress` — the redundant noun is dropped, matching
  `client.jobs.getComponents()`/`getResults()` and the `FilterResource.defaults()`/`custom()`
  convention this phase established.
- The class doc (lines 43–46) now records the naming rule explicitly, so the pattern is
  documented rather than implicit — exactly the intent of the finding's recommendation.
- `git grep` for the old method names (`getPrinterAudit`/`getEsxiHostAudit`/`getDeviceAudit`/
  `getDeviceAuditSoftware`/`getDeviceAuditByMacAddress`) across `src/` and `tests/` returns only
  the *generated* schema identifiers (`getPrinterAuditResponse`, `getDeviceAuditByMacAddressResponseItem`,
  `GetDeviceAuditSoftwareParams`, …), which are Orval-derived from the spec's `operationId` and
  are correctly left untouched. No stale caller of the old resource-method names survives.
- Call sites are consistent: `src/client/operation-map.ts`'s five `audit` rows use the new names,
  and `src/client/datto-rmm-client.ts` mounts `AuditResource` unchanged.

The fix is complete and internally consistent — `engineer-r1-f1` is ratified (Closed).

I re-read the remaining Phase 8 surface this round (`operation-map.ts`, `public-types.ts`,
`index.ts`, `datto-rmm-client.ts`, the five new resource classes, and `coverage-map.test.ts`)
for any engineer-lens issue I may have missed in round 1. The code is clean: naming is now
uniform across all ten namespaces, the public barrel/`public-types` curation is self-enforcing
via by-name re-exports (a rename breaks typecheck rather than silently shifting the surface), and
the coverage-map driver's one documented reflective dispatch is justified against the uniform
argument convention it relies on. No new findings.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Closed | Naming | `src/client/resources/audit-resource.ts` | Ratified. The five `AuditResource` methods were renamed to drop the redundant `Audit`/`Device` noun (`getPrinter`/`getEsxiHost`/`getDevice`/`getDeviceSoftware`/`getDeviceByMacAddress`), a class-doc sentence now records the naming rule, and every call site (`operation-map.ts`, the audit resource test, `base-resource.ts`'s doc example, phase notes) was updated to match. `git grep` confirms no stale caller of the old names remains — only the Orval-generated schema identifiers, correctly left untouched. | No further action — fix verified complete and consistent. |
