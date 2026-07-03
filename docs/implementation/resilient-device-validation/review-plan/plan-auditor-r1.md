## plan-auditor — round 1

Round 1 audit of `plan.md` against `design.md` and the live repo (`datto-rmm-api-client`).

### Repo reality checks (all verified true unless noted)
- `src/validation.ts` — sole `validate(schema, data, mode)` seam; `warn` calls `console.warn` directly, `strict` throws `result.error`, `off` returns raw. Matches plan/design. ✔
- `src/client.ts` — `getAllPages<T, P extends { pageDetails?: { nextPageUrl: string | null } }>(url, token, params, schema, extractor)` validates the whole page via `validate(...)` in try/catch; `getAccountDevices` passes `DevicesPageSchema` + `(p) => p.devices ?? []`; `getDeviceByUid` catches `ZodError` → `{ ok: false }` with **no** logging and **no** `logger` local in scope. `getAllPages` has exactly one caller. ✔
- `src/result.ts` — `Result<T>` ok-branch carries `warnings?: ProblemError[]`; `ProblemError` has `type/title/status/detail?/raw?`. No type change needed. ✔
- `src/schemas.ts` — `DeviceSchema` closed object; `PaginationDataSchema` has required `prevPageUrl`/`nextPageUrl` (string|null); `DevicesPageSchema = { pageDetails?, devices?: array(DeviceSchema) }`. All exported via `src/index.ts` barrel. ✔
- `src/logger.ts` — `LoggerLike { debug/info/warn/error }`, `defaultLogger = console`. `src/config.ts` has `logger?` + `validationMode?`. ✔
- `package.json` — scripts are only `test`(jest), `build`(tsc), `format`; **no** `lint`/`typecheck`. `tsconfig.json` `strict:true`, `exclude` includes `src/__tests__` (tests type-checked at jest time). `zod ^4.0.5`. ✔
- Tests/fixtures — `deviceSchema.test.ts` calls 3-arg `validate(DeviceSchema, device, "strict")`; `devicesMethod.test.ts` uses `MockAxios` keyed by URL; fixtures `device.json`, `devicesPage.json`, `devicesPage1.json`, `devicesPage2.json` present; `devicesPage1` pageDetails carries a valid `prevPageUrl`/`nextPageUrl`. `README.md` exists. ✔

Type-shape spot check: `DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>` (pageDetails = `PaginationDataSchema.optional()`) satisfies the `getAllPages` generic constraint `{ pageDetails?: { nextPageUrl: string|null } }`. No generic-constraint break. ✔

### Design Alignment
| Design Requirement | Plan Coverage | Gap/Deviation |
|--------------------|---------------|---------------|
| R1 (per-device resilience in strict) | Phase 2 (validateItems + getAllPages rewrite) | none |
| R2 (rejected → warnings[] with id/uid + path) | Phase 1 (toProblemError) + Phase 2 wiring | none |
| R3 (dropped-device error via config.logger) | Phase 1 (logger.error in helper) + Phase 2 (logger passed) | none |
| R4 (Device/DeviceSchema/exports unchanged) | Phase 1 & 2 no-schema-change constraint; gate checks | verification not machine-enforced — see r1-f1 |
| R5 (malformed envelope hard-fails in strict/warn, not off) | Phase 2 Step 1–2 (direct envelope safeParse, mode-gated) | none |
| R6 (validate() warn routes via logger.warn) | Phase 1 Step 1 | none |
| R7 (getDeviceByUid fail-hard + error log) | Phase 2 Step 4 | logger local undeclared — see r1-f2 |
| R8 (warn/off returned-data contract preserved) | Phase 1 Step 2 (warn raw passthrough) + Phase 2 off path | none |

Every R-ID is claimed by at least one phase whose steps actually deliver it; no orphaned requirement; no phase claims an R-ID its steps don't serve.

### Notes
The design's three Breaking Changes, the multi-page abort discarding accumulated items/warnings, and the "warn returns raw (unparsed) even for valid items so unknown keys survive" contract are all faithfully carried into the plan and its test list. The remaining findings are execution-gaps, not design deviations.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Open | Clarity | Phase 2 Step 4 and its opinionated `getDeviceByUid` catch snippet reference a `logger` local (`validate(..., logger)` and `logger.error(...)`), but no step instructs declaring one in `getDeviceByUid`, and the current method has no `logger` in scope. Following the plan verbatim yields `Cannot find name 'logger'` — `tsc`/`npm test` fail and Phase 2's own exit gate cannot pass. | Add an explicit step: resolve `const logger = this.config.logger ?? defaultLogger;` at the top of `getDeviceByUid` (mirroring the `getAllPages` line in Step 2) before the `validate(...)`/`catch` use it. |
| plan-auditor-r1-f2 | Medium | Open | Completeness | Both phases' Exit Gates verify the R4 invariant (no changes to `src/schemas.ts` `DeviceSchema`/`PaginationDataSchema`/`DevicesPageSchema`, `src/result.ts`, `src/index.ts` export list) with `git diff --name-only` prose bullets placed **outside** the single fenced `bash` block. The pipeline driver executes only the fenced block (`npm run build`/`npm test`), so the plan's hardest constraint — public type-surface stability — is never mechanically enforced and can silently regress. | Move the R4 guard into the fenced block as a command that exits non-zero on violation (e.g. `git diff --name-only \| grep -qE 'src/(schemas\|result)\.ts\|src/index\.ts' && { echo 'R4 violation'; exit 1; } \|\| true`), or back R4 with an explicit test asserting the export list / schema shapes are unchanged. |
| plan-auditor-r1-f3 | Low | Open | MissingDecision | Phase 2 Documentation step targets `README.md` with three well-specified release-note bullets but names no section/anchor, and no exit-gate step verifies the doc edit landed. "and/or add a short note" leaves the placement undecided. | Name the concrete README section (or state "new '## Resilient validation / Behavioral changes' section") where the three bullets go, so the reviser has an unambiguous target. |
