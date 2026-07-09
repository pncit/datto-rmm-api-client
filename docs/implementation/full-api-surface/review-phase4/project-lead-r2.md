## project-lead — round 2

Re-scoped `git diff origin/main` to Phase 4's actual delta (the working-tree changes on top of the
already-committed Phase 1–3 history: `src/validation/schema-leniency.ts`, `src/validation/diagnostics.ts`,
their two test files, plus the new `tests/generated/schema-union-freedom.test.ts`; `pipeline-run.json`
remains an orchestration artifact, not a deliverable). Re-verified my round-1 finding against the
current code, then re-checked requirements coverage and scope/risk given the intervening
architect/engineer/typescript-cop rounds and the reviser's disposition of all of them.

### Requirements Coverage (re-confirmed)
| Requirement | Status | Notes |
|-------------|--------|-------|
| R5 — response leniency: unknown-key strip, null/absent tolerance, enum degradation to passthrough with logging | Fully Met | Unchanged in substance from round 1; the `collectionKey`/`trackExamined` rewrite (architect-r1-f1) and the `Lenient<T>` return-type overload (typescript-cop-r1-f1) are correctness/type-honesty improvements to the same behavior, not behavior changes. |
| R7 — collection responses validate per-item, invalid items dropped and logged | Partially Met (as planned) | Still correctly deferred to Phase 6's `validateArrayResponse`; `DiagnosticsCollector.flush`'s sink-based signature (reviser-r1, `implementation-auditor-r1-f3`) now makes that reuse literally unmodified, which strengthens rather than weakens this phase's boundary. |
| R20 — UDF values never appear unmasked in logs | Fully Met | Unchanged: both diagnostic messages remain static text; every wire-derived value rides in `meta`. |

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Closed | Risk | `tests/generated/schema-union-freedom.test.ts`, `src/validation/schema-leniency.ts` (`toLenientField`) | ratified: a new test recursively scans every `*.zod.ts` file under `src/generated/schemas/**` (verified: 10 files present today, none matching `zod.union(`/`zod.discriminatedUnion(`) and fails the suite the moment one appears; `toLenientField`'s invariant comment now points at this test as the enforcement mechanism instead of solely deferring to Phase 9. The previously-unverified assumption the blanket per-field leniency rests on is now a build-breaking regression guard against the exact committed schemas this module runs against in production. | — |

No other issues found this round: the intervening architect/engineer/typescript-cop fixes (the
`collectionKey`-based `total` accumulation, the `Lenient<T>` overload, the `groupKey` collision fix, the
naming/DRY cleanups) are all internal to the same delivered behavior and introduce no new requirements
gap, scope creep, or rollout risk — the module remains standalone and unconsumed until Phase 6, as
planned. Phase 4 is converged from this domain's perspective.
