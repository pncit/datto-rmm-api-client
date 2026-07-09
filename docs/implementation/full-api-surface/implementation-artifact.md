# Full API Surface — Implementation Process Artifact

_This cycle rebuilt `datto-rmm-api-client` from a three-method device-listing utility into a complete, generated, type-safe client covering the entire Datto RMM v2 surface across ten resource namespaces, shipped as a breaking `1.0.0`._

## Genesis

`datto-rmm-api-client` shipped at `0.1.14` with a solid infrastructure layer but almost no API
coverage: three hand-written operations (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`)
against a v2 surface of 53 paths. Anything beyond listing devices — sites, alerts, jobs, audits,
variables, filters, users, activity logs, or any write — forced consumers back to raw HTTP,
forfeiting the client's auth, retry, rate-limiting, and validation. Worse, the one hand-written
schema was already wrong against production data: `DeviceSchema` modeled `udf1…udf30` where real
devices carry `udf1…udf300`, and `deviceClass` omitted the real `rmmnetworkdevice` value, so those
records silently failed validation.

Hand-transcribing ~113 schemas and the full operation set would have multiplied that class of silent
defect. The chosen path — set out in `design.md` and sequenced across ten phases in `plan.md` — was
to **generate** schemas from Datto's own OpenAPI specification (with the spec's systematic defects
corrected in a committed patch step), validate responses leniently and requests strictly, and
converge the client's architecture on the sibling `fuze-api` package (throwing error hierarchy,
injectable logger, Orval/tsup/vitest toolchain) so the two PNCIT clients share one mental model.

## Outcome

The client now exposes **every operation in the committed v2 spec — 57 operations across 53 paths —**
behind ten resource namespaces (`account`, `sites`, `devices`, `alerts`, `jobs`, `filters`, `audit`,
`users`, `activityLogs`, `system`), each reachable as `client.<resource>.<operation>()`. Schemas are
Orval-generated from a committed, patch-corrected spec; regeneration is byte-reproducible and
CI-guarded. Responses validate leniently (null-tolerant, unknown-key-stripping, per-item drop, open
enums degrading to `string`); write bodies validate strictly. The transport models Datto's real
read / aggregate-write / per-operation rate limits, honors 429/403, and never leaks secrets into
error objects or logs. UDF values are masked in all log output. The old flat surface was deleted in
one commit and the package shipped as a breaking `1.0.0` with a README and upgrade guide.

The living design and plan are `docs/implementation/full-api-surface/design.md` and `plan.md`; the
per-phase implementation notes accompany them. This artifact records how the review process shaped
that result.

## Process at a glance

Ten phases were implemented and reviewed sequentially, one per session, each landing new code under
new paths while the old surface stayed compiling until Phase 8 deleted it. Every phase ran a two-step
review: **Step A** an `implementation-auditor` pass, then **Step B** four reviewers in parallel —
`architect`, `engineer`, `project-lead`, `typescript-cop` — with a `reviser` reconciling each round
(disposing findings Fixed / Rejected / Escalated) until the round converged to zero open findings.

Most phases closed in 2–3 rounds. Two ran long: **Phase 2** (spec pipeline) took four reviser rounds
as codegen-correctness and script type-safety findings compounded, and **Phase 8** (old-surface
removal and client finalize) took six rounds and invoked the `mediator` three times to route five
findings to human ruling. The mediator appeared only in Phase 8; all its escalations were
requirements/research gaps in the plan/design prose, outside the reviser's remit. Test count grew
from the original ~37 to 547 by Phase 10.

## Key findings

**Verification gates had to be built before the code they guard (Phase 1).** The toolchain swap
silently dropped type-checking of test files — under Vitest+esbuild, the plan's compile-time type
assertions (its R5 safety gate) would have compiled away and passed unconditionally. The reviser
added a dedicated `tsconfig.test.json` (and a `tsconfig.tools.json` for the root config files) wired
into a composite `typecheck` script, plus coverage-exclusion of test files. This established the
enforcement seams every later phase relied on.

**The spec-patch pipeline was where the whole project's correctness concentrated (Phase 2).** Several
findings hardened it: the alert-context rewrite orphaned component schemas, so an anchored,
fail-loud transitive-reachability prune was added; 40 operations had no success-response schema, so
a `patchMissingSuccessResponses` step synthesizes a `200` (or fails loud on an undocumented
no-schema op, with a documented void-write allowlist); the reproducibility guard was strengthened to
catch untracked/deleted files, which exposed that `npm run generate` never deleted stale output —
root-fixed with `output.clean: true` on both Orval targets. The enum-widening codemod gained a
post-condition that proves it engaged on both its inclusion and exclusion sides. `checkJs: true` was
turned on for the `.mjs` scripts, surfacing 50 implicit-`any`/null-safety gaps that were all closed,
and the duplicated schema-traversal logic was consolidated into one shared `schema-walk.mjs` walker.

**Logging masking had to be total and correctly bounded (Phase 3).** The UDF masker was made total
(never throws on a non-serializable value), its recursive scrubber was fixed to stop rebuilding
non-plain objects (`Date`/`Error`/`Map`/class instances now pass through intact) and to short-circuit
circular references, and `this`-binding was preserved for prototype-method loggers. The guarantee's
real bounds — only `meta`, only plain-object/array structure, so a raw wire body nested in a
`DattoApiError` is *not* auto-masked — were documented honestly rather than overclaimed.

**Lenient validation needed both correct accounting and a sound type (Phase 4).** Diagnostic `total`
counts were rebuilt to sum examined items per structural array key (correct even for widenings two
arrays deep) instead of a misleading `Math.max`. The `Lenient<T>` type carried a latent unsoundness:
because response enums are widened to `EnumUnion | (string & {})` and `(string & {}) extends object`
is structurally true, the mapped type was mapping over `String.prototype` for every enum field — fixed
by ordering a primitive branch before the object branch. Unknown Zod node kinds now throw instead of
silently passing, and a build-breaking `schema-union-freedom` test now enforces the union-freedom
invariant `toLenientField` depends on.

**Transport must never leak secrets, and must survive concurrency and hostile inputs (Phase 5).**
`DattoApiError` now carries a `sanitizeAxiosErrorCause` result (never `config.data`/`auth`/`headers`),
so neither the bearer token nor `apiKey`/`apiSecret` reach `error.cause`; a malformed token grant is
zod-validated and its raw body is withheld from `error.response`. Concurrent `getToken()` calls
coalesce into one grant; request timeouts were added; a 401 triggers an `onUnauthorized` hook with a
single retry; the rate limiter uses `Object.hasOwn` to defeat prototype-key hazards and a
`never`-typed exhaustiveness switch on descriptor kind.

**BaseResource made leniency honest and pagination safe (Phase 6).** The `http*` primitives return
`Lenient<T>` at the boundary rather than silently re-narrowing; pagination validates that
`nextPageUrl` shares the configured origin (SSRF guard) and enforces cycle-detection plus a
10,000-page ceiling; a sixth primitive `httpGetArray` gives bare-array endpoints the same per-item
drop as paginated ones; and **all nine** body-carrying write operations were reconciled with
hand-verified required-field/nullable rules (not just the one the plan named), including the
`warrantyDate` nullable fix.

**Resource surfaces were pinned against generated-schema drift (Phase 7).** Hand-written mirror
schemas were replaced with the generated response schemas where possible, and the rest are guarded by
a compile-time `schema-mirror-pin.ts` asserting key-set (and, where no enum-widening asymmetry
applies, full structural) equality against the generated types. A tenth write op
(`SiteResource.update`, `POST /site/{siteUid}`) that the spec declared but no key existed for was
implemented and given its `site-update` rate-limit key. End-to-end tests were tightened to genuinely
exercise the real rate limiter and auth stack rather than assert behavior by name.

**Finalize surfaced plan/design record defects, not code defects (Phase 8).** The old surface was
deleted cleanly and 57/57 coverage was mechanically proven, but several requirements-record
discrepancies were caught and escalated (see Key decisions). Code-side findings — an audit-method
naming cleanup (dropping redundant `Audit`/`Device` nouns), and making the `coverage-map` set-equality
assertion run unconditionally and fail loud on a missing spec — were fixed directly.

**Fixtures encode every known defect and controls stay in lockstep (Phase 9).** The three independent
"what is a UDF key" definitions (in-log masker, schema-shape override, at-rest sanitizer) are now
tied together by a build-breaking consistency test; the fixture sanitizer refuses to overwrite its
input in place; and `*raw-sweep.json` is git-ignored to keep live captures out of the repo.

**Documentation was made a tested artifact (Phase 10).** The README's namespace→endpoint tables are
now drift-guarded per operation, derived from the same authoritative `OPERATION_MAP` (verb + path,
scoped per namespace); flagship examples were rewritten to model the leniency the docs promise
(no non-null assertions); `retryAfterMs`'s real conditions were documented; the `exports` map gained
its `./package.json` companion entry; and the lockfile was resynced to `1.0.0`.

## Key decisions

- **Reject empirically, not by assertion (Phase 1).** Two architect findings — a predicted `@/` alias
  leak into published `.d.ts`, and a call for coverage thresholds — were *rejected* by the reviser
  with a targeted reproduction (tsup resolved the alias fully; `grep` of the whole plan found no
  Exit Gate referencing coverage thresholds) and conceded by the architect. Precedent (`fuze-api`'s
  threshold-free config) was preferred over inventing project policy.

- **Prefer the mechanism the toolchain actually supports (Phases 2, 4).** Where a literal reviewer
  recommendation didn't compile, the reviser used a verified alternate that achieves the same
  guarantee and documented the deviation: `satisfies`-based excess-property checking instead of an
  explicit closed-type return annotation (a named interface can't declare the required index
  signature), and JSDoc `readonly` typing instead of `as const` in `.mjs` files.

- **Fix at the root when a test exposes a deeper defect (Phase 2, 4).** Writing the reproducibility
  guard revealed that generation never deleted stale output → `output.clean: true`. Writing the
  `Lenient<T>` regression pin revealed the type was actively unsound over widened enums → the branch
  reordering. In both cases the reviser fixed the underlying defect rather than encoding the buggy
  behavior into the new guard.

- **Escalate plan/design-record defects rather than edit artifacts the reviser doesn't own
  (Phase 8).** Five findings were routed through the mediator to human ruling, all classified
  Requirements/Research gaps: (1) two Phase-8 exit-gate greps (`Result<`, `validationMode`) were
  unsatisfiable against correct code because they matched a third-party `z.ZodSafeParseResult` type
  and a doc comment — the human reworded the gates to value/word-scoped exclusions; (2) stale
  `filter-create`/`filter-delete` plan prose after those dead keys were removed from code; (3) design
  prose describing `src/index.ts` as exporting "the generated types" when it ships a curated,
  by-name `public-types.ts`; and (4) the **"53 paths / 75 operations"** figure repeated throughout
  design and plan. Ruling on (4): the committed spec genuinely has **57** operations and the client
  covers 57/57; the human confirmed the spec and corrected every "75" to "57."

- **`invalidateToken` was an unintentional capability gap (Phase 8).** The retired flat client
  exposed a fourth public method, `invalidateToken`, that the plan's "three methods" prose and the
  design's Breaking Changes list both omitted. On the human ruling, this was recorded as an
  *unintentional* gap (not a deliberate design choice): proactive invalidation is now reachable only
  via the internal `AuthManager.invalidate()` wired to the automatic 401 handler, which serves a
  different case than a consumer rotating `apiSecret` mid-process. It was flagged for Phase 10's R18
  migration guide to document as a dropped capability with no public replacement.

- **Hold scope discipline against tempting-but-out-of-scope expansions (Phase 9).** Two auditor
  findings were *rejected*: broadening the synthesized fixture corpus to entities with no known
  defect pattern (the plan's Deferred Validation, not a Phase 9 deliverable) and widening the `lint`
  glob to `tests/**`/`scripts/**` repo-wide (a pre-existing, cross-cutting convention change that
  would surface unrelated debt in 37 files).

## Known limitations

- **Committed-spec completeness rests on a human confirmation, not an automated check.** The "75"
  figure was corrected to 57 after the human confirmed the committed spec is the complete v2 surface.
  A live re-fetch against `*.centrastage.net` to re-verify completeness remains a plan **Deferred
  Validation** item; it cannot run unattended in CI. The code's guarantee ("every operation in the
  *committed* spec is reachable") is mechanically proven regardless.

- **`invalidateToken` has no public replacement.** Its removal is a documented, intentional-to-ship
  breaking change but an unintentional capability gap; consumers needing proactive token
  invalidation after mid-process credential rotation have no public API for it. Documented in the
  design's Breaking Changes and the README upgrade guide.

- **Real-sweep validation is deferred.** Phase 9 validates the reconciled schemas against
  *synthesized* fixtures that deliberately encode every observed defect pattern (nullability,
  `udf1…udf300`, `rmmnetworkdevice`, `@class` alert contexts, epoch-ms timestamps). Validating
  against a fresh live capture requires a real account and is a Deferred Validation item; four
  spec-derived-only operations (`audit.getPrinter`, `audit.getEsxiHost`, `sites.updateProxy`,
  `sites.deleteProxy`) are flagged "unverified shape" in the README because the sampled account
  lacked the relevant devices/config.

- **Masking is scoped to UDF values only.** By deliberate design (Non-Goal), other potentially
  sensitive fields (masked site/account `variables`, free-text `Site.notes`) are not masked by the
  client; a consumer that logs them is responsible for redaction. The masking guarantee is exactly
  "no UDF value in cleartext," not an open-ended secret scrubber.
