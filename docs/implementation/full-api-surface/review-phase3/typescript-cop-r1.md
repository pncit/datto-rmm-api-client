## typescript-cop — round 1

Scoped to `git diff main` for Phase 3's new paths: `src/errors/**`, `src/logging/**`,
`src/client/datto-client-config.ts`, `src/defaults.ts`, and their `tests/unit/**` counterparts.
Cross-checked each ported module against its `../fuze-api` original (`base-error.ts`,
`fuze-api-error.ts`, `fuze-validation-error.ts`, `error-utils.ts`, `fuze-client-config.ts`) to
isolate genuine deviations from faithful ports. Verified two compile-time assignability questions
empirically via `tsc --noEmit` on scratch files (not run as part of the project's test/build
pipeline): (1) a value typed `DattoLogger` is assignable to `DattoRmmClientConfig['logger']` —
compiles clean, no public-type mismatch between the hand-written `DattoLogger` type and the
zod-inferred config field; (2) an array literal is rejected at the `meta?: Record<string, unknown>`
parameter position — confirms the boundary is closed against the one case that would make the
finding below more than a precision nitpick.

No boundary-validation defects, unsafe external-input handling, exhaustiveness gaps, or
floating-promise issues in this phase's diff — the error hierarchy, config schema, and logger
schema are strict, correctly typed, and match their pinned plan signatures. One minor internal
type-precision issue in the masking decorator.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Low | Open | TypeHole | `src/logging/mask.ts:74-76` (`withUdfMasking`'s `wrap`) | `scrub(meta) as Record<string, unknown>` casts away `scrub`'s declared `unknown` return type. The cast is safe today only because every call site happens to pass a non-array object (enforced structurally by `DattoLogger`'s `meta?: Record<string, unknown>` parameter type, verified — an array literal is rejected there), a fact the cast itself does nothing to preserve: `scrub`'s signature (`(value: unknown): unknown`) gives no static guarantee its return matches the assertion, so a future edit to `scrub` (e.g. changing what the array branch returns, or reordering checks) could silently invalidate the cast with no compiler error at this call site. | Replace the cast with a properly-typed entry point, e.g. add `function scrubMeta(meta: Record<string, unknown>): Record<string, unknown> { … }` (the same object-branch logic currently inlined in `scrub`'s `typeof value === "object"` case) and have `wrap` call `scrubMeta(meta)` directly — `scrub` stays `unknown → unknown` for its own recursive calls, but the boundary `wrap` actually crosses is asserted correct by a real return type, not a cast. |
