## reviser — round 2

Disposition of the two open findings in `design-auditor-r2.md`. Both are genuine in-scope internal
contradictions introduced by my own round-1 fixes (r1-f4 and r1-f1); each is Fixed by tightening the
design so the newly-added text is consistent with the spec's established defect profile — no scope
added.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| design-auditor-r2-f1 | Fixed | Real contradiction the r1-f4 fix created: "strict `pageDetails` cursor" collides with Current State defect #1 (spec models no nullability), so a verbatim non-null cursor schema would throw at the end of **every** walk when the terminal `nextPageUrl` is `null` — breaking R3. Fixed by specifying that `pageDetails` is a dedicated **override** schema (now named in the schema-override Key Concept) modeling `nextPageUrl`/`prevPageUrl` as nullable strings and `count`/`totalCount` as present integers, enforced **strictly on structure** (missing/malformed `pageDetails` throws `DattoValidationError`) while treating a `null` `nextPageUrl` as the ordinary end-of-walk terminal. Stated in R3 and the `paginate` Key Concept; "strict" is now unambiguous. Tightening only. |
| design-auditor-r2-f2 | Fixed | Genuine consistency gap the r1-f1 fix left open: response enums widen to `string` at runtime, but the emitted TypeScript type was never said to widen, so a consumer would get a compile-time union claiming an exhaustiveness the runtime deliberately violates — re-introducing a silent-mismatch class against the "type-safe" Vision. Fixed by stating in R5 (and the leniency Key Concept) that the emitted response type is widened to match (`EnumUnion \| (string & {})`) so callers must handle an unknown value. One-sentence tightening; no new mechanism. |
