## plan-auditor — round 6

Followed the in-progress-review procedure. The one round-5 `Open` finding (r5-f1) was marked
`Fixed` by reviser-r5; I re-verified it against the actual plan text and the fixtures on disk — it
is genuinely fixed, confirmed independently rather than on the reviser's word. All rounds 1–4
findings remain ratified `Closed` and are carried forward by ID. I then re-scanned the reconciled
Phase 9 secret-scan design (the area the last two rounds churned) for any residual gap and raise one
new `Low` finding about the sole gate on the real-capture root.

Re-verification of the round-5 fix:
- **r5-f1 → Fixed (verified).** Phase 9 Step 3 (lines 550–553) now splits the udf heuristic into two
  **root-scoped** branches exactly per the auditor's option (a): a **real-secret-pattern branch**
  (BitLocker/credential/high-entropy/`password`-`secret`-key) applied to all roots and the *sole*
  gate on `src/__tests__/fixtures/`, and a **sentinel-strictness branch** (non-sentinel non-null udf
  ⇒ fail) scoped only to the synthetic `tests/fixtures/` root. Confirmed on disk that the retained
  real captures carry non-null, non-sentinel low-entropy udfs (`device.json`/`devicesPage.json`/
  `devicesPage1.json` → `udf1:"value1"`; `devicesPage2.json` → `udf1:"value2"`) — under the revised
  rule these pass the sole real-secret-pattern gate rather than tripping it, so the Phase 9 Exit-Gate
  command `node scripts/scan-secrets.mjs` (line 585) no longer fails on committed files. The
  Assumption (line 15) and Exit-Gate note (line 587) were both rewritten to describe the two-branch,
  root-scoped behavior, so the "mechanically confirmed"/"exits 0 over the real captures" claims now
  match what the scan actually does. `scan-secrets.test.ts` (line 574) asserts the retained real
  fixtures pass, that a planted BitLocker/credential-shaped value under `src/__tests__/fixtures/` is
  still caught, and — proving root-scoping — that a benign `value1` fails under the synthetic root
  while passing under the real root. The r4-f1/r4-f2 cross-interaction contradiction is fully
  reconciled for both the synthetic and the real roots.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified r2–r5, still intact r6: base primitives are `httpGet/httpPost/httpPatch/httpDelete`, resource-call rule present, Phase 7 example uses `this.httpGet`/`this.httpPost`; no shadow/recursion. |
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
| plan-auditor-r5-f1 | Medium | Closed | Consistency | — | **verified Fixed r6:** the r4-f1/r4-f2 cross-contradiction on the retained real captures is resolved via root-scoped branches (option a). Confirmed on disk the real captures' `value1`/`value2` udfs pass the sole real-secret-pattern gate on `src/__tests__/fixtures/`; Assumption (line 15), Exit-Gate note (line 587), and `scan-secrets.test.ts` (line 574) all updated to match. Phase 9's `node scripts/scan-secrets.mjs` gate no longer fails on committed files. |
| plan-auditor-r6-f1 | Low | Open | Security | The **real-secret-pattern branch** (Phase 9 Step 3, lines 550–551) is now the **sole** gate on both the real-capture root `src/__tests__/fixtures/` and `spec/`, yet its "high-entropy pattern" component is left undefined — no entropy threshold, no per-field scoping, no exclusion of expected non-secret identifiers. Today this is harmless: the committed fixtures use low-entropy placeholders (verified: `uid:"device-uid-1"`, `siteUid:"site-uid-1"`, `intIpAddress:"192.168.1.10"`, `udf1:"value1"`), so nothing trips it. But the Assumptions and Deferred-Validation flow expect a maintainer to later add **genuine sanitized real captures** to these roots via `sanitize-fixtures.mjs`; real device rows carry high-entropy-looking-but-benign hardware identifiers (device UIDs, MAC/serial numbers, agent GUIDs) that `sanitize-fixtures.mjs` (which redacts only secret-bearing fields, notably `udf*`) does not null out. An undefined threshold forces the implementor to pick one that either (a) fires on those benign identifiers → blocks a legitimate real-capture commit, or (b) is loosened enough to avoid that → risks a false-negative on a real secret, defeating the sole gate. The `scan-secrets.test.ts` corpus pins only two points (benign `value1`/`value2` pass; `S3CR3T`/BitLocker fail), which does not constrain the middle where real hardware identifiers live. | State the "high-entropy" predicate concretely in Phase 9 Step 3: e.g. a Shannon-entropy threshold over a minimum length **restricted to string values whose key is not on a documented non-secret-identifier allowlist** (`uid`, `siteUid`, `deviceUid`, MAC/serial/GUID-shaped known fields), so genuine sanitized real captures pass while a high-entropy value under an *unexpected* key still fails. Add a `scan-secrets.test.ts` case with a realistic high-entropy device-identifier field (asserting it passes) alongside a high-entropy value under an unrecognized key (asserting it fails), so the middle of the range is pinned and future real-capture commits are not silently blocked or silently under-scanned. |
