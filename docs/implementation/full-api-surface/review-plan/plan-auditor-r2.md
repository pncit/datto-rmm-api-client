## plan-auditor — round 2

Reconciled the seven round-1 findings against the revised plan, re-verifying each fix in the repo,
then hunted for new issues. All round-1 findings are genuinely resolved (see below). Four new
findings raised — three missing-decision / consistency gaps and one residual prose-only-gate issue
parallel to the now-closed f3.

Re-verification notes on the round-1 fixes:
- **f1** — Phase 6 Step 1 renames the base primitives to `httpGet`/`httpPost`/`httpPatch`/`httpDelete`,
  adds the "resources call only the `http*` primitives" rule, and the Phase 6 Goal + Phase 7
  `DeviceResource` example now call `this.httpGet`/`this.httpPost`. TS2416 shadow + recursion trap gone.
- **f2** — Phase 3 `**Requirements:**` is now `R9, R13, R14, R20` (R10 removed); R10 is claimed and
  delivered only by Phase 5.
- **f3** — the named prose assertions are folded into the fenced gates: Phase 1 (`test ! -f jest.config.js`,
  the `! grep -qE '"(jest|ts-jest|@types/jest)"'`, config existence, `npx orval --help`) and Phase 8
  (`! git grep -qn "Result<" -- src/`, `! git grep -qn "validationMode" -- src/`, the deleted-file loop,
  `test ! -d src/internal`).
- **f4** — Phase 5 Step 4 pins `DEFAULT_TOKEN_REFRESH_PCT = 25` and the auth test asserts against it.
- **f5** — Phase 8 `coverage-map.test.ts` now derives the authoritative inventory from
  `spec/openapi.json` and asserts a per-operation map covers each operation exactly once.
- **f6** — Phase 3 `mask.ts` redacts any non-null `udf*` value regardless of wire type, with a
  nested-object (`udf9`) test.
- **f7** — Phase 1 Step 1 aligns `@types/node@^26` with fuze-api.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified: base primitives renamed to `httpGet/httpPost/httpPatch/httpDelete` (Phase 6 Step 1 + Goal), resource-call rule added, Phase 7 `DeviceResource` example rewritten to `this.httpGet`/`this.httpPost` — no shadow/recursion, public `devices.get(uid)` is safe. |
| plan-auditor-r1-f2 | Medium | Closed | DesignAlignment | — | ratified: R10 removed from Phase 3's requirements line; R10 claimed and delivered solely by Phase 5. |
| plan-auditor-r1-f3 | Medium | Closed | Completeness | — | ratified: the named prose-only assertions are now fenced commands in Phase 1 and Phase 8; Phase 9's "exits non-zero on a planted secret" is enforced by `scan-secrets.test.ts` under `npm test`. (Residual prose-only checks in *other* phases tracked separately as r2-f4.) |
| plan-auditor-r1-f4 | Medium | Closed | MissingDecision | — | ratified: `DEFAULT_TOKEN_REFRESH_PCT = 25` pinned in Phase 5 Step 4 and referenced by the auth-manager test. |
| plan-auditor-r1-f5 | Medium | Closed | Test | — | ratified: `coverage-map.test.ts` derives the inventory from `spec/openapi.json` and asserts exactly-once coverage of every operation. |
| plan-auditor-r1-f6 | Low | Closed | Security | — | ratified: `mask.ts` redacts any non-null `udf*` value regardless of wire type; nested-object udf test added. |
| plan-auditor-r1-f7 | Low | Closed | Consistency | — | ratified: `@types/node@^26` aligned with fuze-api. |
| plan-auditor-r2-f1 | Medium | Open | MissingDecision | Phase 3 Step 4 declares `retry?` and `rateLimit?` only as "strict sub-objects" with no field list or defaults, yet Phase 5 Step 3 relies on `retry.maxAttempts` and the Phase 5 http-client test asserts "a 5xx retries per `maxAttempts`" and a 429 "retried after the delay". With no pinned default `maxAttempts` (and backoff base/cap), retry count and backoff timing are nondeterministic across implementors and the test threshold is unfixed — the same defect class as the (now-fixed) `tokenRefreshPct` f4. | Pin the `retry` sub-object shape and defaults now (e.g. `maxAttempts` default, base/max backoff ms), exported as named constants the http-client test references; likewise fix the `rateLimit` sub-object shape (or state it merely overrides the committed `rate-limits.ts` table and name the overridable fields). |
| plan-auditor-r2-f2 | Medium | Open | Clarity | Phase 2 Step 3's `widen-response-enums.mjs` must widen "every **response** enum field … never request/param/body types" but never specifies *how* the script tells a response enum field from a request/param/body one. The `\| (string & {})` idiom is emitted into `src/generated/types/**`, where Orval (tags-split) names types after component schemas (`Device`, `Alert`) — not suffixed `Response`/`Body`/`Params` — so "scope strictly to response types" has no stated mechanical rule. Over-widening (touching a request/param type) would silently loosen the request-side type contract the design keeps closed (R5/R6), and Phase 9's enum-alignment test only exercises response fields, so it would not catch the over-widen. | State the concrete discrimination rule the codemod uses (e.g. widen enums only in component-schema types and never in operation `*Body`/`*Params`/`*Query` types, or drive the target field set from a list emitted alongside generation), and add a codemod test asserting a request/param enum type is left closed. |
| plan-auditor-r2-f3 | Medium | Open | Consistency | Phase 3 Step 4 adds `axiosInstance?` to `dattoRmmClientConfigSchema`, but no phase consumes it: Phase 5 Step 3 "create[s] the shared axios instance" from `apiUrl`/headers and Phase 7 Step 6 wires "axios instance … (from Phase 5)" — neither reads a caller-supplied instance, and the nock tests intercept at the HTTP layer regardless. This reintroduces exactly the dead-config pattern R14 / Decision (dead-config) just retired (`autoRefresh`). The design's public-surface config block also does not list `axiosInstance`. | Either wire `axiosInstance` in Phase 5 (use the provided instance instead of constructing one when present, and test that path) or drop the field to keep the config free of unused knobs per R14. |
| plan-auditor-r2-f4 | Medium | Open | Completeness | Residual prose-only Exit-Gate assertions remain in phases outside f3's scope, so the pipeline driver (which runs only the fenced block) never enforces them. Phase 2: "`spec/openapi.json` and `spec/openapi-prev.json` are committed; `spec/openapi.patched.json` is git-ignored and untracked" and "`src/generated/**` is committed and non-empty". Phase 10: "`dist/index.js` and `dist/index.d.ts` exist after `npm run build`" and the README-content checklist. | Fold each into the fenced block as a failing command, e.g. Phase 2: `git ls-files --error-unmatch spec/openapi.json spec/openapi-prev.json`, `! git ls-files --error-unmatch spec/openapi.patched.json 2>/dev/null`, `test -n "$(ls -A src/generated)"`; Phase 10: `test -f dist/index.js && test -f dist/index.d.ts` (README-content is already partly guarded by the optional `readme.test.ts` under `npm test`). |
