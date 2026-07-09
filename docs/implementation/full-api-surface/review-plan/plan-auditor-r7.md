## plan-auditor — round 7

Followed the in-progress-review procedure. The single round-6 `Open` finding (r6-f1, Low) was
marked `Fixed` by reviser-r6; I re-verified it against the actual plan text and by computing the
Shannon entropy of the pinned test strings, rather than taking the reviser's word — it is genuinely
fixed. All rounds 1–5 findings remain ratified `Closed` and are carried forward by ID. Verifying the
r6-f1 fix, however, surfaced one **new** `Low` consistency finding: the now-concrete entropy
predicate definitively excludes the plan's own canonical example secret (`S3CR3T`) from the
real-secret-pattern branch, contradicting a stated "fails under any root" guarantee.

Re-verification of the round-6 fix:
- **r6-f1 → Fixed (verified).** Phase 9 Step 3 (lines 552–555) now states the "high-entropy"
  predicate concretely: a string is entropy-flagged only when **all** of (i) length ≥
  `MIN_SECRET_LEN = 20`, (ii) Shannon entropy ≥ `MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3.5` bits/char,
  (iii) its key is not on a documented `NON_SECRET_KEY_ALLOWLIST`
  (`uid`/`siteUid`/`deviceUid`/`agentUid`/`alertUid`/`id`/`macAddress`/`serialNumber`/`serial`/
  `guid`/`hostname`), and (iv) it does not match `BENIGN_IDENTIFIER_SHAPE` (canonical MAC / GUID
  regexes). The BitLocker/credential/`password`/`secret` sub-patterns are explicitly held independent
  of the allowlist (line 555), so a genuine secret under an allowlisted key is still caught; only the
  ambiguous pure-entropy middle is narrowed. `scan-secrets.test.ts` (line 578) pins the middle of the
  range: I confirmed the values are deterministic — `deviceUid:"a3f9c1e084b24d7e9f6c2b18d5e07a41"`
  (H=3.93, len 32) passes via the allowlist; the same value under a non-allowlisted `token` key
  passes length+entropy with no allowlist/shape excuse and **fails**; and `SYNTHETIC-UDF-300`
  (H=3.74 but len 17 < 20) clears the length gate. Constants follow the plan's named-constant /
  single-point-of-update convention. The finding is genuinely resolved.

New this round:
- Computing the entropy of the strings the plan actually names shows `S3CR3T` — the emblematic
  "planted real secret" used in Phase 3's mask test (line 262), Phase 9 Step 3's narrative
  (line 557), and the scan test (line 578) — is length 6, entropy 2.25. Post-r6-f1 the
  real-secret-pattern branch (the **sole** gate on the real-capture root `src/__tests__/fixtures/`)
  has three concrete sub-predicates, and `S3CR3T` satisfies none of them: not high-entropy
  (len < 20, H < 3.5), not BitLocker-shaped, and not under a `password`/`secret` key (it sits under
  `udf5`). Yet line 557 asserts "a planted real secret (`S3CR3T`, a BitLocker recovery key) under
  **any** root fails." Raised as r7-f1 below.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified r2–r6, still intact r7: base primitives are `httpGet/httpPost/httpPatch/httpDelete`, resource-call rule present, Phase 7 example uses `this.httpGet`/`this.httpPost`; no shadow/recursion. |
