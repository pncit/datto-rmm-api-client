# Full API Surface — Design Process Artifact

_This cycle produced the design for rebuilding `datto-rmm-api-client` from a three-operation
device-listing utility into a complete, generated, type-safe client covering the entire Datto RMM
v2 surface — and hardened that design through review until its schema-reconciliation, rate-limit,
and security guarantees were internally consistent and buildable._

## Genesis

`datto-rmm-api-client` shipped at `0.1.14` with solid infrastructure (auth, retry, rate limiting,
non-throwing `Result`/`ProblemError`) but almost no API coverage: three operations
(`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`) against a v2 surface of 53 paths / 75
operations across ten resource groups. Anything else forced consumers back to raw HTTP, forfeiting
the client's guarantees.

The gap was also a correctness problem. The single hand-written schema was already silently wrong
against production: `DeviceSchema.udf` modeled `udf1…udf30` while real devices carry `udf1…udf300`,
and `deviceClass` omitted the real value `rmmnetworkdevice`, failing validation on network devices.
Hand-transcribing ~113 schemas and 75 operations would multiply this class of silent-data-loss
defect, especially given Datto's defective published OpenAPI spec. A sibling PNCIT package,
`fuze-api`, had already solved the same problem (Orval-generated zod schemas, a lenient validation
layer, resource namespaces, a typed throwing error hierarchy) and diverged from this client only by
historical accident. The design set out to close the coverage gap by *generating* schemas from the
committed spec, reconciling them against observed production reality, and converging on `fuze-api`'s
architecture — shipped as a breaking `1.0.0`.

## Outcome

The design (`docs/implementation/full-api-surface/design.md`) specifies a complete v2 client whose
schemas are Orval-generated from a committed OpenAPI spec and reconciled through four cooperating
mechanisms: a committed spec-patch step, a hand-verified override module, a runtime `parseLenient`
layer, and a committed post-generate codemod. Its load-bearing guarantees, as settled by review:

- **Response leniency without silent data loss.** Response validation tolerates unmodeled
  nullability and unknown keys; enum-typed *response* fields widen to `string` (logging the unseen
  value rather than dropping the record), while *request* bodies stay strict. The emitted TypeScript
  response type is widened to match (`EnumUnion | (string & {})`) via a committed post-generate
  codemod, so the compile-time contract never claims an exhaustiveness the runtime relaxes.
- **Pagination integrity.** A dedicated `pageDetails` override models the cursor as nullable and is
  validated strictly on structure — a malformed envelope throws `DattoValidationError` rather than
  silently truncating the walk; a `null` `nextPageUrl` is the ordinary terminal.
- **Faithful, plannable rate limiting.** A dual-layer limiter keyed by a committed static
  `src/rate-limits.ts` table, seeded before the first request, with a request descriptor
  (`{ kind, opKey? }`) threaded through `BaseResource` → `HttpClient.acquire()`.
- **Structural UDF masking.** Masking is enforced at a single logger-boundary decorator, not by
  per-call-site discipline.
- **Reproducible codegen.** `src/generated/**` is committed (mirroring `fuze-api`), the patched spec
  is an uncommitted transient, and the `git diff must be empty` reproducibility gate has real teeth.

## Process at a glance

The run had two phases against a single evolving design. Phase 1 was a five-round grounding and
correctness lineage between the **design-auditor** and the **reviser** (auditor r1–r5, reviser
r1–r5): the auditor verified every current-state claim against the repo and the `fuze-api` reference
and drove out specification gaps. Phase 2 layered two design reviewers on the converged text — the
**architect** (r1–r2) and the **engineer** (r1–r2) — with the reviser dispositioning their findings
in a shared r5 turn. Both Phase 2 reviewers ratified all fixes in their round 2 and raised nothing
new. There were no escalations; every finding was resolved between reviewer and reviser.

A notable feature of Phase 1 is that several rounds chased consequences the *previous round's fixes*
introduced — the review repeatedly caught the reviser's own tightenings creating new contradictions,
and followed each lineage to a verified-feasible resolution.

## Key findings

**The leniency-vs-guarantees tension (the spine of Phase 1).** The auditor's opening round showed
that blanket response leniency, as first written, quietly re-created the very `rmmnetworkdevice`
silent-data-loss the Problem Statement condemned: strict generated enums plus per-item drop meant a
single unobserved server enum value would fail and silently drop a whole record. The fix — widen
response enums to passthrough, strict on requests — then cascaded through three more rounds:

- Widening at runtime but not in the *emitted type* would hand callers a narrow union claiming an
  exhaustiveness the runtime deliberately violated; resolved by widening the emitted type to
  `EnumUnion | (string & {})`.
