## project-lead — round 2

Re-verified `project-lead-r1-f1` against the round-2 diff (triage-r2's Cluster 1 remediation,
`reviser-r2`'s disposition) rather than taking the reviser's summary at face value:

- `src/http/http-observer.ts`: `observerCallbackSchema<Fn>()` is now a per-field generic factory
  (`z.custom<Fn>(...)`), instantiated as `observerCallbackSchema<DattoHttpObserver["onRequest"]>()`
  / `["onResponse"]` / `["onError"]` in `dattoHttpObserverSchema` — no more shared field-agnostic
  `(event: never) => unknown`.
- `dist/index.d.ts` (fresh `npm run build`): `onRequest`/`onResponse`/`onError` now show
  `z.ZodCustom<((event: DattoHttpRequestEvent) => void) | undefined, ...>` etc. — concrete
  `DattoHttp*Event` parameter types, no `never`.
- Reproduced the original repro from the opposite direction: with the fix in place, a scratch
  `DattoRmmClientConfig` literal `{ ..., httpObserver: { onRequest: (event) => event.method } }`
  type-checks with `event` inferred as `DattoHttpRequestEvent` — no pre-declared intermediate
  variable needed, confirmed via `npm run typecheck` (clean) and the new compile-time regression
  pins in `tests/generated/surface-pin.ts` (`_OnRequestParamPin`/`_OnResponseParamPin`/
  `_OnErrorParamPin`/`_SchemaObserverParityPin`), which assert exactly this and pin it against a
  third-round recurrence.
- The `as never` workaround the finding cited in `tests/unit/client/config.test.ts:65` is gone;
  the test now passes a real `DattoHttpRequestEvent`.
- `npm run typecheck`, `npm test` (565/565, 39/39 files), and `npm run build` all clean; the
  `http-observer.ts` axios-free exit-gate greps (`from 'axios'`, `\bAxios[A-Z]`) both still pass.

R1's Goal (the five exported event types reaching the idiomatic inline-config call site) is now
fully realized, restoring parity with the `logger` field's established precedent rather than
regressing from it. No new requirements/behavior-intent/scope/risk/dependency issues found in the
round-2 diff.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | High | Closed | BehaviorIntent | — | — | ratified: per-field `observerCallbackSchema<Fn>()` generic restores concrete `DattoHttp*Event` parameter types on `DattoRmmClientConfig["httpObserver"]`; verified in `dist/index.d.ts`, by a fresh idiomatic-inline-literal type-check, and by the new `surface-pin.ts` regression pins. |