| plan-auditor-r1-f2 | Medium | Closed | DesignAlignment | — | ratified r2: R10 claimed and delivered solely by Phase 5. |
| plan-auditor-r1-f3 | Medium | Closed | Completeness | — | ratified r2: named prose assertions folded into fenced gates. |
| plan-auditor-r1-f4 | Medium | Closed | MissingDecision | — | ratified r2: `DEFAULT_TOKEN_REFRESH_PCT = 25` pinned and asserted (Phase 5 Step 4). |
| plan-auditor-r1-f5 | Medium | Closed | Test | — | ratified r2: `coverage-map.test.ts` derives inventory from `spec/openapi.json`, asserts exactly-once coverage (Phase 8). |
| plan-auditor-r1-f6 | Low | Closed | Security | — | ratified r2: `mask.ts` redacts any non-null `udf*` value regardless of wire type; nested-object test present. |
| plan-auditor-r1-f7 | Low | Closed | Consistency | — | ratified r2: `@types/node@^26` aligned with fuze-api. |
| plan-auditor-r2-f1 | Medium | Closed | MissingDecision | — | verified r3: `DEFAULT_RETRY` + strict `retry`/`rateLimit` sub-objects, consumed Phase 5, asserted in http-client test. |
| plan-auditor-r2-f2 | Medium | Closed | Clarity | — | verified r3: response-vs-request suffix rule + documented constant (Phase 2 Step 3); `widen-enums.test.ts` guards closed request enums + idempotency. |
| plan-auditor-r2-f3 | Medium | Closed | Consistency | — | verified r3: `axiosInstance?` removed with explicit "not accepted" note; no phase references it. |
| plan-auditor-r2-f4 | Medium | Closed | Completeness | — | verified r3: residual Phase 2 / Phase 10 prose assertions are fenced commands. |
| plan-auditor-r3-f1 | Medium | Closed | Consistency | — | verified r4: `paginate` attaches explicit `{ kind: 'read' }` per page; interceptor defaults to `{ kind: 'read' }` when untagged; paginate test asserts the read window is consumed per page. |
| plan-auditor-r3-f2 | Low | Closed | DesignAlignment | — | verified r4: 403 narrowed to `'ip-block'` only under `isRateLimitBlock(response)`, else `'forbidden'`; both surfaced without retry with raw response; README + Deferred Validation updated. |
| plan-auditor-r4-f1 | Medium | Closed | Security | — | verified r5: secret-scan scope covers `spec/`, `tests/fixtures/`, and `src/__tests__/fixtures/`; planted-secret-caught test present. |
| plan-auditor-r4-f2 | Medium | Closed | Consistency | — | verified r5: mandated udf leniency fixture uses `SYNTHETIC-UDF-300`; Step-3 heuristic admits the sentinel while failing real-secret patterns. |
| plan-auditor-r5-f1 | Medium | Closed | Consistency | — | verified r6: r4-f1/r4-f2 cross-contradiction on the retained real captures resolved via root-scoped branches; real captures' `value1`/`value2` pass the sole real-secret-pattern gate on `src/__tests__/fixtures/`. |
| plan-auditor-r6-f1 | Low | Closed | Security | — | **verified Fixed r7:** Phase 9 Step 3 (lines 552–555) pins the entropy predicate (`MIN_SECRET_LEN=20`, `MIN_SECRET_ENTROPY_BITS_PER_CHAR=3.5`, `NON_SECRET_KEY_ALLOWLIST`, `BENIGN_IDENTIFIER_SHAPE`), keeps BitLocker/credential/`password`/`secret` sub-patterns allowlist-independent, and `scan-secrets.test.ts` (line 578) pins the middle of the range. Entropy of the pinned examples confirmed deterministic (token value H=3.93 fails under a non-allowlisted key; `deviceUid` passes via allowlist). |
| plan-auditor-r7-f1 | Low | Open | Consistency | The r6-f1 fix pinned the real-secret-pattern branch's "high-entropy" component to a concrete predicate (`len ≥ 20` **and** `H ≥ 3.5` bits/char, Phase 9 Step 3 line 552), which surfaces a contradiction with the plan's long-standing canonical example secret. `S3CR3T` — used as the emblematic "real secret" in the Phase 3 mask test (line 262), the Phase 9 narrative (line 557), and the scan test (line 578) — is **length 6, Shannon entropy 2.25** (computed). It therefore satisfies **none** of the real-secret-pattern branch's now-concrete sub-predicates: not high-entropy (fails both the length and entropy gates), not BitLocker-shaped (BitLocker keys are 48 digits in dash-separated groups), and not under a `password`/`secret` key (it sits under `udf5`). But that branch is, by the r5-f1 fix, the **sole** gate on the real-capture root `src/__tests__/fixtures/`, and line 557 asserts "a planted real secret (`S3CR3T`, a BitLocker recovery key) under **any** root fails." Under the real root that claim is false as specified: a planted `udf5:"S3CR3T"` there would **pass** the scan (the sentinel-strictness branch that would catch it is scoped only to the synthetic `tests/fixtures/` root). The label "`S3CR3T`, a BitLocker recovery key" is also inaccurate — the value is neither high-entropy nor BitLocker-shaped. Net effect: a stated security guarantee is overstated against the pinned predicate, and the canonical example a maintainer is most likely to copy when smoke-testing the scan does not exercise the real-root gate it appears to. Committed fixtures are unaffected (all benign), so this is a spec/example-vs-predicate consistency defect, not a live build break. | Reconcile the canonical example with the pinned predicate. Either (a) change the "fails under any root" example (line 557, and the real-root case in line 578) to a value the real-secret-pattern branch actually catches — e.g. a ≥20-char high-entropy string or a real BitLocker-format key `XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX` — and keep `S3CR3T` only for the synthetic-root / sentinel-strictness and mask examples where it is correctly caught/redacted; or (b) add a concrete "credential/keyword" sub-pattern to the real-secret-pattern branch (documented alongside the entropy constants) that matches short leetspeak/literal secret markers like `S3CR3T`, so the "under any root fails" claim becomes true, and pin a `scan-secrets.test.ts` case asserting `udf5:"S3CR3T"` planted under `src/__tests__/fixtures/` fails. Then correct the "BitLocker recovery key" label on `S3CR3T` (line 557) since it is neither high-entropy nor BitLocker-shaped. |
