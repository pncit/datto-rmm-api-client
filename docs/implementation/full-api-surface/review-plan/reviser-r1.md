## reviser — round 1

Disposition of the round-1 PlanAuditor `Open` findings against `full-api-surface/plan.md`.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| plan-auditor-r1-f1 | Fixed | Renamed the ported `BaseResource` HTTP primitives to `httpGet`/`httpPost`/`httpPatch`/`httpDelete` in Phase 6 Step 1 (and the Phase 6 Goal line), added an explicit rule that resource classes call only the `http*` primitives, and rewrote the Phase 7 `DeviceResource` example to call `this.httpGet`/`this.httpPost` — eliminating the TS2416 shadow + infinite-recursion trap so a public `devices.get(uid)` is safe. |
| plan-auditor-r1-f2 | Fixed | Removed `R10` from Phase 3's `**Requirements:**` line; R10 (OAuth password grant + token lifecycle) remains claimed and delivered solely by Phase 5's `auth-manager.ts`/`token-store.ts` steps. |
| plan-auditor-r1-f3 | Fixed | Folded the prose-only assertions into the fenced Exit Gate blocks as commands that fail non-zero: Phase 1 (`test ! -f jest.config.js`, `! grep -qE '"(jest|ts-jest|@types/jest)"' package.json`, config-file existence, `npx orval --help`); Phase 8 (`! git grep -qn "Result<" -- src/`, `! git grep -qn "validationMode" -- src/`, a loop asserting each deleted old-surface file is gone, `test ! -d src/internal`). Phase 9's "exits non-zero on a planted secret" is already enforced by `scan-secrets.test.ts` running under the fenced `npm test`; clarified the bullet to state that. |
| plan-auditor-r1-f4 | Fixed | Pinned `tokenRefreshPct` default at `25` in Phase 5 Step 4, exported as `DEFAULT_TOKEN_REFRESH_PCT`, and rewrote the auth-manager test to assert refresh fires below the pinned 25% threshold and not above — refresh timing is now deterministic. |
| plan-auditor-r1-f5 | Fixed | Rewrote Phase 8's `coverage-map.test.ts` to derive the authoritative inventory from the committed `spec/openapi.json` (every `paths[path][method]`) and assert a maintained `client.<ns>.<method>`→`{method,path}` map covers each spec operation exactly once, replacing the bare-count check that could not catch a duplicate-plus-omission. |
| plan-auditor-r1-f6 | Fixed | Rewrote the Phase 3 `mask.ts` example and its prose so any non-null value under a `udf*` key is redacted regardless of wire type (string, number, object, array) using `String(v)`/`JSON.stringify(v)` length, never passed through or recursed into; extended the mask test with a nested-object udf (`udf9`) asserting the sink never sees `'BitLockerRecoveryKey'`. |
| plan-auditor-r1-f7 | Fixed | Aligned `@types/node` to `^26` (matching `fuze-api`) in Phase 1 Step 1, restoring the single-toolchain rationale. |

All seven `Open` findings are resolved by plan edits; no escalations. A self-review pass propagated the f1 rename to the Phase 6 Goal line and confirmed no remaining `this.get`/primitive-name collisions elsewhere in the plan.
