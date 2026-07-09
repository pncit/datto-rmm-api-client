## reviser — round 6

Addressed the single round-6 `Open` finding (r6-f1, Low). All prior findings remain `Closed`/ratified
and were not touched.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| plan-auditor-r6-f1 | Fixed | Phase 9 Step 3's real-secret-pattern branch now states the "high-entropy" predicate concretely instead of leaving it to the implementor: a string is entropy-flagged only when length ≥ `MIN_SECRET_LEN = 20` **and** Shannon entropy ≥ `MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3.5` bits/char **and** its key is not on a documented `NON_SECRET_KEY_ALLOWLIST` (`uid`/`siteUid`/`deviceUid`/`agentUid`/`alertUid`/`id`/`macAddress`/`serialNumber`/`serial`/`guid`/`hostname`) **and** it does not match a documented `BENIGN_IDENTIFIER_SHAPE` (canonical MAC / GUID regexes). The BitLocker/credential/`password`/`secret` sub-patterns are explicitly kept independent and unscoped by the allowlist, so a genuine secret placed under an allowlisted key is still caught — only the ambiguous pure-entropy middle is narrowed. This lets future sanitized real captures (added via `sanitize-fixtures.mjs`) commit cleanly rather than tripping on benign hardware identifiers, while still failing high-entropy values under unexpected keys. Added `scan-secrets.test.ts` cases pinning the middle of the range: a high-entropy `deviceUid` and a canonical MAC/GUID under an unexpected key pass, while an equally-high-entropy value under a non-allowlisted `token` key fails. Constants follow the plan's existing named-constant / single-point-of-update convention. |
