## implementation-auditor — round 2

Round-2 scope: re-verify the two `Fixed` findings the reviser addressed (both were test-coverage
gaps), then re-audit the whole Phase 5 tree for anything round 1 missed. The working-tree delta
since round 1 is exactly the reviser's two added tests in `tests/unit/http/http-client.test.ts`
(plus orchestrator bookkeeping in `pipeline-run.json`); the Phase 5 source under `src/rate-limit/`,
`src/http/`, `src/auth/` and the `tsconfig.test.json` one-liner are unchanged from the round-1
baseline. `npm run typecheck` (src+test+tools) is clean and the three Phase 5 suites run green
(31 tests). No old-surface file was touched — coexistence rule honored.

### Re-verification of round-1 findings

- **implementation-auditor-r1-f1 (backoff `maxDelayMs` cap untested)** — the reviser added
  `"clamps exponential backoff at retry.maxDelayMs instead of growing unbounded"` with
  `{ maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 250 }` against a repeated 503. The second
  retry's uncapped delay (400 ms) is clamped to 250 ms; the test asserts the elapsed total lands
  at the clamped ~450 ms (`>= 400`, `< 550`) rather than the uncapped 600 ms — this genuinely
  exercises the `Math.min(delay, policy.maxDelayMs)` branch in `calculateBackoffDelayMs`. Verified
  passing. → **Closed (ratified).**
- **implementation-auditor-r1-f2 (429 retry-exhaustion throw untested)** — the reviser added
  `"throws DattoApiError with retryAfterMs when 429 retries are exhausted"`: 429 with a parseable
  `Retry-After: "0"` replied `DEFAULT_RETRY.maxAttempts` times. I traced the branch: attempts
  1→2→3 each compute `waitMs = 0` and re-enter until `failedAttemptNumber (3) >= maxAttempts (3)`
  fires `throw buildRateLimitError(0, …)` — the exhaustion path, distinct from both the
  over-`MAX_RETRY_AFTER_MS` and the 429-then-200 paths. The test asserts `statusCode: 429` and
  `retryAfterMs: 0`. Verified passing. → **Closed (ratified).**

### Fresh audit notes (no new findings)

Beyond the two ratified items I re-derived the load-bearing behaviors and found them sound:

- **Rate-limiter concurrency is actually safe, not merely best-effort.** In
  `MultiWindowRateLimiter.acquire`, the check (`msUntilRoom`) and the commit (`record`) in the
  `waitMs === 0` branch are fully synchronous with no `await` between them, so each waking
  continuation is an atomic job under the single-threaded event loop: when N callers wake from the
  same `sleep` for one freed slot, the first job records (re-filling the window) before the second
  job's check runs, which then re-sleeps. No over-admission — the window ceiling holds under
  concurrent `acquire`. The `SlidingWindow.prune` boundary is `<=` (not `<`), which is required for
  the delay model: after sleeping exactly `timestamps[0] + windowMs - now`, the oldest entry is at
  the cutoff and must be pruned so room actually opens (a `<` boundary would busy-loop).
- **Retry semantics are internally consistent.** Both the 5xx/network branch (`failedAttemptNumber
  < maxAttempts` → retry) and the 429 branch (`failedAttemptNumber >= maxAttempts` → throw) allow
  exactly `maxAttempts` total HTTP attempts per logical request, tracked via the per-config
  `__dattoRetryCount`; this matches Decision 2's "total attempts" reading and the plan's pinned
  `DEFAULT_RETRY`.
- **Transport isolation is structural.** `AuthManager` issues the grant through its own bare
  `axios.create()` (`grantClient`, no interceptors), maps its own failures via
  `DattoApiError.fromAxiosError`/`statusCode: 0`, and only touches the shared instance in
  `attachTo`; the "does not retry a failed grant" test confirms the bare instance carries no retry
  stack. `needsRefresh` correctly computes remaining-TTL % of the original TTL from the added
  `issuedAt`. `Retry-After` parsing (both RFC forms, `MAX_RETRY_AFTER_MS` bound, unparseable →
  computed backoff) and the `isRateLimitBlock` 403 classification match the plan and are each
  covered.

Every pinned constant/signature (the 14-entry `WRITE_LIMITS` with `device-udf-set: 600`, the
closed `WriteOpKey` union, `RateDescriptor`, `DattoApiError`'s pinned construction sites,
`isRateLimitBlock` as a named exported predicate, `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT`/
`MAX_RETRY_AFTER_MS` from `src/defaults.ts`, the ambient augmentation kept out of the entry import
graph) is present and consumed as specified. No new issues found.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Closed | Tests | `tests/unit/http/http-client.test.ts` l.199-221 | ratified: added test drives `{ baseDelayMs: 200, maxDelayMs: 250 }` against a repeated 503; the second retry's 400 ms uncapped delay is clamped to 250 ms and the ~450 ms elapsed bound (vs 600 ms uncapped) genuinely exercises the `Math.min(delay, maxDelayMs)` cap. Verified passing. | None — resolved. |
| implementation-auditor-r1-f2 | Low | Closed | Tests | `tests/unit/http/http-client.test.ts` l.223-237 | ratified: added test replies 429 with `Retry-After: "0"` `DEFAULT_RETRY.maxAttempts` times and asserts the thrown `DattoApiError` has `statusCode: 429` + `retryAfterMs: 0`, exercising the `failedAttemptNumber >= maxAttempts` exhaustion throw in the 429 branch (distinct from the over-max and 429-then-200 paths). Verified passing. | None — resolved. |
