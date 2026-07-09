# Full API Surface — Plan Process Artifact

_This cycle turned the full-api-surface design into a sequenced, ten-phase implementation plan for rebuilding `datto-rmm-api-client` from a three-operation device-lister into a generated, throwing, namespace-organized client for the entire Datto RMM v2 surface — hardened through two reviewer stages until it converged with no open findings._

## Genesis

`datto-rmm-api-client` ships at `0.1.14` with solid infrastructure but almost no coverage: three
operations (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`) against a v2 API of 53 paths /
75 operations across ten resource groups. Worse, its one hand-written schema is already wrong against
production data — `udf1…udf30` where real devices carry `udf1…udf300`, a missing `rmmnetworkdevice`
device class — and silently so. The design (`design.md`, already reviewed in its own cycle) chose to
close the gap by *generating* schemas from Datto's OpenAPI spec, reconciling the spec's systematic
defects, and converging the client's architecture on the sibling `fuze-api` package (Orval codegen,
`parseLenient`, a throwing error hierarchy, `BaseResource`, an injectable logger, tsup/vitest).

This cycle produced the **plan** that realizes that design: a ten-phase blueprint (coexistence rule,
byte-reproducible generation pipeline, faithful `fuze-api` ports, per-phase exit gates) that an
implementor executes one phase at a time. The review's job was to make that blueprint mechanically
sound — every phase buildable, every exit gate enforceable, every design requirement (R1–R20)
traceably delivered — before any code is written.

## Outcome

The plan (`plan.md`) is the living result: ten phases from toolchain migration and spec
generation through the error/logging/validation/auth/rate-limit layers, resource namespaces, the
old-surface deletion, fixture validation, and the documented breaking `1.0.0`. Load-bearing shapes it
settled include:

- A committed, defect-patched spec feeding a deterministic `generate` pipeline
  (`patch-spec → orval → dedupe-generated-index → widen-response-enums`), with the generated tree the
  single source and all corrections confined to the patch step, the enum codemod, or
  `src/schema-overrides/`.
- Reconciled entity types (`Device`, `Alert`) as the **single source of truth**, grafting the
  codemod-widened open enums onto the override schemas' `z.infer` via an `Omit`/`Pick` intersection
  keyed by a per-entity `WIDENED_FIELDS`/`OVERRIDE_ENTITIES` registry, guarded for completeness at
  every nesting depth.
- A curated public surface, isolated OAuth transport, a typed `WriteOpKey` rate-limit contract,
  pinned numeric defaults in a layer-neutral `src/defaults.ts`, fail-loud generation guards, and
  fenced (executable) exit gates throughout.

A reader should take away that the plan is faithful to `fuze-api`, defect-aware, and gated so that
regeneration and phase boundaries stay green — not a set of aspirations but a buildable sequence.

## Process at a glance

The run had two reviewer stages against one reviser, spanning thirteen reviser rounds:

1. **Plan-auditor stage (design-traceability):** six rounds auditing the plan against `design.md`,
   the repo, and the `fuze-api` sibling. It confirmed all twenty R-IDs are claimed and delivered, then
   raised 16 findings; reviser rounds 1–5 dispositioned them (marked *Fixed*).
2. **Architect + Engineer panel:** each reviewed nine rounds across their own axes — architect on
   module boundaries, data model, public surface, sequencing, and hot paths; engineer on DRY,
   complexity, error handling/logging, naming, and configuration. Together they raised ~46 findings;
   reviser rounds 6–13 dispositioned them (marked *Accept*). Both reviewers reached a round with **no
   open findings**, ratifying convergence.

Every finding was accepted and fixed — **no rejections and no live escalations**. Each reviewer round
re-verified the prior fixes by direct reading of the revised plan (not on the reviser's word) before
hunting for new issues, and both stages practiced strict carry-forward discipline (closed findings
were not re-tabled). One human ruling from earlier history was carried in: the Phase 9 secret-scanner
was ordered removed (see Known limitations).

## Key findings

The substantive issues clustered into a few themes; the ones that changed the plan most:

- **Two sources of truth for entity types (the central thread).** The generated types and the
  reconciled `schema-overrides` schemas described the same entities differently, so a method annotated
  `Promise<Device>` could misdescribe its runtime value. The fix made the reconciled schemas the
  single source. That immediately exposed a deeper tension the design's R5 open-enum widening created:
  the `(string & {})` widening is a TS-types-only codemod transform with no zod representation, so
  `z.infer` of a composed override schema inherits a *closed* enum — reviving at compile time the exact
  exhaustiveness the runtime deliberately relaxes. Resolving it took a multi-round arc: an explicit
  `Omit`/`Pick` intersection graft; keying it off a single `as const` constant to kill hand-repeated
  literals; extending it to `Device`'s **nested** enums (`antivirus.antivirusStatus`,
  `patchManagement.patchStatus`) by grafting the whole widened subtree; a **recursive** completeness
  guard binding every enum field at every depth to the constant; homing the recursive enum-walker as an
  exported helper of the single `_zod.def`-isolated module so no parallel introspection site appears;
  renaming the constant to `*_WIDENED_FIELDS` to match its now-subtree semantics; and finally a single
  `OVERRIDE_ENTITIES` registry pairing each schema with its widened fields so the guard is
  implementable without a layering inversion.

- **No dead surface, no dead knobs.** Reviewers removed an entire committed-but-unused generated
  endpoints layer (and its axios-mutator), replaced `export * from './generated/types'` with a curated
  `public-types.ts` gated against regeneration drift, dropped the unwired `axiosInstance` and
  `defaultWriteLimit` config fields (the same anti-pattern R14 retires), and enumerated every concrete
  write `opKey` so the closed `WriteOpKey` union actually compiles.

- **Transport and rate-limit correctness.** The OAuth token round-trip was isolated onto a separate
  bare axios instance so it cannot consume the v2 read window, attach a Bearer header, or hit the v2
  retry/classification path — with `AuthManager` mapping its own failures since the bare instance has
  no interceptor. The highest-volume paginated read path was found to go out **untagged** (bypassing
  the limiter); `paginate` now attaches an explicit `{kind:'read'}` descriptor and the interceptor
  defaults an absent descriptor to read. The custom `rateDescriptor` axios augmentation was scoped as
  internal-only so it never leaks into the published `.d.ts`.

- **Fail-loud generation guards.** `patch-spec` now throws on a missing timestamp anchor rather than
  silently reshipping a defect; the enum-widen guard verifies its load-bearing "no request body shares
  a response component schema" assumption **transitively** (recursive `$ref` resolution), filtered to
  enum-bearing shares to avoid spurious build breaks, with a self-locating error message; and the
  dropped `fuze-api` index-dedupe step was ported back into the pipeline.

- **Enforceable exit gates and real coverage.** Prose-only exit-gate assertions across several phases
  were folded into fenced commands that fail non-zero. The R1 coverage guard was hardened from a bare
  count to a spec-derived inventory driven against the *constructed client* under scoped nock
  intercepts — with minimal valid sample bodies for body-carrying writes (and an explicit exemption for
  bodiless writes) so strict `validateRequest` doesn't throw before the request is observed.

- **Determinism and defaults.** Nondeterministic timing knobs were pinned as named constants
  (`DEFAULT_TOKEN_REFRESH_PCT = 25`, `DEFAULT_RETRY`, `MAX_RETRY_AFTER_MS = 30_000` to cap a hostile
  `Retry-After`), then relocated from `src/client/` to a top-level, layer-neutral `src/defaults.ts` to
  break a `client → http → client` import cycle. The `moduleResolution: "Bundler"` pin was paired with
  its required `module: "ESNext"` setting so Phase 1's own typecheck gate holds.

- **Data-model faithfulness.** UDF masking was made to redact any non-null `udf*` value regardless of
  wire type (and never interpolate wire values into log message strings, only `meta`); the udf value
  schema was widened to agree with that defense; the pagination cursor was loosened from `strictObject`
  to tolerate benign added envelope keys while still throwing on missing/mistyped cursor fields; and
  403s were split into `ip-block` vs `forbidden` rather than mislabeling ordinary authorization
  failures.

## Key decisions

- **Reconciled schemas are the single source of truth for reconciled entities.** Rather than exporting
  raw generated types, the plan derives public entity types from the override schemas and grafts only
  the widened enum subtrees back in. This is the decision the longest review thread exists to make
  mechanically sound; it keeps compile-time types honest about what the runtime returns.

- **Widen guard scoped precisely to where over-widening is possible.** The transitive guard throws only
  when a request/response-shared component actually declares an enum, because widening is a no-op on
  enum-free schemas — accepting a slightly narrower guard to avoid failing `npm run generate` on benign
  shared address/pagination sub-objects.

- **`DEFAULT_WRITE_LIMIT` kept as a limiter-only defensive fallback.** Once `WriteOpKey` became a
  closed union, no typed resource call can reach an "unlisted" opKey; rather than delete the fallback,
  the plan documents it as reachable only via the intentionally-untyped `acquire` boundary and drops
  the corresponding dead *config* field — resolving the tension explicitly instead of leaving a knob
  that looks live but isn't.

- **Synthesized fixtures over live capture.** Real sweep data carries live secrets and needs a live
  account, so Phase 9 validates against fixtures that deliberately encode every observed defect pattern
  plus the benign existing captures; a live re-validation is consciously Deferred Validation.

Every finding across both stages was accepted; the review recorded no disputes requiring a
reviewer-vs-reviser ruling. The plan's shape is therefore the product of accepted corrections layered
round on round, not of contested trade-offs.

## Known limitations

- **Secret-scanner removed by human ruling.** An earlier plan iteration included a Phase 9 automated
  secret detector; a human ruling determined it was a bad idea from the start (an unreliable heuristic —
  false positives on OpenAPI/OAuth structural keys, false negatives on novel shapes) and it was
  removed. The plan's at-rest guarantee instead rests on the deterministic key-based sanitizer,
  commit-time human review, and the verified-benign existing fixtures. A residual citation pointed at a
  `mediator-hardstop-r1.md` artifact that does not exist in this review record; the reviser scrubbed the
  dangling reference rather than restoring the file, leaving the self-standing rationale in place.

- **Deferred Validation (explicitly out of this cycle).** A live refresh/diff of the committed spec; a
  fresh real-sweep validation of the reconciled schemas (fixtures are synthesized); confirmation of
  Datto's real IP-block 403 wire marker against a live block; and per-operation `opKey`-name accuracy
  against production — all deferred because they require live egress or a live account an implementor
  agent lacks.

- **Streaming pagination deferred.** `paginate` buffers a fully-walked page eagerly; this is
  acknowledged and bounded, with streaming left out of scope.
