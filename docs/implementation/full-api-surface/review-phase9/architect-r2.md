## architect — round 2

In-progress review. Both round-1 architect findings were dispositioned `Fixed` by `reviser-r2`; I
re-verified each against the source rather than the reviser's digest, and add no new findings —
consistent with round-2 convergence. No other reviewer's `Open` findings are mine to carry.

Re-verification detail:

- **architect-r1-f1 (UDF-key single-source-of-truth).** Ratified. The three definitions are now
  each an exported, cross-referenced constant — `UDF_KEY` (`src/logging/mask.ts:15`),
  `UDF_KEY_PATTERN` (`src/schema-overrides/device-overrides.ts:28`, re-exported from
  `src/schema-overrides/index.ts:18`), and `SECRET_KEY_PATTERNS`
  (`scripts/sanitize-fixtures.mjs:55`) — with doc comments at all three sites naming the lockstep
  requirement and the test. `tests/unit/security/udf-key-pattern-consistency.test.ts` imports all
  three and asserts they agree across a representative key set (positive `udf1…udf300`, boundary
  `udf0`, and negatives `uid`/`udfDescription`/`UDF1`/`udf-1`/`udf1a`/`""`), plus a non-vacuity
  guard. All three regexes are `/^udf\d+$/` with no `g` flag, so the `.test()` calls the assertion
  relies on are not stateful — the comparison is sound. This mechanically fails the build on any
  future divergence between the at-rest, in-log, and schema-shape controls, which is exactly the
  split-brain the finding named. Neither newly-exported symbol reaches the package's public
  surface: `src/index.ts` re-exports only the client, config/logger types, the errors block, and
  the curated `./public-types`, none of which pulls in `mask`, `schema-overrides`, or the
  `.mjs` — so no PublicAPI regression was introduced by the fix. **Closed.**

- **architect-r1-f2 (no mechanical guard against committing a raw capture).** Ratified.
  `.gitignore:163` adds `*raw-sweep.json` (slash-free pattern → matches at any depth) with a
  comment explaining the R17 risk it guards, and the sanitizer header
  (`scripts/sanitize-fixtures.mjs:25-27`) documents the `raw-sweep.json`-suffix convention and that
  `.gitignore` now enforces it. The pattern does not over-match the sanitized output
  (`sanitized-sweep.json`), so committed fixtures are unaffected. An unsanitized capture named per
  the documented convention can no longer be accidentally staged. **Closed.**

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | Security | scripts/sanitize-fixtures.mjs:55; src/logging/mask.ts:15; src/schema-overrides/device-overrides.ts:28; tests/unit/security/udf-key-pattern-consistency.test.ts | Ratified. The three "what is a UDF key" definitions are now exported, cross-referenced constants pinned in lockstep by a dedicated consistency test (representative-set equivalence + non-vacuity guard); no `g`-flag statefulness in the compared regexes; neither exported symbol leaks into the package public surface (`src/index.ts` unchanged). Single-source-of-truth invariant now fails the build on divergence. | No further action. |
| architect-r1-f2 | Low | Closed | Security | .gitignore:163; scripts/sanitize-fixtures.mjs:25-27 | Ratified. `*raw-sweep.json` ignore rule (any depth) plus the documented naming convention in the sanitizer header provide the mechanical at-rest guard the finding requested, without over-matching sanitized fixtures. | No further action. |
