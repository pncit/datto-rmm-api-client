## project-lead — round 2

Round 1 raised no findings of my own, so there is nothing of mine to reconcile. Re-scoped via
`git diff main...HEAD` to the Phase 3 paths (`src/errors/**`, `src/logging/**`,
`src/client/datto-client-config.ts`, `src/defaults.ts`, their tests) and read the intervening
turns (`architect-r1`, `engineer-r1`, `typescript-cop-r1`, `implementation-auditor-r1`/`r2`,
`reviser-r1`/`r2`). Spot-checked their disposed findings against the current source
(`mask.ts`'s `isPlainObject`/`scrubMeta`/receiver-preserving `wrap`, `datto-client-config.ts`'s
relative imports, `datto-api-error.ts`'s `firstNonEmptyString` + null/empty-body fallback) — all
consistent with "Fixed"/"ratified," nothing to add there. Requirements coverage (R9, R13, R20 Fully
Met; R14 Partially Met by design, deferred to Phase 5) is unchanged from round 1.

Looked for issues in the reviewers' own remit (delivery correctness, requirements, risk/rollout)
that their code-quality/type/architecture passes wouldn't necessarily flag, and found one:
the mandatory UDF-masking boundary changes the default console-backed logger's actual output for
every log call that omits `meta`, which is a real behavior-vs-intent gap in R13's shipped default,
not just a style nit.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r2-f1 | High | Open | BehaviorIntent | `src/logging/mask.ts:97-109` (`withUdfMasking`'s `wrap`) | `wrap`'s returned function always forwards two positional arguments — `logger[method](message, meta ? scrubMeta(meta) : meta)` — regardless of whether the original call supplied `meta`. When the caller omits `meta` (the plan's own `tests/unit/logging/mask.test.ts` "passes calls through unchanged when no meta is supplied" case), this still calls `logger[method](message, undefined)` — an explicit second argument, not an omitted one. `withUdfMasking` is the client's mandatory single logging boundary (design: "the client constructs `withUdfMasking(config.logger ?? consoleLogger)` once… so no call site can leak a raw UDF value"), and R13's default is the raw `console` object (`consoleLogger: DattoLogger = console`). `console.info`/`.warn`/etc. are variadic and print every argument they actually receive — `console.info("x", undefined)` prints `x undefined`, while `console.info("x")` prints `x` (standard, well-documented Node/V8 `console` behavior; confirmed by reading the `wrap` implementation against `Console`'s formatting semantics, not by executing this codebase). Because every log call — current or future — is forced through this boundary, **every plain-text log line without `meta` will show a spurious trailing "undefined" in the shipped default logger**, degrading the very "console-backed implementation" R13 requires as the out-of-box experience. No test exercises the actual `consoleLogger` through `withUdfMasking` (`mask.test.ts` only asserts against a `vi.fn()` sink, which doesn't observe this argument-count effect), so the defect is invisible to the current suite. | Only forward a second argument when the caller actually supplied one, e.g. `meta === undefined ? logger[method](message) : logger[method](message, scrubMeta(meta))` (or spread: `logger[method](message, ...(meta === undefined ? [] : [scrubMeta(meta)]))`), so a call made with one argument still reaches the underlying logger — and by extension `console` — with one argument. Add a regression test that wraps the real `consoleLogger` (or a spy asserting `arguments.length`/call-arg-count, not just call-arg-value) and confirms a no-`meta` call is forwarded as a single argument. |
