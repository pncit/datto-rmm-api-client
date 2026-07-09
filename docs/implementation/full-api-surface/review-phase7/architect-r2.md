## architect — round 2

In-progress review. Re-verified both round-1 findings against the current working tree and the
`reviser-r2` dispositions (both claimed `Fixed`), then re-swept every Phase 7 axis for new issues.

**Carry-forward / re-verification of round 1:**

- **architect-r1-f1 (Open → Closed, ratified).** `base-resource.ts:11-38` now describes `coerceSchema`'s
  *real* current use (the inline `schema as unknown as z.ZodType<Device>` cast `schema-overrides/
  types.ts` performs) and states outright that it "narrows only the schema's own declared type, not
  `BaseResource`'s `Lenient<T>` wrapper," cross-referencing `narrow<T>` (`./narrow.ts`) as the
  separate value-level mechanism. `validateResponse`'s doc (`:384-401`) and `narrow.ts`'s own doc
  (`:1-16`) were updated to match — the two helpers are now documented as non-competing (schema-level
  vs value-level), and no resource method uses `coerceSchema`. The one-idiom-per-job seam is closed.

- **architect-r1-f2 (Open → Closed, ratified).** All five hand-mirrored item schemas now carry
  `@internal` plus a one-line "exported only for `schema-mirror-pin.ts`" note and an explicit "Phase
  8's `src/index.ts` barrel must … never `export *` from this module" constraint:
  `componentSchema`/`dnetSiteMappingSchema` (`account-resource.ts:26-77`),
  `deviceNetworkInterfaceSchema`/`filterSchema` (`site-resource.ts:38-99`), `jobComponentSchema`
  (`job-resource.ts:18-40`). Intent is signalled at the point a Phase 8 implementor building the
  barrel will read it.

**New-issue sweep (all axes).** I independently re-verified the round-1 reviser's `site-update`
addition (`implementation-auditor-r1-f4`): `'site-update': 100` is present in `WRITE_LIMITS`
(`rate-limits.ts:27`), `SiteResource.update()` is implemented and typechecks against the closed
`WriteOpKey` union, and its response reuse of `getSiteResponse` in place of `updateResponse` is
correct — the two generated schemas are byte-for-byte structurally identical (verified). I also
re-checked every hand-mirrored item schema's key set and enum values against its generated type
(`FilterType`'s `['rmm_default','custom','site']`, `Component`/`ComponentVariable`,
`JobComponent`/`JobComponentVariable`, the `devices` arrayKey on `DevicesNetworkInterfacePage`) —
all exact, and the five non-`Filter` schemas are now full-`Equal`-pinned per `typescript-cop-r1-f2`.
Architecture (single shared axios instance, resources call only `http*`/`paginate`), data model,
public-surface namespace grouping, pagination-hot-path bounding, and the SSRF/credential guard are
all clean. One new finding, below — a documentation-integrity defect in the phase's own durable
record, not a code defect.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|--------------------------|
| architect-r1-f1 | Medium | Closed | Architecture | `base-resource.ts:11-38,384-401`, `narrow.ts:1-16` | Ratified. The two casting idioms are now doc-disambiguated: `coerceSchema` retypes a *schema* (and its doc no longer claims it can produce a clean un-wrapped resource return), `narrow` retypes an already-`Lenient`-wrapped *value*; `validateResponse` and `narrow.ts` cross-reference both. No resource uses `coerceSchema`. | No further action. |
| architect-r1-f2 | Low | Closed | Boundaries | `account-resource.ts:26-77`, `site-resource.ts:38-99`, `job-resource.ts:18-40` | Ratified. All five item schemas carry `@internal` plus the explicit "Phase 8 barrel must never `export *` from this module" constraint at the exact site a barrel author reads first. | No further action. |
| architect-r2-f1 | Low | Open | Architecture | `implementation-phase7-notes.md` §5 (line 184 "No other deviations"), §6 (208-214), §10 (unlisted), §11 (311-315), §13 (358 "Phase 5's `rate-limits.ts` table are all untouched") | The phase-7 implementation notes — this phase's durable, human-readable "what changed" record and the artifact a future maintainer or the historian reads first — are now factually contradicted by the shipped code on the `site-update` axis. Round 1's reviser (`implementation-auditor-r1-f4`, ratified by `project-lead-r1`) implemented `SiteResource.update()` and added `'site-update': 100` to `rate-limits.ts`'s `WRITE_LIMITS`, but the notes were never reconciled: §6 and §11 still state "Site `update()` … is not implemented" and "a maintainer … needs to add `'site-update'`", §5 asserts "No other deviations," and §13's Final Assertion explicitly claims "Phase 5's `rate-limits.ts` table are all untouched" — all four are now false. A maintainer trusting §13 would be misled about where `site-update`'s ceiling came from and would believe an uncovered spec operation still exists. An explicit, false Final Assertion in the phase's own sign-off record is a genuine audit-trail/maintainability defect, independent of the code (which is correct). | Reconcile the notes with the shipped tree: in §6/§11 record that `SiteResource.update()` **is** implemented and `'site-update'` was added to `WRITE_LIMITS` (crediting `implementation-auditor-r1-f4`); correct §5 to note the `rate-limits.ts` extension as an in-scope infra addition rather than "no other deviations"; and fix §13's Final Assertion so it no longer asserts `rate-limits.ts` is untouched. Keep it to a factual reconciliation — the *code* is already ratified; only the record is stale. |
