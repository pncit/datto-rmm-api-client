## reviser — round 3

| ID | Disposition | Rationale (and, for Fixed, what changed) |
|----|-------------|-------------------------------------------|
| engineer-r2-f1 | Fixed | Deleted the redundant `it.each(namespaces)("documents at least one method for client.%s", …)` block (`tests/unit/readme.test.ts`, formerly l.92-101). It was strictly subsumed by the per-operation `it.each(OPERATION_MAP)` case, which already locates every method's own row within its namespace section and fails if any is missing — the coarser "at least one method" check could never fail while that passed. The namespace-heading tripwire (`it.each(namespaces)("has a namespace → endpoint map section for client.%s", …)`) is retained per the recommendation. `npx vitest run tests/unit/readme.test.ts` now runs 71/71 green (down from 81, reflecting the removed duplicate cases, not lost coverage). |
| engineer-r2-f2 | Fixed | Moved the file/suite-overview JSDoc block (citing R18, the plan phase, and the `OPERATION_MAP`-derived design) from immediately above `function namespaceSection` to a module-level comment placed right after the imports, before the `__dirname`/`README_PATH` constants. `namespaceSection` now has only its own, correctly-scoped doc comment directly above it, so a top-down reader no longer misattributes the suite overview to that one helper. |

### Verification
`npx vitest run tests/unit/readme.test.ts` (71/71 passing), `npm run typecheck` (`typecheck:src`, `typecheck:test`, `typecheck:tools` all clean), and `npm run lint` all pass on the current working tree. `git status --short` shows edits confined to `tests/unit/readme.test.ts` — no other files touched this round.
