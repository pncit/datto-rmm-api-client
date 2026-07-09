## implementation-auditor — round 2

Continuing the Phase 7 review. Read my round-1 turn and the reviser's round-1 dispositions
(all four findings marked `Fixed`), then re-verified each against the current working tree
(`git diff HEAD`) and cross-checked every new/changed path, verb, `opKey`, schema binding, and
generated-type import against `spec/openapi.json` and the generated tree. No prior finding was
escalated or human-ruled. After ratifying the fixes I hunted for issues newly introduced by them.

### Re-verification of round-1 findings

- **f1 (`accountSchema` hand-copy)** — `AccountResource.get()` now validates against the generated
  `getUserAccountResponse` (imported from `-v2-account.zod`); the hand-written `accountSchema` block
  is deleted. Matches how `SiteResource.get()`/`JobResource.get()` reuse their generated response
  schemas. The silent-drift hazard is gone. **Ratified → Closed.**
- **f2 (unbound item-schema mirrors)** — new `tests/generated/schema-mirror-pin.ts` adds a
  compile-time `Equal<keyof T, keyof z.infer<schema>>` pin for all six mirrors
  (`Component`/`DnetSiteMappingsDto`/`DeviceNetworkInterface`/`Filter`/`JobComponent`/`Variable`),
  picked up by the same `tsconfig.test.json` include glob as `lenient-type-pin.ts` and enforced by
  `npm run typecheck`. The four private schemas were exported to make them referenceable. The
  key-set (rather than deep-`Equal`) comparison is a sound, documented choice — it catches exactly
  the named hazard (a field silently added/removed upstream causing a `parseLenient` strip) while
  avoiding a spurious failure from the already-guarded `Filter["type"]` open/closed-enum asymmetry.
  **Ratified → Closed.**
- **f3 (inline object literals over generated types)** — `AccountResource.variables()` →
  `GetAccountVariablesParams`, `SiteResource.variables()` → `GetSiteVariablesParams`,
  `DeviceResource.createJob()` body → `CreateQuickJobRequest`. Verified each generated type is
  structurally identical to the removed inline literal (`{page?; max?}` and `{jobName; jobComponent}`
  respectively), so no signature widening/narrowing occurred; the stranded `JobComponentRequest`
  import was removed cleanly. **Ratified → Closed.**
- **f4 (unimplemented `POST /api/v2/site/{siteUid}` site update)** — `SiteResource.update(siteUid,
  body: SiteRequest)` implemented, calling `httpPost` with `siteUpdateBodySchema`, `getSiteResponse`,
  context `"POST /site/{siteUid}"`, and the new `'site-update'` `WriteOpKey`. Verified against the
  spec: `POST /api/v2/site/{siteUid}` "Updates the site…", body `SiteRequest` (`required: ["name"]`).
  `siteUpdateBodySchema` re-exports the generated `updateBody` (a `strictObject` requiring `name`);
  `'site-update': 100` added to the closed `WRITE_LIMITS` union and actively consumed (no dead
  entry); the stale "known gap / out of scope" doc paragraphs in `site-resource.ts` and
  `write-bodies.ts` were removed and replaced; new nock + `write-bodies` tests cover path/verb/opKey
  and body validation. Editing the Phase-5 `rate-limits.ts` and Phase-6 `write-bodies.ts` here is
  the resolution f4 explicitly offered ("add now… or defer") and is justified — these are
  extension-point infrastructure files, not the coexistence rule's untouched *old* pre-refactor
  surface. **Ratified → Closed.**

### New issues

None. The four fixes are minimal, correct, and self-consistent; scans for stranded references
(`accountSchema`, `JobComponentRequest`), dead `WriteOpKey` entries, and generated-type structural
drift came back clean.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | BestPractices | `src/client/resources/account-resource.ts` | ratified: `get()` now validates against the generated `getUserAccountResponse` and the hand-copied `accountSchema` is deleted, eliminating the regeneration-drift hazard. | — |
| implementation-auditor-r1-f2 | Medium | Closed | BestPractices | `tests/generated/schema-mirror-pin.ts` | ratified: a compile-time key-set pin now binds all six hand-mirrored item schemas to their generated types (enforced by `npm run typecheck`), so an upstream field add/remove fails the build instead of silently dropping via `parseLenient`. The key-set (vs deep-`Equal`) scope is correct and documented. | — |
| implementation-auditor-r1-f3 | Low | Closed | BestPractices | `account-resource.ts`, `site-resource.ts`, `device-resource.ts` | ratified: the three inline object literals are replaced with the generated `GetAccountVariablesParams`/`GetSiteVariablesParams`/`CreateQuickJobRequest`, each verified structurally identical; the redundant `JobComponentRequest` import was removed. | — |
| implementation-auditor-r1-f4 | Medium | Closed | Completeness | `src/client/resources/site-resource.ts`, `src/rate-limit/rate-limits.ts`, `src/schema-overrides/write-bodies.ts` | ratified: `SiteResource.update()` implemented for `POST /api/v2/site/{siteUid}` (verified against spec) with the new `'site-update'` `WriteOpKey` (actively consumed, no dead entry) and `siteUpdateBodySchema`; stale "gap" docs removed; tests added. The documented spec-write surface is now complete for this phase. | — |
