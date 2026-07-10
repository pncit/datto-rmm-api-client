## triage — round 2

Round 1's callback-schema defect (implementation-auditor-r1-f1/f2/f3) was remediated,
`reviser-r1` marked it `Fixed`, and `implementation-auditor-r2` re-verified and ratified it
`Closed` — those three carry no route row here. Round 2 opens seven new findings across four
reviewers (`architect`, `engineer`, `project-lead`, `typescript-cop`); `implementation-auditor-r2`
found no new defect. I reproduced every routed finding against the working tree and the installed
`zod@4.4.3` before routing (evidence inline per cluster).

The dominant round-2 signal is a **collateral regression the round-1 fix introduced**: to make one
runtime validator serve all three differently-typed callbacks, the fix used a single field-agnostic
`z.custom<(event: never) => unknown>`, which erases the concrete event types out of the
directly-exported `DattoRmmClientConfig`. Three reviewers converged on it from three domains
(High × High × High). See Cluster 1 and the chain watch.

### Route table

| ID | Route | Detail |
|----|-------|--------|
| architect-r1-f1 | Remediate | Cluster 1 — `never`-erasure of the callback types (public schema face). High → Remediate (fix evidence-forced, not a gap). |
| project-lead-r1-f1 | Remediate | Cluster 1 — same regression, BehaviorIntent/R1 face. |
| typescript-cop-r1-f1 | Remediate | Cluster 1 — same regression, public-types/export-hygiene face. |
| typescript-cop-r1-f2 | Remediate | Cluster 1 — `never`-erasure in the internal helper (`invokeObserver`); the same mechanism, resolved in the same pass. |
| architect-r1-f2 | Remediate | Cluster 2 — `fireRequest`/`fireResponse` unit-test gap. |
| engineer-r1-f1 | Remediate | Cluster 2 — duplicate of architect-r1-f2, same mechanism. |
| typescript-cop-r1-f3 | Remediate | Cluster 3 — unguarded `logger?.warn` inside `invokeObserver` can re-introduce the R7 failure mode. |
| engineer-r1-f2 | Remediate | Cluster 4 — `??` lets an empty-string `method` through as `""`. |
| architect-r1-f3 | Remediate | Cluster 4 — `normalizeHeaders` re-spells the `DattoHttpHeaders` alias inline. |

No `Human`, `Ruled`, or `Challenge` rows: every finding is a verified defect or gap with a concrete,
evidence-forced fix and no cross-reviewer conflict to settle, so there is no Medium/Low judgment
call for me to rule and nothing that turns on a decision only the human can make.

---

### Cluster 1 — the `never`-erasure of the three callback types (root cause)
**Members:** architect-r1-f1 (High), project-lead-r1-f1 (High), typescript-cop-r1-f1 (High) — the
**public schema** face; typescript-cop-r1-f2 (Medium) — the **internal helper** face.

**Root cause (one shortcut, two surfaces).** Round 1 correctly swapped the wrapping
`z.function` for a non-wrapping `z.custom`, but chose a **single, field-agnostic**
`observerCallbackSchema = z.custom<(event: never) => unknown>(…)` reused for `onRequest`,
`onResponse`, and `onError` alike (`src/http/http-observer.ts:120-134`). Because all three fields
share one generic argument, `z.infer<typeof dattoHttpObserverSchema>` — and therefore the
**directly-exported** `DattoRmmClientConfig["httpObserver"]` (`datto-client-config.ts:81-86,:103`)
— types every callback parameter as `never`. The same shortcut appears one layer down in
`invokeObserver`, whose `fn` is typed `((event: never) => void) | undefined` and then cast away with
`(fn as (event: unknown) => unknown)(event)` (`observer.ts:92-102`), so nothing checks the
callback/event pairing at the three `fire*` sites.

**Reproduced (this tree, `tsc --strict`).** A consumer typing a var as `DattoRmmClientConfig` and
writing the idiomatic inline `httpObserver: { onRequest: (event) => event.method }` fails with
`Property 'method' does not exist on type 'never'`; the inferred field is literally
`onRequest: (event: never) => void`. The `logger` field is unaffected (its per-method
`z.function({ input:[…] })` keeps concrete params through `z.infer`), so `httpObserver` is a
regression *relative to the established precedent*, not parity with it. `config.test.ts:65` already
routes around the defect with an `as never` cast — a live symptom, not a hypothetical.

