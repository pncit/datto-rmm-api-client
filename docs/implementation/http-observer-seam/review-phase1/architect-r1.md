## architect — round 1

First architect turn on Phase 1 (no prior architect turn to reconcile). I read the prior
`implementation-auditor` turns (r1/r2), triage-r1, and reviser-r1: the callback-schema defect
(implementation-auditor-r1-f1/f2/f3) was remediated and ratified `Closed` — I do **not** re-raise
it. My review is a fresh architectural pass over the Phase 1 surface: the five axios-free public
types + shape-only schema (`src/http/http-observer.ts`), the strict-config field
(`src/client/datto-client-config.ts`), the barrel export (`src/index.ts`), the per-attempt stash
augmentation (`src/http/axios-augment.d.ts`), and the internal helper (`src/http/observer.ts`) with
its tests.

**Boundaries — clean.** The public-contract module stays axios-free; the internal helper and the
`axios-augment.d.ts` stash stay out of `dist` (auditor verified). No cycle: `http-observer.ts`
(types+schema) ← `datto-client-config.ts` / `observer.ts` / `index.ts`; `observer.ts` ←(type-only)
`axios-augment.d.ts`; `observer.ts` → `http-observer.ts` + `logger.ts` + axios. The schema value
(`dattoHttpObserverSchema`) and the config schema are deliberately not re-exported from `index.ts`
(only the five types are) — internal surface stays internal. The `axios`-default import for
`isAxiosError` lives only in the internal helper, never the public module. All good.

The substantive issue is that the **public config contract does not actually present the
`DattoHttpObserver` type** to the consumer on the path they use most (f1); plus a helper
test-coverage gap (f2) and a minor type-alias duplication (f3).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | High | Open | PublicAPI | `src/http/http-observer.ts:120-134` (`observerCallbackSchema`/`dattoHttpObserverSchema`) → `src/client/datto-client-config.ts:81-86` + `:103` (`DattoRmmClientConfig = z.infer<…>`) | `DattoRmmClientConfig` is inferred from the schema, and `observerCallbackSchema` is `z.custom<(event: never) => unknown>`. So `DattoRmmClientConfig["httpObserver"]` infers `{ onRequest?: (event: never) => unknown; onResponse?: …; onError?: … }` — it is **not** `DattoHttpObserver`, and there is **zero** compile-time linkage between the exported `DattoHttpObserver`/`DattoHttp*Event` types and what the config accepts. A consumer writing the primary, inline form — `const cfg: DattoRmmClientConfig = { …, httpObserver: { onRequest: (event) => { … } } }` — gets `event: never`, i.e. no type, no IntelliSense, no field checking. The five exported payload types exist *precisely* so callbacks are annotatable, but they buy the inline-config user nothing. This is strictly worse than the logger precedent the schema claims to follow: `z.function({ input: [z.string(), …], output: z.void() })` infers `(message: string, meta?: Record<string,unknown>) => void`, so `DattoRmmClientConfig["logger"]` is meaningfully typed; the observer inference degrades to `never`. Separately, the hand-authored `DattoHttpObserver` interface and the `.strictObject` schema are two independent sources of truth that can silently drift (add `onRedirect?` to the interface → the strict schema rejects it at runtime while the type accepts it), with no assertion pinning parity. | Make the config field present the real contract, e.g. type the object schema `z.custom<DattoHttpObserver>(…)` / cast the field type to `DattoHttpObserver`, or use per-callback `z.custom<DattoHttpObserver["onRequest"]>((v) => v === undefined \|\| typeof v === "function")` (the triage's original f1 shape) so inline callbacks infer `DattoHttpRequestEvent`/`…ResponseEvent`/`…ErrorEvent`. Then add a compile-time parity assertion (e.g. `expectTypeOf`/an `A extends B ? … : never` pin in `surface-pin.ts`) that `z.infer<typeof dattoHttpObserverSchema>` and `DattoHttpObserver` are mutually assignable, so the two sources cannot drift. |
| architect-r1-f2 | Medium | Open | Architecture | `tests/unit/http/observer.test.ts` (covers `normalizeHeaders`/`captureRequest`/`invokeObserver`/`fireError` only) | Two of the seven Phase 1 helper primitives — `fireRequest` and `fireResponse` — have **no** direct unit test, yet `fireResponse` carries real logic Phase 2/3 will depend on being correct: it computes `durationMs = Date.now() - capture.startedAt`, runs `normalizeHeaders(response.headers)`, copies `statusCode`/`responseBody`, and assembles `DattoHttpResponseEvent` from the stash. The phase goal states "the helper is unit-tested in isolation"; leaving these two untested means the first exercise of the response-event assembler is deferred to Phase 2 wiring, where a defect is harder to localize. (`fireError` is well covered; `fireRequest`/`fireResponse` are the gap.) | Add direct `fireRequest` and `fireResponse` tests: assert the assembled event fields (method/url/headers/body for request; requestHeaders/requestBody/statusCode/responseHeaders/responseBody + numeric `durationMs`), that response headers are normalized (pass an `AxiosHeaders`), and the `observer === undefined` no-op — mirroring the existing `fireError` block. |
| architect-r1-f3 | Low | Open | Boundaries | `src/http/observer.ts:55` (`normalizeHeaders` return) | The return re-spells the `DattoHttpHeaders` alias inline: `{ ...(raw as Record<string, string \| string[] \| undefined>) }`. This is the exact literal definition of `DattoHttpHeaders` (`http-observer.ts:15`) duplicated at a boundary; if the header value type ever changes, the alias and this cast drift silently, and the function's declared return type (`DattoHttpHeaders`) would then mask the mismatch. | Cast through the named alias — `{ ...(raw as DattoHttpHeaders) }` (`DattoHttpHeaders` is already imported) — so the one alias remains the single source of the header shape. |
