## architect — round 2

In-progress review of Phase 8 (scope: `git diff 71f93e8..HEAD`). I read my `architect-r1` turn, the
`reviser-r3` dispositions, and `mediator-r3`'s rulings, and re-verified each against the working tree.

**Carry-forward accounting (both r1 findings):**

- **architect-r1-f1 → Closed (ratified).** The reviser removed the `it.skipIf(!specIsCommitted)`
  guard on `coverage-map.test.ts`'s spec-vs-map set-equality assertion. Verified at
  `tests/unit/client/coverage-map.test.ts:138-170`: the completeness assertion now runs
  unconditionally and its first statement is `expect(specIsCommitted, "…R15 requires it to be
  committed; this checkout is broken").toBe(true)`, so a missing committed spec fails loudly rather
  than silently no-op'ing. The doc comment (lines 133-137) records the R15 rationale and contrasts
  the legitimate live-egress `skipIf` on `reproducibility.test.ts`. Fix is complete and correct.

- **architect-r1-f2 → Escalated (carried, awaiting human ruling).** Not fixed. The reviser escalated
  it (`reviser-r3`) as a design-artifact edit outside its remit; `mediator-r3` routed it to the
  Human (Requirements Gap — not mediator-rulable). No human ruling has been supplied to this review
  directory. I re-verified the defect still stands: `design.md:452-454`'s "Public surface" section
  still reads "`src/index.ts` exports … the config and logger types, the error classes, and **the
  generated types**," while the delivered `src/index.ts:23` re-exports only the curated
  `./public-types` (no `export * from './generated/types'` anywhere, plan `plan.md:543-544`). The
  design prose still misdescribes the delivered/plan-mandated curated surface. It remains a live
  human decision; I keep it `Escalated` rather than reopen it as a fresh dispute.

**New this round:** one finding on the ActivityLog drift-pin granularity (architect-r2-f1). The rest
of the Phase 8 surface I re-walked is sound — the five new resources import only from `generated/**`,
`base-resource`, `narrow`, and the shared `filter-schema` (clean dependency direction, no cycle); the
`filter-schema.ts` extraction is a verbatim behavior-preserving move; `datto-rmm-client.ts` mounts all
ten namespaces on one shared axios instance + one masked logger; `public-types.ts` covers every
param/return type the five new resources' public signatures name; and `OPERATION_MAP`'s 57 rows plus
the two surface pins (`surface-pin.ts` `@ts-expect-error`, `surface.test.ts`) are faithful.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f2 | Low | Escalated | PublicAPI | `docs/implementation/full-api-surface/design.md:452-454` ("Public surface") | Carried from r1. The design's authoritative "Public surface" section still states `src/index.ts` exports "the generated types," but Phase 8 ships a curated `public-types.ts` re-exported by name with **no** `export * from './generated/types'` (verified: `src/index.ts:23` is the sole type re-export path), per the plan-mandated surface (`plan.md:543-544`). Reviser escalated (outside remit); mediator-r3 routed to Human; no ruling supplied yet, so the design record still misdescribes the delivered `1.0.0` surface. | Awaiting the human ruling mediator-r3 requested. Reword `design.md:452-454` to state `src/index.ts` exports a **curated subset** of entity/response types re-exported **by name** from `public-types.ts` (never a wildcard re-export of the generated types), cross-referencing `plan.md:543-544`. Same reconciliation pass as `implementation-auditor-r1-f2`/`r1-f4`/`r2-f1`. |
| architect-r2-f1 | Low | Open | DataModel | `tests/generated/schema-mirror-pin.ts:96-99` (`_ActivityLogKeys` pin) and file doc lines 19-38 | The new `activityLogSchema` mirror is pinned against `ActivityLog` by **key-set equality only** (`Equal<keyof ActivityLog, keyof z.infer<…>>`) because of its single enum field `entity`. But `activityLogSchema` carries **two nested object fields** (`site: { id, name }`, `user: { id, userName, firstName, lastName }`) plus scalar fields whose *types* (`date: number`, `deviceId: number`, `hasStdOut/hasStdErr: boolean`) are all left entirely unpinned by a top-level `keyof` comparison. The pin file's own stated purpose (lines 13-16) is to catch a hand-mirror that would "silently drop or mis-coerce that field at runtime while the declared return type still claims the old shape" — but for `ActivityLog` a spec regeneration that changes `site.name`'s type, adds a nested field, or flips `date` from `number` to a string would pass this pin silently, defeating the guard for the phase's most deeply-nested new entity. The r1-accepted `filterSchema` key-set precedent is much weaker evidence here: `Filter` is six flat scalars with no nested objects, so key-set loses only same-named scalar type-changes; `ActivityLog` additionally buries two whole object shapes the guard never inspects. The enum degradation the key-set weakening exists to accommodate is already covered generically by `lenient-type-pin.ts`, so the whole-schema demotion is broader than the one field that forces it. | Tighten the pin so only the enum field is exempted, restoring full structural drift-detection for everything else. Add `type _ActivityLog = Expect<Equal<Omit<ActivityLog, "entity">, Omit<z.infer<typeof activityLogSchema>, "entity">>>` alongside the existing `_ActivityLogKeys` key-set pin (keep the key-set pin so a change to `entity`'s presence is still caught). Apply the same `Omit`-based split to `filterSchema`/`_FilterKeys` for consistency, and update the file doc's "key-set equality for the two enum-bearing mirrors" paragraph to describe the structural-plus-keyset split. |
