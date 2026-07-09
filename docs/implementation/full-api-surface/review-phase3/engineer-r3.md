## engineer — round 3

In-progress review, round 3. All three of my findings were ratified `Closed` in round 2 and
carry forward unchanged; I re-verified each against the current source and confirmed the
round-3 reviser edits (a cycle-detection guard added to `src/logging/mask.ts` for
`architect-r2-f1`, plus doc/`wrap`-arity changes for `architect-r2-f2` / `project-lead-r2-f1`)
introduce no new engineer-category regressions.

Re-verification:

- **engineer-r1-f1** (scrub over-recursion) — still fixed. `scrub` (`src/logging/mask.ts:69-93`)
  recurses only into arrays and `isPlainObject` plain objects; `Date`/`Error`/`Map`/class
  instances still pass through by reference. The new `seen: Set<object>` cycle guard is added
  and removed around each array/plain-object frame (`add` on entry, `delete` in a `finally`),
  so a shared-but-acyclic reference is still fully walked and only a true ancestor cycle
  short-circuits to `CIRCULAR_PLACEHOLDER`. The pass-through property is unaffected. Stays
  **Closed**.
- **engineer-r1-f2** (duplicated candidate-key scan) — still fixed. `firstNonEmptyString`
  (`src/errors/datto-api-error.ts:64-75`) remains the single scan, called by both
  `extractErrorMessage` (`ERROR_MESSAGE_KEYS`) and `extractRequestId` (`REQUEST_ID_HEADERS`);
  no re-duplication. Stays **Closed**.
- **engineer-r1-f3** (empty/`null` body → `""`/`"null"` message) — still fixed.
  `extractErrorMessage` (`datto-api-error.ts:84-108`) returns `fallbackMessage` for
  `responseData == null` and for empty/whitespace-only string bodies; regression tests intact.
  Stays **Closed**.

No new findings. The round-3 `mask.ts` cycle guard is correctly scoped (top-level self-reference
via `scrubMeta` → `scrubEntries` → `scrub` is caught once `meta` re-enters `scrub` and is found
in `seen`; the DAG-preservation via `finally`-`delete` is sound), well-documented, and named with
a shared `CIRCULAR_PLACEHOLDER` constant — no magic value, no dead code, naming and complexity are
fine. The untouched Phase-3 files (`base-error.ts`, `datto-validation-error.ts`, `logger.ts`,
`datto-client-config.ts`, `defaults.ts`, `errors/index.ts`) remain clean per rounds 1–2.
Converged.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Logging | `src/logging/mask.ts` | Over-recursion in `scrub` corrupted non-plain objects (`Error`/`Date`/class instances) under non-UDF `meta` keys. | Fixed in round 2 (recursion gated behind `isPlainObject`; non-plain objects pass through); round-3 cycle guard preserves that behavior. Re-verified against current source — ratified, stays Closed. |
| engineer-r1-f2 | Low | Closed | DRY | `src/errors/datto-api-error.ts` | `extractErrorMessage`'s inner loop and `extractRequestId` duplicated the same ordered-candidate-key string scan. | Fixed in round 2 via `firstNonEmptyString(record, keys)`, called by both. Still the single scan in current source — ratified, stays Closed. |
| engineer-r1-f3 | Low | Closed | ErrorHandling | `src/errors/datto-api-error.ts` | Empty-string body returned `""` and `null` body returned literal `"null"` as the error message, discarding the axios fallback. | Fixed in round 2 (`responseData == null` and empty/whitespace-only strings fall back to `fallbackMessage`); regression tests intact — ratified, stays Closed. |
