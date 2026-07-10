## architect — round 2

In-progress review reconciling my round-1 turn against `reviser-r2` (which marked all three of my
findings `Fixed`). I re-verified each fix against the source rather than the reviser's digest.

- **architect-r1-f1 (PublicAPI, High)** — *ratified → Closed.* The shared, field-agnostic
  `z.custom<(event: never) => unknown>()` is gone; `observerCallbackSchema<Fn>()`
  (`src/http/http-observer.ts:131-133`) is now a per-field generic instantiated with
  `DattoHttpObserver["onRequest"]` / `["onResponse"]` / `["onError"]` at lines 144-146, so
  `z.infer` preserves each field's concrete `DattoHttp*Event` parameter and the identity
  pass-through (`z.custom` returns input unchanged) is retained. The compile-time linkage I asked
  for is present and load-bearing: `tests/generated/surface-pin.ts:94-102` pins each
  `DattoRmmClientConfig["httpObserver"]` callback parameter to its concrete event type (no
  `never`), and `:106-108` pins schema↔interface mutual assignability. Config field
  (`src/client/datto-client-config.ts:81-86`) now presents the real contract to the inline-config
  consumer.

- **architect-r1-f2 (Architecture, Medium)** — *ratified → Closed.* `fireRequest`
  (`tests/unit/http/observer.test.ts:327-359`) and `fireResponse` (`:361-408`) now have direct
  unit suites: event-field assembly, `AxiosHeaders`→plain-record normalization, `durationMs >= 0`,
  and both `observer`-absent and callback-absent no-ops. All seven Phase 1 primitives are now
  directly exercised.

- **architect-r1-f3 (Boundaries, Low)** — *ratified → Closed.* `normalizeHeaders`
  (`src/http/observer.ts:55`) now casts through the named alias — `{ ...(raw as DattoHttpHeaders) }`
  — so `DattoHttpHeaders` remains the single source of the header shape.

No new architectural issues. The fixes are localized, respect the axios-free boundary of the public
module, keep the internal helper and augmentation out of the published surface, and introduce no new
coupling. Round 2 converges to zero open findings.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | High | Closed | PublicAPI | `src/http/http-observer.ts:131-147` → `src/client/datto-client-config.ts:81-86`; pins `tests/generated/surface-pin.ts:94-108` | Ratified. Per-field generic `observerCallbackSchema<Fn>()` restores concrete `DattoHttp*Event` inference on `DattoRmmClientConfig["httpObserver"]` (no `never`) while keeping the `z.custom` identity pass-through; parity/no-`never` compile pins added as recommended. | No further action. |
| architect-r1-f2 | Medium | Closed | Architecture | `tests/unit/http/observer.test.ts:327-408` | Ratified. Direct `fireRequest`/`fireResponse` unit suites added (event-field assembly, header normalization, `durationMs`, no-op paths); all seven primitives now covered. | No further action. |
| architect-r1-f3 | Low | Closed | Boundaries | `src/http/observer.ts:55` | Ratified. Return casts through the named `DattoHttpHeaders` alias; the single-source-of-truth for the header shape is restored. | No further action. |
