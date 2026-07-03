# Resilient Device Validation — Design Process Artifact

_This cycle produced a design that scopes device-schema validation to the individual device, so one divergent device can no longer fail an entire account's `getAccountDevices()` call, while surfacing the drift through the consumer's configured logger._

## Genesis

In `strict` validation mode the Datto RMM client validated each page of devices as a single
unit: `getAllPages()` ran `DevicesPageSchema` over a whole page, so one device whose shape
diverged from `DeviceSchema` threw a `ZodError` that aborted the walk and failed the entire
call with `{ ok: false }`. There was no way to retrieve the account's other, valid devices.

This was a standing production outage, not a hypothetical. A downstream daily sync had failed
100% for one account for over two weeks: authentication and every HTTP call returned `200`, but
the account's inventory contained a device stricter than `DeviceSchema` allowed (e.g. a printer
or ESXi host missing patch/AV data, or a value outside the closed `deviceClass`/`patchStatus`/
`antivirusStatus` enums). The only workaround, `validationMode: 'warn'`, flowed the entire raw
payload through unvalidated and routed its diagnostic to `console.warn`, bypassing any configured
logger — so the drift was invisible to the consumer's logging pipeline.

The work (tracking issue #13) set out to make `getAccountDevices()` resilient to per-device
drift: return every conforming device, exclude and report every non-conforming one as a
structured warning at error level, and treat divergence as a signal that the package's schema
must be reconciled with upstream — without relaxing `DeviceSchema`, changing the public `Device`
type, or adding a new validation mode.

## Outcome

The design (see `design.md`) splits validation into two distinct seams:

- **Envelope validation** — a protocol check. `getAllPages` runs the page envelope through a
  direct `safeParse` hard-fail (a malformed response object, non-array `devices`, or unparseable
  `pageDetails`) returning `{ ok: false, error: { type: "validation-error" } }`. This is
  mode-gated: it runs in `strict`/`warn`, is skipped in `off`, and is deliberately *not* routed
  through the mode-branching `validate()` seam.
- **Per-item validation** — drift handling, mode-scoped. A per-item helper validates each device
  against `DeviceSchema`: in `strict` it drops divergent devices, logs each at error level, and
  collects them into `Result.warnings[]`; in `warn` it returns every item raw and unparsed,
  running the schema only to detect and log divergence; in `off` it casts through.

`Result.warnings[]` (already present on the `ok: true` branch) carries rejected devices, so no
public type changes. `config.logger` is threaded into the validation layer via an optional
trailing parameter on `validate()` defaulting to `defaultLogger`, closing the observability gap
without widening the public surface. `getAllPages`'s signature changes to take an envelope
schema, a per-item schema, and a raw-item extractor `(page) => unknown[]`; the change is
contained to its single caller.

## Process at a glance

Two review phases across five revision rounds. Phase 1 was led by the **design-auditor**
(completeness/consistency against the actual `src/` package, three rounds); phase 2 added the
**architect** (boundaries, coupling, abstraction, over-length — four rounds) and the
**engineer** (resilience interaction, return-payload shape, developer experience — four rounds).
The reviser dispositioned findings across five rounds. The core seam — envelope-vs-per-item
split with `warnings[]` reuse and a threaded logger — was affirmed as sound by all three
reviewers from the first pass; every finding was a tightening of an under-specified seam or a
consolidation of revision-driven duplication, not an objection to the approach. All findings
reached `Closed`; the design converged with no Open findings.

## Key findings

**Under-specified plumbing at the changed seams (design-auditor, phase 1).** The initial design's
"nothing else changes" framing overstated what stayed the same at three seams:
- The generic `getAllPages` extractor previously received a *parsed* page and returned typed
  items; the per-item model needs the *raw* `unknown[]` validated individually. The design both
  left the new signature unspecified and wrongly listed "the extractor pattern" as unchanged.
  Resolved by specifying the new signature (envelope schema + per-item schema + `(page) =>
  unknown[]` extractor) and per-page aggregation of `valid`/`warnings`.
- The `warn`-mode contract: because `z.object` strips unknown keys on parse, parsing "valid"
  devices in `warn` would silently change returned data versus today's raw passthrough. Resolved
  by having `warn` return every item raw and unparsed, running the schema only to detect
  divergence for logging.
- Whether envelope validation runs in `off`. Resolved by making it mode-gated (skipped in `off`,
  which reads `pageDetails?.nextPageUrl` best-effort), preserving `off`'s no-validation contract.

**The warn-mode envelope hard-fail (design-auditor, phase 1, rounds 2–3).** Scoping the envelope
hard-fail to `strict`/`warn` exposed that the `validate()` seam does *not* throw in `warn` — it
logs and passes through. Routing the envelope check through `validate()` would therefore open a
silent warn-mode hole in the guarantee that malformed envelopes hard-fail. Resolved by
specifying the envelope check as a direct `safeParse` hard-fail, identical in `strict` and
`warn`, explicitly not the mode-branching `validate()` seam. The consequent behavioral change —
`warn` now hard-fails on a malformed envelope where it previously returned `{ ok: true, value:
[] }` — was documented in R8 and Breaking Changes.

**Multi-page discard semantics (engineer, phase 2).** The design never said what happens to valid
devices already collected from earlier pages when a *later* page's envelope hard-fails — a point
in visible tension with the resilience goal (R1). Resolved by stating explicitly that a mid-walk
envelope hard-fail discards all accumulated `valid`/`warnings` and returns `{ ok: false }`
(consistent with today's abort, since pagination cannot continue past an unreadable
`nextPageUrl`), pinned by a success criterion and a new-test row.

**`validate()` arity vs. the "unchanged test" claim (engineer, phase 2).** The design showed
`logger` as a required positional parameter while asserting the existing three-argument
`deviceSchema.test.ts` fixture "still validates unchanged" — a contradiction that would break the
build/verification gate. Resolved by specifying `logger` as an optional trailing parameter
defaulting to `defaultLogger`, keeping the existing call compiling and adding that R6's
warn-routing guarantee relies on the live client passing `config.logger ?? defaultLogger`.

**Revision-driven duplication (architect r1 / engineer r1, phase 2).** By the end of phase 1 the
envelope hard-fail mechanism and the `warn` behavioral change had each been restated in ~5–6
places as successive rounds appended copies, creating a multi-source-of-truth maintenance
hazard. Resolved by making Decision 2 the single normative statement of the mechanism, with
R5/R8/Breaking Changes/Success reduced to terse references to the observable outcome.

Smaller closed items included specifying the strict single-value `logger.error` as
`getDeviceByUid`'s own catch responsibility (not `validate()`, which never logs in `strict`);
noting that `warn` diagnostics change *granularity* (one per-page line → one per divergent
device) as a release-noted change; making the two `pageDetails.nextPageUrl` sourcing paths
(envelope-parse result in `strict`/`warn`, raw page in `off`) explicit; and a final one-word
count fix ("Two" → "Three" behavioral changes) after Breaking Changes grew a third item.

## Key decisions

- **Envelope errors are protocol errors, separate from per-device drift.** The two-seam split
  (`safeParse` hard-fail for the envelope, mode-scoped per-item handling for devices) was ratified
  by all three reviewers as the correct boundary, and drove the resolution of the warn-mode hole.
- **A mid-walk envelope hard-fail discards all accumulated valid devices.** Chosen deliberately as
  consistent with the existing abort behavior and the "envelope = protocol error" reading, rather
  than attempting partial salvage across pages — and pinned by an explicit test case so the choice
  is not left to inference.
- **`warnings[]` is unbounded by design.** Under a Datto-wide schema change that drifts every
  device, the returned array grows one full-`ZodError`-bearing `ProblemError` per device. This
  was consciously accepted as-is — proportionate to, and mirroring, the log signal rather than
  capped or summarized — and stated explicitly in the risk table for the Planner.
- **`logger` is optional and defaulted, not required.** Preserves the existing test and every
  current call site; the trade-off (R6's warn-routing depends on the live caller passing the
  configured logger) is written down and bounded to the one production caller.

## Known limitations

- **Rejected `architect-r1-f2` (the three-site `ValidationMode` coupling):** the architect asked
  for an additive meta-invariant sentence naming the three sites where `ValidationMode` is
  interpreted (`validate()`, the per-item helper, the envelope path) and requiring their meanings
  stay in lockstep. The reviser rejected it: each site is already singly and fully specified where
  it belongs, the split is a justified boundary rather than accidental duplication, and Non-Goal 4
  (no new modes) bounds the surface a maintainer could shift. The finding never made the design
  wrong. The architect accepted the rejection on re-review and it remained closed-as-rejected
  through convergence.
- **`warnings[]` growth under mass drift** is accepted as an explicit, unbounded-by-design
  limitation (see Key decisions) rather than mitigated with a cap or summarization.
- **Earlier-page strict rejections may be logged then discarded:** in a mid-walk envelope
  hard-fail, per-device `logger.error` lines emitted for earlier pages persist even though the
  call ultimately returns `{ ok: false }` and their `warnings[]` are discarded. The engineer
  judged this a correct signal (those devices genuinely drifted) that does not impede planning,
  and did not raise it as a finding.
