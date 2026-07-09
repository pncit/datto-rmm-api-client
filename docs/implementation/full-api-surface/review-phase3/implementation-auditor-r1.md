## implementation-auditor — round 1

Phase 3 scope: port the `fuze-api` throwing error hierarchy (`Datto*`), the injectable
zod-validated `DattoLogger` + UDF-masking decorator (R20), the new `DattoRmmClientConfig`
schema (R14), and the layer-neutral `src/defaults.ts` — all under new paths, old surface
untouched (coexistence rule). Reviewed the working-tree diff (all-new untracked files under
`src/errors/`, `src/logging/`, `src/client/`, `src/defaults.ts`, `tests/unit/`), cross-checked
each ported module against its `fuze-api` original, and verified zod 4.4.3 runtime behavior for
the load-bearing `z.function` logger schema and the masker's edge inputs.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Error hierarchy (`base-error`, `datto-api-error`, `datto-validation-error`, `index`) | ✅ Implemented | Pinned `DattoApiError` opts bag (`statusCode` required, `retryAfterMs`/`code`/`cause` optional) + `fromAxiosError`; pinned `DattoValidationError(zodError, stage, opts?)` + `getErrorTree`; barrel re-exports + `isDattoApiError`/`isDattoValidationError` guards. Faithful to fuze originals with justified renames. |
| 2. Logger (`logging/logger.ts`) | ✅ Implemented | `DattoLogger` type, `dattoLoggerSchema` (verified rejects missing/non-function methods on zod 4.4.3), `consoleLogger = console`. Mirrors `fuzeLoggerSchema`. |
| 3. UDF-masking decorator (`logging/mask.ts`) | ✅ Implemented | `withUdfMasking` deep-scrubs `meta`, redacts every non-null `udf\d+` value at any depth incl. arrays/nested `udf` record, regardless of wire type; `null`/non-UDF preserved. Message string never scrubbed — documented invariant carried into JSDoc. |
| 4. Config (`client/datto-client-config.ts` + `defaults.ts`) | ✅ Implemented | `z.strictObject` with exactly the pinned field set; `retry`/`rateLimit` strict sub-objects; retired knobs rejected by `.strict`; `defaults.ts` exports `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT`/`MAX_RETRY_AFTER_MS`, layer-neutral with the cycle-breaking rationale documented. |
| Tests | ✅ Implemented | Every plan-named test present (errors instanceof + `fromAxiosError` mapping; mask named R20 fixture + sink-never-saw-secret assertion; logger accept/reject; config accept + each rejection case incl. `defaultWriteLimit` anti-pattern). |

### Drift Report
**Out-of-scope changes:** None. `git status` shows only new untracked paths under the Phase-3
directories plus the orchestrator's `pipeline-run.json` (metadata, not implementation). No tracked
old-surface file modified — coexistence rule honored.
**Acceptable Phase 3 necessities:**
- New code imports `from "zod"` (not the old surface's `zod/v4`), aligning with the Phase-2
  generated schemas (`from 'zod'`); no cross-boundary mixing in this phase — correct forward-looking choice.
- `isDattoApiError`/`isDattoValidationError` and `extractErrorMessage` inlined into the four
  named error files rather than a fifth `error-utils.ts` — faithful to fuze's intent within the
  plan's closed file list; reasonable.
- `BaseError.cause` widened `Error`→`unknown` to satisfy the pinned `DattoApiError(cause?: unknown)`
  signature; matches native `ErrorOptions.cause` and is behavior-preserving — correct, not a workaround.

### Notes on faithful ports / non-defects (verified, no action needed)
- `fromAxiosError` deliberately leaves `retryAfterMs`/`code` unset (Phase 5 owns 429/403
  disambiguation, per plan Step 1 "disambiguated in Phase 5" and the Phase 5 direct-construction
  sketch). The "stores every constructor option" test covers preservation via direct construction.
  Consistent with the plan; not raised.
- `requestId` candidate-header list is a documented best-effort answer to a genuine spec gap (no
  declared response headers); degrades to `undefined`. Live verification is already Deferred
  Validation in the design; not raised.
- `retry`/`tokenRefreshPct` carry no `.default()` — the plan's literal zod snippets have none and
  Phase 5 applies `?? DEFAULT_*`; the implementor's reading of literal-over-prose is sound.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | BestPractices | `src/logging/mask.ts:11-14` (`mask`) | `withUdfMasking` is billed as the *mandatory single logging boundary* through which all client logging flows, yet `mask()` can **throw** on inputs a caller could legitimately place under a `udf\d+` key: `JSON.stringify` throws a `TypeError` on a `bigint` or a circular object, and returns `undefined` (→ `undefined.length` throws) on a `symbol`/`function`. Verified against zod-free runtime: `10n`, `Symbol()`, `()=>{}`, and a self-referential object all throw. Deviation §5.2 removed the plan sketch's `?? String(v)` fallback on the claim `mask()` "is only ever called with a JSON-parsed wire value" — but `withUdfMasking` accepts an arbitrary `Record<string, unknown>` `meta` from any call site; nothing constrains it to wire-derived JSON, so the "no call site can leak / by construction" guarantee is undercut by a boundary that can crash the log call (and thus the operation being logged) instead of masking. | Make the boundary total: wrap `mask()` in a `try/catch` (and/or restore a `String(v)`/typeof-based fallback) so a non-serializable value under a UDF key still yields a safe `[redacted …]` placeholder rather than throwing. A masker that can throw is worse than one that over-redacts. |
