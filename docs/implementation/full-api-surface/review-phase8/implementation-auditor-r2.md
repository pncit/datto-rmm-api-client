## implementation-auditor — round 2

### Re-verification of round 1

I re-checked each round-1 finding against the current working tree (`git diff`, `git status`,
scoped greps) rather than trusting the reviser's dispositions.

- **implementation-auditor-r1-f1 (Fixed → Closed).** `git status` shows the stray review-doc
  relocated via rename: `R src/docs/.../architect-r5.md -> docs/.../architect-r5.md`. `src/docs/`
  no longer exists, the file lives under `docs/implementation/resilient-device-validation/review-plan/`,
  and `git grep "Result<" -- src/` no longer matches it (only the legitimate `z.ZodSafeParseResult`
  occurrences remain). Genuinely resolved.
- **implementation-auditor-r1-f3 (Fixed → Closed).** `filter-create`/`filter-delete` are gone from
  `WRITE_LIMITS` (`src/rate-limit/rate-limits.ts`); `git grep "filter-create\|filter-delete" -- src/ tests/`
  is empty. The `FilterResource` class doc and `BaseResource.httpDelete` doc were updated to drop the
  removed keys, and the placeholder test in `base-resource.test.ts` now tags a **real** opKey
  (`site-variable-set`, confirmed used by `SiteResource.deleteVariable` at `site-resource.ts:235`)
  against a realistic delete path. The closed `WriteOpKey` union now types exactly the keys resource
  code can pass. No dangling references remain in source or tests. Genuinely resolved.

- **implementation-auditor-r1-f2 (Escalate).** Carried forward as **Escalated**. No human ruling for
  Phase 8 is recorded in `pipeline-run.json` (its `rulings` object holds only `plan:p1`), so the
  mediator's routing of this to the human is not yet settled. The facts still hold on this tree:
  `git grep "Result<" -- src/` matches only `z.ZodSafeParseResult<...>` (`schema-leniency.ts:807-828`)
  and `git grep "validationMode" -- src/` matches only the Phase-3 doc comment at
  `datto-client-config.ts:34`. Both exit-gate greps remain unsatisfiable against correct code; the
  R9/R19 substance is met. Needs the human/planner decision described in round 1.
- **implementation-auditor-r1-f4 (Escalate).** Carried forward as **Escalated**. No human ruling
  recorded. Re-counted the committed `spec/openapi.json`: 53 paths / **57** operations; `OPERATION_MAP`
  has 57 entries (58 `method:` lines minus the interface field) and the coverage test enforces 57/57.
  The "75 operations" figure still stands unreconciled across `design.md:9,23,74,417,497` and
  `plan.md:22,531,569`. Needs the human fact-check (complete spec vs. truncated fetch) from round 1.

### New issue this round

Resolving f3 removed `filter-create`/`filter-delete` from the code but left the **plan** still
referencing them as live operations (`plan.md:355` lists both in the "complete key set" for
`WRITE_LIMITS`; `plan.md:569` uses `filter-delete` as its canonical bodiless-`DELETE` example). The
code has now authoritatively established these operations do not exist, so the plan prose is stale in
the same way the "75 operations" figure (f4) is — a plan-artifact discrepancy the reviser correctly
declined to edit unilaterally. Raised below so it is reconciled alongside f2/f4 rather than lost.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | Plan Adherence | `docs/implementation/resilient-device-validation/review-plan/architect-r5.md` (was `src/docs/...`) | Ratified: the stray unrelated review-doc was `git mv`d out of `src/` into `docs/` and the empty `src/docs/**` tree removed. `src/` no longer holds any `docs/` subtree, and this file is no longer a contributor to the `Result<` gate match. | None — resolved. |
| implementation-auditor-r1-f2 | Medium | Escalated | Escalation | plan Phase 8 Exit Gate (`plan.md:580-581`); `src/validation/schema-leniency.ts:807-828`; `src/client/datto-client-config.ts:34` | Two of Phase 8's own exit-gate greps (`! git grep -qn "Result<" -- src/`, `! git grep -qn "validationMode" -- src/`) cannot pass against correct code: `Result<` matches third-party `z.ZodSafeParseResult<...>`, `validationMode` matches a Phase-3 doc comment. R9/R19 intent is verifiably met, but the literal gate is unsatisfiable. Reviser escalated (plan-artifact edit outside its remit); mediator routed to human; no human ruling is recorded in `pipeline-run.json` yet, so it remains open for the human. | Human/planner: reword the two gate commands to word-boundary/`.ts`-scoped/value-line greps that exclude `ZodSafeParseResult` and doc comments, or ratify the two residual matches as documented false positives in the Phase 8 record. |
| implementation-auditor-r1-f3 | Low | Closed | Best Practices | `src/rate-limit/rate-limits.ts`; `src/client/resources/filter-resource.ts`; `src/client/resources/base-resource.ts`; `tests/unit/client/base-resource.test.ts` | Ratified: the dead `filter-create`/`filter-delete` `WriteOpKey` entries were removed; the closed union now types only keys resource code can pass; all three docs and the one placeholder test were updated to a real opKey (`site-variable-set`). No dangling references remain in `src/` or `tests/`. | None — resolved. |
| implementation-auditor-r1-f4 | Medium | Escalated | Escalation | plan `plan.md:22,531,569`; `design.md:9,23,74,417,497`; committed `spec/openapi.json` | Plan/design prose asserts "53 paths / **75** operations"; the committed spec has 53 paths / **57** operations and the client covers 57/57 (mechanically guarded). The 75 figure is unreconciled — either stale prose or a truncated committed spec (the latter would undercut R1's "entire v2 surface" promise). Reviser escalated (needs a fact it cannot establish without live egress); mediator routed to human; no human ruling is recorded yet. | Human/planner: confirm the committed spec is the complete v2 surface, then correct "75"→"57" across `design.md`/`plan.md` (if complete), or re-fetch + `npm run generate` and re-scope (if truncated). |
| implementation-auditor-r2-f1 | Low | Open | Plan Adherence | `docs/implementation/full-api-surface/plan.md:355`, `plan.md:569` | After f3 removed `filter-create`/`filter-delete` from the code, the plan still references them as live operations: `plan.md:355` lists both in the "complete key set" seeded into `WRITE_LIMITS`, and `plan.md:569` uses `filter-delete` as the canonical bodiless-`DELETE` example. Phase 8 has now mechanically proven (coverage-map 57/57) no such operations exist, so this plan prose is stale and misleading — a plan-artifact discrepancy of the same class as f4, not a code defect. The reviser correctly declined to edit `plan.md` unilaterally. | Escalate to the planner (Requirements Gap): drop `'filter-create'`/`'filter-delete'` from the `plan.md:355` key set, and replace the `plan.md:569` bodiless-`DELETE` example with a real delete call site (e.g. `SiteResource.deleteVariable`, opKey `site-variable-set`), so the plan matches the delivered closed union. |
