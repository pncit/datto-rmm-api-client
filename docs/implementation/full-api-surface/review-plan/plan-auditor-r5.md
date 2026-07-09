## plan-auditor — round 5

Re-verified the two round-4 `Open` findings (r4-f1, r4-f2) against the revised
`full-api-surface/plan.md` — both are genuinely fixed, confirmed by direct reading of the plan and
the repo, not by the reviser's word. Rounds 1–3 findings remain ratified Closed and are carried
forward. Then audited the **interaction** of the two round-4 fixes against the actual retained real
fixtures on disk, and raised one new concrete finding: the now-broadened secret-scan scope
(r4-f1) plus the now-strict udf heuristic (r4-f2) together reject a value that ships in the
committed real captures the plan promises the scan will *confirm as safe*.

Re-verification notes on the round-4 fixes:
- **r4-f1** — Phase 9 Step 3 (line 549) now scopes `scan-secrets.mjs` to all three committed roots
  — `spec/`, `tests/fixtures/`, **and `src/__tests__/fixtures/`**; the Exit-Gate note (line 584)
  and the Assumption (line 15) both state the confirmed-by-scan claim is now enforced over those
  exact files, and `scan-secrets.test.ts` (line 571) asserts a planted secret under
  `src/__tests__/fixtures/` is caught. The narrow-scope gap is closed.
- **r4-f2** — Phase 9 Step 1 (line 545) sets the mandated `udf300` leniency fixture to the
  allowlisted sentinel `SYNTHETIC-UDF-300`; Step 3 (line 550) flags a `udf\d+` value only when it
  is a real-secret pattern **or** a non-null udf string that is not the sentinel, so the mandated
  synthetic leniency fixture passes while `S3CR3T`/BitLocker keys fail; `scan-secrets.test.ts`
  (line 571) asserts the sentinel passes and a real secret fails. The Step-1-vs-Step-3 contradiction
  is reconciled *for the synthetic fixtures*.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified r2–r4, still intact r5: base primitives renamed `httpGet/httpPost/httpPatch/httpDelete`, resource-call rule added, Phase 7 example uses `this.httpGet`/`this.httpPost`; no shadow/recursion. |
