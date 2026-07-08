## plan-auditor — round 1

Round 1 audit of `full-api-surface/plan.md` against `design.md` and the repo
(`datto-rmm-api-client` @ `0.1.14`) plus the reference sibling `../fuze-api`.

### Reality checks (verified)
- Repo layout matches the plan's "Repo Context Checked": `src/{client,config,validation,result,schemas,httpClient,auth,rateLimiter,tokenStore,logger,index}.ts`, `src/internal/devicesEnvelope.ts`, four tests under `src/__tests__/`, fixtures `device.json`/`devicesPage*.json`, `jest.config.js`, `tsconfig.json` (`moduleResolution: "Node"`), `package.json` on jest/ts-jest + zod `^4.0.5` + axios `^1.10`. All confirmed.
- `../fuze-api` exists with every ported file the plan names: `orval.config.ts`, `src/validation/schema-leniency.ts`, `src/client/resources/base-resource.ts`, `src/client/fuze-client-config.ts`, `src/client/axios-mutator.ts`, `src/client/interceptors/retry-interceptor.ts`, `scripts/dedupe-generated-index.mjs`, `tsup.config.ts`, `vitest.config.ts`, `spec/openapi.json`. fuze toolchain confirmed: `orval ^7`, `tsup ^8`, `vitest ^4`, `nock ^14`, `@vitest/coverage-v8 ^4`, zod `^4`; `"generate": "orval && node scripts/dedupe-generated-index.mjs"`.
- fuze `schema-leniency.ts` isolates all `_zod.def` access via `getDef`, has an `addCatchallRecursive` switch with an existing (leaf) `enum` case, and `parseLenient(schema, data, logger?, context?)` — matching the plan's port claims. fuze `BaseResource` exposes `protected get/post/patch/deleteRequest`, `validateRequest/validateResponse/validateArrayResponse`, `coerceSchema`; there is no `paginate` (plan adds it). fuze `CompanyResource` names its public method `search` (not a base-primitive name).
- `.github/workflows/` exists (validate.yml, npm-publish.yml) — Phase 9's CI-wiring target is real.

### Design Alignment
| Design Requirement | Plan Coverage | Gap/Deviation |
|--------------------|---------------|---------------|
| R1 full surface | Ph7, Ph8, Ph9 | OK; but coverage guard is count-only (f5) |
| R2 namespaces | Ph7, Ph8 | `get(uid)` naming clashes with base primitive (f1) |
| R3 strict pagination cursor | Ph6 | OK — dedicated `pageDetailsSchema`, throw-on-malformed |
| R4 Orval two-target zod v4 | Ph2 | OK |
| R5 lenient response + open-enum type widen | Ph2 (codemod), Ph4 (runtime) | OK |
| R6 strict request + required marks | Ph6 | OK |
| R7 per-item drop | Ph4, Ph9 | OK |
| R8 defect corrections survive regen | Ph2, Ph6, Ph9 | OK |
| R9 throwing error hierarchy | Ph3 | OK |
| R10 OAuth password grant + lifecycle | Ph5 | Ph3 also claims R10 but no Ph3 step delivers it (f2) |
| R11 dual/per-op rate limit | Ph5 | OK (opKey-name accuracy is Deferred Validation) |
| R12 429/403 handling | Ph5 | OK |
| R13 DattoLogger | Ph3 | OK |
| R14 userAgentExtra/tokenRefreshPct functional, autoRefresh removed | Ph3, Ph5 | `tokenRefreshPct` default left unpinned (f4) |
| R15 committed spec+generated, byte-reproducible | Ph2 | OK |
| R16 tsup/vitest/nock ESM | Ph1, Ph10 | OK (minor @types/node drift, f7) |
| R17 fixtures validate | Ph9 | OK (synthesized; real capture deferred) |
| R18 README | Ph10 | OK |
| R19 breaking 1.0.0 | Ph8, Ph10 | "old contract removed" gate is prose-only (f3) |
| R20 UDF masking | Ph3, Ph9 | mask passes through non-string udf values (f6) |

