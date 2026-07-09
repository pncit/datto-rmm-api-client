## reviser — round 8

Addressed the single round-8 `Open` finding (r8-f1, Medium). All prior findings remain `Closed`
and are carried forward by ID.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| plan-auditor-r8-f1 | Fixed | Adopted the auditor's recommendation, combining both offered options for defense in depth. In Phase 9 Step 3 (line 551) I pinned the scope of `SECRET_KEYWORD_VALUE_PATTERN` so benign OpenAPI documentation prose cannot trip the Phase 9 scan gate: (i) it is now an **anchored whole-value** match — the entire trimmed string value must *equal* a marker, so a description/example that merely *contains* "password"/"API key"/"secret" does not match while a udf value of exactly `"S3CR3T"`/`"P4SSW0RD"` does (option b); and (ii) it is applied **only to `udf\d+` values and to leaf string values under the fixture roots** (`tests/fixtures/`, `src/__tests__/fixtures/`), with the **`spec/` root excluded** from this content sub-pattern (option a). The `spec/` root still receives the BitLocker / credential / high-entropy / `password`-`secret`-keyed sub-patterns, so a genuine embedded secret is still caught there. I updated the consistency prose at line 557 to qualify the guarantee — the keyword sub-pattern catches `S3CR3T`-style literals under either **fixture** root, while the BitLocker pattern remains root-independent (covers `spec/`) — and explained the intentional fixture-vs-spec scoping split. I extended the `scan-secrets.test.ts` case list (line 578) to guard this false-positive class: the committed `spec/openapi.json` with benign prose descriptions/examples mentioning "password"/"API key"/"secret" **passes**, a whole-value `udf:"P4SSW0RD"`/`"S3CR3T"` under a fixture root **fails**, and a fixture-root description merely *containing* "password" **passes** — proving both the anchoring and the root-exclusion do their work. The Phase 9 Exit Gate (line 589) runs the scan over the real committed spec, so the guarantee at line 591 that the scan "exits 0 over the committed trees" including `spec/` now holds. This mirrors the r6-f1 lesson (scoping the entropy heuristic) rather than re-introducing unscoped value matching over the most documentation-dense root. |

### Internal self-review
Re-read Phase 9 Step 3 with fresh eyes: line 555's "unscoped by the allowlist" claim for the
keyword sub-pattern remains accurate because allowlist-scoping and root-scoping are independent
axes — the new fixture-root scoping does not contradict allowlist-independence. Verified the
Phase 3 mask test (`S3CR3T` retained after masking) and the Phase 1 fixture assumptions are
unaffected, since masking redacts by key regardless of value content and the retained real captures
carry only benign `value1`/`value2` udfs that the anchored keyword pattern does not match. No new
issues folded in.
