## implementation-auditor — round 1

Scope: reviewed the working-tree diff for Phase 7 — the five new `*Resource` classes
(`account`/`site`/`device`/`alert`/`job`), the three shared helpers (`narrow.ts`, `void-response.ts`,
`variable-schema.ts`), the `DattoRmmClient` scaffold, the doc-only `datto-client-config.ts` change, the
`schema-leniency.ts` bug fix, and the six new test files — against plan Phase 7 (steps 1–6) and the
design. Cross-checked every hand-written path/verb, every pagination `arrayKey`, and every `opKey`
against `spec/openapi.json`, and every schema/type import against the generated tree and the
`schema-overrides` barrel.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. `AccountResource` (`get`, `devices`, variables, components, dnetSiteMappings) | ✅ Implemented | Paths/verbs/keys all verified against spec; `devices()` is the pinned `client.account.devices()` (Decision 5). See f1/f2 on hand-written `accountSchema`. |
| 2. `SiteResource` (list/get, site devices, variables, settings, filters, proxy) | ⚠️ Partial | All listed reads/writes present and correct; `POST /site/{siteUid}` (site `update`) unimplemented — see f4. |
| 3. `DeviceResource` (`get`, `setUdf`→`/udf`, `move`, `createJob`, warranty) | ✅ Implemented | `setUdf` correctly realigned to `POST /api/v2/device/{uid}/udf`; proxy correctly rehomed to `SiteResource` per real spec topology. |
| 4. `AlertResource` (open/resolved incl. `openForSite`, `resolve`, mute/unmute) | ✅ Implemented | All 10 reads/writes present; concept-first rehoming applied consistently and matches the design's `openForSite` example. |
| 5. `JobResource` (job reads + components) | ✅ Implemented | Bare-array endpoints correctly on `httpGetArray`; `getComponents` paginates with correct `jobComponents` key. |
| 6. `DattoRmmClient` scaffold (masked logger, `.safeParse` throw, axios+auth/rate/retry, mount 5) | ✅ Implemented | Construction order matches Phase 5 docs; `src/index.ts` untouched per coexistence rule. |
| Tests: one file/resource (path/verb, response validation, opKey + malformed-body for writes) | ✅ Implemented | Present for all five + scaffold; `setUdf` endpoint + R20 end-to-end masking and the alertContext-survival assertion all present. |

### Drift Report
**Out-of-scope changes:**
- `src/validation/schema-leniency.ts` (Phase 4 file) — a real, minimal, well-documented bug fix
  (`objectCatchall` + one `else if` branch) required for `AlertResource`'s R8 `alertContext`
  guarantee to hold end-to-end. I verified: the fix is correct (the `never`-catchall exclusion
  genuinely prevents `strictObject` write bodies from admitting extra keys), its blast radius is
  contained (only `alertContextSchema` reaches this path via `parseLenient`; `pageDetailsSchema` is
  validated by direct `.safeParse` in `paginate`, never through `cleanAndDiagnoseResponse`), and the
  new alert-context test actually exercises it. **Acceptable Phase-7 necessity — no finding.**
- `src/client/datto-client-config.ts` — doc-comment-only correction (stale "wired in Phase 8"). Trivial, acceptable.

**Acceptable Phase 7 necessities:** the two above; the three shared helpers (`narrow`/`voidResponseSchema`/`variableSchema`) are legitimately in-scope Phase-7 code.

