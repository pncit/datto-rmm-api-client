## design-auditor — round 3

Re-verified the reviser's two `Fixed` dispositions from round 2 against the revised `design.md` and
the actual package (`src/client.ts`, `src/validation.ts`, `src/schemas.ts`). Both fixes land:

- **r2-f1** (warn-mode envelope R5 hole): Decision 2 (L132–136) and "Generic `getAllPages` plumbing"
  (L97) now state envelope validation is a **direct `safeParse` hard-fail** on the envelope schema,
  explicitly *not* the mode-branching `validate()` seam, returning `{ ok: false, error: { type:
  "validation-error" } }` identically in `strict` and `warn`. The Planner can no longer wire the
  envelope through `validate()` and open a warn-mode passthrough hole.
- **r2-f2** (R8 / Breaking Changes accuracy): R8 (L46) now scopes "only log routing changes" to the
  **per-device path** and calls out the envelope exception (warn now hard-fails where it previously
  returned `{ ok: true, value: [] }`, `off` unaffected); Breaking Changes gains item 2 (L171)
  documenting the warn-mode envelope change alongside the strict outcome-shape change.

I also checked the blast radius of the two signature changes the design introduces: `getAllPages`
has a **single** caller (`getAccountDevices`, `client.ts:75`) and `validate()` has one production
caller beyond `getDeviceByUid` (both in `client.ts`) plus the `deviceSchema.test.ts` guard fixture —
so the `extractor: (page)=>unknown[]` and added-logger signature changes are fully contained, with no
stranded caller the design fails to account for. No new inconsistency surfaced; the design has
converged.

### Prior-finding re-verification
| ID | Reviser said | Verified in design | Result |
|----|--------------|--------------------|--------|
| r2-f1 | Fixed | L97 + L132–136: envelope is a direct `safeParse` hard-fail, deliberately not the mode-branching `validate()`; identical `{ok:false}` in `strict`/`warn` | Closed |
| r2-f2 | Fixed | R8 (L46) scoped to per-device path with the envelope exception noted; Breaking Changes item 2 (L171) documents the warn-mode envelope hard-fail | Closed |

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r2-f1 | Medium | Closed | Completeness | Decision 2 / Key Concepts | ratified: envelope validation is now specified as a direct `safeParse` hard-fail on the envelope schema (not the mode-branching `validate()` seam), returning `{ok:false, error:{type:"validation-error"}}` identically in `strict` and `warn`; the warn-mode R5 hole is closed. | — |
| design-auditor-r2-f2 | Medium | Closed | DesignDecision | R8 / Breaking Changes | ratified: R8 scopes "only log routing changes" to the per-device path and names the envelope exception; Breaking Changes item 2 records the warn-mode malformed-envelope hard-fail alongside the strict change. Consistency restored. | — |
