## implementation-auditor — round 3

Scope: re-verification of the one Open finding carried into round 3 (`implementation-auditor-r2-f1`,
`warrantyWriteBodySchema`) against `reviser-r2.md`'s disposition and the current working tree, plus a
fresh exhaustive hunt over the round-3 diff. The only uncommitted change since round 2 is
`src/schema-overrides/write-bodies.ts` (the r2-f1 fix) — `git status` shows no other tracked source
touched, so the coexistence rule still holds (old runtime surface untouched, only the new
`src/client/**` + `src/schema-overrides/**` trees plus their `tests/**` counterparts exist).

Gates re-run this round on the current tree:
- `npm run typecheck` (`:src` + `:test` + `:tools`) — clean.
- `npm run lint` — 0 errors, 11 pre-existing warnings, all in untouched old-surface files
  (`src/auth.ts`, `src/client.ts`, `src/httpClient.ts`, `src/logger.ts`) — unchanged baseline.
- `npm test` — 311/311 passing across 25 files.
- Spot-verified (via `tsx`) that `.extend` on the generated **strict** write bodies preserves R6
  unknown-key rejection: `warrantyWriteBodySchema`, `createSiteVariableWriteBodySchema`, and
  `createAccountVariableWriteBodySchema` each reject a body with a bogus extra key. So the round-2
  `.extend` refactor did not silently loosen strictness.

### Re-verification of round-2 finding

- **r2-f1 (Low, BestPractices — `warrantyWriteBodySchema` hand-rebuilt instead of derived)** →
  **Fixed / ratified Closed.** `write-bodies.ts:100-102` now reads
  `export const warrantyWriteBodySchema = setWarrantyDataBody.extend({ warrantyDate: z.string().nullable() })`,
  importing `setWarrantyDataBody` from the generated `-v2-device.zod` alongside its siblings. This
  restores the module's single-source-of-truth / regeneration-tracking pattern: a regeneration that
  renames the generated warranty body now breaks the import at compile time, and an added field is
  inherited through `.extend` rather than silently strict-rejected. The `.extend` override keeps
  `warrantyDate` **required but nullable** (a bare `z.string().nullable()` is non-optional), so `{}`
  still fails and `{ warrantyDate: null }` (the documented clear form) still passes — the three
  existing `warrantyWriteBodySchema` tests (`write-bodies.test.ts:59-76`) pass unmodified, confirming
  the accepted/rejected shapes are unchanged. The doc comment was updated to describe the `.extend`
  derivation. Verified strictness is preserved (see gates above).

### Re-verification of round-1 findings (all previously ratified Closed — spot-confirmed still fixed)

- **r1-f1 (Medium, PlanAdherence — "each write body")** → still Closed. `write-bodies.ts` reconciles
  every body-carrying write named by a Phase 5 `WriteOpKey` (two re-exported as already
  spec-required, seven hand-verified wrappers), each with a test.
- **r1-f2 (Low, Tests — R20 meta invariant)** → still Closed. `base-resource.test.ts:442-466` flows a
  real string wire value (`"S3CR3T-RAW-WIRE-VALUE"`) into `dropped[].error` and asserts absence from
  both the message and `JSON.stringify(meta)` — a genuine leak guard.
- **r1-f3 (Low, PlanAdherence — paginate optional args)** → still Closed. `base-resource.ts:375-381`
  restores the pinned optional `params?`/`context?` trailing signature with an `UNKNOWN_CONTEXT`
  fallback.
- **r1-f4 (Low, Design — silent zero-item page)** → still Closed. `validateArrayResponse`
  (`base-resource.ts:307-331`) branches on `Array.isArray(data)` and emits a distinct
  `"response array field was not an array"` warn for non-array data.

### Fresh hunt (round-3 diff + whole-phase re-read)

Re-read every Phase 6 source file (`base-resource.ts`, all six `schema-overrides/*.ts`) and every
Phase 6 test against the plan's Phase 6 Steps/Tests. No new defects found:

