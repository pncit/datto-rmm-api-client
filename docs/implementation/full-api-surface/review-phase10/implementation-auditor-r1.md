## implementation-auditor — round 1

### Phase Coverage

Phase 10 is documentation + release metadata only. Scope reviewed against the plan's three steps
(plan.md l.664–670) and the phase notes:

- **Step 1 — README rewrite (R18):** present and complete. Verified the required topic set is all
  there: install/ESM (§Requirements/Install), auth setup (`createDattoRmmClient` quick start),
  the namespace→endpoint map across all ten namespaces, error handling incl. `retryAfterMs` and
  the 403 `code`, logger injection + the UDF-masking guarantee **and** the explicit non-UDF
  boundary, validation leniency + the caller's unknown-enum obligation, rate-limit config +
  `system.requestRate()`, and the `alertContext` `@class` discriminator with the six observed
  shapes. The maintainer runbook for `scripts/sanitize-fixtures.mjs` (Phase 9 deferral) is
  included.
- **Step 2 — upgrade guide:** present; all five documented breaking changes plus the
  `invalidateToken()` capability-gap callout the design's Migration Strategy mandates.
- **Step 3 — version bump + publish shape:** `package.json` → `1.0.0`, `type:"module"`,
  `publishConfig.access:"public"`, `files:["dist","README.md","LICENSE"]`, and a minimal
  `exports` map added. The `exports` addition is within the plan's "confirm `…/exports/…` publish
  dist + .d.ts" wording, documented as a decision in the notes — not drift.

**Cross-checks performed (all accurate unless noted below):**
- Namespace→endpoint map vs `src/client/operation-map.ts`: all 57 operations, ten namespaces,
  method names and HTTP verbs reconciled row-by-row — complete and correct.
- Error field surface vs `src/errors/datto-api-error.ts` / `datto-validation-error.ts`:
  `statusCode`/`response`/`requestId`/`code`, `stage`/`zodError`/`prettyMessage`/`getErrorTree()`/
  `payload`/`context`, `BaseError` extension — all correct.
- 429/403 behavior vs `src/http/http-client.ts`: 30s ceiling (`MAX_RETRY_AFTER_MS`), RFC-7231
  both-forms `Retry-After` parsing, 403 `ip-block`/`forbidden` disambiguation, no-retry-on-403 —
  all correct (except the `retryAfterMs` scoping in f1).
- Config table defaults vs `src/defaults.ts` / `src/rate-limit/rate-limits.ts`: `DEFAULT_RETRY`
  `{3,250,5000}`, `tokenRefreshPct` default 25, rate-limit scalars 600/600/60 — all correct.
- `.gitignore` `*raw-sweep.json`, mask `[redacted - N characters]` format, `pageDetails.nextPageUrl`
  walk, `consoleLogger`/`dattoLoggerSchema`, `validate.yml` badge target — all confirmed present.

### Drift

No behavioral scope creep. `src/**` untouched (confirmed via `git diff` — only `README.md`,
`package.json`, and the new `tests/unit/readme.test.ts` changed, plus the run's pipeline JSON). The
`exports`-map addition is a defensible in-scope hardening, not drift.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Open | Completeness | README.md l.301–302, l.278–281, l.284–288 | The `DattoApiError` field list documents `retryAfterMs` as **"(429 only)"**, but `src/http/http-client.ts`'s `build403Error` (l.212–228) also populates `retryAfterMs` for a **403 `ip-block`** when the server sends a `Retry-After` header. A consumer following the doc would branch on `statusCode === 429` to read `retryAfterMs` and never learn the block-duration hint is available on the `ip-block` 403 the README itself tells them is a "stateful penalty." Separately, the quick-start comment (l.279–281) says `retryAfterMs` is populated only "when the server's own Retry-After exceeded the client's wait ceiling," but `buildRateLimitError` (l.202–210) also sets it on **retry exhaustion** (`failedAttemptNumber >= maxAttempts`, l.290–299) even when the wait was under the ceiling — so the stated condition covers only one of the two 429 paths. | Correct the field bullet to note `retryAfterMs` is set on a 429 **and** on a 403 `ip-block` carrying a `Retry-After`; add a one-line mention in the 403 branch (l.283–288) that `err.retryAfterMs` may indicate the block's wait when present. Broaden the quick-start comment to cover both 429 conditions (ceiling-exceeded *or* retry exhausted). |
| implementation-auditor-r1-f2 | Low | Open | Comments & docs | README.md l.441–442 | The exported-types section directs the reader to "see `src/public-types.ts` **in the package source** for the complete, curated list," but `package.json`'s `files` ships only `["dist","README.md","LICENSE"]` — `src/` is **not** in the published tarball, so a consumer who installed from npm has no `src/public-types.ts` to open. | Point at the published artifact or the repository instead — e.g. "see `dist/index.d.ts` for the complete exported surface" or "see `src/public-types.ts` in the GitHub repository" — so the pointer resolves for an npm consumer. |