**Note on Deviation 1 (`z.void()`→`z.unknown()`):** verified correct — a real empty axios response body is `""`, not `undefined`, so the plan's illustrative `z.void()` would fail every bodiless-response write. The correction is sound; no finding.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Open | BestPractices | `src/client/resources/account-resource.ts:27-48` (`accountSchema`) | `accountSchema` is hand-written as a "plain mirror … no override needed," but the generated schema **already exists**: `getUserAccountResponse` (`src/generated/schemas/-v2-account/-v2-account.zod.ts`) is a field-for-field-identical single-`Account` schema. This is inconsistent with the same phase's `SiteResource.get()`/`JobResource.get()`, which reuse the generated `getSiteResponse`/`get1Response` directly, and it creates a silent drift hazard: a spec regeneration that changes `Account` updates the generated schema and the `Account` type but not this hand-copy, so `get()` would strip/misshape a field while still declaring `Promise<Account>`. The stated rationale ("no override needed, plain mirror of the generated shape") overlooks that a directly-reusable generated schema is present. | Replace `accountSchema` with an import of `getUserAccountResponse` (as `site.get`/`job.get` do); delete the hand-written copy. |
| implementation-auditor-r1-f2 | Medium | Open | BestPractices | `account-resource.ts` (`componentSchema`, `dnetSiteMappingSchema`), `site-resource.ts` (`deviceNetworkInterfaceSchema`, `filterSchema`), `job-resource.ts` (`jobComponentSchema`), `variable-schema.ts` | The hand-written paginated **item** schemas each mirror a generated type (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `Filter`, `JobComponent`, `Variable`) and each method asserts that exact type via `narrow<T>` — but nothing binds the schema to the type. The repo already establishes a type-pin convention for exactly this (`tests/generated/lenient-type-pin.ts`, `Expect<Equals<…>>`) for the reconciled `Device`/`Alert` schemas; these six new mirrors have no such guard. Because `parseLenient` strips unknown keys, a regeneration that adds a field to any of these entities would silently drop that field from the returned value while the declared return type still claims it — undetected by any test or the typechecker. (They match the generated types today; this is the missing guard, not a current mismatch.) | Add a compile-time pin per schema (e.g. `type _ = Expect<Equals<z.infer<typeof componentSchema>, Component>>` alongside `lenient-type-pin.ts`, or extract the item from the generated envelope's inline shape) so a spec-refresh divergence fails a check rather than silently shipping. |
| implementation-auditor-r1-f3 | Low | Open | BestPractices | `account-resource.ts:136` & `site-resource.ts:187` (`variables()` param), `device-resource.ts:89` (`createJob` body) | These three signatures use inline object literals where a generated type already exists and every sibling method uses the generated one: `variables(params?: { page?; max? })` duplicates `GetAccountVariablesParams`/`GetSiteVariablesParams`, and `createJob(…, body: { jobName; jobComponent })` duplicates `CreateQuickJobRequest` (whereas `create()` correctly uses the generated `CreateSiteRequest`). The literals match today, but a regeneration that adds a query/body field leaves these signatures silently unable to express it — the same single-source-of-truth drift the codebase otherwise avoids. | Import and use `GetAccountVariablesParams`/`GetSiteVariablesParams` and `CreateQuickJobRequest` in place of the inline literals. |
| implementation-auditor-r1-f4 | Medium | Open | Completeness | `src/client/resources/site-resource.ts` (`SiteResource`, class doc §96-104) | `POST /api/v2/site/{siteUid}` (site update) is a real, documented v2 write operation left unimplemented because Phase 5's `WRITE_LIMITS` has no `WriteOpKey` for it. R1 requires the full documented surface; the scope boundary here is genuinely unsettled, because this phase *did* edit another untouched prior-phase file (`schema-leniency.ts`) as a "phase necessity" while declining to add one `WriteOpKey` here — a human/orchestrator decision, not something the plan settles (plan Step 2 lists "site list/get, site devices, site variables" and is silent on update). Left entirely undecided, the operation is uncovered until Phase 8's coverage test happens to surface it. | Decide and record: either add `'site-update'` to `src/rate-limit/rate-limits.ts`'s `WRITE_LIMITS` and implement `SiteResource.update()` now, or formally defer to Phase 8 with sign-off. If unresolved, escalate as a Requirements Gap rather than leaving it as an undocumented scope call. |
