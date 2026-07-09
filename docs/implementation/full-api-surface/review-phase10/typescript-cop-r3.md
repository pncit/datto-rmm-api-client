## typescript-cop — round 3

### Reconciliation

- `typescript-cop-r1-f1` (Quick Start's `devices[0]!.uid!`/`one.uid!` non-null assertions) was
  ratified and `Closed` in round 2. Per carry-forward discipline, an already-`Closed` finding is
  not re-listed here; it stays settled.
- No other prior `typescript-cop` finding remains `Open`.

### Scope this round

`git diff` against the pre-phase-10 tip still touches exactly `README.md`, `package.json`,
`package-lock.json`, and `tests/unit/readme.test.ts`; no `src/**` file is touched. `README.md` and
`package.json` are byte-identical to the round-2 state (already reviewed clean — Quick Start fix,
`exports` map, `./package.json` companion entry), so this round re-scans only the one file that
changed since round 2: `tests/unit/readme.test.ts`, edited by the reviser to (a) delete the
redundant "documents at least one method for client.%s" `it.each` block (strictly subsumed by the
per-operation `it.each(OPERATION_MAP)` case) and (b) relocate the suite-overview JSDoc comment
above the `__dirname`/`README_PATH` constants.

Both edits are structural (deletion, comment relocation) — no new types, casts, generics, or async
code were introduced. The retained `namespaceSection`/`findMethodRow`/`escapeRegExp`/`pathPattern`
helpers and the `it.each(OPERATION_MAP)` case are unchanged from round 2, where they were already
reviewed and found clean (typed off `OperationMapEntry`, no `any`, no unsafe casts). Re-confirmed
this round: `findMethodRow`'s `string | undefined` return still flows correctly into the
`expect(row, …).toBeDefined()` / `expect(row).toContain(...)` / `expect(row).toMatch(...)` chain —
vitest's `expect()` accepts `unknown` for its matchers, so this isn't a type hole, and a runtime
`undefined` fails the preceding `toBeDefined()` assertion before either downstream matcher could
mask a real gap.

No new findings.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
