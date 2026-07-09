## reviser — round 10

Dispositions for every `Open` finding in the latest Architect (`architect-r5`) and Engineer
(`engineer-r5`) turns. Both findings are Low and converge on the same weakness introduced by the
r9 enum-graft edit: the open-enum field set for override-touched entities became effectively a
second source (the hand-written `Omit`/`Pick` literals) alongside the documented `ENUM_FIELDS`
constant, and the Phase 9 alignment test only exercised one field (`Device['deviceClass']`), so the
plan's "graft and runtime widening cover the same field set" claim was unverified. Folded a single
fix addressing both.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| architect-r5-f15 | Accept | Phase 6 Step 3 (l.436) now (a) drives the `Omit`/`Pick` key set from one `as const` per-entity constant (`typeof DEVICE_ENUM_FIELDS[number]`), making the constant the single source with no hand-repeated literals, and (b) softens the overstated claim: it no longer asserts a single-field test guards the whole field set. Phase 9 Step 3 (l.608–609) adds a **completeness guard** — a test that enumerates each override-touched entity's actual enum-typed fields (from the generated type / override schema) and asserts each is present in that entity's `ENUM_FIELDS` — turning the "same field set" property into a verified gate, and drives the truly-novel-value assertion over **every** field in **every** entity's `ENUM_FIELDS`. This catches a spec-refresh enum field added to `Device`/`Alert` but omitted from its constant (which would type closed while `parseLenient` widens at runtime, reviving the R5 hazard) instead of shipping silently. Chose recommendation (a)+(b) combined for defence in depth. |
| engineer-r5-f1 | Accept | Addressed by the same Phase 6 Step 3 edit: the `Omit`/`Pick` keys are now `typeof DEVICE_ENUM_FIELDS[number]` rather than hand-written literals, so the runtime constant and the type-level graft are one source (matching the `WriteOpKey`/`DEFAULT_RETRY`/`src/defaults.ts` single-source discipline the plan invokes elsewhere) — adding an open-enum field to the constant updates the graft automatically, eliminating the desync path. Phase 9 (l.608 + example l.623–627) now asserts a truly-novel value against **each** entity's `ENUM_FIELDS` (including `Alert` fields "as applicable"), so a missing `Alert` graft fails the exit gate rather than passing on `Device['deviceClass']` alone. |

**Internal self-review:** re-read the revised Phase 6/9 text with fresh eyes across the schema axes.
The two edits are internally consistent (Phase 6's `ENUM_FIELDS` constants ↔ Phase 9's per-field
assertion + completeness guard), the Files line (l.438) already names `types.ts` as the home of the
reconciled types/`ENUM_FIELDS`, and line 161's "Phase 9 asserts the two stay aligned on the same
field set" is now literally backed by the completeness guard rather than aspirational. No exit-gate,
dependency, phasing, or design-alignment issue surfaced; no further changes folded.
