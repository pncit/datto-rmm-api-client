## reviser — round 5

Scope: the latest turns from all four reviewers this round — `architect-r3.md`, `engineer-r3.md`,
`project-lead-r3.md`, `typescript-cop-r3.md`. `architect-r3`, `project-lead-r3`, and `typescript-cop-r3`
each closed out their prior findings (`architect-r1-f2`, `architect-r2-f1`, `project-lead-r1-f1`) and
raised nothing new — zero `Open` findings from those three. `engineer-r3` raised one new `Open`
finding, `engineer-r3-f1`. That is the only Open finding addressed this round.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| engineer-r3-f1 | Fixed | Updated both stale doc comments to describe the current two-pin split instead of the superseded "key-set equality only, not full structural equality" claim. `src/client/resources/filter-schema.ts:18-25` now states the pin is a `keyof` pin over `type` (key-set equality, since a literal-enum `Equal` would fail today given Phase-2's codemod-widened generated type) plus a full structural `Omit<Filter, "type">` pin over every other field. `src/client/resources/activity-log-resource.ts:9-24` states the equivalent for `entity`/`ActivityLog`, explicitly calling out that the `Omit` pin covers the nested `site`/`user` objects and scalar types. Both now agree with `tests/generated/schema-mirror-pin.ts`'s file doc (lines 19-39), closing the cross-reference drift `engineer-r3-f1` identified. `git grep "key-set equality only"` now returns zero matches. `npm run lint` and `npm run typecheck` (all three projects) both pass clean on the current tree. |

No other Open findings existed across the four latest reviewer turns to address this round.
