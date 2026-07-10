## engineer — round 1

First engineer review of Phase 1 (public observer types, config-schema field, and the internal
`observer.ts` helper). Scope is `git diff main`: `src/http/http-observer.ts`, `src/http/observer.ts`,
`src/http/axios-augment.d.ts`, `src/client/datto-client-config.ts`, `src/index.ts`,
`tests/generated/surface-pin.ts`, `tests/unit/http/observer.test.ts`, `tests/unit/client/config.test.ts`.

The prior review dir holds no `engineer` turn — this is my origin round — but it does carry an
`implementation-auditor-r1` review whose findings (f1/f2/f3, the wrapping-`z.function` schema defect)
were triaged `Remediate` and marked `Fixed` by `reviser-r1`. I re-verified the current source: the
schema is now the non-wrapping `z.custom<(event: never) => unknown>((value) => typeof value === "function")`
(`http-observer.ts:120-122`), the R7 schema-parsed regression tests exist
(`observer.test.ts:188-252`), and the config round-trip now asserts identity (`config.test.ts:69-70`).
Those are settled and out of my column; I do not re-raise them.

Overall the diff is clean, well-documented, and axios-isolation is respected in the public module.
Engineer-domain observations below.

### Analysis notes (no finding)

- **DRY (considered, not raised):** `fireResponse` and `fireError` share a four-field request-side
  prefix (`method`/`url`/`requestHeaders`/`requestBody`), and all three `fire*` repeat the
  `if (!observer) return;` guard. I judged extraction net-negative here — the events are structurally
  distinct, the guard is a one-liner, and inlining reads clearly. Not raised.
- **Module naming (considered, not raised):** the *public* contract is `http-observer.ts` while the
  *private* plumbing is the more-generic `observer.ts` (inverted from the usual "generic name = the
  main thing" intuition). Both files carry an unambiguous top-of-file role comment and the names are
  fixed by the plan/Phase 2-3 references, so the comprehension risk is already mitigated. Not raised.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | Tests | `tests/unit/http/observer.test.ts` (whole file); `src/http/observer.ts:123-161` (`fireRequest`, `fireResponse`) | Two of the three terminal primitives are entirely untested. `observer.test.ts` imports and exercises `normalizeHeaders`, `captureRequest`, `invokeObserver`, and `fireError`, but **never** `fireRequest` or `fireResponse` (confirmed: neither name appears anywhere in `src/` or `tests/`). This phase's stated intent (notes §2) is to deliver an "already-verified helper" so Phases 2/3 "have a single, already-verified helper to route through." `fireResponse` in particular carries untested logic that will be load-bearing for both wiring sites: it maps `response.status` → `statusCode`, runs `normalizeHeaders(response.headers)` for `responseHeaders`, passes `response.data` → `responseBody`, and computes `durationMs = Date.now() - capture.startedAt`. `fireRequest`'s event mapping and its `!observer` no-op are likewise unguarded. A regression in either (e.g. a mis-mapped field or a broken no-op short-circuit) would ship silently into Phase 2/3. | Add `describe("fireResponse")` and `describe("fireRequest")` blocks mirroring the existing `fireError` suite: for `fireResponse`, assert the built event's `statusCode`/`responseHeaders` (against `(response.headers as AxiosHeaders).toJSON()`)/`responseBody`/`durationMs` (e.g. `>= 0`) and reuse-of-`capture` request fields, plus the `observer === undefined` no-op; for `fireRequest`, assert `method`/`url`/`headers`/`body` mapping and the no-op. This closes the "verified in isolation" gap the phase's own charter asserts. |
| engineer-r1-f2 | Low | Open | ErrorHandling | `src/http/observer.ts:71` (`captureRequest`, `method: (args.method ?? "get").toUpperCase()`) | The `??` default only triggers on `null`/`undefined`; an empty-string `method` (`""`) slips past it and yields `"".toUpperCase() === ""`, producing an event whose `method` is `""` — which contradicts the published contract that `DattoHttpRequestEvent.method` is "The HTTP method, uppercased (e.g. `\"GET\"`)" (`http-observer.ts:19`) and the notes' "defaulting to `\"GET\"` when absent." An empty method is unlikely from axios today, but this primitive is the *single* assembler both wiring sites feed arbitrary `config.method` into, and the cost of hardening is one character. | Use `||` instead of `??` (`(args.method || "get").toUpperCase()`) so a falsy/empty method also falls back to `GET`, guaranteeing the event's `method` is always a non-empty uppercased token as documented. |
