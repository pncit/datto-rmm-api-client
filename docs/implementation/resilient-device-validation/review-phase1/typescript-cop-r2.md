## typescript-cop — round 2

Reconciled round-1 against the reviser's disposition, then re-scanned the full current diff
(`git diff origin/main`) for `src/validation.ts` and `src/__tests__/validation.test.ts` — the only
files in this phase's scope under this agent's remit — including the changes landed since round 1
(the shared `firstIssuePath()` extraction, the `toProblemError` `identityOverride` parameter, the
hoisted `Array.isArray` guard, and the shared log-prefix constants).

- `data as T` / `item as T` / `items as T[]` casts in `off`/`warn` branches remain unvalidated
  casts from `unknown`/`unknown[]` to `T`/`T[]`, unchanged in substance from round 1 — still the
  pre-existing `off`-mode pattern plus the design-mandated raw-passthrough for `warn` (R8); not
  re-raised.
- The new `identityOverride?: string` parameter on `toProblemError` and the extracted
  `firstIssuePath(error: ZodError): string` helper are both correctly typed, additive, and
  don't weaken any existing signature.
- Hoisting the `Array.isArray(items)` guard above the mode branch doesn't change any typing —
  `mode` is still correctly narrowed by control flow after the early `"off"` return.
- `validation.ts`'s exports (`validate`, `validateItems`, `toProblemError`, `firstIssuePath`,
  `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`) remain absent from `src/index.ts`'s barrel
  (confirmed: it `export *`s only `client.js`/`config.js`/`result.js`/`schemas.js`), so none of
  this phase's new surface reaches the public API.
- No floating promises, no new `async`, no exhaustiveness gaps — still synchronous, unchanged from
  round 1.
- No new type holes found in this round's changes.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| typescript-cop-r1-f1 | Low | Closed | TypeHole | — | — | ratified: `src/__tests__/validation.test.ts:166` now reads `(valid[0] as Record<string, unknown>).extra`, replacing the prior `as any` cast. |
