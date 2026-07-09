## project-lead — round 1

Scope reviewed: `git diff origin/main` for Phase 4 — `src/validation/schema-leniency.ts`,
`src/validation/diagnostics.ts`, `tests/unit/validation/schema-leniency.test.ts`,
`tests/unit/validation/diagnostics.test.ts` (the only code/test paths the phase touches;
`pipeline-run.json` is an orchestration artifact, not a deliverable). Read the plan's Phase 4
section, design.md's R5/R7/R20 text and the "Leniency diagnostics volume & levels"/Decision-2
sections, the implementation notes, and the prior `implementation-auditor`/`reviser` turns in this
review directory (informational only — this is project-lead's first round, so there is no prior
project-lead turn to reconcile against).

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| R5 — response leniency: unknown-key strip, null/absent tolerance on any field, enum degradation to passthrough with logging | Fully Met | `addCatchallRecursive`/`detectUnknownProperties` implement all three; unobserved enum members widen and are reported, never dropped; requests are unaffected since `validateRequest` (Phase 6) never calls `parseLenient`. |
| R7 — collection responses validate per-item, invalid items dropped and logged | Partially Met (as planned) | The plan's own Phase 4 Step 3 text explicitly defers the actual per-item drop to Phase 6's `validateArrayResponse`, with this phase building only the reusable `warn`-capable `DiagnosticsCollector`. This is the correct phase boundary, not a gap in this phase's delivery. |
| R20 — UDF values never appear unmasked in logs | Fully Met (within this phase's surface) | Both diagnostic messages are static text; every wire-derived value (stripped-key value omitted entirely, enum value passed) rides in `meta`, so `withUdfMasking` scrubs it if ever UDF-shaped. |

### Behavior vs Intent / Scope / Risk
- Scope is clean: only the four files the plan names are touched; the old surface is untouched; no
  new dependencies. Nothing in this phase is wired to a live call site yet, so rollout risk is
  effectively zero at this point in the plan's sequencing (expected — `BaseResource` doesn't exist
  until Phase 6).
- The three prior-round findings (`implementation-auditor-r1-f1..f4`) are all ratified fixed per
  `implementation-auditor-r2.md`, and the diff supports that: the enveloped-list `total` fix, the
  `logger`-gates-leniency JSDoc, and the level-agnostic `flush` sink are all present and match their
  described behavior.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Open | Risk | `src/validation/schema-leniency.ts:58-79` (`toLenientField`) | The blanket per-field `.nullable().optional()` leniency is documented as sound "only because no response schema under `src/generated/schemas/**` declares a `z.union` today" — a real, load-bearing correctness invariant for R5 (a future union would silently mismatch branches instead of failing, per the deviation the implementor's own notes §5.3/§11 flag as needing confirmation). The fix applied for `implementation-auditor-r1-f4` added only an in-code comment and deferred the actual check to "Phase 9's schema-completeness audit." But Phase 9, as scoped in `plan.md`, only verifies open-enum `WIDENED_FIELDS` completeness against override-touched entities (Device/Alert) — it never mentions unions or a union-freedom check anywhere in its text. Grepping the repo (`tests/`, `src/`) for any union-freedom guard today returns nothing. So the safety net this phase's design rests on does not actually exist and isn't scheduled to exist: the "flagged forward" is a promise with no receiving phase, and the invariant is currently enforced only by a one-time manual `grep` a prior agent ran, not by anything that fails loud on a future spec refresh. | Add a small regression test in this phase's own suite (e.g. `tests/unit/validation/schema-leniency.test.ts` or a `tests/generated/` check) that asserts no `z.union` object schema exists anywhere under `src/generated/schemas/**` (or, if a future refresh does introduce one, that it is excluded from `toLenientField`'s reach) — this is cheap, exercises the exact committed schemas this module already runs against in production, and turns a currently-unverified assumption into something that fails the build the moment it becomes false, rather than depending on a future phase that doesn't currently plan to check it. |

No other issues found: requirements coverage, scope discipline, and rollout risk for this phase are
otherwise sound.
