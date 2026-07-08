# Full API Surface — Design Process Artifact

_This cycle produced the design for rebuilding `datto-rmm-api-client` from a three-operation
device-listing utility into a complete, Orval-generated, type-safe client for the entire Datto RMM
v2 surface, converging its architecture on the sibling `fuze-api` package._

## Genesis

`datto-rmm-api-client` shipped at `0.1.14` with a solid infrastructure layer (auth, retry, rate
limiting, validation) but almost no API coverage: three operations against a v2 surface of 53 paths
/ 75 operations across ten resource groups. Anyone needing sites, alerts, jobs, audits, variables,
filters, users, activity logs, or any write had to fall back to raw HTTP, forfeiting the client's
guarantees.

The gap was not only breadth but correctness. The single hand-written schema was already wrong
against production data and silently so — `udf1…udf30` where real devices carry `udf1…udf300`, a
`deviceClass` enum missing the real value `rmmnetworkdevice` (a network device fails validation and
vanishes). Hand-transcribing ~113 schemas and 75 operations from a defective published OpenAPI spec
would multiply this class of silent-data-loss defect. Meanwhile a sibling PNCIT package, `fuze-api`,
had already solved the same problem — Orval-generated zod schemas, a lenient validation layer,
resource namespaces, a typed throwing error hierarchy — and diverged from this client only by
historical accident. The design's aim was to generate schemas from the committed spec, reconcile the
spec's systematic defects against observed reality, and mirror `fuze-api`'s architecture, shipping as
a breaking `1.0.0`.

## Outcome

The design (`docs/implementation/full-api-surface/design.md`) specifies a fully generated client:
Orval-emitted zod v4 schemas from a committed OpenAPI spec, lenient response validation (unknown keys
stripped, fields tolerated as nullable, unobserved enum values widened to `string` rather than
dropped) paired with strict request validation, a throwing error hierarchy replacing the old
non-throwing `Result<T>`/`ProblemError` contract, a dual-layer rate limiter modeling the real server
buckets, an injected `fuze-api`-parallel logger, and ten resource namespaces. Known spec defects
(timestamps, the full UDF range, `alertContext`) are corrected deterministically and survive
regeneration; `src/generated/**` is committed so a post-regeneration `git diff` is a real
reproducibility gate. It ships as a documented breaking `1.0.0` with no compat aliases.

Review ran in two phases and fully converged: every finding was resolved in the design text except
two consciously deferred follow-ups.

## Process at a glance

Two review phases over the single design document.

- **Phase 1 — grounding and correctness** (`design-auditor` ↔ `reviser`): five auditor rounds with
  four revision passes. Round 1 verified every current-state and reference claim against the repo and
  the `fuze-api` reference (all verified) and raised seven design-quality gaps. Rounds 2–4 were
  notable for a self-correcting cascade: several of the reviser's own fixes introduced new internal
  contradictions that the next round caught, until convergence at round 5.
- **Phase 2 — design quality** (`architect` and `engineer`, each ↔ `reviser`): one review round each
  (seven architect findings, four engineer findings), one revision pass, then a clean ratifying round
  from both reviewers. Converged with no new findings.

No finding was escalated to a human ruling.

## Key findings

**Leniency versus silent data loss — the central thread.** The design condemned the
`rmmnetworkdevice` silent-drop, yet its blanket response leniency covered only nullability and unknown
keys while enums stayed strict; combined with per-item drop, a future unobserved enum value would fail
and silently drop the whole record — re-creating the exact failure under a new mechanism. The fix
(response enum fields widen to `string`, logged not dropped; strict only on requests) triggered a
multi-round chain: the runtime widening then had to be matched by the emitted TypeScript type
(`EnumUnion | (string & {})`) so callers aren't handed a false exhaustiveness; and that widened type
needed a real production path. The reviser first named "an Orval `transformer`," which a later round
showed cannot express a TypeScript-only open-enum idiom that has no JSON-Schema representation. It was
finally resolved as a committed post-generate codemod run as step 2 of `npm run generate`, mirroring
`fuze-api`'s `scripts/dedupe-generated-index.mjs`, with Orval's per-schema+field enum emission letting
the codemod widen response enums without touching strict request enums.

**Pagination cursor integrity.** Retiring the old envelope hard-fail for a lenient walker risked
letting a malformed cursor silently truncate the result set, violating the "full result set"
guarantee. Requiring the cursor to validate strictly then collided with the spec's total lack of
modeled nullability — the legitimate terminal `nextPageUrl: null` would throw at the end of every
walk. Resolved with a dedicated `pageDetails` override schema: nullable cursor fields, strict on
structure (missing/malformed throws `DattoValidationError`), `null` treated as the normal end-of-walk.

**Request strictness could not catch missing required fields.** Because the spec marks only 4 of 113
schemas' fields `required`, strict validation of generated request bodies would reject unknown keys
but never a missing required field. R6 was downgraded to "unknown keys + present-field types," with
required-field marks added by hand for the small write set in the override module.

