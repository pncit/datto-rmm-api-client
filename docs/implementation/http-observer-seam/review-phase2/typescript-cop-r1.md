## typescript-cop — round 1

Scoped to the Phase 2 diff (`git diff origin/main` limited to files actually changed by this
phase): `src/http/http-client.ts`, `src/client/datto-rmm-client.ts`,
`tests/unit/http/http-client.test.ts`. `src/http/http-observer.ts` and `src/http/observer.ts`
(Phase 1) are unchanged in this diff and were not re-reviewed.

The new production code is clean: no new `any`, no unsafe `as` casts, no non-null assertions, no
changed public-export surface, and no floating promises. `captureRequest`/`fireRequest`/
`fireResponse`/`fireError` are consistently routed through as the plan requires; the
`error.config?.__dattoObserverCapture` and `response.config.__dattoObserverCapture` reads resolve
cleanly off the global `axios-augment.d.ts` augmentation with no cast needed. `handleResponseError`'s
new `httpObserver` parameter and its one call site are correctly and consistently typed. The one
finding below is confined to new test-only casts.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| typescript-cop-r1-f1 | Low | Open | Type Holes & Unsafe Patterns | `tests/unit/http/http-client.test.ts` (`events: Array<["request" \| "response", unknown]>` / `Array<["request" \| "response" \| "error", unknown]>`, and the four `events[N]![1] as DattoHttp*Event` casts) | The two new observer-event tests capture pushed events as `[kind, unknown]` tuples, then recover the concrete event type with an unvalidated `as DattoHttpRequestEvent` / `as DattoHttpResponseEvent` / `as DattoHttpErrorEvent` cast from `unknown`. The observer callbacks (`onRequest`/`onResponse`/`onError`) already receive a precisely-typed event at the push site — the cast is only needed because the tuple's second element is widened to `unknown` on push. | Type `events` as a discriminated union tuple array instead, e.g. `Array<["request", DattoHttpRequestEvent] \| ["response", DattoHttpResponseEvent] \| ["error", DattoHttpErrorEvent]>`, so indexing narrows via the discriminant and the `as` casts (and the `unknown` widening that necessitates them) are removed entirely. |
