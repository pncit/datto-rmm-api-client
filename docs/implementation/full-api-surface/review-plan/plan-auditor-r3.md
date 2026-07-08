## plan-auditor — round 3

Re-verified the four round-2 `Open` findings against the revised `full-api-surface/plan.md` (the
round-1 seven were already ratified Closed in round 2 and are carried forward as Closed). All four
round-2 findings are genuinely fixed in the current plan — each fix confirmed by direct reading, not
just by the reviser's word. Then hunted for new issues; two raised (one Medium, one Low), both
concrete cross-phase gaps.

Re-verification notes on the round-2 fixes:
- **r2-f1** — Phase 3 Step 4 pins `retry?` as `z.strictObject({ maxAttempts, baseDelayMs, maxDelayMs })`
  (all optional) and exports `DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }`;
  `rateLimit?` is a strict override sub-object (`readLimit`/`writeAggregateLimit`/`windowSeconds`/
  `defaultWriteLimit`) falling back to the committed table constants. Phase 5 Step 3 consumes
  `retry.maxAttempts ?? DEFAULT_RETRY.maxAttempts` (+ base/max bounds) and the Phase 5 http-client
  test asserts a 5xx retries exactly `DEFAULT_RETRY.maxAttempts` times against the imported constant,
  plus an override-honored case. Determinism restored.
- **r2-f2** — Phase 2 Step 3 now states the concrete discrimination rule: the codemod scans only
  `src/generated/types/**` and widens enum unions only inside exported types whose name does **not**
  end in the request-side suffix set (`Body`/`Params`/`Parameter(s)`/`Query`/`QueryParams`/
  `Header(s)`/`PathParameters`), held as a documented constant. `widen-enums.test.ts` asserts a
  `*Body` and a `*Params` enum stay closed while a component-schema enum is widened, and that a second
  pass is a no-op — catching the over-widen Phase 9's response-only test would miss.
- **r2-f3** — Phase 3 Step 4 drops `axiosInstance?` and adds an explicit "no `axiosInstance` field …
  a caller-supplied instance is deliberately not accepted" note; `.strict()` rejects it as unknown.
  No phase references it; the dead-config pattern R14 retires is gone.
- **r2-f4** — Phase 2's fenced gate now includes `git ls-files --error-unmatch` for both committed
  spec files, `! git ls-files --error-unmatch spec/openapi.patched.json`, the `.gitignore` grep, and
  `test -n "$(ls -A src/generated)"` + the `schemas/*/*.zod.ts`/`types/` checks; Phase 10's fenced
  gate includes `test -f dist/index.js && test -f dist/index.d.ts`. Prose-only assertions eliminated.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | High | Closed | Consistency | — | ratified in r2: base primitives renamed `httpGet/httpPost/httpPatch/httpDelete`, resource-call rule added, Phase 7 example uses `this.httpGet`/`this.httpPost`; no shadow/recursion. Still intact in r3. |
| plan-auditor-r1-f2 | Medium | Closed | DesignAlignment | — | ratified in r2: R10 claimed/delivered solely by Phase 5. |
| plan-auditor-r1-f3 | Medium | Closed | Completeness | — | ratified in r2: named prose assertions folded into fenced gates (Phase 1, Phase 8). |
| plan-auditor-r1-f4 | Medium | Closed | MissingDecision | — | ratified in r2: `DEFAULT_TOKEN_REFRESH_PCT = 25` pinned and asserted. |
| plan-auditor-r1-f5 | Medium | Closed | Test | — | ratified in r2: `coverage-map.test.ts` derives inventory from `spec/openapi.json`, asserts exactly-once coverage. |
| plan-auditor-r1-f6 | Low | Closed | Security | — | ratified in r2: `mask.ts` redacts any non-null `udf*` value regardless of wire type; nested-object test present. |
| plan-auditor-r1-f7 | Low | Closed | Consistency | — | ratified in r2: `@types/node@^26` aligned with fuze-api. |
| plan-auditor-r2-f1 | Medium | Closed | MissingDecision | — | verified in r3: `DEFAULT_RETRY` constant + strict `retry`/`rateLimit` sub-objects defined in Phase 3 Step 4 (lines 227–228), consumed in Phase 5 Step 3, asserted in the Phase 5 http-client test. |
| plan-auditor-r2-f2 | Medium | Closed | Clarity | — | verified in r3: concrete response-vs-request suffix rule + documented constant in Phase 2 Step 3 (line 152); `widen-enums.test.ts` guards the `*Body`/`*Params`-stay-closed and idempotency cases. |
| plan-auditor-r2-f3 | Medium | Closed | Consistency | — | verified in r3: `axiosInstance?` removed from `dattoRmmClientConfigSchema` (line 229) with an explicit "not accepted" note; no phase references it. |
| plan-auditor-r2-f4 | Medium | Closed | Completeness | — | verified in r3: residual Phase 2 and Phase 10 prose assertions are now fenced commands (lines 199–203, 610). |
| plan-auditor-r3-f1 | Medium | Open | Consistency | The `paginate` helper (Phase 6 Step 2) issues its page fetch via `this.axios.get(url, { params: p, /* RateDescriptor: read */ })` (line 405) — a bare comment, not an attached descriptor — and the Step 2 prose never says paginate must tag the request. Unlike the `http*` primitives (Phase 6 Step 1), which are specified to attach `{kind:'read'}`/`{kind:'write',opKey}`, paginate calls the raw axios instance directly (it must, to read the `{pageDetails, <array>}` envelope rather than a single validated schema), so it bypasses the descriptor-tagging path. Phase 5 Step 3 says the request interceptor "calls `limiter.acquire(descriptor)` … using a descriptor carried on the axios request config" but never defines behavior when the descriptor is **absent**. Result: the single highest-volume read path (`account.devices()` and every other paginated list) goes out untagged, so its rate-limit bucket selection is undefined — it may be unthrottled (defeating R11 on the primary read path) or make `acquire(undefined)` throw. | In Phase 6 Step 2 require `paginate` to attach an explicit `{kind:'read'}` `RateDescriptor` on each page's axios config (replace the placeholder comment with the real attach), and/or in Phase 5 Step 3 define the interceptor's default when no descriptor is present (treat as `{kind:'read'}`). Add a paginate test asserting the read window is consumed per page. |
| plan-auditor-r3-f2 | Low | Open | DesignAlignment | Phase 5 Step 4/Step 3 (line 355–357 example) classifies **every** HTTP 403 as `code:'ip-block'` and throws immediately with no retry. Datto returns 403 both for the rate-limit IP-block penalty (the case R12/Non-Goal targets) **and** for ordinary authorization failures (insufficient scope/permissions, revoked credentials). Hard-labeling all 403s `ip-block` mislabels a permission-denied response as a rate-limit block, misleading a consumer's `catch` on `error.code`. R12 speaks specifically of "403 IP-block"; the plan broadens it to all 403s without distinguishing. | Either narrow the `ip-block` classification (e.g. only when the response body/headers indicate a rate/block condition, else leave `code` unset or a distinct `forbidden`), or explicitly document in Phase 5 that per Datto's model all 403s are treated as IP-block and surface the raw `response` body so consumers can disambiguate. Note in the README error-handling section (Phase 10) accordingly. |
