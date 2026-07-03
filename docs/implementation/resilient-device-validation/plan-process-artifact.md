# Resilient Device Validation — Plan Process Artifact

_This cycle turned the approved design (#13) into a two-phase, mechanically-gated implementation plan for making `getAccountDevices()` resilient to per-device schema drift, hardening it across three review passes until it was buildable exactly as written._

## Genesis

The design this plan implements responds to a standing production outage: in `strict` validation mode a **single** device that diverges from `DeviceSchema` fails the **entire** `getAccountDevices()` call, because `getAllPages()` validates each page as one unit and a `ZodError` from any device aborts the whole walk. A downstream daily sync had failed 100% for one account for over two weeks — every HTTP call returned `200`, but one device's shape was stricter than the schema allowed, and it was all-or-nothing. The only workaround, `validationMode: 'warn'`, passed the entire raw payload through unvalidated and routed its diagnostic to `console.warn`, bypassing the consumer's configured logger.

The design's answer: validate **per device**, return every conforming device, and report each divergent one as a structured `warnings[]` entry logged at error level through `config.logger` — treating drift as a signal to reconcile the schema, never silently dropping data and never taking down the account. `Device`/`DeviceSchema` and the public type surface stay unchanged (R4). This plan cycle exists to translate those requirements (R1–R8) into a step-by-step, testable, gated build.

## Outcome

The living plan is [`plan.md`](./plan.md). It sequences the work into two phases, each ending in a single fenced `bash` exit gate the pipeline driver executes:

- **Phase 1 — logger-aware validation seam + per-item helper.** `validate()` gains an optional logger (routing `warn` through `logger.warn`, R6); new un-barrelled helpers `validateItems`/`toProblemError`/`extractIdentity` in `src/validation.ts` partition a page into surviving `valid` items and per-device `warnings`, with shared `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` constants. Phase 1 leaves the repo compiling on the old call sites.
- **Phase 2 — wire resilient validation into the client.** `getAllPages` is rewritten to mode-gate a whole-envelope `safeParse` (hard-failing malformed envelopes per R5) and accumulate `valid`/`warnings` across the pagination walk; `getDeviceByUid` hard-fails and logs on divergence (R7). The internal `DevicesEnvelopeSchema` lives in a new un-barrelled `src/internal/devicesEnvelope.ts` so it never enters the public surface.

Both exit gates mechanically enforce the R4 type-surface invariant (a `git diff … HEAD` protected-file guard plus a new-`export` guard on the barrelled modules) and a README doc-landing check. The plan converged after both structural reviewers reported no new findings.

## Process at a glance

The cycle ran in two review passes, each a reviewer↔reviser loop with the plan edited in place (no revision markers):

1. **Requirement-traceability pass** — a **plan-auditor** verified R1–R8 coverage and exit-gate mechanics against the live repo over three rounds (reviser rounds 1–2), converging with all findings closed.
2. **Structural pass** — an **architect** (module boundaries, data model, public API surface, phasing, hot paths) and an **engineer** (DRY, logging, error handling, naming, magic values) reviewed in parallel over five rounds each (reviser rounds 3–6). Both reported zero new findings in their final two rounds; the reviser also folded a self-review into every disposition.

No finding was escalated for a human ruling. The genesis and checkpoint history are visible in the six `checkpoint(plan)` commits (`plan:p1` rounds 1–2, `plan:p2` rounds 3–6).

## Key findings

**Requirement/mechanics gaps (auditor).** The first draft would not have built or self-verified as written: `getDeviceByUid`'s snippet referenced a `logger` local no step declared (a `Cannot find name 'logger'` compile break, fixed by resolving `this.config.logger ?? defaultLogger`), and the R4 protected-file guard sat in unexecuted prose *outside* the fenced exit-gate block, so the plan's hardest constraint — public type-surface stability — was never mechanically enforced. Both were pulled into the fenced block; the guard was later hardened to `git diff --name-only HEAD` so staged/committed edits can't pass it vacuously. The auditor also tightened under-specified tests (an off-mode passthrough case that would crash on a non-array `devices`, and a missing cross-page `warnings[]` accumulation test).

**The generic seam carried device-specific copy (architect + engineer, same issue).** `validateItems`/`toProblemError` were billed as reusable for any future paginated endpoint yet hard-coded `"Device failed schema validation"` and probed `id`/`uid`. Resolved by injecting an `entityLabel` parameter so the seam carries no domain strings.

**Error-shape inconsistency (architect + engineer).** The envelope and `getDeviceByUid` paths dumped the full multi-line `ZodError.message` into `ProblemError.title`, while the new `toProblemError` established the right convention (short stable title, structured `detail`, `ZodError` in `raw`). Unified across all three `validation-error` sites; a later engineer round (r4-f2) finished the job by making the envelope's `detail` concise and path-named too, leaving the serialized error only in `raw`.

**Observability regressions (engineer).** Per-device logs dumped the bare `ZodError` instead of naming which device/field drifted; the envelope hard-fail emitted no log at all (a `warn`-mode regression versus the old `console.warn`); and `validate()`'s `warn` seam still dumped the raw blob. Each was made single-line and path-named so every log in the feature reads consistently — the design's routable-signal thesis (Decision 3, R3).

**The envelope schema could not be both internal and testable (architect r2-f1, High).** The design mandated a test asserting the envelope accepts existing page fixtures, but the schema had to stay a non-`export` in `client.ts` — and `index.ts` does `export * from "./client.js"`, so any export there becomes public (R4 violation), while an inline copy would defeat the test. Resolved by relocating `DevicesEnvelopeSchema` into a dedicated un-barrelled `src/internal/devicesEnvelope.ts`, imported by both the client and the test. This also exposed that the R4 grep watched only `schemas/result/index.ts` and was blind to a new `export` in the barrelled `client.ts`/`config.ts`; a second exit-gate guard was added to catch that leak path.

**Off-mode null-safety, chased across two dereference sites (architect + engineer, rounds 1–3).** `off` skips the envelope check, so a non-array or `null` page body could throw a `TypeError` that escaped the "never throw, always `Result`" contract. The first fix guarded the extractor (`(p) => p?.devices ?? []`); a later round found the *sibling* `nextUrl = page.pageDetails?.nextPageUrl` read still threw on a `null` body (the `?.` sat after `pageDetails`, not `page`). Fixed to `page?.pageDetails?.nextPageUrl`, with the test strengthened to exercise the `null` case specifically (a string body auto-boxes and would pass even the buggy form).

**A field-initializer that couldn't compile (architect r3-f2).** Prose instructed `private logger: LoggerLike = config.logger ?? defaultLogger` as a field initializer, which can't reference the constructor parameter-property `config` (TS2663). Reconciled to an uninitialized field assigned in the constructor body, matching the authoritative snippet.

**A design success criterion left untested (engineer r4-f1).** The plan tested single-page envelope hard-fail and multi-page all-success accumulation, but not the design-named *discard* path — an earlier page succeeds, a later page's envelope is malformed, and the accumulated `valid`/`warnings` are thrown away. That mid-walk `return { ok: false }` behavior shipped unverified until a dedicated test was added.

## Key decisions

- **Parameterize, don't scope-down (architect-r1-f1 / engineer-r1-f4).** Faced with a generic helper carrying device copy, the reviser took the option that *preserves* the design's stated reuse (inject `entityLabel`) rather than declaring the helpers device-scoped. The mapping stays generic and a future endpoint won't mislabel non-devices.

- **Move the schema to a new internal module rather than weaken the test or the guard (architect-r2-f1).** The clean fix kept both R4 (schema off the public barrel) and the design-mandated direct `safeParse` test against the *real* schema — chosen over reconstructing a copy in the test (which would assert against the wrong thing) or dropping the test.

- **Accept the both-optional envelope gap deliberately (engineer-r3-f3).** A 200 JSON object lacking *both* `pageDetails` and `devices` (`{}`, an auth-error body) parses as an empty page — arguably the "mask real breakage as empty-but-ok" outcome the design rhetorically rejects. The reviser chose to keep `devices` optional (matching the unchanged `DevicesPageSchema` and not regressing legitimate zero-device accounts) and instead **document the hard-fail's scope explicitly**, pin the behavior with a test (`{}` / `{ error: "unauthorized" }` → `{ ok: true, value: [] }`, no log), and record an evidence-driven tightening follow-up. Rationale: auth failures normally surface as non-2xx and are short-circuited upstream, so a 200 non-devices-page object is rare.

- **`extractIdentity` stays id-first (engineer-r3-f4).** Every valid `Device` carries a numeric `id`, so `detail` reads `Device id=…` rather than `uid=…`. Rather than reorder for the uid-addressed `getDeviceByUid`, the reviser kept id-first (the account-devices path benefits from the always-present `id`), corrected the prose, and aligned test assertions to `id=` — R2 permits either identity.

- **`warnings[]` is always present, even when empty (engineer-r3-f5).** Chosen over omitting the key when empty: a stable, simpler shape, at the cost of consumers needing to check `result.warnings.length` (an empty array is truthy). Documented in the plan, the README release note, and a shape-guard test.

## Known limitations

- **Envelope hard-fail does not catch a 200 body lacking both `pageDetails` and `devices`.** Consciously accepted (see Key decisions); a body with neither key is treated as an empty page, not a protocol error. An evidence-driven envelope-tightening follow-up is recorded under the plan's Deferred Validation section for if/when such bodies are observed in practice.

- **`getAllPages`'s six positional parameters were left as-is (engineer-r1-f6, Rejected).** An options-object refactor was deferred: there is exactly one caller today, and the reviewer had scoped the refactor as optional ("raise only if a second list endpoint adopts the pattern"). Introducing indirection now buys nothing; it is deferred until a second paginated endpoint actually adopts the pattern, consistent with the design framing reuse as a Future Consideration.

- **Cross-function diagnostic factoring was declined (engineer-r1-f5, Accepted partial).** The intra-`validateItems` duplication was removed, but sharing a formatter between the single-value `validate()` and the per-item `validateItems` was declined as over-abstraction — the single-value seam has no per-item identity and serves a different message shape; the reviewer flagged this Low and warned against over-abstraction.
