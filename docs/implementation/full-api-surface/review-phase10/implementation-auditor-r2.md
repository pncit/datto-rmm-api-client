## implementation-auditor — round 2

Reconciled the two round-1 findings against the current working tree (`git diff` scope:
`README.md`, `package.json`, and the run's `pipeline-run.json` — `src/**` untouched), then hunted
for new issues.

### Reconciliation

- **r1-f1 (retryAfterMs doc):** ratified. Verified against `src/http/http-client.ts`:
  `build403Error` (l.211–228) sets `retryAfterMs` on an `ip-block` 403 only when `Retry-After` is
  present, and `handleResponseError` throws `buildRateLimitError` on **both** ceiling-exceeded
  (`waitMs > MAX_RETRY_AFTER_MS`) **and** retry-exhaustion (`failedAttemptNumber >= maxAttempts`).
  All three README edits land: the field bullet now reads "set on a 429, and also on a 403
  `ip-block` when the server sends a `Retry-After`"; the 429 quick-start comment covers both
  give-up conditions; the 403 branch notes `err.retryAfterMs` carries the block wait hint.
- **r1-f2 (public-types pointer):** ratified. The exported-types pointer now links
  `src/public-types.ts` at its GitHub location and notes `dist/index.d.ts` is the on-disk
  equivalent, so it resolves for both a repo browser and an npm consumer whose tarball omits
  `src/`. The linked URL matches `package.json`'s `repository`/`homepage`.

### New-issue sweep (no new findings)

- **Exports section accuracy:** every type the README's "package exports" section names
  (`DeviceUdfInput`, `DeviceWarrantyInput`, `SiteVariableCreateInput`/`Update`,
  `AccountVariableCreateInput`/`Update`, `SiteProxyInput`, `GetSitesParams`,
  `RateStatusResponse`, …) is actually re-exported from `src/public-types.ts` — confirmed
  name-by-name.
- **`exports` map (package.json):** `types`→`./dist/index.d.ts`, `import`→`./dist/index.js`; both
  targets are produced by `npm run build`. No `require`/`browser` conditions, correctly matching
  the ESM-only, no-browser Non-Goal. In-scope hardening, not drift (unchanged from r1).
- **Factory/constructor equivalence:** the README's "`createDattoRmmClient(config)` … Equivalent
  to `new DattoRmmClient(config)`" is literally true — the factory body is `return new
  DattoRmmClient(config)`.
- **`readme.test.ts`:** derives its namespace set from `OPERATION_MAP` (`entry.ns`) and checks
  each namespace's method names via `entry.method` (the resource method name, not the HTTP verb),
  so the drift guard is real; `system.requestRate()` and the factory name are documented as
  shipped.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | Completeness | — | — | ratified: README now documents `retryAfterMs` on a 429 **and** a 403 `ip-block` (with `Retry-After`), and the 429 comment covers both ceiling-exceeded and retry-exhaustion give-up paths — matches `http-client.ts` `build403Error`/`buildRateLimitError`. |
| implementation-auditor-r1-f2 | Low | Closed | Docs | — | — | ratified: exported-types pointer now links `src/public-types.ts` on GitHub and names `dist/index.d.ts` as the installed equivalent, so it resolves for an npm consumer whose tarball omits `src/`. |
