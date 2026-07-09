## implementation-auditor — round 1

### Phase coverage

Phase 8 delivers the remaining five resource namespaces (`audit`, `filters`, `users`,
`activityLogs`, `system`), finalizes `DattoRmmClient` to mount all ten namespaces + a thin
`createDattoRmmClient` factory, rewrites `src/index.ts`/`src/public-types.ts` into a curated public
barrel, deletes the entire 0.1.x surface in the same change, and adds the coverage-map machinery
(`src/client/operation-map.ts` + `coverage-map.test.ts`). I reviewed the eight plan steps against
the working tree.

What holds up well (verified directly, not assumed):

- **Path/verb correctness is mechanically guarded.** `OPERATION_MAP` has 57 entries; the committed
  `spec/openapi.json` has exactly 53 paths / 57 operations (I counted independently). Every
  paginate `arrayKey` matches the generated envelope key (`software`/`filters`/`users`/`activities`
  all confirmed against `src/generated/schemas/**`). `coverage-map.test.ts` derives the spec set at
  test time, asserts duplicate-free set equality, and drives each operation to a scoped nock
  intercept — a real R1 guard, not a bare count.
- **Generated schema references all resolve** (`getPrinterAuditResponse`, `getEsxiHostAuditResponse`,
  `getDeviceAuditResponse`, `getDeviceAuditByMacAddressResponseItem`, `resetApiKeysResponse`,
  system `getResponse`/`getStatusResponse`/`getPaginationConfigurationsResponse`).
- **Hand-mirrored item schemas match their generated types** (`softwareSchema`↔`Software`,
  `authUserSchema`↔`AuthUser` full-structural, `activityLogSchema`↔`ActivityLog` key-set) and are
  pinned in `schema-mirror-pin.ts`; the `filterSchema` extraction into `filter-schema.ts` is a
  faithful move of the established `variable-schema.ts` pattern.
- **Barrel hygiene:** neither `src/index.ts` nor `src/public-types.ts` contains
  `export * from './generated/types'`; `surface-pin.ts` compile-time-pins the absence of
  `Result`/`ProblemError` and two raw generated types.
- **Old surface fully removed** (`src/__tests__` and `src/internal` gone; the ten 0.1.x files
  deleted; fixtures moved to `tests/fixtures/` with no dangling references in `tests/`).

Deviations 1–3 in the notes (shared `filter-schema.ts`, the `auth-manager.ts` doc reword, the four
tooling configs dropping dead `src/__tests__` globs) are minimal, in-scope, and correctly
characterized.

### Drift

No scope drift into Phases 9/10. The `site-resource.ts` and config edits are the minimal
necessities the notes claim. Findings below are two exit-gate/hygiene items, one dead-surface
item, and one design/plan reconciliation the phase surfaces but cannot itself settle.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Open | Plan Adherence | `src/docs/implementation/resilient-device-validation/review-plan/architect-r5.md` | A review-doc from an **unrelated** plan (`resilient-device-validation`) is tracked under `src/`. It is misplaced cruft (documentation belongs under `docs/`, not the source tree that `tsconfig`/coverage globs target), and it is a direct cause of this phase's own exit gate `! git grep -qn "Result<" -- src/` failing (line 48 contains `Result<Device[]>`). The notes (§11) acknowledge it but decline to act, citing scope. Since the gate is Phase 8's and the file has no reason to live under `src/`, relocating it is low-risk cleanup that removes one gate contributor. | Move the file to `docs/` (or delete it) so `src/` holds only source and one contributor to the failing `Result<` gate is removed. |
| implementation-auditor-r1-f2 | Medium | Open | Plan Adherence | plan Phase 8 Exit Gate (`! git grep -qn "Result<" -- src/`, `! git grep -qn "validationMode" -- src/`); `src/validation/schema-leniency.ts:807-828`; `src/client/datto-client-config.ts:34` | Two of the phase's own exit-gate commands **cannot pass as literally written even with correct code**: `Result<` matches the legitimate third-party `z.ZodSafeParseResult<...>` in `schema-leniency.ts`, and `validationMode` matches the Phase-3 config doc comment that *documents the schema rejecting* it. The R9/R19 intent (the `Result<T>`/`ProblemError` contract and three-mode config are gone) is verifiably met — a scoped recheck (`git grep -n "Result<" -- 'src/**/*.ts' \| grep -v ZodSafeParseResult` after f1) returns clean — but the crude substring gate is unsatisfiable, so the phase's "all eight steps + exit gate pass" claim (self-scored 9.6 Plan Adherence) is overstated. This is a plan/gate defect needing a decision the implementor can't make unilaterally. | Escalate to the planner (Requirements Gap): refine the two gate commands to word-boundary / `.ts`-scoped / value-line greps that exclude `ZodSafeParseResult` and doc comments, so the gate reflects the code's actual (correct) state. Document the residual matches as ratified false positives in the phase record. |
| implementation-auditor-r1-f3 | Low | Open | Best Practices | `src/rate-limit/rate-limits.ts:38-39` (`filter-create`, `filter-delete`); `src/client/resources/filter-resource.ts` doc | Direct spec enumeration confirms `-v2-filter` declares no create/delete operation, so the `filter-create`/`filter-delete` `WriteOpKey` entries are provably dead — unreachable via any typed resource call and never referenced (grep: only their own definitions). They inflate the closed `WriteOpKey` union with keys that can never be legitimately passed. The notes correctly identify them as dead but leave them in place, citing Phase 5 file ownership. They remain misleading dead surface. | Reconcile with the planner/Phase 5: remove the two dead keys from `WRITE_LIMITS` (a one-line-each deletion the closed-union typecheck will keep honest), or, if kept deliberately, add an inline `// no spec operation — reserved` marker at the table itself, not only in a downstream resource doc. |
| implementation-auditor-r1-f4 | Medium | Open | Requirements Gap | plan Phase 8 Goal (l.531 "53 paths / 75 operations"); design R1; committed `spec/openapi.json` | The plan's Phase 8 goal and the design assert the surface is "53 paths / **75** operations," but the committed spec has 53 paths / **57** operations (verified two ways), and the client covers 57. R1's mechanical guarantee ("every committed-spec operation reachable") holds, but the 75 figure is unreconciled: either the design number is stale, or the committed spec is incomplete/truncated — and the latter would silently undercut R1's "entire v2 surface" promise. The implementor documented the 57 figure but flagged (correctly) that reconciling `design.md` is out of this phase's scope. This needs a human/planner fact-check. | Escalate to the planner/human (Requirements Gap): confirm whether the committed `spec/openapi.json` is the complete v2 surface (not a truncated fetch) and correct the design/plan "75 operations" figure to the authoritative count, so R1's guarantee is trustworthy on its face rather than only against a possibly-partial spec. |
