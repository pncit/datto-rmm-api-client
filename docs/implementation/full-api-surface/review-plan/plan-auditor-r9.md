## plan-auditor — round 9

Followed the in-progress-review procedure. The single round-8 `Open` finding (r8-f1, Medium) was
marked `Fixed` by reviser-r8, combining both offered options. I re-verified it against the actual
plan text (Phase 9 Step 3 lines 551–552, 559; scan test line 580; Exit-Gate note line 593) rather
than taking the reviser's word — it is genuinely fixed. All rounds 1–7 findings remain ratified
`Closed` and are carried forward by ID (not re-listed, per carry-forward discipline). Re-verifying
the r8-f1 fix, however, surfaced one **new** finding: the fix drew the fixture-vs-spec scoping line
around **only** the keyword sub-pattern, explicitly re-affirming that the **high-entropy**
sub-pattern still runs over `spec/` — and that entropy predicate false-positives on ordinary
OpenAPI description prose, so the same "spec trips the Phase 9 gate" failure the r8-f1 fix set out
to eliminate returns through a different sub-pattern.

Re-verification of the round-8 fix:
- **r8-f1 → Fixed (verified).** Phase 9 Step 3 now pins `SECRET_KEYWORD_VALUE_PATTERN`'s scope
  (line 552): (i) an **anchored whole-value** match — the entire trimmed value must *equal* a marker
  (optionally quoted), so prose that merely *contains* "password"/"secret"/"API key" does not match
  while a udf value of exactly `"S3CR3T"`/`"P4SSW0RD"` does; and (ii) it is applied **only** to
  `udf\d+` values and leaf strings under the fixture roots (`tests/fixtures/`,
  `src/__tests__/fixtures/`), with the **`spec/` root excluded** from this content sub-pattern. The
  consistency prose (line 559) now correctly states the committed spec's benign documentation prose
  passes *because the keyword sub-pattern is fixture-root-scoped and anchored*, while `S3CR3T` is
  caught under either fixture root and a true BitLocker key is caught root-independently. The scan
  test (line 580) adds the guard: the committed `spec/openapi.json` with prose mentioning
  "password"/"API key"/"secret" **passes**, a whole-value `udf5:"P4SSW0RD"`/`udf6:"S3CR3T"` under a
  fixture root **fails**, and a fixture-root description merely *containing* "password" **passes** —
  exercising both the anchoring and the root-exclusion. Line 555's "unscoped by the allowlist" claim
  for the keyword pattern stays accurate (allowlist-scoping and root-scoping are independent axes).
  The finding is genuinely resolved for the keyword sub-pattern.

New this round:
- The r8-f1 fix explicitly re-affirms (line 552): "The `spec/` root still receives the BitLocker /
  credential / **high-entropy** / `password`-`secret`-keyed sub-patterns … but not the prose-tripping
  keyword scan." So the entropy sub-pattern is deliberately kept live over `spec/`. That predicate
  (line 554) flags any string ≥ `MIN_SECRET_LEN = 20` with Shannon char-entropy ≥
  `MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3.5` under a non-allowlisted, non-MAC/GUID key. I computed the
  entropy of representative OpenAPI description prose: `"The date and time when the device was last
  seen by the platform"` → **H = 3.86** (len 63); `"A short description of the alert context and its
  category"` → **H = 3.88** (len 57). Both clear the length and entropy gates, sit under a
  non-allowlisted `description`/`summary` key, and are not MAC/GUID-shaped — so the entropy
  sub-pattern flags them. A full OpenAPI 3.1 document (53 paths, 113 schemas) is dense with exactly
  such prose. Raised as r9-f1 below.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r8-f1 | Medium | Closed | Security | — | **verified Fixed r9:** Phase 9 Step 3 line 552 pins `SECRET_KEYWORD_VALUE_PATTERN` to an anchored whole-value match applied only to `udf\d+` values and fixture-root leaf strings, excluding `spec/`; line 559 justifies the spec pass via that root-scoping/anchoring; scan test line 580 guards the false-positive class (committed spec passes; whole-value `udf:"P4SSW0RD"`/`"S3CR3T"` under a fixture root fails; a description merely containing "password" passes). Verified the anchoring and root-exclusion both do work; line 555's allowlist-independence claim remains consistent. |
| plan-auditor-r9-f1 | Medium | Open | Security | The r8-f1 fix eliminated the keyword sub-pattern's spec false-positives by scoping it out of `spec/`, but in doing so it **explicitly re-affirms that the high-entropy sub-pattern still runs over `spec/`** (Phase 9 Step 3 line 552: "The `spec/` root still receives the BitLocker / credential / **high-entropy** / `password`-`secret`-keyed sub-patterns … but not the prose-tripping keyword scan"). The entropy predicate (line 554) flags any string with length ≥ `MIN_SECRET_LEN = 20` **and** Shannon char-entropy ≥ `MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3.5` bits/char under a key not on `NON_SECRET_KEY_ALLOWLIST` and not matching `BENIGN_IDENTIFIER_SHAPE`. Ordinary OpenAPI description/summary/example prose satisfies all four: it is long (descriptions routinely exceed 20 chars), its unigram char-entropy is ~3.85–3.9 bits/char (computed: `"The date and time when the device was last seen by the platform"` → H = 3.86; `"A short description of the alert context and its category"` → H = 3.88 — both > 3.5), it sits under non-allowlisted keys (`description`, `summary`, `title`, `example`), and it is not MAC/GUID-shaped. A full OpenAPI 3.1 document (53 paths, 113 component schemas) is dense with such prose, so `node scripts/scan-secrets.mjs` would exit non-zero over the committed `spec/openapi.json`, **failing the Phase 9 Exit Gate (line 589)** and contradicting the plan's own claim (lines 559 and 591/593) that the scan "exits 0 over the committed trees" including `spec/`. Critically, the plan's justification for the spec passing (line 559) reasons **only** about the keyword sub-pattern ("the keyword sub-pattern is fixture-root-scoped and anchored, so prose cannot trip it") and never addresses the entropy sub-pattern it deliberately leaves running over the same prose — the exact r8-f1 failure class, re-entering through the sub-pattern the r8-f1 fix did not touch. Committed fixtures are benign, so this surfaces when the spec is committed in Phase 2 and gates in Phase 9, not as a masked live secret. | Close the entropy sub-pattern's prose hole over `spec/` the same way r8-f1 closed the keyword pattern's. Options: (a) exclude the `spec/` root from the pure-entropy sub-pattern entirely (the spec still gets the BitLocker/credential/`password`-`secret`-keyed sub-patterns, which catch a genuinely embedded secret — a real credential in a spec description is a leaf-value credential, not high-entropy-prose), mirroring the keyword-pattern carve-out; or (b) scope the entropy sub-pattern in `spec/` to leaf **values** under value-bearing keys (`example`/`default`/`enum` members) and exclude documentation keys (`description`/`summary`/`title`), so credential-shaped examples are still caught but prose is not; or (c) add a prose exclusion (e.g. skip strings whose whitespace ratio or dictionary-word ratio indicates natural language). Then extend the `scan-secrets.test.ts` case (line 580) and rely on the Phase 9 Exit Gate to assert the committed `spec/openapi.json` — including a long benign description whose char-entropy exceeds 3.5 — passes the scan, so this false-positive class is guarded rather than discovered at first spec commit. Also correct line 559's spec-pass justification to account for the entropy sub-pattern, not only the keyword sub-pattern. |
