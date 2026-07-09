## typescript-cop — round 3

Re-scoped to `git diff main` for Phase 3's paths (`src/errors/**`, `src/logging/**`,
`src/client/datto-client-config.ts`, `src/defaults.ts`, `tests/unit/**` counterparts); the uncommitted
delta since `typescript-cop-r2.md` is confined to `src/logging/mask.ts` and
`tests/unit/logging/mask.test.ts` (`reviser-r3.md`'s fixes for `architect-r2-f1`, `architect-r2-f2`,
`project-lead-r2-f1`). No prior `typescript-cop` finding was `Open` entering this round (both r1 and r2
findings ratified `Closed`), so there is nothing to carry forward.

Reviewed the new cycle-detection code in `scrub`/`scrubEntries`: `seen: Set<object>` is threaded
through every recursive call, added on entry and removed in a `finally` on exit for both the array and
plain-object branches, so a true ancestor cycle resolves to the `"[circular]"` sentinel while a
non-circular shared reference (the same object reached via two sibling keys) is still walked in full at
each occurrence — matches the new regression tests exactly, and the `seen.has`/`seen.add`/`finally
seen.delete` sequencing has no gap that would either leak a stale entry across sibling branches or
false-negative a real cycle. `scrubMeta` still starts a fresh `Set` per top-level call, so no state
leaks across log calls. The `wrap` closure's `meta === undefined` branch narrows `meta` to
`Record<string, unknown>` in the `else` arm correctly (the parameter types are inferred from the
`DattoLogger[typeof method]` return annotation), and the two-arg/one-arg forwarding matches
`DattoLogger`'s optional-`meta` signature exactly — confirmed against the real `console`-backed test
added for this fix. The docstring rewrite for `architect-r2-f2` is prose only, no type surface changed.
Verified clean with `tsc --noEmit` against both `tsconfig.json` and `tsconfig.test.json`.

No new type holes, boundary-validation gaps, exhaustiveness issues, or floating promises found.

## Findings

No findings.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
