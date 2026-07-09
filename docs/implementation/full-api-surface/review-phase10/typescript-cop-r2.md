## typescript-cop — round 2

### Scope

`git diff 9b00367` (the pre-phase-10 tip) against the current working tree still touches exactly
`README.md`, `package.json`, `package-lock.json`, and `tests/unit/readme.test.ts` — no `src/**`
file changed. This round re-verifies the round-1 finding's fix and re-audits everything the
reviser touched since round 1 (the `exports` map's `./package.json` entry, the two new
"Unverified shape(s)" README callouts, and `tests/unit/readme.test.ts`'s expanded per-operation
`it.each(OPERATION_MAP)` drift guard) for new type-safety issues.

### Re-verification of round-1 finding

`typescript-cop-r1-f1` (Quick Start's `devices[0]!.uid!` / `one.uid!` non-null assertions):
confirmed fixed in `README.md` l.76–84. The example now reads `firstUid = devices[0]?.uid`,
throws a clear `Error` when absent, does the same after `client.devices.get(firstUid)`, and only
then calls `setUdf` with a narrowed `string`. Cross-checked against `Device["uid"]` (still
`string | undefined` per `src/schema-overrides/types.ts`'s open-enum/lenient reconciliation) —
the fix correctly models the leniency the rest of the README documents instead of contradicting
it. Closed (ratified).

### New/expanded surface reviewed this round

- `package.json`'s added `"./package.json": "./package.json"` `exports` entry — correctly shaped,
  consistent with the existing `"."` entry, no publish-shape regression.
- `README.md`'s two new "Unverified shape(s)" callouts (`sites.updateProxy`/`deleteProxy`,
  `audit.getPrinter`/`getEsxiHost`) — prose only, no code samples, no type-safety surface.
- `tests/unit/readme.test.ts`'s new `namespaceSection`/`findMethodRow`/`escapeRegExp`/
  `pathPattern` helpers and the `it.each(OPERATION_MAP)` per-operation case: fully typed off
  `OperationMapEntry` (no `any`, no unsafe casts), correctly typed `RegExp`/`string | undefined`
  return types, and consistent with the existing `@/*` path-alias convention used elsewhere in the
  test suite (`tests/unit/client/coverage-map.test.ts`). Clean.

No new findings. All factual claims re-spot-checked this round (rate-limit table constants
against `src/rate-limit/rate-limits.ts`, `DattoLogger`/masking claims against
`src/logging/logger.ts`/`mask.ts`, exported-type names against `src/index.ts`/
`src/public-types.ts`) match the shipped source.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | README.md l.76–84 (Quick start) | (Ratified fix — see Re-verification above.) | — |
