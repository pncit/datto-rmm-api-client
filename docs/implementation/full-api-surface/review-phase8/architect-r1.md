## architect — round 1

Fresh architectural review of Phase 8 (scope: `git diff 71f93e8..HEAD`, the Phase 7 → Phase 8
delta). No prior `architect` turn exists in this review dir, so this is a first-round review; I
read the `implementation-auditor`/`mediator`/`reviser` turns for context and honored their settled
rulings (the two exit-gate greps, the `75`→`57` reconciliation, and the `filter-create`/
`filter-delete` removal are human-ruled and resolved — I do not re-raise them).

### What I verified as structurally sound (no finding)

- **Dependency direction / boundaries are clean.** The five new resources import only from
  `generated/**`, `base-resource`, `narrow`, and the shared `filter-schema`; `datto-rmm-client.ts`
  imports the resources (one direction, no cycle). No resource imports the client. The old 0.1.x
  modules are deleted with no stranded imports in `src/` or `tests/` (grepped).
- **Construction/wiring** mounts all ten namespaces on one shared axios instance + one masked
  logger; `createDattoRmmClient` is a thin factory. Consistent with Phase 7.
- **Public-barrel curation is faithful and enforced** — every Phase 8 method's param/return type
  resolves in `public-types.ts`; the by-name re-exports make regeneration drift a `typecheck`
  failure. `config` sub-types are structural (`z.infer`), so no named config type is under-exported.
- **Item-schema drift is guarded.** All four new hand-mirrored schemas (`softwareSchema`,
  `authUserSchema`, `activityLogSchema`, and the extracted `filterSchema`) are pinned in
  `schema-mirror-pin.ts` (full structural for the enum-free ones, key-set for the two with widened
  enums). The `filter-schema.ts` extraction is a verbatim, behavior-preserving move of the
  established `variable-schema.ts` pattern.
- **`OPERATION_MAP` (57 rows)** transcribes the spec `(method, path)` set and the per-op nock drive
  proves each mapped method reaches the transport.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | PublicAPI | `tests/unit/client/coverage-map.test.ts:131` (`it.skipIf(!specIsCommitted)`) | The map-vs-spec **set-equality** assertion is Phase 8's central R1 mechanical guarantee ("every committed-spec operation is mapped, none unmapped or stale"). It is gated behind `skipIf(!specIsCommitted)`, so it **silently no-ops** whenever `spec/openapi.json` is absent. The per-operation `it.each` drive tests iterate the *hardcoded* `OPERATION_MAP` (not the spec), so they still run and pass — i.e. an environment without the spec yields 57 green "reaches transport" tests plus a *silently skipped* completeness check, producing false confidence that coverage is proven when the completeness half never ran. R15 mandates the spec is committed, so a missing spec here signals a broken checkout, not a legitimate condition. The auditor accepted this by analogy to `reproducibility.test.ts`, but that test skips because it needs live egress; this one only reads a committed file R15 guarantees exists. | Make the completeness path fail loudly instead of vanishing: replace the `skipIf` on this assertion with an unconditional `expect(specIsCommitted).toBe(true)` (or a top-level guard that fails if `spec/openapi.json` is missing), so the R1 completeness proof can never be silently disabled. Keep the true-egress `skipIf` only on `reproducibility.test.ts`. |
| architect-r1-f2 | Low | Open | PublicAPI | `docs/implementation/full-api-surface/design.md:452-454` ("Public surface") | The design's authoritative "Public surface" section still states `src/index.ts` exports "the config and logger types, the error classes, and **the generated types**." Phase 8 deliberately delivers the opposite — a curated `public-types.ts` with **no** `export * from './generated/types'` — per the approved plan (`plan.md:543-544`, which explicitly forbids the wildcard). The design line was left untouched by this phase (its diff only changed `75`→`57`), so it now misdescribes the delivered `1.0.0` public surface — the same class of stale design prose the human already reconciled for the "75 operations" figure (auditor-r1-f4). A reader of the design is misled about what the package exports. | Reconcile the design to the delivered/plan-mandated surface: change design.md:452-454 to say `src/index.ts` exports a **curated subset** of the entity/response types via `public-types.ts` (never a wildcard re-export of the generated types), cross-referencing `plan.md:543-544`. Same escalation path as auditor-r1-f4 (design-artifact edit outside the reviser's remit). |
