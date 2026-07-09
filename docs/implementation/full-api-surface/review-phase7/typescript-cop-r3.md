## typescript-cop — round 3

Scope: `git diff 9b53c42..HEAD` (Phase 6 baseline → current tree — no source has changed since round
2's turn; `reviser-r3.md`'s only action was a documentation-only reconciliation of
`implementation-phase7-notes.md`, confirmed via `git diff f16d9fb..HEAD`, which touches no file under
`src/`/`tests/`). Re-read every changed source file in full against round 2's closures: `base-resource.ts`,
`narrow.ts`, all five `*Resource` classes (`account`/`site`/`device`/`alert`/`job`), `void-response.ts`,
`variable-schema.ts`, `datto-rmm-client.ts`, `datto-client-config.ts`'s doc edit, `rate-limits.ts`'s
`site-update` entry, `schema-overrides/write-bodies.ts`/`index.ts`'s `siteUpdateBodySchema` addition,
`schema-leniency.ts`'s `objectCatchall`, `schema-mirror-pin.ts`'s six pins, `test-harness.ts`, and the
full test suite for all five resources plus `datto-rmm-client.test.ts`.

No new issues found. Both round-1 findings remain correctly fixed (no regression since round 2's
ratification, since the underlying files are byte-for-byte unchanged): `objectCatchall`
(`schema-leniency.ts:96-99`) still routes through `getDef()` rather than a direct `_zod.def` cast, and
`schema-mirror-pin.ts` still uses full `Equal<T, z.infer<typeof schema>>` for the five enum-free
mirrors while `Filter` alone stays key-set-only, scoped to its documented enum-widening asymmetry.
Re-verified `narrow<T>`/`coerceSchema<T>` usage across every resource method, every `httpPost`/`httpPut`/
`httpPatch`/`httpDelete`/`paginate`/`httpGetArray` call site, and every test file's `as unknown as X`
casts remain confined to deliberate negative-validation cases — nothing new to raise.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | — | — | ratified (round 2, reconfirmed round 3, no source change since): `objectCatchall` routes through `getDef()` instead of a direct `(schema as any)._zod.def.catchall` cast. |
| typescript-cop-r1-f2 | Low | Closed | Exhaustiveness | — | — | ratified (round 2, reconfirmed round 3, no source change since): five of six `schema-mirror-pin.ts` mirrors use full `Equal<T, z.infer<typeof schema>>`; `Filter`/`filterSchema` correctly stays key-set-only. |

No open findings remain.