All twenty R-IDs are claimed by at least one phase.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Open | Consistency | Design Decision 5 mandates the public API `client.devices.get(uid)`, but Phase 6 keeps the ported `BaseResource` primitives named `get/post/patch/deleteRequest` (protected), and the Phase 7 example defines a public `DeviceResource.get(uid): Promise<Device>`. Redeclaring `get` in the subclass with an incompatible signature triggers TS2416 ("Property 'get' … not assignable to the same property in base type"), and the example's body `return this.get(\`/api/v2/device/${uid}\`, deviceResponseSchema, …)` resolves to the subclass's own `get` → infinite recursion. fuze avoided exactly this by naming its base delete primitive `deleteRequest` and its resource methods non-colliding names (`search`). | Resolve the name clash explicitly in Phase 6/7: either rename the base HTTP primitives (e.g. `httpGet`/`httpPost`/`httpPatch`/`httpDelete`) so resources can expose public `get`/etc., or forbid resource methods from reusing primitive names. Fix the Phase 7 `DeviceResource.get` example to call the renamed primitive, not itself. |
| plan-auditor-r1-f2 | Medium | Open | DesignAlignment | Phase 3's `**Requirements:**` line claims **R10** (OAuth2 password grant + token cache/proactive refresh), but no Phase 3 step delivers it — Phase 3 builds errors, logger, mask, and config, and R10's auth/token-store work is entirely in Phase 5 (`auth-manager.ts`/`token-store.ts`), which also claims R10. A phase claiming an R-ID its steps don't serve is a traceability defect. | Remove R10 from Phase 3's requirements line (leave it under Phase 5), or move a concrete R10-serving step into Phase 3. |
| plan-auditor-r1-f3 | Medium | Open | Completeness | Several Exit Gates put their most important assertions in **prose bullets outside** the fenced `bash` block, so the pipeline driver (which executes the fenced block verbatim) never enforces them: Phase 8's `git grep -n "Result<" src/` / `git grep -n "validationMode" src/` "return nothing" and "No file under the deleted list remains"; Phase 1's "no jest/ts-jest reference remains (grep is clean)" and "jest.config.js is deleted"; Phase 9's "proven to exit non-zero on a planted secret". | Fold each into the fenced Exit Gate block as commands that exit non-zero on violation, e.g. `! git grep -qn "Result<" src/`, `! git grep -qn "validationMode" src/`, `test ! -f jest.config.js`, `! grep -qE "jest|ts-jest" package.json`. |
| plan-auditor-r1-f4 | Medium | Open | MissingDecision | Phase 5 Step 4 defers the `tokenRefreshPct` default: "refresh when the remaining lifetime is below `tokenRefreshPct` of the original TTL (default e.g. 25% if unset — pick and document a default)". R14 makes this field functional and the phase's auth test asserts proactive refresh, but no concrete default is fixed, so refresh timing (and its test) is nondeterministic across implementors. | Pin the exact default now (a single number, e.g. 25) in Phase 5 Step 4 and reference it from the auth-manager test's threshold assertion. |
| plan-auditor-r1-f5 | Medium | Open | Test | Phase 8's `coverage-map.test.ts` is said to "assert the count reaches the full operation set (guards R1 — no path silently missing)", but the plan never defines the authoritative expected inventory. A bare count check passes even if a namespace duplicates one operation and omits another, so it does not actually guard R1. | Derive the expected operation set from the committed `spec/openapi.json` (enumerate path×method / `operationId`s) and assert each maps to a reachable `client.<ns>.<method>`, rather than comparing a hardcoded total. |
| plan-auditor-r1-f6 | Low | Open | Security | The Phase 3 `mask.ts` example only redacts **string** udf values (`mask = v => typeof v === 'string' ? … : v`) and, for a udf key holding a non-null object/array, returns it unchanged without recursing. R20 requires masking "each non-null UDF value"; a udf key carrying a non-string (or nested object) would be emitted to the sink in cleartext. | Mask any non-null value under a `udf*` key (redact objects/arrays/numbers too, not just strings) so the guarantee holds regardless of wire type. |
| plan-auditor-r1-f7 | Low | Open | Consistency | Phase 1 Step 1 adds `@types/node@^22`, but the plan's stated rationale is "keep the two PNCIT clients on one toolchain" and `../fuze-api` uses `@types/node@^26`. The version divergence undercuts the single-toolchain goal. | Align `@types/node` with fuze-api (`^26`) or justify the `^22` pin explicitly. |
