## architect — round 3

In-progress review. All five of my round-1 findings (`architect-r1-f1..f5`) were ratified `Closed`
in round 2 and are **not** re-listed here (carry-forward discipline: earlier-closed findings do not
reappear). This round I (a) re-confirmed those closures have not regressed under the changes landed
since my round 2, and (b) ran a fresh exhaustive architectural pass over the whole Phase 6 surface,
including the parts touched by the round-3/round-4 reviser passes. **No new architect findings.**

### Re-confirmation that my closed findings did not regress

- **f1 (bare-array primitive)** — `httpGetArray` still present (`base-resource.ts:243-254`), tagging
  `{kind:'read'}` and delegating to `validateArrayResponse` for per-item lenient drop. Unchanged.
- **f2 (cross-origin `nextPageUrl`)** — `resolveNextPageUrl`/`parseAbsoluteUrl` still pin each
  cursor to the configured `baseURL` origin and reissue `pathname + search`
  (`base-resource.ts:99-115`, called at `:552`). Unchanged.
- **f3 (unbounded/cyclic walk)** — `visitedUrls` Set + `MAX_PAGINATION_PAGES` guard still bound the
  walk (`base-resource.ts:522-535`); ordering (cycle → cap → add → fetch) is still correct.
- **f4 (types decoupled from schemas)** — pre-coerced `deviceSchema`/`alertSchema`
  (`z.ZodType<Device>`/`z.ZodType<Alert>`) still exported and barrel-re-exported
  (`types.ts:80-85`, `index.ts:22`), so a resource passing them can never re-narrow to closed
  enums. **Note on the round-3/-4 interaction:** the concurrent `Lenient<T>` fix
  (`typescript-cop-r1-f1`) made `httpGet(path, deviceSchema, ctx)` resolve to `Promise<Lenient<Device>>`
  rather than `Promise<Device>`. That does **not** regress my f4 — the closed-enum hazard f4
  targeted stays fixed (`deviceSchema` remains `Device`-typed, so the residual is only the honest
  `Lenient<Device>`→`Device` re-assertion, not a closed-enum re-narrowing). The residual doc-claim
  contradiction was correctly owned and resolved by `typescript-cop-r2-f1` (Closed, ratified in
  `typescript-cop-r3`) and reviser-r4's doc rewrite; it is a type-fidelity/doc concern in that
  agent's lane, so I do not raise a duplicate.
- **f5 (stale notes)** — the notes' §3/§7 test counts and §4/§6 `deviceSchema` framing were further
  corrected by reviser-r4 (`project-lead-r2-f1`, `typescript-cop-r2-f1`); notes now match the code.

### Fresh architectural pass — nothing new

- **Boundaries / dependency direction** — verified `schema-overrides/**` contains no runtime import
  of `client/resources` (only doc-comment cross-references); `base-resource.ts` imports only
  downward (`errors`, `logging` [type], `rate-limit` [type], `schema-overrides/pagination`, `util`,
  `validation`). No circular dependency, no inverted edge, no cross-layer bypass introduced.
- **Single-transport invariant** — every primitive (`httpGet`, `httpGetArray`,
  `httpPost`/`httpPut`/`httpPatch` via `sendWrite`, `httpDelete`, and each `paginate` page) routes
  through the one shared axios instance and attaches an explicit `RateDescriptor`; no resource path
  reaches `this.axios` unthrottled or unvalidated.
- **Data model / public API** — `pageDetailsSchema` (strict-cursor via `.catchall`), `udfSchema`,
  `alertContextSchema`, the `Omit`/`Pick` open-enum graft driven off the `*_WIDENED_FIELDS`
  constants, and `OVERRIDE_ENTITIES` (schema-not-name pairing for Phase 9's `enumFieldPaths`) are
  internally consistent and carry no leaking concrete coupling. Write-body reconciliation covers
  every `WriteOpKey`-named body-carrying op; the documented cross-phase gap
  (`POST /api/v2/site/{siteUid}` with no `WriteOpKey`) remains correctly deferred to Phase 5/8, not
  smuggled into an out-of-scope edit here.
- **Security / hot path** — the SSRF origin-pin, cycle, and page-cap guards on the highest-volume
  read path (`paginate`) are the correct boundary-level defenses; the `baseURL`-unset bypass is
  production-unreachable (`apiUrl` is a required, URL-validated config field) and documented.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