- That widened type had no stated production path (Orval emits the narrow union; generated output
  can't be hand-edited). The reviser first named "an Orval `transformer`," which the auditor
  falsified against Orval's model — the open-enum idiom is TypeScript-only with no JSON-Schema
  representation, so a spec-level transformer collapses it to plain `string`. The final, verified
  mechanism is a **committed post-generate codemod** run as step 2 of `npm run generate`, exactly the
  pattern `fuze-api`'s `scripts/dedupe-generated-index.mjs` establishes.

**Pagination-cursor integrity.** The original `getAllPages` deliberately hard-failed a malformed
envelope so a bad cursor could not truncate the walk; the lenient redesign lost that guarantee. The
fix required strict cursor validation — which immediately collided with the spec's unmodeled
nullability, since a strict non-null cursor schema would throw at the *end of every walk* when the
terminal `nextPageUrl` is `null`. Resolved by a dedicated `pageDetails` override: nullable cursor
fields, strict on structure, `null` = normal terminal.

**Under-specified integration and reproducibility points.** The dual-layer rate limiter never said
how read/write and op-keys reached the context-free `acquire()`; the request-descriptor plumbing was
named. Request "strict" validation was overclaimed given only 4 of 113 spec schemas mark `required`;
R6 was downgraded and required-field marks moved into the override module. The claim that
`src/generated/**` was uncommitted was factually inverted against `fuze-api` (which commits it) *and*
made the byte-for-byte `git diff` gate vacuous; the design was corrected to commit generated output.

**Structural security invariants (Phase 2, architect).** Two load-bearing guarantees were described
as behavior without a boundary that enforced them. UDF masking depended on remembering to call the
masker at each log site; it was rewritten to a single logger-boundary decorator so the guarantee
holds by construction. The worst-rated risk (fixtures carrying live BitLocker keys/credentials,
High/High) was mitigated only by a "documented" sanitization step; it was replaced with a committed
sanitization script plus a pre-commit/CI scan that fails the build on secret-shaped values.

**Observability at scale (Phase 2, engineer).** Leniency diagnostics, as specified, would emit one
(masked) log line per field per item across fully-walked collections (848 devices, 1500 alerts),
drowning genuine signal and running the masker thousands of times per call. A diagnostics strategy
was added: aggregate/dedupe per page/call, with benign strip/widen at `debug` and per-item drop
(real data loss) at `warn`.

**Document hygiene.** Both Phase 2 reviewers independently flagged that the r1–r5 revisions had left
three mechanisms (the cursor override, enum-widening/codemod, and the reproducibility gate) restated
near-verbatim in three-plus places each. Each was collapsed to one canonical home with the other
sites referencing it, and a success criterion was added to guard the build-time-type ⇄ runtime
`parseLenient` widening alignment that otherwise had no test.

## Key decisions

- **Widen response enums, keep request enums strict.** The asymmetry is deliberate: responses must
  survive unobserved server values (the client does not control server payloads), while request
  bodies are client-authored and stay strict. Both the runtime and the emitted type are widened so
  the two contracts agree.
- **Correctness of the codegen mechanism over the first plausible one.** The "Orval transformer"
  path was accepted by the reviser, then rejected on verified evidence that Orval transformers
  cannot express the open-enum idiom. The design was held open until a mechanism proven to exist in
  the reference repo (a committed post-generate codemod) replaced it — a case of the review refusing
  a fix that read well but could not be built.
- **Commit generated output, mirroring `fuze-api`.** Chosen over keeping it uncommitted so the
  byte-for-byte reproducibility gate is a real check (`git diff` never reports untracked files) and
  R15's "fuze-api pattern" citation is factually correct.
- **Masking is UDF-only, by design.** Rather than expand the masking utility to cover masked
  `variables` and free-text `Site.notes`, an explicit Non-Goal makes the boundary deliberate: the
  guarantee is exactly "no UDF value in cleartext," and other secret-bearing fields are the
  consumer's responsibility. This honored the R20 stakeholder decision without silently broadening
  scope.
- **Security and reproducibility guarantees must be structural, not procedural.** Masking moved to a
  logger boundary; fixture sanitization moved to a committed script + CI scan; the widened type moved
  to a committed codemod. In each case a "remembered" control was replaced with one enforced by
  construction.
- **One pluralization rule on the frozen `1.0.0` surface.** Because the breaking surface cannot be
  re-cut without a `2.0.0`, the mixed plural/singular namespaces were reconciled to a single rule
  (plural for collection namespaces; singular for the genuine singletons `account`/`system` and for
  `audit` as a group of fetch ops), so `audit` is no longer an unexplained lone singular.

## Known limitations

Two concerns were consciously **deferred** rather than folded into this design, both raised by the
architect as explicit `Defer:` findings and recorded under Deferred Decisions:

- **Duplicated primitives across the two clients.** Convergence is achieved by *copying* `fuze-api`'s
  `parseLenient` and `BaseResource` rather than sharing them, which risks the same historical-accident
  drift the Problem Statement condemns. Extracting the shared leniency/base-resource/error primitives
  into a common internal package touches both clients and is out of scope for a single-client rebuild;
  a consolidation follow-up is filed, and the copy is recorded as a conscious, temporary duplication.
- **Eager full-buffer pagination.** `paginate` walks every page and buffers the full result set in
  memory (1500+ alerts today, unbounded as accounts grow), with no streaming/async-iterator escape
  hatch on the frozen surface. This matches 0.1.x behavior and R3's stated intent; a streaming variant
  is additive (non-breaking) and deferred to a follow-up.

There were no escalations; every finding was resolved between reviewer and reviser. The design's own
`Tracking:` line is `None` (explicit).
