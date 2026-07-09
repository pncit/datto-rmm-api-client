## architect — round 2

In-progress review. The reviser's `reviser-r1`/`reviser-r2` turns dispositioned only the
implementation-auditor's findings, never mine explicitly — so I re-verify each of my five round-1
findings directly against the current tree rather than against a disposition. All five are now
addressed by shipped code and I ratify them Closed; no round-2 findings.

Re-verification:

- **architect-r1-f1** (missing non-paginated-array primitive) — **ratified.**
  `httpGetArray<T>(path, itemSchema, context, params?)` now exists
  (`src/client/resources/base-resource.ts:243-254`), tagging `{kind:'read'}` and delegating to
  `validateArrayResponse` for per-item lenient drop — exactly the primitive I asked for, and the
  four bare-array R1 ops (`getByMacAddress`, `getDeviceAuditByMacAddress`, `getStdOut`,
  `getStdErr`) now have a correct transport path. `base-resource.test.ts` covers a bad item being
  dropped without failing the call (§7 notes).
- **architect-r1-f2** (cross-origin `nextPageUrl` SSRF/credential-exfiltration) — **ratified.**
  `resolveNextPageUrl` (`base-resource.ts:99-115`) parses each cursor against the axios
  `baseURL`, throws a `DattoValidationError('response')` on origin mismatch, and reissues only
  `pathname + search` against the configured host so the bearer token can never leave it; a
  cross-origin cursor is now refused with a test.
- **architect-r1-f3** (unbounded/cyclic pagination walk) — **ratified.** The walk now tracks a
  `visitedUrls` Set (immediate cycle rejection) and a `MAX_PAGINATION_PAGES` (10,000) ceiling
  (`base-resource.ts:520-535`), each throwing a bounded `DattoValidationError` — a pathological
  chain now fails fast instead of hanging or growing `items` without bound.
- **architect-r1-f4** (reconciled types decoupled from their schemas) — **ratified.**
  `schema-overrides/types.ts:73-78` now exports pre-coerced `deviceSchema: z.ZodType<Device>` and
  `alertSchema: z.ZodType<Alert>`, re-exported from the barrel (`index.ts:22`), so
  `httpGet(path, deviceSchema, ctx)` yields `Promise<Device>` by default and closed-enum
  re-narrowing can no longer happen by omission. The binding is a local same-file cast (not an
  import of `coerceSchema`), correctly preserving the `schema-overrides` → `client/resources`
  dependency direction I flagged.
- **architect-r1-f5** (stale/self-contradictory phase notes) — **ratified.** The notes now
  describe the shipped scope throughout: §1/§3/§5 document `httpGetArray` and the origin-pin +
  cycle/page-cap guards (Deviation 5), §6 Decision 4 records all 9 write bodies reconciled with
  warranty required-but-nullable, and the §13 Final Assertion no longer contradicts the code.

No circular dependencies introduced (verified: nothing under `schema-overrides/` imports
`client/resources`; `coerceSchema` stays in the transport layer while `types.ts` does its own
local cast). The documented cross-phase gap (`POST /api/v2/site/{siteUid}` has no `WriteOpKey`)
is correctly deferred to Phase 5/7 as out-of-scope for editing `rate-limits.ts` here, and is
already tracked by other domain reviewers — I raise nothing new on it.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | High | Closed | PublicAPI | `src/client/resources/base-resource.ts:243-254` | Non-paginated top-level-array GET had no validated primitive. | Ratified: `httpGetArray` added, delegating to `validateArrayResponse` for per-item lenient drop; the four bare-array R1 ops now have a correct path. |
| architect-r1-f2 | Medium | Closed | Security | `src/client/resources/base-resource.ts:99-115` | `paginate` followed a server-controlled cross-origin `nextPageUrl` with the bearer token attached. | Ratified: `resolveNextPageUrl` pins each cursor to the configured `apiUrl` origin, throws on mismatch, reissues path+query against `baseURL`; cross-origin cursor refused, tested. |
| architect-r1-f3 | Medium | Closed | Performance | `src/client/resources/base-resource.ts:520-535` | The `while (url)` walk had no cycle detection or page cap. | Ratified: `visitedUrls` Set rejects a repeat, `MAX_PAGINATION_PAGES` (10,000) caps an ever-advancing chain; both throw a bounded error, tested. |
| architect-r1-f4 | Medium | Closed | PublicAPI | `src/schema-overrides/types.ts:73-78`, `index.ts:22` | Reconciled `Device`/`Alert` types were decoupled from their schemas; the plan's own example would silently re-narrow to closed enums. | Ratified: pre-coerced `deviceSchema`/`alertSchema` (`z.ZodType<Device>`/`z.ZodType<Alert>`) now exported and barrel-re-exported via a local cast that preserves dependency direction. |
| architect-r1-f5 | Low | Closed | Maintainability | `docs/implementation/full-api-surface/implementation-phase6-notes.md` §1/§3/§5/§6/§13 | Notes were stale/self-contradictory versus the shipped code (write-body scope, primitive count, missing guards). | Ratified: notes now describe the shipped scope throughout; §13 Final Assertion no longer contradicts the code. |
