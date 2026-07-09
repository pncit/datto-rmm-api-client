## typescript-cop — round 2

In-progress review. Scope: `git diff 9b00367 -- src/ scripts/ tests/ .gitignore` (working tree,
covers everything committed as Phase 9's base plus every uncommitted round-2 fix), plus the new
untracked `tests/unit/security/udf-key-pattern-consistency.test.ts`. Re-verified my one round-1
finding against the source (not the reviser's digest), then re-scanned every changed line — the
now-`src/`-touching `mask.ts`/`device-overrides.ts`/`index.ts` changes (new to this round, made in
response to `architect-r1-f1`) plus the two touched test files and the new consistency test — for
new type holes.

- `typescript-cop-r1-f1` re-verified: `scripts/sanitize-fixtures.mjs:117` now has
  `/** @type {unknown} */` immediately before `JSON.parse(readFileSync(inputPath, "utf8"))`,
  before it flows into `sanitizeValue`. Confirmed this JSDoc cast is actually enforced (not just
  present as an unchecked comment) by round-tripping a scratch file through
  `tsc -p tsconfig.test.json`: reassigning the annotated export to a narrower type produces a
  compile error citing the correct source type, proving `checkJs` is live on this file.
- Re-checked the newly-exported `UDF_KEY` (`src/logging/mask.ts`) and `UDF_KEY_PATTERN`
  (`src/schema-overrides/device-overrides.ts`, re-exported from `schema-overrides/index.ts`) —
  raised to close `architect-r1-f1` — for public-surface leakage: `src/index.ts` re-exports only
  `client`, `config`/`logger` types, `errors`, and the curated `./public-types`; neither symbol is
  reachable from any of those (confirmed by direct grep of `src/public-types.ts`, which re-exports
  `schema-overrides` types by name, not `export *`, and does not name either). No new public type
  surface.
- Re-checked the new `tests/unit/security/udf-key-pattern-consistency.test.ts`: it imports
  `SECRET_KEY_PATTERNS` (typed `readonly RegExp[]` via the `.mjs`'s own `@type` JSDoc) directly
  from the `.mjs` script and calls `.some((pattern: RegExp) => pattern.test(key))` — verified by a
  scratch-file probe against `tsconfig.test.json` that the import is genuinely inferred as
  `readonly RegExp[]` (not `any`), so the inline `pattern: RegExp` annotation is redundant but not
  compensating for a lost type.
- Re-checked `tests/integration/fixtures.test.ts`'s and `tests/unit/scripts/sanitize-fixtures.test.ts`'s
  diffs (folded `it.each`, reverse `WIDENED_FIELDS` guard, same-resolved-path CLI tests): no new
  `any`, no new unvalidated-boundary cast — the `error as { status: number | null; stderr: string }`
  pattern in the two new same-path CLI tests duplicates the shape already used unflagged in this
  same file's pre-existing "missing output path" test; test-only assertions on a subprocess's own
  synchronous-exec error, not a production boundary, so it is not a new issue.
- `npm run typecheck` (src+test+tools) and `npm run lint` are clean in the current tree.

No new findings this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Low | Closed | TypeHole | — | — | ratified: `/** @type {unknown} */` now precedes the `JSON.parse` call in `scripts/sanitize-fixtures.mjs`'s `main()`; verified the annotation is compiler-enforced (`checkJs`), not decorative. |
