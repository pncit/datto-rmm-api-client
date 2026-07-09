## architect — round 2

In-progress review of Phase 3 (error hierarchy, injectable UDF-masking logger, config). I read my
`architect-r1` turn and the reviser's `reviser-r1`/`reviser-r2` dispositions. All three of my r1
findings were dispositioned `Fixed`; I re-verified each against the current source and ratify all
three (→ `Closed`):

- **architect-r1-f1** (`scrub` over-recursion) — `scrub` (`src/logging/mask.ts:55-63`) now recurses
  only into arrays and plain objects via `isPlainObject`; `Date`/`Error`/`Map`/class instances are
  returned unchanged. Regression test present. Ratified.
- **architect-r1-f2** (`@/` alias) — `src/client/datto-client-config.ts:3-4` now uses relative
  imports (`../defaults`, `../logging/logger`), matching every other `src/` module. Ratified.
- **architect-r1-f3** (`this`-loss in `wrap`) — `withUdfMasking` now calls
  `logger[method](message, …)` through the receiver, preserving `this`. Ratified.

I also re-verified the runtime claim I relied on in r1 (that `dattoLoggerSchema`, a `z.function`-based
schema, actually rejects missing/non-function methods on `zod@4.4.3`): `tests/unit/logging/logger.test.ts`
exercises accept / missing-method / non-function-method / `consoleLogger` cases directly, so that
boundary is adequately covered.

Two **new** findings, both concerning the same single mandatory logging boundary. They are a direct
consequence of ratifying r1-f1: narrowing `scrub`'s recursion (correct) left the *rest* of the
"never throws" / "no leak" contract that this phase established for the boundary only partially
honored.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | Boundaries | `src/logging/mask.ts:55-63` | — | ratified: `scrub` recurses only into arrays + plain objects (`isPlainObject`); non-plain objects returned intact; regression test present. |
| architect-r1-f2 | Medium | Closed | Boundaries | `src/client/datto-client-config.ts:3-4` | — | ratified: both imports now relative; no `@/` alias remains in `src/`. |
| architect-r1-f3 | Low | Closed | Boundaries | `src/logging/mask.ts:97-108` | — | ratified: `wrap` invokes `logger[method](…)` through the receiver; `this` preserved; regression test present. |
| architect-r2-f1 | Medium | Open | Boundaries | `src/logging/mask.ts:55-83` (`scrub` / `scrubMeta`) | `scrub`/`scrubMeta` recurse into every nested plain object and array with **no cycle guard and no depth bound**. A circular *non-UDF* plain object in `meta` (e.g. `logger.info("x", { req })` where `req` has a self- or parent/child back-reference — a routine logging shape) drives `scrubMeta → scrub → scrubMeta → …` until the call stack overflows and a `RangeError` is thrown, crashing the log call. This is the *same* mandatory boundary whose "never throws" property the team deliberately established this phase (`implementation-auditor-r1-f1` made `mask()` total precisely so "the logging boundary always produces a placeholder instead of crashing the log call"), and the reviser explicitly conceded that `meta` is "caller-supplied and not constrained to JSON-parsed wire values." That totality guarantee was only wired into `mask()` (the UDF-key path); the `scrub` recursion path that all *non*-UDF structure flows through has no such protection, so the boundary still crashes on realistic caller input. Note `mask()`'s own `try/catch` does **not** help here — the throw happens in `scrub`'s recursion before any UDF key is reached. | Add a cycle/visited guard to the recursion: thread a `WeakSet<object>` through `scrub`/`scrubMeta`, and when an already-seen object is re-encountered return a sentinel (e.g. `"[circular]"`) instead of recursing; optionally cap depth as a backstop. Add a regression test asserting `withUdfMasking(...).info("m", { req })` with a self-referential non-UDF plain object does not throw. |
| architect-r2-f2 | Low | Open | Security | `src/logging/mask.ts:85-96` (`withUdfMasking` docstring) | The boundary docstring asserts an absolute invariant — "so no call site — current or future — can leak an unmasked UDF value." After ratifying r1-f1 that claim is no longer true: any UDF value embedded inside a **non-plain** object placed in `meta` (a `Date`, `Map`, or — most relevantly — an `Error`/`DattoApiError` instance) is now returned by `scrub` *unmasked*, because `scrub` intentionally passes non-plain objects through untouched. This directly interacts with this same phase's `DattoApiError` (`src/errors/datto-api-error.ts:135`), which stores the raw wire body in `response: unknown`; logging a caught error as `meta: { err }` is the single most common structured-logging pattern, and if that raw body ever carries a `udf<N>` value it now reaches the sink in cleartext. This is the boundary future phases (4–8) copy, so an over-strong invariant comment risks a real leak by giving implementers false assurance. (I am not asking to re-mask Error contents — r1-f1's pass-through is correct; the fix is to state the boundary's true coverage.) | Correct the docstring to scope the guarantee accurately: masking covers UDF values carried as plain-object/array structure directly in `meta`; values embedded inside non-plain objects (`Error`, `Date`, `Map`, class instances) pass through unmasked, so call sites must not place raw wire payloads (e.g. a `DattoApiError.response`) into `meta` under the assumption they will be scrubbed. |
