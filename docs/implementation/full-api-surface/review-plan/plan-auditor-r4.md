## plan-auditor — round 4

Re-verified the two round-3 `Open` findings against the revised `full-api-surface/plan.md` (rounds 1
and 2's findings were ratified Closed in r2/r3 and are carried forward as Closed). Both round-3
findings are genuinely fixed — confirmed by direct reading of the plan, not by the reviser's word.
Then audited Phase 9's sanitization/secret-scan machinery specifically (the design's High/High
mitigation row) and raised two new concrete findings: the scan's directory scope and its udf
heuristic both contradict other explicit statements in the plan.

Re-verification notes on the round-3 fixes:
- **r3-f1** — Phase 6 Step 2 now **requires** `paginate` to attach an explicit `{ kind: 'read' }`
  `RateDescriptor` on each page's axios config (via the same `rateDescriptor` property the `http*`
  primitives use), and the example (line 410) replaces the placeholder comment with the real attach
  `rateDescriptor: { kind: 'read' }`. Phase 5 Step 3 (line 337) now defines the interceptor default
  when no descriptor is present — `{ kind: 'read' }`, so an untagged request is never sent
  unthrottled and `acquire` is never called with `undefined`. Phase 6 `paginate.test.ts` (line 423)
  asserts the read window is consumed once per page. R11 now holds on the highest-volume read path.
- **r3-f2** — Phase 3 Step 1 (line 218) types `DattoApiError.code?: 'ip-block' | 'forbidden'`;
  Phase 5 Step 3 + example (lines 337, 355–361) classify `'ip-block'` **only** when a rate/block
  marker is present (documented `isRateLimitBlock(response)` predicate), else `'forbidden'`, both
  surfaced without retry with the raw `response` attached. Phase 5 test (line 366) covers both
  branches; Phase 10 README (line 594) documents the distinction; Deferred Validation (line 626)
  covers confirming Datto's real 403 marker. The over-broad `ip-block` mislabel is gone.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified r2, still intact r3/r4: base primitives renamed `httpGet/httpPost/httpPatch/httpDelete`, resource-call rule added, Phase 7 example uses `this.httpGet`/`this.httpPost`; no shadow/recursion. |
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
| plan-auditor-r3-f2 | Low | Closed | DesignAlignment | — | verified r4: 403 narrowed to `'ip-block'` only under `isRateLimitBlock(response)`, else `'forbidden'` (Phase 3 Step 1, Phase 5 Step 3 + example); both surfaced without retry with raw response; README + Deferred Validation updated. |
| plan-auditor-r4-f1 | Medium | Open | Security | Phase 9 Step 3's secret-scan (`scan-secrets.mjs`) scopes to "any tracked file under **`spec/`** or **`tests/fixtures/`**", but the plan's Assumption (line 15) states the existing real captures under **`src/__tests__/fixtures/*.json`** are "safe to keep … Phase 9's secret-scan will confirm," Phase 8 Step 8 keeps those files in place (`src/__tests__/fixtures/*.json`), and Phase 9 Step 1 explicitly reuses them from that path (`keep/extend the existing real src/__tests__/fixtures/device*.json`). The scan therefore never inspects the one directory holding real captured (non-synthesized) data — precisely the highest-risk files — so the assumption that the scan "will confirm" them is unmet, and the scope is narrower than the design's High/High mitigation row (which covers "`spec/` and fixture paths", plural). | Add `src/__tests__/fixtures/` to the secret-scan's scanned paths (or relocate the retained real fixtures into `tests/fixtures/` so the single scanned fixture root covers them), and update the Phase 9 Exit Gate / assumption so the confirmed-by-scan claim is actually enforced over every committed fixture path. |
| plan-auditor-r4-f2 | Medium | Open | Consistency | Phase 9 Step 1 **requires** a synthesized fixture "a device with **`udf300` set** and many nulls" to exercise the `udf1…udf300` leniency path, but Phase 9 Step 3's scan heuristic flags "**non-null `udf\d+` string values**" as a build-failing secret. A fixture with a non-null `udf300` string is exactly what Step 1 mandates and exactly what the Step 3 heuristic (as written) rejects, so the required test fixture would trip `scan-secrets.mjs` and fail the Phase 9 Exit Gate (`node scripts/scan-secrets.mjs`). The heuristic cannot both "fail on any non-null udf string" and permit the mandated udf-bearing leniency fixture; `sanitize-fixtures.mjs` (Step 2) redacting `udf*` to null would in turn defeat the udf-set leniency assertion. | Refine the scan rule so a known-safe synthetic udf value is admissible — e.g. flag only secret-shaped udf values (BitLocker/credential patterns, high-entropy), or require synthetic udf fixtures to use an allowlisted sentinel string the scanner treats as safe, or scope the "non-null udf" rule to real-capture paths only. State the exact reconciliation in Phase 9 so the mandated udf-set fixture and the secret-scan can both pass. |
</content>
</invoke>
