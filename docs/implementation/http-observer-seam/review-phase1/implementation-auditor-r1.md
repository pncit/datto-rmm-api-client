## implementation-auditor — round 1

Phase 1 scope: the five axios-free public types + shape-only schema (`src/http/http-observer.ts`),
strict-config acceptance of `httpObserver` (`src/client/datto-client-config.ts`), the public barrel
export (`src/index.ts`), the per-attempt stash augmentation (`src/http/axios-augment.d.ts`), and the
internal helper module (`src/http/observer.ts`) with its unit tests. No transport instrumentation
fires yet (Phases 2–4).

All five steps are present and every exit-gate grep passes (verified independently):
`dist/index.d.ts` contains `DattoHttpObserver`, has no `declare module`, `src/http/http-observer.ts`
is axios-free (`from 'axios'` and `\bAxios[A-Z]` both empty), `observer.ts` is not re-exported from
`index.ts`, and `ObserverCapture`/`__dattoObserverCapture` do not leak into `dist`. The helper
primitives, the stash augmentation, and the export list all match the plan.

The one substantive problem is the callback schema. The plan's Assumption (plan line 9) that
"`z.function` shape-only validation keeps the callbacks pass-through (invocable, un-wrapped) after
`safeParse`, exactly as the logger" is **empirically false** in zod 4.4.3: `z.function({ input,
output: z.void() })` returns a *validating proxy*, not the consumer's function, and it validates the
return value at call time. Because `DattoRmmClient` threads `validated.httpObserver` (the parsed,
wrapped callbacks) into the transport (per Phases 2/3), this breaks R7 — a Phase 1 requirement — and
the raw pass-through intent. Details in f1 (with the two supporting test-quality findings f2/f3).

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1 — public types + shape-only schema (`http-observer.ts`) | ⚠️ Partial | Types correct and axios-free; the schema's `z.function`/`output: z.void()` construction is defective (f1). |
| 2 — `httpObserver` on strict config schema | ✅ Implemented | `.optional().describe(...)` added; raw/unmasked noted; top-level strict rejection preserved. |
| 3 — export five types from `src/index.ts` | ✅ Implemented | Present in `dist/index.d.ts`; surface-pin extended. |
| 4 — `__dattoObserverCapture` stash on both request-config interfaces | ✅ Implemented | Type-only import from `./observer`; augment stays out of `dist`. |
| 5 — internal `observer.ts` helper (7 primitives) | ✅ Implemented | `ObserverCapture`, `normalizeHeaders`, `captureRequest`, `invokeObserver`, `fireRequest`, `fireResponse`, `fireError` all present and match pinned signatures. |
| Tests — `observer.test.ts` / config extension / surface-pin | ⚠️ Partial | Cover the listed cases, but the R7 async-rejection test bypasses the schema and so masks f1 (f2); config round-trip under-asserts raw delivery (f3). |

### Drift Report
**Out-of-scope changes:** None. No Phase 2/3/4 wiring leaked in; no unrelated refactors. The
config-test file name deviation (`config.test.ts` vs the plan's `datto-client-config.test.ts`) is a
correct adaptation to the repo's actual layout, documented in the notes.
**Acceptable Phase 1 necessities:** The `axios-augment.d.ts` doc-comment update describing the new
stash field; the `.describe(...)` text on the config field.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | High | Open | PlanAdherence | `src/http/http-observer.ts:108-122` (`observerCallbackSchema` / `dattoHttpObserverSchema`) | `z.function({ input: [z.any()], output: z.void() })` in zod 4.4.3 does **not** validate shape-only pass-through — it replaces each supplied callback with a validating proxy (`parse` output is not identity-equal to the consumer's function — verified) that validates the return value against `void` at invocation. Consequences, all reachable once `DattoRmmClient` threads `validated.httpObserver` (the parsed/wrapped callbacks) into the transport per Phases 2/3: (1) any callback returning a non-`undefined` value — the idiomatic `onRequest: (e) => buffer.push(e)` returns a number — throws a synchronous `$ZodError`, which `invokeObserver` catches and mis-reports as `"…callback threw; ignored"` once per HTTP attempt, even though the callback worked; (2) an `async` (or otherwise thenable-returning) callback throws `$ZodError` **synchronously** at the wrapper before returning the promise, so `invokeObserver` never receives the thenable to attach its `.then(undefined, …)` handler — a rejecting async callback therefore escapes as an **unhandled rejection** (verified: `UNHANDLED REJECTION: Error: async boom`). This defeats R7 (a Phase 1 requirement: "a rejection from an accidentally-async callback … never leak an unhandled rejection") and the raw pass-through intent (the delivered callback is a proxy, not the consumer's function). Note the static type `onRequest?(e): void` *permits* returning a value under TS's void-return rule, so type-checking consumer code fails at runtime. The plan's Assumption (plan line 9) that this mirrors the logger "un-wrapped" is factually wrong. | Validate function-shape **without** wrapping or return-validation so the consumer's original function reference is delivered and any return value / async rejection is tolerated — e.g. per callback `z.custom<DattoHttpObserver["onRequest"]>((v) => v === undefined \|\| typeof v === "function")`, or otherwise guarantee the transport invokes the un-wrapped callbacks. Because the plan explicitly mandated mirroring `dattoLoggerSchema`'s `z.function` form and that form is incompatible with R7's accidentally-async tolerance, this likely warrants a Requirements-Gap escalation to the planner. |
| implementation-auditor-r1-f2 | Medium | Open | Tests | `tests/unit/http/observer.test.ts:146-165` | The R7 regression test ("swallows a returned rejected promise … no unhandled rejection") constructs a raw async `fn` and passes it straight to `invokeObserver`, bypassing `dattoHttpObserverSchema.parse`. It therefore exercises a path that never occurs in the wired client (which invokes the schema-parsed, wrapped callback) and gives false confidence that R7 holds — masking f1. | Add a test that obtains the callback **through** `dattoHttpObserverSchema` (or `dattoRmmClientConfigSchema`) — an `async`/rejecting callback and a value-returning callback — then invokes it via `invokeObserver` and asserts no unhandled rejection and no spurious `warn`. This test should fail today and pass once f1 is fixed, guarding the requirement on the real path. |
| implementation-auditor-r1-f3 | Low | Open | Tests | `tests/unit/client/config.test.ts` (the "still invocable after parsing" case, asserting `expect(received).toEqual([rawEvent])`) | R9's raw-delivery guarantee is about **identity** pass-through of the event object, but the test asserts structural equality (`toEqual`), which would still pass if the schema cloned/transformed the argument. The notes claim "identity-equal" but the assertion does not check it. | Assert identity: `expect(received[0]).toBe(rawEvent)` (or `expect(received).toContain(rawEvent)`), so the test actually pins that parsing does not clone or redact the delivered payload. |
