## typescript-cop — round 2

Re-verified all three round-1 findings against the current working tree (not just the reviser's
disposition): read `src/http/http-observer.ts`, `src/http/observer.ts`,
`src/client/datto-client-config.ts`, `tests/generated/surface-pin.ts`,
`tests/unit/client/config.test.ts`, `tests/unit/http/observer.test.ts`, and the built
`dist/index.d.ts`.

- **f1 (schema `never`-erasure):** `observerCallbackSchema<Fn>()` is now a per-field generic
  factory instantiated as `observerCallbackSchema<DattoHttpObserver["onRequest"]>()` /
  `["onResponse"]` / `["onError"]`. Confirmed directly in `dist/index.d.ts:32-36`: `onRequest`,
  `onResponse`, `onError` each show their own concrete `DattoHttp*Event` parameter type — no
  `never` anywhere in the built config type. `tests/generated/surface-pin.ts` now carries a
  regression pin (`_OnRequestParamPin`/`_OnResponseParamPin`/`_OnErrorParamPin` plus
  `_SchemaObserverParityPin`) that fails to compile if this collapses back to a shared/`never`
  schema. The `as never` workaround in `config.test.ts` is gone; the round-trip test now invokes
  the parsed callback with a real `DattoHttpRequestEvent` and asserts identity. Ratified.
- **f2 (`invokeObserver` `never`-erasure):** `invokeObserver` is now generic over `E`
  (`invokeObserver<E>(logger, callbackName, fn: ((event: E) => void) | undefined, event: E)`), the
  internal `(fn as (event: unknown) => unknown)(event)` cast is gone (`fn(event)` is called
  directly), and each `fire*` site pins its own event type (`invokeObserver<DattoHttpRequestEvent>`,
  etc.), so the compiler now checks callback/event pairing at all three call sites. Ratified.
- **f3 (unguarded `logger.warn` inside the swallow paths):** both swallow paths now route through
  a `safeWarn` helper that wraps `logger?.warn(...)` in its own `try/catch`, so a throwing
  `warn` can no longer escape the synchronous `catch` block or leave an unhandled rejection behind
  in the `.then(undefined, ...)` handler. A dedicated regression test (`observer.test.ts`, "guards a
  throwing logger.warn…") exercises both paths with a `warn` that itself throws, using a real
  `process.on("unhandledRejection", ...)` harness, and asserts no throw escapes and no unhandled
  rejection occurs. Ratified.

No new type-safety issues found on this pass. The schema, the internal helper, the axios-free
public module, the `axios-augment.d.ts` stash augmentation, and the barrel export are all clean.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | High | Closed | Public Types & Export Hygiene | `src/http/http-observer.ts` (`observerCallbackSchema`/`dattoHttpObserverSchema`) | Ratified fixed — per-field generic schema restores concrete `DattoHttp*Event` parameter types on `DattoRmmClientConfig["httpObserver"]`; verified directly in `dist/index.d.ts` and pinned by `surface-pin.ts`. | — |
| typescript-cop-r1-f2 | Medium | Closed | Generics & Inference | `src/http/observer.ts` (`invokeObserver`) | Ratified fixed — `invokeObserver` is now generic over the event type with no internal erasure cast; each `fire*` call site pins its own event type. | — |
| typescript-cop-r1-f3 | Medium | Closed | Async/Await Correctness | `src/http/observer.ts` (`invokeObserver`'s swallow paths) | Ratified fixed — both `logger?.warn(...)` call sites are now routed through a nested-`try/catch` `safeWarn` helper; regression test confirms neither a throw escapes nor an unhandled rejection occurs when the logger itself misbehaves. | — |