**Remediation (single fix, both surfaces).**
1. **Schema (f1 ×3).** Replace the shared validator with a per-field generic that keeps the
   non-wrapping `z.custom` (identity pass-through, no return-value validation — R7/R9 preserved):
   ```ts
   function observerCallbackSchema<Fn>() {
     return z.custom<Fn>((value) => typeof value === "function").optional();
   }
   z.strictObject({
     onRequest:  observerCallbackSchema<DattoHttpObserver["onRequest"]>(),
     onResponse: observerCallbackSchema<DattoHttpObserver["onResponse"]>(),
     onError:    observerCallbackSchema<DattoHttpObserver["onError"]>(),
   })
   ```
   I compiled this against the repo's own `zod`: `z.infer<…>.onRequest` is callable with a real
   `DattoHttpRequestEvent` with **no cast**, and `schema.parse({ onRequest }).onRequest === onRequest`
   stays `true`. Keying the generic off `DattoHttpObserver["on*"]` (rather than a re-spelled
   `(event: E) => unknown`) also makes the hand-authored interface the single source the schema
   tracks. Update the `:103-119` doc comment so it explains the per-field generic (it currently
   describes only the round-1 `z.function`→`z.custom` rationale).
2. **Internal helper (f2).** Make `invokeObserver` generic over the event —
   `invokeObserver<E>(logger, name, fn: ((event: E) => void) | undefined, event: E)` — and drop the
   internal `as` cast (`const returned: unknown = fn(event);` typechecks directly). Each `fire*` site
   becomes `invokeObserver<DattoHttpRequestEvent>(…)` etc., so the compiler now pins callback↔event
   at all three sites. Remove the now-stale `never`-rationale paragraph in the `invokeObserver`
   doc comment (`observer.ts:86-90`).
3. Add a **compile-time regression pin** (in `tests/generated/surface-pin.ts`, or a dedicated
   type-test) asserting (a) an inline `httpObserver: { onRequest: (event) => event.method }` literal
   type-checks against `DattoRmmClientConfig` with no annotation, and (b) `z.infer<typeof
   dattoHttpObserverSchema>` and `DattoHttpObserver` are mutually assignable — so the two sources
   cannot silently drift and this cannot regress a third time. Remove the `as never` cast at
   `config.test.ts:65` (it should no longer compile-check-around anything).

**Scope boundary.** `src/http/http-observer.ts` (schema + doc comment), `src/http/observer.ts`
(`invokeObserver` signature + call sites + doc comment), `tests/generated/surface-pin.ts` (new
pin), `tests/unit/client/config.test.ts` (drop the cast). Do **not** touch `dattoLoggerSchema`,
do **not** add Phase 2/3/4 wiring, do **not** alter the five public types' shapes, and preserve
`.strictObject`/`.optional()` and the non-function / unknown-key rejections.

**Verification.** `npm run typecheck` + `npm test` green; the new compile pin present and passing;
`config.test.ts` cast gone. Reviewer-grade: inline inline-callback config type-checks without
annotation; `parse({ onRequest }).onRequest === onRequest` still `true`; a value-returning parsed
callback via `invokeObserver` logs **no** `warn`, an async-rejecting one produces **no** unhandled
rejection + exactly one attributed `warn` (round-1 guarantees must not regress). Re-run the Phase-1
exit-gate greps unchanged: `http-observer.ts` axios-free; `dist/index.d.ts` contains
`DattoHttpObserver`, no `declare module`, no `ObserverCapture`/`__dattoObserverCapture` leak;
`observer.ts` not re-exported.

### Cluster 2 — `fireRequest`/`fireResponse` have no direct unit test
**Members:** architect-r1-f2 (Medium), engineer-r1-f1 (Medium) — duplicates, same mechanism.

**Root cause.** `tests/unit/http/observer.test.ts` exercises `normalizeHeaders`, `captureRequest`,
`invokeObserver`, and `fireError`, but never `fireRequest` or `fireResponse` (confirmed: neither
name appears in `src/` tests). `fireResponse` carries load-bearing logic Phases 2/3 will route
through — `durationMs = Date.now() - capture.startedAt`, `normalizeHeaders(response.headers)`,
`statusCode`/`responseBody` assembly — first exercised only at wiring time otherwise. The phase
charter itself claims the helper is "verified in isolation."

