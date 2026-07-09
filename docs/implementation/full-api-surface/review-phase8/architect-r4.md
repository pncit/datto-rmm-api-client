## architect — round 4

In-progress review of Phase 8 (scope: `git diff` `feat/full-api-surface` vs. `main`, plus the
uncommitted working-tree edits from `reviser-r5`). I read my `architect-r1`/`r2`/`r3` turns, the
`reviser-r4`/`reviser-r5` dispositions, and `engineer-r3`. Both of my findings closed (ratified) in
round 3 — `architect-r1-f2` and `architect-r2-f1` — so per carry-forward discipline they are **not**
re-listed here. I enter this round with **zero** open or escalated architect findings.

**What changed since my r3 review:** the only source edit is the `reviser-r5` fix for the
*engineer* finding `engineer-r3-f1` — two cross-referencing doc comments that had gone stale after the
r4 pin tightening. I re-verified it from the architectural lens (public-surface / boundary invariants
are what I own, and doc drift on the mirror-pin contract touches the type-safety boundary):

- `src/client/resources/filter-schema.ts:22-27` now describes the two-pin split accurately — a `keyof`
  pin over `type` by key-set equality *plus* a full structural `Omit<Filter, "type">` pin over every
  other field, "which — unlike key-set equality — also fails if a same-named field's type changes."
- `src/client/resources/activity-log-resource.ts:19-24` states the equivalent for `entity`/
  `ActivityLog`, explicitly naming the nested `site`/`user` objects and scalar types covered by the
  `Omit` pin.

Both now agree with `schema-mirror-pin.ts`'s file doc (L19-39). `git grep "key-set equality only"`
returns only these two occurrences, each in its correct new context ("a `keyof` pin … by key-set
equality only … plus a full structural `Omit` pin"), not the superseded whole-schema claim. The
`@internal` guard ("The `src/index.ts` barrel must never `export *` from this module") is retained on
both, preserving the curated-surface boundary. No architectural change, no new coupling, no regression.

**Public-surface invariants re-confirmed** (unchanged, still holding): `src/index.ts:23` is the sole
type re-export path (`export * from "./public-types"`); no `export * from '.../generated/types'` exists
anywhere in `src/`; the generated-type surface remains gated behind the hand-curated
`public-types.ts`. The five Phase-8 resource namespaces, the shared axios instance + masked logger in
`datto-rmm-client.ts`, `OPERATION_MAP`, and the surface pins were walked exhaustively in r1/r2 and are
untouched by `reviser-r5`.

**New this round:** none. The phase has converged from the architecture lens — dependency direction is
clean, boundary DTOs stay separated from domain models, the public surface is curated and internally
consistent with the design record, and the mirror-pin drift-detection contract is now documented
consistently across all three files. I carry no open or escalated findings forward.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| — | — | — | — | — | No open or new architect findings this round. Both prior findings (`architect-r1-f2`, `architect-r2-f1`) closed in round 3 and are not re-listed. | No action. |
