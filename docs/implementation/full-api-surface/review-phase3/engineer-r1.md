## engineer — round 1

First engineer round on Phase 3 (error hierarchy, injectable UDF-masking logger, config schema,
layer-neutral defaults). No prior `engineer` turn in this review dir; the existing
`implementation-auditor`/`reviser` turns cover a single masker-throws finding (r1-f1) already
closed. Scoped via `git diff main` to the new Phase-3 files: `src/errors/*`, `src/logging/*`,
`src/client/datto-client-config.ts`, `src/defaults.ts`, and their tests. Cross-checked the ported
`extractErrorMessage` against `../fuze-api/src/errors/error-utils.ts`.

Overall the phase is small, well-documented, and faithful to the plan's pinned signatures. Three
maintainability/quality findings below; the code is otherwise clean (no dead exports — the
sub-schemas are module-private, `DEFAULT_*` unconsumed-until-Phase-5 is expected sequencing, not a
leftover; naming and complexity are fine; no magic values beyond the single named `[redacted]`
placeholder).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | Logging | `src/logging/mask.ts:40-57` (`scrub`) | `scrub` recurses into **every** object (`value !== null && typeof value === "object"`) and rebuilds it from `Object.entries`, discarding the prototype and all non-enumerable properties. Any non-plain object placed under a non-UDF `meta` key is silently corrupted: an `Error` becomes `{}` (its `message`/`stack`/`name` are non-enumerable), a `Date` becomes `{}`, a `Map`/class instance loses its content. Because `withUdfMasking` is the mandatory single boundary for *all* client logging, this quietly destroys diagnostic context — e.g. a future call site logging `logger.error("grant failed", { err })` or `{ since: new Date() }` reaches the sink as `{ err: {} }`. No test exercises a non-plain object in `meta`, so the corruption is currently invisible. | Restrict recursion to plain objects and arrays only (e.g. recurse when `Array.isArray(value)` or `Object.getPrototypeOf(value) === Object.prototype \|\| === null`); pass all other objects through unchanged. Wire-derived UDF structures are always plain JSON objects, so the R20 guarantee is preserved while `Error`/`Date`/class instances survive to the sink. Add a test asserting an `Error` (and a `Date`) under a non-UDF key reaches the sink intact. |
| engineer-r1-f2 | Low | Open | DRY | `src/errors/datto-api-error.ts:73-80, 97-102` | `extractErrorMessage`'s inner loop and `extractRequestId` are the same "iterate an ordered candidate-key `as const` list, return the first `typeof value === "string" && value.length > 0`" scan, duplicated. This duplication is new to the Datto port (`extractRequestId` has no fuze-api counterpart; fuze factored the message loop into its own `extractMessageFromObject` helper — that factoring was dropped and then re-duplicated here). | Extract a shared `firstNonEmptyString(record: Record<string, unknown>, keys: readonly string[]): string \| undefined` helper and call it from both `extractErrorMessage` (over `ERROR_MESSAGE_KEYS`) and `extractRequestId` (over `REQUEST_ID_HEADERS`). |
| engineer-r1-f3 | Low | Open | ErrorHandling | `src/errors/datto-api-error.ts:61-87` (`extractErrorMessage`) | Only `responseData === undefined` falls back to `fallbackMessage` (the axios `err.message`). An **empty-string** body returns `""` (the `typeof === "string"` branch returns it verbatim → `DattoApiError.message` is empty, discarding axios's descriptive message), and a **`null`** body falls through to `JSON.stringify(null)` → the literal message `"null"`. Both are unhelpful for a transport/5xx error with an empty or null body. This is a faithful port of fuze-api's behavior, but still yields a misleading/empty error message. | Treat empty-string and `null` bodies like `undefined`: return `fallbackMessage` when `responseData == null` or is an empty/whitespace-only string, so the axios message (e.g. `"Request failed with status code 500"`) is preserved instead of being replaced by `""` or `"null"`. |
