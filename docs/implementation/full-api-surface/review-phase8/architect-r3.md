## architect — round 3

In-progress review of Phase 8 (scope: `git diff 71f93e8..HEAD` plus the uncommitted `reviser-r4`
working-tree edits to `design.md`, `plan.md`, and `tests/generated/schema-mirror-pin.ts`). I read my
`architect-r1`/`architect-r2` turns, the `reviser-r4` dispositions, and `mediator-r3`'s rulings, and
re-verified each disposition against the working tree. Both previously-open findings were dispositioned
`Fixed`; both fixes verify, so both close this round. No new findings — the phase has converged.

**Carry-forward accounting:**

- **architect-r1-f2 → Closed (ratified).** The human ruling relayed through `mediator-r3` has been
  applied. `design.md`'s "Public surface" section no longer claims `src/index.ts` exports "the
  generated types"; it now reads that `src/index.ts` exports `createDattoRmmClient`, `DattoRmmClient`,
  the config/logger types and error classes, "plus a **curated subset** of entity/response types
  re-exported **by name** from the hand-maintained `src/public-types.ts` — never a wildcard re-export
  of the generated types (see `plan.md:543-544`…)." This matches the delivered surface
  (`src/index.ts:23` `export * from "./public-types";` as the sole type re-export path; no
  `export * from './generated/types'` anywhere) and the plan-mandated curation. Design record is now
  internally consistent with the shipped `1.0.0` surface. Fix complete and correct.

- **architect-r2-f1 → Closed (ratified).** The `Filter`/`ActivityLog` mirror pins in
  `schema-mirror-pin.ts` are now split as recommended. Alongside the retained key-set pins
  (`_FilterKeys` L100-102, `_ActivityLogKeys` L109-111) the reviser added full-structural pins
  `_Filter = Expect<Equal<Omit<Filter,"type">, Omit<z.infer<typeof filterSchema>,"type">>>` (L103-108)
  and `_ActivityLog = Expect<Equal<Omit<ActivityLog,"entity">, Omit<z.infer<typeof activityLogSchema>,
  "entity">>>` (L112-117). Together these now inspect exactly what the bare `keyof` comparison skipped:
  the two nested object shapes on `ActivityLog` (`site: {id,name}`, `user: {id,userName,firstName,
  lastName}`) and its scalar *types* (`date`, `deviceId`, `hasStdOut`, `hasStdErr`), while still
  exempting only the one Phase-2-widened enum field per mirror — the exact scoping I asked for. The
  file doc (L19-39) was rewritten to describe the two-pin split accurately (key-set for the enum field
  + `Omit`-based full structural equality for the rest) rather than claiming whole-schema key-set-only.
  The reviser reports `npm run typecheck` clean across all three projects; per my read-only constraint
  I did not execute it, but the pin construction is sound and drift-detection is restored for Phase 8's
  most deeply-nested new entity. Fix complete and correct.

**New this round:** none. The remainder of the Phase 8 surface was walked exhaustively in r1/r2 (clean
dependency direction across the five new resources; single shared axios instance + masked logger in
`datto-rmm-client.ts`; faithful `public-types.ts` curation; `OPERATION_MAP`'s 57 rows and the two
surface pins) and is unchanged by `reviser-r4`, whose only code-adjacent edit was the pin tightening
above. No regressions introduced. I have no open or escalated findings carried into a future round.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f2 | Low | Closed | PublicAPI | `docs/implementation/full-api-surface/design.md` ("Public surface") | Ratified. The human-ruled reconciliation is applied: the "Public surface" section now states `src/index.ts` exports a **curated subset** of entity/response types re-exported **by name** from `src/public-types.ts`, "never a wildcard re-export of the generated types," cross-referencing `plan.md:543-544`. Matches the delivered surface (`src/index.ts:23` re-exports only `./public-types`; no `export * from './generated/types'`). Design record is now consistent with the shipped `1.0.0` surface. | No action — closed. |
| architect-r2-f1 | Low | Closed | DataModel | `tests/generated/schema-mirror-pin.ts:100-117` (`_Filter`/`_FilterKeys`, `_ActivityLog`/`_ActivityLogKeys`) and doc L19-39 | Ratified. The whole-schema key-set-only demotion is replaced by a two-pin split: a `keyof` pin for the single enum field each mirror carries (presence/absence still caught) plus an `Omit<…,"type"|"entity">` full-structural pin covering every other field — restoring type-change drift-detection for `ActivityLog`'s two nested object shapes (`site`, `user`) and its scalar types (`date`, `deviceId`, `hasStdOut`, `hasStdErr`), and `Filter`'s remaining scalars. Only the Phase-2-widened enum field is exempted, as intended; file doc updated to describe the split. | No action — closed. |
