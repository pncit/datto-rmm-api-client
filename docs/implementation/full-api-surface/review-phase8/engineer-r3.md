## engineer — round 3

In-progress review. Carried state: my sole prior engineer-lens finding, `engineer-r1-f1`
(the `AuditResource` methods repeating the `Audit`/`Device` noun the namespace already supplies),
was fixed via option (a) and ratified Closed in round 2. Re-verified this round: `audit-resource.ts`
still exposes `getPrinter`/`getEsxiHost`/`getDevice`/`getDeviceSoftware`/`getDeviceByMacAddress`,
the class doc records the naming rule (lines 42–46), and `git grep` for the old method names surfaces
only the Orval-generated schema identifiers. It stays Closed — no re-raise.

New scope this round: the only source change since round 2 is the round-4 reviser fix for
`architect-r2-f1`, which tightened `tests/generated/schema-mirror-pin.ts` from a key-set-only pin to
a two-pin split (a `keyof` pin over the one enum field + an `Omit<…, enumField>` full-structural pin
over every other field) for `Filter`/`filterSchema` and `ActivityLog`/`activityLogSchema`. The pin
file's own doc comment was updated to describe the new split, and the tighter pins are internally
consistent. However, that fix left two *cross-referencing* doc comments in the schema source files
stale — they still describe the pin as "key-set equality only, not full structural equality," which
is now false. That is the one new finding below (`engineer-r3-f1`).

I re-read the rest of the Phase 8 surface (`operation-map.ts`, `public-types.ts`, `index.ts`,
`datto-rmm-client.ts`, the five resource classes, `filter-schema.ts`/`site-resource.ts` extraction,
`base-resource.ts` doc edits) for any other engineer-lens issue. The `base-resource.ts` doc edits
(`audit.getDeviceByMacAddress`, `deleteVariable`/`deleteProxy` examples) are accurate to the current
surface, the `public-types.ts` curation is self-enforcing by named re-export, and no other doc drift,
dead code, or complexity issue surfaced. No further new findings.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Closed | Naming | `src/client/resources/audit-resource.ts` | Ratified in round 2 and re-verified this round: the five `AuditResource` methods drop the redundant `Audit`/`Device` noun (`getPrinter`/`getEsxiHost`/`getDevice`/`getDeviceSoftware`/`getDeviceByMacAddress`), a class-doc sentence records the naming rule, every call site matches, and `git grep` finds no stale caller of the old names. | No further action — fix verified complete and consistent. |
| engineer-r3-f1 | Low | Open | Comments & Documentation | `src/client/resources/filter-schema.ts:22-24`; `src/client/resources/activity-log-resource.ts:18-20` | The round-4 fix for `architect-r2-f1` tightened `schema-mirror-pin.ts` so `filterSchema`/`Filter` and `activityLogSchema`/`ActivityLog` are now each pinned by **two** assertions — a `keyof` pin over the one enum field (`type`/`entity`) *plus* an `Omit<…, enumField>` full-structural pin over every other field (`_Filter`/`_ActivityLog` at `schema-mirror-pin.ts:103-108,112-117`). The reviser updated the pin file's own doc comment to describe this split but left the two schema-source doc comments that cross-reference the pin unchanged: `filter-schema.ts:24` still reads "pins this schema against `Filter` by key-set equality only, not full structural equality," and `activity-log-resource.ts:20` still reads "pins this schema against `ActivityLog` by key-set equality only, not full structural equality." Both statements are now factually wrong — a maintainer reading the schema (the natural place to look before editing it) would believe a same-named field's *type* change (e.g. a nested `site`/`user` object or a scalar) goes uncaught, when in fact the new `Omit` pin catches exactly that. `git grep "key-set equality only"` confirms these are the only two remaining occurrences. | Update both doc comments to describe the current two-pin split rather than "key-set equality only." Each should state that the pin covers the one enum field (`type`/`entity`) by key-set equality (because Phase-2 enum-widening makes a full `Equal` fail at compile time) and every *other* field by full structural equality via `Omit<…, "type"/"entity">` — mirroring the language now in `schema-mirror-pin.ts`'s file doc (lines 19-39), so the three docs agree. |
