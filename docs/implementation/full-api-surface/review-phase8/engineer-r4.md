## engineer — round 4

In-progress review, round 4. Carried state re-verified against `reviser-r5.md`:

- `engineer-r3-f1` (stale "key-set equality only, not full structural equality" doc comments in
  `filter-schema.ts` and `activity-log-resource.ts`) was dispositioned **Fixed** in round 5. I
  re-verified against the current tree: `filter-schema.ts:18-27` now describes the two-pin split
  (`keyof` pin over `type` by key-set equality only, so the enum field's presence/absence is still
  checked, plus a full structural `Omit<Filter, "type">` pin over every other field that also fails
  on a same-named field's type change), and `activity-log-resource.ts:14-24` states the equivalent
  for `entity`/`ActivityLog`, explicitly naming the nested `site`/`user` objects. Both now agree
  with `tests/generated/schema-mirror-pin.ts`'s file doc (lines 18-39) and the two inline pin
  comments (lines 75-99). `git grep "key-set equality only"` returns exactly the two *correct*
  updated usages (each describing the `keyof` pin, which genuinely is key-set-only), with the stale
  "…, not full structural equality" clause gone. Ratified → **Closed**.

- `engineer-r1-f1` was Closed in round 2 (re-verified again in round 3); per carry-forward
  discipline it is not re-listed here.

New finding this round: reviewing the full branch diff (`main..HEAD`) for the Dead Code & Cleanup
axis surfaced a tracked editor swap file, `docs/implementation/full-api-surface/.plan.md.swp`. It
is a binary vim swap artifact committed into the branch (checkpoint `a494426`), still present in
`HEAD` (`git cat-file -t HEAD:…` → `blob`, and `git ls-files` lists it), and `.gitignore` has no
`*.swp` rule to prevent recurrence. The working tree currently shows it deleted but that deletion
is **unstaged** (` D` in `git status`), so it remains in the committed tree and will merge with the
branch unless removed from tracking. This is the one new finding below (`engineer-r4-f1`).

No other new engineer-lens issues surfaced: the only Phase-8 source deltas since round 3 were the
two doc-comment fixes (verified above) and the round-4 `schema-mirror-pin.ts` tightening (reviewed
in round 3), and no new doc drift, dead code, naming, or complexity issue appeared.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r3-f1 | Low | Closed | Comments & Documentation | `src/client/resources/filter-schema.ts:18-27`; `src/client/resources/activity-log-resource.ts:14-24` | Fixed in round 5 and re-verified this round: both doc comments now describe the two-pin split (`keyof` pin over the enum field by key-set equality only, plus a full structural `Omit<…, enumField>` pin over every other field that also catches a same-named field's type change) instead of the superseded "key-set equality only, not full structural equality" claim. All three cross-referencing docs (both schema sources + `schema-mirror-pin.ts` file doc lines 18-39) now agree, and `git grep "key-set equality only"` returns only the two correct `keyof`-pin descriptions. | No further action — fix verified complete and consistent across the three docs. |
| engineer-r4-f1 | Low | Open | DeadCode | `docs/implementation/full-api-surface/.plan.md.swp` (tracked in `HEAD`); `.gitignore` | A binary vim swap file, `.plan.md.swp`, was committed to the branch (checkpoint `a494426`) and is still tracked in `HEAD` — `git ls-files` lists it and `git cat-file -t HEAD:docs/implementation/full-api-surface/.plan.md.swp` returns `blob`. It is accidental editor junk that will be carried into the default branch when this branch merges. The working tree shows it deleted, but that deletion is **unstaged** (` D` in `git status`), so `HEAD` still contains the file. `.gitignore` also has no `*.swp` entry, so the same artifact can be re-committed. | Untrack the file (`git rm --cached docs/implementation/full-api-surface/.plan.md.swp`, then commit the removal so it is gone from the merged tree) and add a `*.swp` (and, ideally, `*.swo`) rule to `.gitignore` so editor swap files cannot be re-committed. |