- `BaseResource` primitives all route through the single shared axios instance and attach an explicit
  `RateDescriptor`; the bodied/bodiless overload dispatch keys on a fixed argument-tail length (3 vs
  5); `validateRequest` (strict, pinned 2-arg throw), `validateResponse` (lenient via `parseLenient`,
  3-arg throw with `{ context }`), and `validateArrayResponse` (per-call aggregated single `warn`,
  capped at `MAX_REPORTED_DROP_ERRORS`, wire values only in masked `meta`) all match the plan.
- `paginate` validates each page's cursor strictly against `pageDetailsSchema` (throws, never
  truncates), validates the named array leniently, attaches `{ kind:'read' }` per page, and
  terminates on falsy `nextPageUrl` (covering the real `""` terminal).
- `udfSchema`, `alertContextSchema`, `pageDetailsSchema` match the plan's literal schema text; the
  `Omit`/`Pick` open-enum graft in `types.ts` is driven from the `*_WIDENED_FIELDS` `as const`
  constants; `OVERRIDE_ENTITIES` pairs each entity's **schema** (not name) with its constant, so
  Phase 9's `enumFieldPaths` guard consumes a `z.ZodType` with no reverse dependency into
  `schema-leniency.ts`.

### Drift Report

**Out-of-scope changes:** None. The sole round-3 edit is to the Phase 6-owned
`src/schema-overrides/write-bodies.ts`.

**Cross-phase gaps (carried forward from prior rounds — properly deferred, not gating Phase 6):**
Unchanged and correctly still documented in `write-bodies.ts`'s module doc / phase notes §11, not
silently edited into out-of-scope Phase 5 files: (a) `POST /api/v2/site/{siteUid}` (site update) is a
body-carrying write with **no** `WriteOpKey`; (b) `filter-create`/`filter-delete` are dead
`WriteOpKey` entries with no real spec operation; (c) the variable/proxy `DELETE` counterparts have
no explicit opKey; (d) the `device-proxy-set` opKey names a `device-` prefix for what is actually a
`POST /site/{siteUid}/settings/proxy` (site) endpoint. All belong to Phase 5's `rate-limits.ts` /
Phase 8's `coverage-map.test.ts` triage and are flagged there so Phase 8's authoritative R1 guard
does not silently omit them.

### Disposition

All round-1 and round-2 findings are Closed and re-verified; the fresh round-3 hunt surfaced no new
findings. From ImplementationAuditor's perspective Phase 6 is converged and clean.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | PlanAdherence | `src/schema-overrides/write-bodies.ts` | Carried forward, still Closed: every body-carrying write named by a Phase 5 `WriteOpKey` is reconciled (2 re-exported spec-required, 7 hand-verified wrappers), each tested — satisfies plan Step 3 "wrap each generated write-body schema" (R6). | — |
| implementation-auditor-r1-f2 | Low | Closed | Tests | `tests/unit/client/base-resource.test.ts:442-466` | Carried forward, still Closed: R20-invariant test flows a real string wire value into `dropped[].error` and asserts absence from both message and `JSON.stringify(meta)`. | — |
| implementation-auditor-r1-f3 | Low | Closed | PlanAdherence | `src/client/resources/base-resource.ts:375-381` | Carried forward, still Closed: `paginate` trailing `params?`/`context?` restored to the plan's pinned optional signature with `UNKNOWN_CONTEXT` fallback. | — |
| implementation-auditor-r1-f4 | Low | Closed | Design | `src/client/resources/base-resource.ts:307-331` | Carried forward, still Closed: non-array `data` emits a distinct `warn` instead of a silent `[]`; genuinely-empty array stays silent. | — |
| implementation-auditor-r2-f1 | Low | Closed | BestPractices | `src/schema-overrides/write-bodies.ts:100-102` | Re-verified Fixed this round: `warrantyWriteBodySchema` now derives from the generated `setWarrantyDataBody` via `.extend({ warrantyDate: z.string().nullable() })`, restoring the single-source/regeneration-tracking pattern; `warrantyDate` stays required-but-nullable; `.extend` confirmed to preserve R6 strict unknown-key rejection; existing tests pass unmodified. | — |