**Remediation.** Add `describe("fireResponse")` and `describe("fireRequest")` blocks mirroring the
existing `fireError` suite: for `fireResponse`, assert `statusCode`/`responseHeaders` (against
`(response.headers as AxiosHeaders).toJSON()`)/`responseBody`/`durationMs` (`>= 0`) and reuse of the
`capture` request-side fields; for `fireRequest`, assert `method`/`url`/`headers`/`body` mapping;
both assert the `observer === undefined` no-op.

**Scope boundary.** Test-only — `tests/unit/http/observer.test.ts`. No source change.
**Verification.** `npm test` green with both new blocks; all seven Phase-1 primitives now have a
direct unit test.

### Cluster 3 — a throwing `logger.warn` can re-open the R7 hole
**Member:** typescript-cop-r1-f3 (Medium).

**Root cause.** Both swallow paths in `invokeObserver` call `logger?.warn(...)` unguarded
(`observer.ts:108-113` in the `.then` rejection handler, `:116-118` in the synchronous `catch`).
`DattoLogger` is shape-only-validated, so a consumer `warn` that itself throws would (a) in the
`catch` block, propagate straight out of `invokeObserver` into the request path — the exact escape
R7 exists to prevent; (b) in the `.then` handler, reject an unstored, unawaited promise → an
unhandled rejection. The plumbing meant to eliminate uncontrolled throws/rejections can reintroduce
them.

**Remediation.** Wrap each `logger?.warn(...)` in its own nested `try { … } catch { /* logger
misbehaved; nothing safe left to do */ }`, in both the synchronous `catch` and the `.then`
rejection callback.

**Scope boundary.** `src/http/observer.ts` (`invokeObserver` body only).
**Verification.** `npm test` green; add/confirm a test where `logger.warn` throws — assert it neither
escapes `invokeObserver` nor produces an unhandled rejection (reuse the round-1
`process.on("unhandledRejection", …)` harness).

### Cluster 4 — two single-line contract-fidelity nits in `observer.ts`
**Members:** engineer-r1-f2 (Low, ErrorHandling), architect-r1-f3 (Low, Boundaries). Independent
mechanisms, but both one-line hardening in the same file, batched.

- **engineer-r1-f2.** `captureRequest` uses `method: (args.method ?? "get").toUpperCase()`
  (`observer.ts:71`); `??` only catches `null`/`undefined`, so an empty-string method yields
  `method: ""`, contradicting the published "uppercased, non-empty" contract
  (`http-observer.ts:19`). Change `??` → `||` so any falsy method falls back to `GET`.
- **architect-r1-f3.** `normalizeHeaders` returns `{ ...(raw as Record<string, string | string[] |
  undefined>) }` (`observer.ts:55`) — the literal definition of `DattoHttpHeaders`
  (`http-observer.ts:15`) re-spelled inline at a boundary, free to drift from the alias. Cast
  through the already-imported alias: `{ ...(raw as DattoHttpHeaders) }`.

**Scope boundary.** `src/http/observer.ts` only.
**Verification.** `npm run typecheck` + `npm test` green; add a `captureRequest({ method: "" })`
assertion that `method === "GET"`.

---

### Chain watch
**The callback-schema shape has now churned two consecutive rounds — watch for a third.**
Round 1 fixed the wrapping-`z.function` defect by collapsing all three callbacks into one
field-agnostic `z.custom<(event: never) => unknown>`; that collapse is precisely what produced
round 2's Cluster 1 (`event: never` leaking into the exported config type). This is the same
mechanism — *how the three callback fields are schema-typed* — surfacing a new face each round.

Note the fix is not open-ended: triage-r1's own first-listed option was a **per-field**
`z.custom<DattoHttpObserver["onRequest"]>` validator; the reviser instead took the single shared
form, which is the direct cause of this round's regression. The Cluster 1 remedy returns to that
per-field shape, and I verified it satisfies **both** constraints at once — the round-1 R7/R9
identity-pass-through *and* the round-2 per-field type inference. The reviser must confirm both in
the same pass (the verification list above pins both), so the schema does not churn a third round by
fixing one constraint and re-breaking the other. If a round-3 finding lands on this same schema
shape again, escalate it rather than spot-fixing.

No other mechanism has repeated: Clusters 2–4 are first-round-of-their-kind.
