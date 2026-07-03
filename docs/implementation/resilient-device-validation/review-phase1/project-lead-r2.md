## project-lead — round 2

Re-scoped via `git diff main` (production delta still confined to `src/validation.ts` +
`src/__tests__/validation.test.ts`, plus the four fixture JSON files from `reviser-r3` and
`implementation-phase1-notes.md`). Since round 1, `reviser-r4` disposed of every open finding
from `architect-r1`, `engineer-r1`, `typescript-cop-r1`, and my own `project-lead-r1-f1`. I
re-verified `project-lead-r1-f1` and looked for new requirements/scope/risk issues introduced by
this round's changes (my lens only — code style, architecture, and type-safety findings raised by
other reviewers are theirs to carry forward, not mine to re-litigate).

### Requirements Coverage (unchanged since round 1)
| Requirement | Status | Notes |
|-------------|--------|-------|
| R2 — rejected items recorded as a `ProblemError` naming device (id/uid) and failing path | Fully Met | Unchanged this round; `toProblemError`/`extractIdentity` still implement this exactly. |
| R3 — dropped-item failures logged at error level through configured logger | Fully Met | Unchanged. |
| R4 — public `Device`/`DeviceSchema`/exports unchanged | Fully Met | No barrelled module touched this round either. |
| R6 — `validate()` takes configured logger, routes `warn` diagnostic through it | Fully Met | Unchanged. |

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Closed | Risk | `implementation-phase1-notes.md` | ratified: §1/§3/§11 now record the fixture fix as a landed post-review addendum instead of an unresolved out-of-scope item. | — |
| project-lead-r2-f1 | Medium | Open | Risk | `implementation-phase1-notes.md` §5, §7, §12 | The notes file has gone stale again on the same class of issue as `project-lead-r1-f1`: `reviser-r4` made a full additional round of substantive changes to `src/validation.ts` (extracted `firstIssuePath()`, added the `identityOverride` parameter to `toProblemError`, added the `VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` constants, hoisted the `Array.isArray` guard above the mode switch) and added 3 more tests (13 tests now live in `validation.test.ts` alone), yet §5 still asserts "No deviations... the only difference from the plan's illustrative snippet is cosmetic," and §7/§12 still cite the pre-`reviser-r4` test count ("17 tests," "10 tests" in `validation.test.ts`). A Phase 2 implementor or the historian reading these notes gets an inaccurate picture of both what changed and how it was tested. | Update §5 to acknowledge the `reviser-r4` additions as deviations from the plan's illustrative snippet (all behavior-preserving, but real signature/structure changes: the new `identityOverride` param, the extracted `firstIssuePath` helper, the two log-prefix constants, the hoisted guard), and refresh §7/§12's test counts to the current totals now that `validation.test.ts` has 13 tests. |
| project-lead-r2-f2 | Low | Open | ScopeCreep | `src/validation.ts` (`toProblemError`'s `identityOverride` parameter) | This parameter (added to address `architect-r1-f3`) is unused by anything in this phase and is not matched by the plan's own Phase 2 call site: the plan's Opinionated Implementation Notes for `getDeviceByUid`'s catch call `toProblemError("Device", e, res.value, 0)` with no 5th argument, and Design Decision 4's rationale explicitly accepts `extractIdentity`'s natural id-first extraction as sufficient ("That is acceptable (R2 permits either id or uid); just keep the prose and test assertions aligned to `id=`"). The design already settled this question without needing an override mechanism, so the parameter is speculative API surface introduced for a consumer the plan says will not use it. | Either drop the `identityOverride` parameter (reverting to the plan's exact `toProblemError(entityLabel, error, item, index)` signature, since Decision 4 already accepted the id-first extraction as sufficient), or, if it is kept as a hedge, note in the phase notes that it is unused speculative surface not required by the plan so a future reader doesn't assume Phase 2 needs it. |