**Rate-limiter plumbing.** The dual-layer limiter was behaviorally described but the read/write kind
and op-key never reached the context-free `acquire()`. The integration point was named (`BaseResource`
tags each request `{ kind, opKey? }`; `HttpClient.acquire()` selects buckets). Phase 2 closed the
remaining gap — where the op-key→limit values live — with a committed static table (`src/rate-limits.ts`)
seeded before the first request, plus a 100 write fallback.

**Generated output: committed or not.** An early fix declared `src/generated/**` an uncommitted build
artifact "per the fuze-api pattern." Re-verification against the actual reference showed the opposite —
`fuze-api` commits its generated output precisely because it derives from an external spec — and, worse,
that the byte-for-byte `git diff` reproducibility gate is vacuous over a gitignored directory. Reversed
to commit `src/generated/**`, with the patched spec kept as an uncommitted transient intermediate.

**Security boundaries made structural.** UDF log-masking was scoped narrower than the threat it cited
and enforced by call-site discipline. It was pinned down as a deliberate Non-Goal (UDF-only; masked
variables and `Site.notes` are the consumer's responsibility) and re-implemented at the single
logger-boundary decorator through which all log calls flow, so no call site can leak an unmasked value.
The worst-rated risk (fixtures carrying live BitLocker keys/credentials) had only a documented
sanitization step; it was upgraded to a committed sanitization script plus a pre-commit/CI scan that
fails the build on secret-shaped values.

**Observability at the target scale.** Leniency diagnostics emitted a log line per field per item —
thousands per paginated call over the 848-device / 1500-alert corpus — drowning genuine signal and
running the masker in a hot path. A diagnostics strategy was added: aggregate/dedupe per page/call, with
benign strips/widenings at `debug` and actual per-item drops at `warn`.

**Document hygiene and DX.** Both Phase 2 reviewers flagged that revision residue had triplicated the
cursor-override, enum-widening, and reproducibility-gate descriptions across three-plus locations each;
these were collapsed to a single canonical home apiece with pointers elsewhere. The `account.devices()`
(list) versus `devices.get(uid)` (single/mutate) namespace split was committed to a documented
namespace→endpoint map rather than papered over with an alias. A missing breaking change — the logger
interface shape change from variadic `console`-style to `(message, meta?)` — was added to the migration
list.

## Key decisions

- **Widen, don't drop, on unobserved enums; stay strict on requests.** The design's own anti-goal
  (silent data loss) governed: response enums degrade to passthrough and log, request enums remain
  strict. The emitted type was widened to match so the compile-time contract never over-promises
  exhaustiveness.
- **Leniency governs item payloads, not the walk cursor.** The pagination cursor is validated strictly
  on structure via an override schema; only named-array items are subject to leniency. This preserved
  the full-result-set guarantee without breaking on the spec's unmodeled nullability.
- **Required-field enforcement is not spec-derivable and is stated as such.** Rather than claim a
  strictness the generated schemas cannot deliver, R6 was scoped down and the write-set required marks
  live in one hand-verified override module.
- **Commit generated output to keep the reproducibility gate real.** Chosen over an uncommitted-artifact
  scheme once the reference and the vacuous-`git diff` problem were verified — grounding both the R15
  source claim and the byte-for-byte success criterion in fact.
- **Enforce invariants by construction, not by discipline.** Masking moved to the single logger boundary
  and fixture sanitization to a mechanical CI gate, on the principle that a security invariant must be
  structural.
- **Kept a factual dispute open with counter-evidence rather than escalating.** When the reviser's first
  production-path fix for the widened type was still wrong, the auditor kept the finding open with
  reference-repo evidence rather than escalating to a human — appropriate for a verifiable,
  non-subjective point with a concrete correct path in the reference. It resolved on the next pass.
- **Fix in-scope gaps; Accept out-of-scope concerns as recorded deferrals.** The reviser distinguished
  the nine tightenings it folded into the design from the two reviewer-flagged `Defer:` findings, which
  were recorded under Deferred Decisions rather than expanding this rebuild's scope.

## Known limitations

- **Duplicated `fuze-api` primitives.** Convergence is achieved by copying `fuze-api`'s `parseLenient`
  and `BaseResource` rather than sharing them, so the two clients can skew on future fixes. Recorded as
  a conscious, temporary duplication with a follow-up to evaluate extracting the shared primitives into
  a common internal package once both clients are on the throwing model.
- **Eager full-buffer pagination.** `paginate` walks every page and buffers the full result set in
  memory (1500+ alerts today, unbounded as accounts grow), with no streaming/async-iterator escape hatch
  on the frozen `1.0.0` surface. This matches 0.1.x behavior and R3's intent; a streaming variant is
  additive and deferred to a follow-up.
