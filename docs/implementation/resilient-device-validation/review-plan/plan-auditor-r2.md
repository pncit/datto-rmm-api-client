## plan-auditor — round 2

Continuing from round 1. Re-verified the reviser's three `Fixed` dispositions against the current
`plan.md` and the live repo, then hunted for new issues.

### Re-verification of round-1 findings (all reviser-marked `Fixed`)
- **r1-f1** (getDeviceByUid `logger` local) — Phase 2 Step 4 (plan L184–186) now instructs resolving
  `const logger = this.config.logger ?? defaultLogger;` at the top of `getDeviceByUid` *before* the
  `validate(...)` call and the `catch` use it, and the opinionated snippet (L269) shows it. Confirmed
  the live method (`src/client.ts` L84–103) has no `logger` in scope today, so this declaration is
  exactly what prevents the `Cannot find name 'logger'` compile break. **Ratified → Closed.**
- **r1-f2** (R4 guard outside fenced block) — Both exit gates now hold the guard *inside* the fenced
  `bash` block: Phase 1 (L156–161) and Phase 2 (L296–303) run
  `git diff --name-only | grep -qE '^src/(schemas|result|index)\.ts$' && { … exit 1; } || true`.
  Confirmed `src/index.ts` re-exports `client/config/result/schemas` (not `validation`), so the
  protected-file set is correct and `validation.ts` is legitimately mutable. **Ratified → Closed.**
- **r1-f3** (README target unnamed) — Phase 2 Documentation (L290–293) now names a concrete
  `## Resilient validation` section with a `### Behavioral changes` subsection, and the Phase 2 fenced
  gate adds `grep -q '## Resilient validation' README.md || { … exit 1; }` (L302). **Ratified → Closed.**

### Repo re-checks for this round (live source)
- `src/client.ts` — `getAllPages` early-returns `res` on `!res.ok`, walks `while (nextUrl)`,
  `nextParams = undefined` after page 1, and does `items.push(...extractor(data))`; `getDeviceByUid`
  has no logger local. All match the plan's before-state. ✔
- `src/schemas.ts` — `PaginationDataSchema` has **required** `prevPageUrl`/`nextPageUrl` (`string|null`);
  the envelope schema reuses it via `.optional()`, so a present-but-partial `pageDetails` hard-fails in
  strict/warn — consistent with design R5 (envelope = protocol error). ✔
- Fixtures — last-page `nextPageUrl` is `""` (falsy), so `while (nextUrl)` terminates correctly; the
  new envelope `safeParse` accepts all three page fixtures. ✔
- `src/index.ts` does **not** barrel `validation.ts`, so adding an exported `validateItems` does not
  widen the public surface — no R4 concern. ✔

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Clarity | ratified: Phase 2 Step 4 + snippet now declare `const logger = this.config.logger ?? defaultLogger;` at the top of `getDeviceByUid` before its `validate(...)`/`catch` uses; the `Cannot find name 'logger'` compile break is removed and Phase 2's own gate can pass. | — |
| plan-auditor-r1-f2 | Medium | Closed | Completeness | ratified: the R4 protected-file guard now lives inside the fenced `bash` block of both phase exit gates (`git diff --name-only | grep -qE '^src/(schemas|result|index)\.ts$' && { … exit 1; }`), so public type-surface stability is mechanically enforced by the pipeline driver. | — |
| plan-auditor-r1-f3 | Low | Closed | MissingDecision | ratified: Phase 2 Documentation names a concrete `## Resilient validation` / `### Behavioral changes` target and a matching `grep -q '## Resilient validation' README.md` doc-landing guard was added to the fenced Phase 2 gate. | — |
| plan-auditor-r2-f1 | Medium | Open | Test | The Phase 2 "Off, malformed envelope passthrough (R8)" test (plan L287) is under-specified — "with a divergent device / non-array-free raw page" — and the design's matching success criterion says off passes through "a malformed page envelope (e.g. `devices` is not an array)… without failing." But `off` runs `items.push(...extractor(page))` where `extractor = (p) => p.devices ?? []`; if `devices` is a non-array **object/number**, the spread throws `TypeError: … is not iterable` (if a string, it silently pushes characters, not "raw" devices). So a literal non-array-`devices` off-test either crashes or asserts garbage — it does **not** demonstrate raw passthrough, and it contradicts the "passes without failing" claim. | Specify the off-mode passthrough test uses a **well-formed page whose `devices` is an array containing a divergent device** (per-device drift), asserting the divergent device flows through untouched with no logger calls. Add a one-line note that a non-array `devices` in `off` is an inherited best-effort edge (spread on `extractor(page)`) that R8's "no fail on shape" does not cover, so the design's non-array example is not the off-mode case to test. |
| plan-auditor-r2-f2 | Low | Open | Test | No Phase 2 test exercises **cross-page `warnings[]` accumulation** in strict. The core new loop behavior is `warnings.push(...partition.warnings)` accumulating across the `while (nextUrl)` walk (design: "accumulating both the surviving `valid` items and the `warnings` across every page"), yet the listed cases cover only a single mixed page, a malformed-envelope hard-fail, and a mid-walk abort — none proves warnings/valid from two *successful* pages are both preserved and concatenated. | Add a strict multi-page case: page1 `[valid1, divergent1]` (with `nextPageUrl` → page2), page2 `[valid2, divergent2]` (terminal) → `result.ok === true`, `value` contains exactly `valid1` and `valid2`, `warnings.length === 2` (one naming each divergent device), and `logger.error` called twice. |
| plan-auditor-r2-f3 | Low | Open | Completeness | The R4 exit-gate guard uses `git diff --name-only` (working-tree unstaged changes only). If the implementor `git add`s or commits protected-file edits before the gate runs, the guard passes vacuously — weakening the exact mechanical enforcement r1-f2 established. | Change both fenced guards to `git diff --name-only HEAD` (catches staged + unstaged) so a protected-file change to `src/{schemas,result,index}.ts` is detected regardless of staging state. |
