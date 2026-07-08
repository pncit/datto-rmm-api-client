## design-auditor — round 1

Review of `docs/implementation/full-api-surface/design.md`. Round 1: current-state claims verified
against the repo and against the `fuze-api` reference; findings below are design-quality gaps, not
grounding errors.

### Current State Verification
| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| Three ops implemented: `getAccountDevices`/`getDeviceByUid`/`updateDeviceUdfs` | Verified | `src/client.ts` |
| `UdfSchema` models `udf1…udf30` only | Verified | `src/schemas.ts:35-66` |
| `deviceClass` enum omits `rmmnetworkdevice` | Verified | `src/schemas.ts:95` (`device|printer|esxihost|unknown`) |
| `updateDeviceUdfs` targets `PATCH /api/v2/account/devices/{uid}/udf` | Verified | `src/client.ts:214-215` |
| Single 600/60s `SlidingWindowRateLimiter`, no write modeling | Verified | `src/rateLimiter.ts` |
| `Result<T>`/`ProblemError` non-throwing contract | Verified | `src/result.ts`; `ProblemError` already carries `retryAfterMs` |
| `autoRefresh`, `tokenRefreshPct`, `userAgentExtra` declared but unused | Verified | only in `src/config.ts`; no other refs |
| Auth refreshes within 60s of expiry, in-memory store | Verified | `src/auth.ts:22` (`+ 60000`) |
| `index.ts` re-exports client/config/result/schemas | Verified | `src/index.ts` |
| `getAllPages` hard-wired to devices envelope + extractor | Verified | `src/client.ts:67-161` |
| fuze-api has `schema-leniency.ts`, `base-resource.ts`, `generated/{schemas,types,endpoints}`, `spec/openapi.json`+`openapi-prev.json`, Orval 7 / tsup / vitest / nock | Verified | `~/dev/repos/fuze-api` |
| Current logger is `LoggerLike` = `(...args:any[])=>void`, default `console` | Verified | `src/logger.ts` (differs from proposed `DattoLogger` `(message, meta?)=>void`) |

The design is well-grounded: every current-state and reference-architecture claim checks out. The
findings are gaps in the proposed design's specification and internal consistency.

### Design Completeness
Problem/Vision/Current State: Complete and accurate. Requirements table: present, R-IDs traceable
in both directions. Decisions 1–5: genuine alternatives, sound rationale. Gaps concentrate in the
interaction between blanket response leniency (R5/R7) and the other guarantees — enum drift,
pagination-cursor integrity, request-schema strictness — plus one un-threaded integration point
(rate-limiter op keys) and one under-scoped security boundary (masking beyond UDFs).

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | High | Open | DesignDecision | Decision 2 / R5 / R7 / "Enum coverage is otherwise good" | Blanket response leniency is specified for **nullability and unknown keys only**; enums are explicitly treated as the trustworthy part and generated verbatim (strict). Combined with per-item drop (R7), a **new/unobserved server enum value** (e.g. a future `deviceClass`, `patchStatus`) causes the whole item to fail and be silently dropped-and-logged — the *exact* `rmmnetworkdevice` silent-data-loss failure the Problem Statement condemns, re-created under a new mechanism. The 848-device sweep cannot prove enum completeness. | Specify response-side enum handling: on **response** validation, enum fields degrade to passthrough (e.g. widen to `string`, or `.catch()`/union-with-string) so an unknown value logs but does not drop the record; keep enums strict only on **request** bodies. State this in Decision 2 / R5. |
| design-auditor-r1-f2 | Medium | Open | Feasibility | Overview / Key Concepts (dual-layer rate limiter, R11) | The design says "each write operation declares its operation key" and the limiter "enforces the tightest applicable window," but never specifies **how read-vs-write and the op-key reach the limiter**. Today `HttpClient.acquire()` is context-free (`SlidingWindowRateLimiter.acquire()` takes no args). A Planner cannot build this without inventing the plumbing (does `BaseResource` pass `{kind, opKey}` through the request options? does `HttpClient` select the bucket?). | Name the integration point: e.g. each `*Resource` write method passes an op-key into `BaseResource`→`HttpClient`→limiter, reads use the read bucket by default. One sentence in the dual-layer-limiter concept resolves it. |
| design-auditor-r1-f3 | Medium | Open | DesignDecision | Decision 2 / R6 / "strict request validation is safe" | R6/Decision 2 assert request validation is **strict**, but request schemas are generated from the same spec that declares `required` on only 4 of 113 schemas. Orval-generated request bodies will therefore have nearly all fields **optional**, so "strict" (reject unknown keys) will **not** catch a missing required field on a write (e.g. an empty `device-move`/`udf-set` body). The rationale "the client controls request shapes" does not close this — the client controls the *call site*, not the *schema's* required-ness. | Either extend the patch/override step to mark required fields on request bodies (the write set is small), or downgrade the R6 claim to "strict on unknown keys / present-field types" and note that required-field enforcement is not spec-derivable. |
| design-auditor-r1-f4 | Medium | Open | Completeness | Key Concepts (`paginate` helper, R3) vs Decision 2 (response leniency) | The current `getAllPages` **deliberately hard-fails** a malformed envelope (`src/client.ts:100-120`) precisely so a bad `pageDetails` cannot truncate the walk. The redesign retires it for a lenient `paginate` helper but does **not** say how the envelope/cursor is validated. Under blanket leniency, a malformed/absent `pageDetails.nextPageUrl` would be tolerated and the walk would **end early**, silently returning a partial set — violating R3's "full result set" with no error. | Specify pagination-cursor handling: the envelope (`pageDetails`) validates strictly enough that a malformed cursor **throws `DattoValidationError`** rather than silently ending the walk; leniency applies to the named-array items, not the walk cursor. |
| design-auditor-r1-f5 | Medium | Open | Risk | R20 / Risks (secret-bearing fields) / Non-Goals | R20 masks only `udf*` values, but the risk row and reality note that secrets also live elsewhere — Datto **site/account variables** carry `masked`/password values, and `Site.notes` is free text. Response debug/leniency logging (R5/R7 diagnostics) could emit variable secrets in cleartext once the `variables` namespace exists. The masking guarantee is narrower than the threat it cites. | Tighten scope, don't just add: either extend the masking utility to masked-variable values, or add an explicit Non-Goal stating masking covers UDFs only and other secret-bearing fields are the consumer's responsibility — so the boundary is deliberate, not accidental. |
| design-auditor-r1-f6 | Low | Open | Migration | Breaking Changes | The logger contract changes shape — from `LoggerLike` = `(...args:any[])=>void` defaulting to `console` (`src/logger.ts`) to `DattoLogger` = `(message:string, meta?)=>void`, zod-validated (R13). A `0.1.x` consumer passing a `console`-style logger breaks. This breaking change is **absent** from the Breaking Changes list, so the R18 README migration will omit it. | Add one line to Breaking Changes: logger interface changes from variadic `(...args)` to `(message, meta?)`; document the shim in the upgrade path. |
| design-auditor-r1-f7 | Low | Open | Completeness | Overview diagram (`spec/openapi.patched.json`) vs R15 / Migration step 2 | The overview pipeline shows `spec/openapi.patched.json` as an intermediate, but R15 and Migration step 2 commit only `spec/openapi.json` + `spec/openapi-prev.json`. Whether the patched spec is committed or a build-time artifact is left ambiguous — which matters for the "`npm run generate` reproduces `src/generated/**` byte-for-byte" success criterion (a non-committed, non-deterministic patch would break it). | State explicitly whether `openapi.patched.json` is committed or regenerated, and confirm the patch step is deterministic so the byte-for-byte criterion holds. |
