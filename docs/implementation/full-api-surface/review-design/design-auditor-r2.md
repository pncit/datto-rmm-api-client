## design-auditor — round 2

Reconciled the seven round-1 findings against the revised design (all dispositioned `Fixed`), then
looked for new issues — with particular attention to regressions the fixes could introduce.

All seven round-1 fixes land and are ratified:

- **r1-f1** — R5, the leniency Key Concept, and the Decision 2 rationale now all specify enum-typed
  response fields widen to `string` (log the unseen value, don't drop the item), strict on requests;
  the Current State enum note calls out that completeness is unprovable from a finite sweep.
- **r1-f2** — the dual-layer-limiter Key Concept and Decision 3 now name the plumbing: `BaseResource`
  tags each request `{ kind, opKey? }`, `HttpClient.acquire()` receives it and selects buckets,
  replacing the context-free `acquire()`.
- **r1-f3** — R6 downgraded to "unknown keys + present-field types," states required-field
  enforcement is not spec-derivable, and the override module now carries the write-set required marks.
- **r1-f4** — R3 and the `BaseResource`/`paginate` Key Concept now require the `pageDetails` cursor to
  validate strictly and throw `DattoValidationError`; leniency applies to item payloads only. (This
  fix introduces a new interaction — see r2-f2.)
- **r1-f5** — an explicit Non-Goal now scopes masking to `udf*` only and assigns `variables`/
  `Site.notes` to the consumer, making the boundary deliberate.
- **r1-f6** — Breaking Changes now lists the `LoggerLike` → `DattoLogger` shape change with a shim.
- **r1-f7** — R15 and the spec-patch Key Concept now state `openapi.patched.json` + `src/generated/**`
  are regenerated (uncommitted) and the patch script is committed and deterministic.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | High | Closed | DesignDecision | — | ratified: R5, the leniency Key Concept, and Decision 2 now specify enum-typed response fields widen to `string` and log rather than drop, strict on requests. |
| design-auditor-r1-f2 | Medium | Closed | Feasibility | — | ratified: the limiter integration point is named — `BaseResource` tags `{ kind, opKey? }`, `HttpClient.acquire()` receives it and selects buckets. |
| design-auditor-r1-f3 | Medium | Closed | DesignDecision | — | ratified: R6 downgraded and required-field marks moved to the override module for the write set. |
| design-auditor-r1-f4 | Medium | Closed | Completeness | — | ratified: R3/`BaseResource` now validate the `pageDetails` cursor strictly and throw on a malformed envelope. |
| design-auditor-r1-f5 | Medium | Closed | Risk | — | ratified: an explicit Non-Goal makes the UDF-only masking boundary deliberate. |
| design-auditor-r1-f6 | Low | Closed | Migration | — | ratified: the logger shape change is now in Breaking Changes with a shim note. |
| design-auditor-r1-f7 | Low | Closed | Completeness | — | ratified: R15 states the patched spec and generated output are uncommitted, deterministic artifacts. |
| design-auditor-r2-f1 | High | Open | Feasibility | R3 / `BaseResource`.`paginate` Key Concept (introduced by the r1-f4 fix) | The r1-f4 fix requires the `pageDetails` cursor to validate **strictly**, but Current State defect #1 establishes the spec models **no** nullability, so the generated `PaginationData` types `nextPageUrl`/`prevPageUrl` as required non-null `string`. On the **terminal** page `nextPageUrl` is `null` (the legitimate end-of-walk signal). Strict validation of that envelope would therefore throw `DattoValidationError` at the end of **every** paginated walk — turning the safety check into a guaranteed failure and breaking R3 outright. "Strict cursor" and "unmodeled nullability" are mutually incompatible as written. | Specify that the `pageDetails` schema is an **override** that models `nextPageUrl`/`prevPageUrl` as nullable (and `count`/`totalCount`/etc. present) — strict on **structure/shape** (missing/malformed `pageDetails` throws) while treating a null `nextPageUrl` as the normal terminal, not an error. State this in R3 and the `paginate` Key Concept so "strict" is unambiguous. |
| design-auditor-r2-f2 | Medium | Open | DesignDecision | R5 / R4 / Vision ("type-safe") (introduced by the r1-f1 fix) | The r1-f1 fix widens enum-typed fields to `string` at **runtime** on responses, but the design never says the generated **TypeScript type** is widened to match. Orval emits the narrow union (e.g. `deviceClass: 'device'|'printer'|'esxihost'|'unknown'`), so a consumer gets a compile-time type that claims exhaustiveness the runtime deliberately violates — an unobserved `rmmnetworkdevice`-class value arrives at runtime but is invisible to an exhaustive `switch`/discriminated handling, re-introducing a silent-mismatch class against the stated "type-safe client" vision. | State whether the emitted enum field type is also widened (e.g. `DeviceClass \| (string & {})`) so the type reflects the widened runtime contract, or explicitly document that response enum types are best-effort and callers must handle unknown values. One sentence in R5/R4 resolves it. |
