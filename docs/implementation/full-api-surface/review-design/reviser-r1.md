## reviser — round 1

Disposition of the open findings in `design-auditor-r1.md`. All seven are genuine in-scope
specification gaps or internal-consistency defects; each is Fixed by tightening the design (no scope
added). f5 is Fixed by making the masking boundary explicit rather than by folding in
variable-masking (which the R20 stakeholder decision does not settle).

| ID | Disposition | Rationale |
|----|-------------|-----------|
| design-auditor-r1-f1 | Fixed | Real internal inconsistency: strict enums + per-item drop (R7) re-create the `rmmnetworkdevice` silent-data-loss the Problem Statement condemns. R5 now specifies enum-typed response fields degrade to passthrough (union with `string`, log the unseen value); the leniency Key Concept, Decision 2 rationale, and the Current State enum note all state enum *completeness* is unprovable from a finite sweep and widened on the response side while staying strict on requests. |
| design-auditor-r1-f2 | Fixed | Genuine feasibility gap — the limiter integration was unspecified and today's `acquire()` is context-free. The dual-layer-limiter Key Concept now names the plumbing: `BaseResource` tags each request `{ kind, opKey? }`, `HttpClient.acquire()` receives it in request options and selects buckets, reads default to the read bucket, writes enforce aggregate-write plus the op-key window. |
| design-auditor-r1-f3 | Fixed | Correct: strict `.strict()` on spec-generated bodies (4/113 `required`) cannot catch a missing required field. R6 downgraded to "unknown keys + present-field types" and states required-field enforcement is not spec-derivable; the override-module Key Concept now marks the required fields for the small write set in one hand-verified place. |
| design-auditor-r1-f4 | Fixed | Real R3 violation risk — blanket leniency would tolerate a malformed cursor and truncate the walk silently. R3 and the `paginate`/`BaseResource` Key Concept now require the `pageDetails` cursor to validate strictly and throw `DattoValidationError`; leniency applies to item payloads only. |
| design-auditor-r1-f5 | Fixed | The masking guarantee (R20) was narrower than the threat it cited, leaving the boundary accidental. Tightened by adding an explicit Non-Goal: masking covers `udf*` only; masked `variables` and `Site.notes` are the consumer's responsibility. This makes the boundary deliberate without expanding scope — variable masking is a new requirement the R20 stakeholder decision does not settle. |
| design-auditor-r1-f6 | Fixed | Valid omission — the logger shape change is breaking and was absent from the migration list, so the R18 README would miss it. Added a Breaking Changes line: variadic `LoggerLike`/`console` → zod-validated `DattoLogger` `(message, meta?)`, with a shim noted for the upgrade path. |
| design-auditor-r1-f7 | Fixed | Real ambiguity that threatened the byte-for-byte success criterion. R15 and the spec-patch Key Concept now state `spec/openapi.patched.json` and `src/generated/**` are regenerated (uncommitted) artifacts, the patch script is committed and deterministic, and only `spec/openapi.json` + `openapi-prev.json` are committed. |
