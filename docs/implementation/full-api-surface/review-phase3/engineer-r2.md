## engineer — round 2

In-progress review. Re-verified my three round-1 findings against the reviser-r2 dispositions
(all marked `Fixed`) by reading the current source and the new regression tests:

- **engineer-r1-f1** (scrub over-recursion) — `src/logging/mask.ts` now gates recursion behind
  `isPlainObject` (proto is `Object.prototype` or `null`); `scrub` recurses only into arrays and
  plain objects, returning `Date`/`Error`/`Map`/class instances unchanged. `withUdfMasking.wrap`
  crosses the boundary through the typed `scrubMeta(meta)`. New test
  (`tests/unit/logging/mask.test.ts:102-116`) asserts a `Date` and an `Error` under a non-UDF key
  reach the sink by reference with `Error#message` intact, while a sibling `udf1` is still masked.
  Fix ratified → **Closed**.
- **engineer-r1-f2** (duplicated candidate-key scan) — `firstNonEmptyString(record, keys)` is
  extracted in `src/errors/datto-api-error.ts:64-75` and called by both `extractErrorMessage`
  (over `ERROR_MESSAGE_KEYS`) and `extractRequestId` (over `REQUEST_ID_HEADERS`); the two inline
  loops are gone. Fix ratified → **Closed**.
- **engineer-r1-f3** (empty/null body yields `""`/`"null"` message) — `extractErrorMessage`
  (`datto-api-error.ts:84-108`) now returns `fallbackMessage` for `responseData == null` and for an
  empty/whitespace-only string body. Three regression tests
  (`tests/unit/errors/datto-api-error.test.ts:121-152`) cover `null`, `""`, and `"   "`, each
  asserting the axios fallback message survives. Fix ratified → **Closed**.

No new engineer-category issues. The fixes did not introduce regressions, and the untouched Phase-3
files (`base-error.ts`, `datto-validation-error.ts`, `logger.ts`, `datto-client-config.ts`,
`defaults.ts`, `errors/index.ts`) remain clean per round 1. Converged.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Logging | `src/logging/mask.ts` | Over-recursion in `scrub` corrupted non-plain objects (`Error`/`Date`/class instances) under non-UDF `meta` keys. | Fixed: recursion gated behind `isPlainObject`; non-plain objects pass through unchanged; regression test at `tests/unit/logging/mask.test.ts:102-116`. Ratified. |
| engineer-r1-f2 | Low | Closed | DRY | `src/errors/datto-api-error.ts` | `extractErrorMessage`'s inner loop and `extractRequestId` duplicated the same ordered-candidate-key string scan. | Fixed: extracted `firstNonEmptyString(record, keys)`, called by both. Ratified. |
| engineer-r1-f3 | Low | Closed | ErrorHandling | `src/errors/datto-api-error.ts` | Empty-string body returned `""` and `null` body returned literal `"null"` as the error message, discarding the axios fallback. | Fixed: `responseData == null` and empty/whitespace-only strings now fall back to `fallbackMessage`; regression tests at `tests/unit/errors/datto-api-error.test.ts:121-152`. Ratified. |
