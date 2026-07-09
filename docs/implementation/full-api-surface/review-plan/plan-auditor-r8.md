## plan-auditor — round 8

Followed the in-progress-review procedure. The single round-7 `Open` finding (r7-f1, Low) was
marked `Fixed` by reviser-r7 via the auditor's option (b). I re-verified it against the actual plan
text (Phase 9 Step 3, lines 551/555/557 and the scan test at 578), and by re-computing the entropy
of the pinned example strings, rather than taking the reviser's word — it is genuinely fixed. All
rounds 1–6 findings remain ratified `Closed` and are carried forward by ID (not re-listed, per
carry-forward discipline). Re-verifying the r7-f1 fix, however, surfaced one **new** finding: the
newly-added value-content keyword pattern is applied unscoped over the committed spec, where benign
documentation text is very likely to false-positive and break the Phase 9 scan gate.

Re-verification of the round-7 fix:
- **r7-f1 → Fixed (verified).** Phase 9 Step 3 line 551 now names a fourth, documented,
  allowlist-independent sub-pattern `SECRET_KEYWORD_VALUE_PATTERN` in the real-secret-pattern branch:
  case-insensitive literal/leetspeak markers (`S3CR3T`/`SECRET`/`P4SSW0RD`/`PASSWORD`/`bitlocker`/
  `recovery key`/`apikey`, with `3→e`/`4→a`/`0→o`/`1→l` substitutions), a single-point-of-update
  constant. It explicitly targets the short, low-entropy literals the entropy gate (len ≥ 20, H ≥
  3.5) skips — and I confirm `S3CR3T` is len 6, H 2.25, so it clears neither gate and genuinely needs
  this sub-pattern. Line 555 lists the new sub-pattern among those independent of the allowlist/
  entropy scoping. Line 557's narrative is corrected: `S3CR3T` is now caught by
  `SECRET_KEYWORD_VALUE_PATTERN` and a **separate** true BitLocker-format key
  (`XXXXXX-XXXXXX-…`, 8 dash-separated groups) is the BitLocker example, so "fails under any root" is
  now true as specified. The scan test (line 578) asserts `udf5:"S3CR3T"` planted under the real root
  `src/__tests__/fixtures/` fails **specifically via `SECRET_KEYWORD_VALUE_PATTERN`** (not entropy or
  sentinel). The Phase 3 mask test (line 262) retention of `S3CR3T` is correct — masking redacts any
  non-null udf regardless of content. The committed benign values (`value1`/`value2`,
  `SYNTHETIC-UDF-300`) do not match the keyword pattern. The finding is genuinely resolved.

New this round:
- The r7-f1 fix defines `SECRET_KEYWORD_VALUE_PATTERN` as a case-insensitive substring match for
  markers including `secret`, `password`, and `apikey`, and (line 551) applies it to "a `udf\d+`
  value — **or any value anywhere in scope**." One of the three scanned roots is `spec/` — the
  committed `spec/openapi.json` (53 paths, 113 component schemas of OpenAPI 3.1 documentation). The
  plan's own entropy predicate was deliberately scoped with an allowlist/shape exclusion (the r6-f1
  fix) precisely because unscoped matching over real data false-positives; the new keyword pattern
  re-introduces unscoped value matching for a different pattern class over the most
  documentation-dense root. Raised as r8-f1 below.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r7-f1 | Low | Closed | Consistency | — | **verified Fixed r8:** Phase 9 Step 3 line 551 adds the documented, allowlist-independent `SECRET_KEYWORD_VALUE_PATTERN` (leetspeak/literal secret markers) to the real-secret-pattern branch; line 555 lists it among the allowlist/entropy-independent sub-patterns; line 557 corrects the label (`S3CR3T` caught by the keyword pattern, a separate true BitLocker-format key is the BitLocker example) so "fails under any root" is now true; scan test line 578 asserts `udf5:"S3CR3T"` under the real root fails specifically via `SECRET_KEYWORD_VALUE_PATTERN`. Entropy of `S3CR3T` re-confirmed len 6 / H 2.25, so the keyword sub-pattern is genuinely required and the guarantee now holds. |
| plan-auditor-r8-f1 | Medium | Open | Security | The r7-f1 fix's new `SECRET_KEYWORD_VALUE_PATTERN` is a case-insensitive substring match for markers including `secret`, `password`, and `apikey` (Phase 9 Step 3 line 551), applied to "any value anywhere in scope." But the scan's scope includes the committed `spec/openapi.json` (line 549: "any tracked file under `spec/`, `tests/fixtures/`, or `src/__tests__/fixtures/`"), a full OpenAPI 3.1 document of field descriptions, enum values, and example strings. A Datto RMM v2 spec very plausibly contains benign descriptive strings matching these markers — e.g. a description mentioning an "API key"/`apikey`, a "secret", or a "password" field — which the pattern would flag as a cleartext secret. That would make `node scripts/scan-secrets.mjs` exit non-zero over the committed spec and **fail the Phase 9 Exit Gate (line 589)**, contradicting the plan's own claim (line 591) that the scan "exits 0 over the committed trees" including `spec/`. The plan already learned this lesson for the entropy heuristic — it scoped it with `NON_SECRET_KEY_ALLOWLIST`/`BENIGN_IDENTIFIER_SHAPE` (the r6-f1 fix) precisely because unscoped matching over real data false-positives — but the new keyword sub-pattern re-introduces unscoped value matching over the most documentation-dense root with no such scoping. Committed fixtures are benign, so this is a scan-scope defect that surfaces when the spec is committed in Phase 2 and gates in Phase 9, not a masked live secret. | Pin the keyword sub-pattern's scope so benign spec/documentation text cannot trip it. Options: (a) apply `SECRET_KEYWORD_VALUE_PATTERN` only to values under `udf\d+` keys and to leaf values in the fixture roots (`tests/fixtures/`, `src/__tests__/fixtures/`), **excluding** the `spec/` root from this value-content sub-pattern (the spec still gets the BitLocker/entropy/keyed sub-patterns); or (b) restrict it to string values that are *whole-value* secret placeholders (anchored match, not a substring inside prose) so a description containing the word "password" does not match while a udf value of `"S3CR3T"`/`"P4SSW0RD"` does. Then add a `scan-secrets.test.ts` case (and rely on the Phase 9 gate) asserting the committed `spec/openapi.json` passes the scan, so this false-positive class is guarded rather than discovered at first spec commit. |