| plan-auditor-r1-f2 | Medium | Closed | DesignAlignment | — | ratified r2: R10 claimed/delivered solely by Phase 5. |
| plan-auditor-r1-f3 | Medium | Closed | Completeness | — | ratified r2: named prose assertions folded into fenced gates (Phase 1, Phase 8). |
| plan-auditor-r1-f4 | Medium | Closed | MissingDecision | — | ratified r2: `DEFAULT_TOKEN_REFRESH_PCT = 25` pinned and asserted. |
| plan-auditor-r1-f5 | Medium | Closed | Test | — | ratified r2: `coverage-map.test.ts` derives inventory from `spec/openapi.json`, asserts exactly-once coverage. |
| plan-auditor-r1-f6 | Low | Closed | Security | — | ratified r2: `mask.ts` redacts any non-null `udf*` value regardless of wire type; nested-object test present. |
| plan-auditor-r1-f7 | Low | Closed | Consistency | — | ratified r2: `@types/node@^26` aligned with fuze-api. |
| plan-auditor-r2-f1 | Medium | Closed | MissingDecision | — | verified r3: `DEFAULT_RETRY` + strict `retry`/`rateLimit` sub-objects (Phase 3 Step 4), consumed Phase 5 Step 3, asserted in http-client test. |
| plan-auditor-r2-f2 | Medium | Closed | Clarity | — | verified r3: concrete response-vs-request suffix rule + documented constant (Phase 2 Step 3); `widen-enums.test.ts` guards closed request enums + idempotency. |
| plan-auditor-r2-f3 | Medium | Closed | Consistency | — | verified r3: `axiosInstance?` removed with explicit "not accepted" note; no phase references it. |
| plan-auditor-r2-f4 | Medium | Closed | Completeness | — | verified r3: residual Phase 2 and Phase 10 prose assertions are now fenced commands. |
| plan-auditor-r3-f1 | Medium | Closed | Consistency | — | verified r4: `paginate` attaches an explicit `{ kind: 'read' }` descriptor per page (Phase 6 Step 2 + example line 410); interceptor defaults to `{ kind: 'read' }` when untagged (Phase 5 Step 3); paginate test asserts the read window is consumed per page. |
| plan-auditor-r3-f2 | Low | Closed | DesignAlignment | — | verified r4: 403 narrowed to `'ip-block'` only under `isRateLimitBlock(response)`, else `'forbidden'`; both surfaced without retry with raw response; README + Deferred Validation updated. |
| plan-auditor-r4-f1 | Medium | Closed | Security | — | verified r5: secret-scan scope now covers `spec/`, `tests/fixtures/`, **and** `src/__tests__/fixtures/` (Phase 9 Step 3 line 549, Exit-Gate note line 584, Assumption line 15); `scan-secrets.test.ts` asserts a planted secret under `src/__tests__/fixtures/` is caught. |
| plan-auditor-r4-f2 | Medium | Closed | Consistency | — | verified r5: mandated udf leniency fixture uses the allowlisted `SYNTHETIC-UDF-300` sentinel (Phase 9 Step 1); Step 3 heuristic admits the sentinel while failing real-secret patterns; `scan-secrets.test.ts` asserts both. (Reconciled *for synthetic fixtures* — see r5-f1 for the real-fixture side effect.) |
| plan-auditor-r5-f1 | Medium | Open | Consistency | The two round-4 fixes, both correct in isolation, **contradict each other on the retained real captures**. r4-f1 broadened `scan-secrets.mjs` to also scan `src/__tests__/fixtures/`; r4-f2 defined the udf rule to flag "a non-null `udf\d+` string that is **not** the allowlisted synthetic sentinel" (Phase 9 Step 3, line 550). But the retained real fixtures those very fixes point at carry non-null, non-sentinel udf values: `src/__tests__/fixtures/device.json`, `devicesPage1.json`, and `devicesPage.json` all contain `"udf1": "value1"` (verified on disk). `"value1"` is non-null and is not `SYNTHETIC-UDF-<n>`, so the Step-3 heuristic flags it → `node scripts/scan-secrets.mjs` (the Phase 9 Exit-Gate command, line 582) exits non-zero → Phase 9's gate fails on committed files. This directly breaks the Assumption (line 15) that these captures are "safe to keep … Phase 9's secret-scan includes `src/__tests__/fixtures/` in its scanned roots, so this claim is **mechanically confirmed**": the scan as specified does not confirm them safe, it rejects them. The r4-f2 heuristic was reconciled only against the *synthetic* sentinel fixtures (Phase 9 Step 1); it was never reconciled against the *real* fixtures r4-f1 pulled into scope, whose whole point is to hold benign real (non-sentinel) values. | Reconcile the heuristic with the real-capture root. Options, pick one and state it in Phase 9 Step 3: (a) apply the "non-null-non-sentinel udf ⇒ fail" branch **only** to synthetic paths (`tests/fixtures/`), and gate `src/__tests__/fixtures/` on the real-secret-pattern branch alone (BitLocker/credential/high-entropy), so benign real udfs like `value1` pass while a planted BitLocker key still fails; or (b) sanitize the retained real fixtures' non-null udfs to `null`/the sentinel via `sanitize-fixtures.mjs` before they are (re-)committed, so no non-sentinel udf string remains under any scanned root; or (c) add the observed benign real udf value(s) to a documented allowlist alongside the sentinel. Then update the Assumption (line 15) and the Exit-Gate note (line 584) so the "mechanically confirmed" claim matches what the scan actually does over `device.json`/`devicesPage*.json`. Add a `scan-secrets.test.ts` case asserting the real retained fixtures pass under the chosen rule. |
