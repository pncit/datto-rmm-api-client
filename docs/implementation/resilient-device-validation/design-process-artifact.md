# Resilient Device Validation — Design Process Artifact

_This cycle produced a design that makes `getAccountDevices()` resilient to per-device schema drift — returning conforming devices and reporting divergent ones instead of failing the whole account — and hardened the specification of that behavior across five revision rounds until three independent reviewer lenses reported convergence._

## Genesis

The work traces to issue #13 and a concrete, standing outage. In `strict` validation mode a
**single** device that diverges from `DeviceSchema` fails the **entire** `getAccountDevices()`
call: `getAllPages()` validates each page as one unit, so one non-conforming device throws a
`ZodError` that aborts the walk and returns `{ ok: false }`, discarding every valid device. A
downstream daily sync had failed 100% for one account for over two weeks — authentication and every
HTTP call returned `200`, but the account's inventory contained a device (a printer, ESXi host, or
network device missing patch/AV data, or one carrying an out-of-enum value) whose shape was stricter
than `DeviceSchema` allowed. The only workaround, `validationMode: 'warn'`, flowed the whole raw
payload through unvalidated and routed its diagnostic to `console.warn`, bypassing any configured
logger — so the drift was invisible.

The goal was to scope a divergent device's rejection to *that device* rather than the whole call,
treat divergence as an actionable signal of schema drift (surfaced through the consumer's own logger
at error level and returned as a structured warning), and do so without relaxing `DeviceSchema` or
changing the public `Device` type.

## Outcome

The design (`docs/implementation/resilient-device-validation/design.md`) splits page validation into
two concerns that were previously conflated:

- **Envelope validation** — is this a well-formed devices page? A structural failure is a protocol
  error and hard-fails the call (R5), via a direct `safeParse` gated to `strict`/`warn` (skipped in
  `off`).
- **Per-device validation** — each element of `devices[]` is validated individually against
  `DeviceSchema` by a new per-item helper that partitions results by mode: `strict` drops divergent
  devices into `Result.warnings[]` (logged at `error`), `warn` keeps every item raw (logged at
  `warn`), `off` passes through untouched.

`validate()` gains an optional trailing `logger` parameter so diagnostics route through
`config.logger`. `getAllPages` takes an envelope schema plus a per-item schema and a raw-item
extractor (`(page) => unknown[]`). The public `Device` type, `DeviceSchema`, `DevicesPageSchema`,
and the `Result`/`ProblemError` types are all unchanged. Three behavioral changes are release-noted
(strict now returns `{ ok: true }` with warnings on drifted accounts; `warn` now hard-fails a
malformed envelope; `warn` diagnostics change sink and granularity). The design closed with no open
questions.

## Process at a glance

Five revision rounds, three concurrent reviewer threads, each entering on a distinct axis and
declining to re-litigate the others' closed items:

- **design-auditor** — completeness, consistency, current-state accuracy (r1–r4).
- **architect** — boundaries, coupling, abstraction fit, over-length (r1–r4).
- **engineer** — plumbing feasibility, error/observability strategy, success-criteria concreteness
  (r1–r4).

The reviser dispositioned findings in rounds r1–r5. All three threads reported convergence by their
round 4 with no open findings; the final reviser turn (r5) closed a one-word count slip. Of the
substantive findings, every one was `Fixed` except a single `Rejected` (accepted by the raising
reviewer). The core seam — envelope-vs-per-item split, `Result.warnings[]` reuse, logger threading —
was affirmed as sound from the first round and never redirected; the entire run was tightening
under-specified seams, not reworking the approach.

## Key findings

**The generic `getAllPages` plumbing was under-specified and self-contradictory.** The design
reused a generic `getAllPages<T,P>` whose existing extractor received an already-*parsed* page and
returned typed items, yet the new per-item model needed the *raw* `unknown[]`. "What Stays the Same"
still listed the extractor pattern as unchanged. The fix specified the new signature (envelope
schema + per-item schema + `(page) => unknown[]` extractor), the cross-page aggregation of
`valid`/`warnings`, and corrected the return-type change (`T[]` → `unknown[]`) as an explicit
not-preserved behavior. (design-auditor)

**`warn` mode's returned-data contract would have silently changed.** Zod `z.object` strips unknown
keys on parse; today `warn` returns the whole raw page, so extra fields survive. Parsing valid
devices in the new helper would drop those fields — a real data change masquerading as "only log
routing changes" (R8). Resolved deliberately: in `warn` the helper returns every item **raw and
unparsed**, running `DeviceSchema` only to *detect* divergence for logging, preserving the
passthrough contract exactly. (design-auditor)

**The envelope hard-fail could not be routed through the mode-branching `validate()` seam.** R5
requires a malformed envelope to hard-fail in both `strict` and `warn`, but `validate()` in `warn`
logs-and-passes-through — so wiring the envelope check through it would open a silent warn-mode R5
hole. The design was tightened to state the envelope check is a **direct `safeParse` hard-fail**,
explicitly *not* the mode-branching seam, returning `{ ok: false }` identically in `strict`/`warn`
and skipped only in `off`. This also required scoping R5 to `strict`/`warn` and documenting that
`off` runs no envelope check (preserving its raw-passthrough contract). (design-auditor)

**Mid-walk envelope hard-fail behavior for already-accumulated devices was unspecified.** If pages 1
and 2 yield valid devices and page 3 returns a malformed envelope, what happens to the earlier
devices sat in visible tension with the resilience goal (R1). Resolved by stating explicitly that a
mid-walk envelope hard-fail discards all accumulated `valid`/`warnings` and returns `{ ok: false }`
— consistent with today's abort, since pagination cannot continue past an unreadable `nextPageUrl` —
and pinning the case with a Success criterion and a new-test row. (engineer)

**`validate()`'s new `logger` arity collided with the "test still validates unchanged" claim.** The
R4 guard rests on `deviceSchema.test.ts` calling `validate(DeviceSchema, device, "strict")` with
three arguments; a required fourth `logger` parameter would break that call and the very Verification
gate the design relies on. Resolved by making `logger` an **optional trailing parameter defaulting
to `defaultLogger`**, keeping the three-arg call compiling — with the explicit note that R6's
warn-routing guarantee therefore rides on the live client caller passing
`config.logger ?? defaultLogger`, which it does. (engineer)

**Observability edges: unbounded `warnings[]` and changed `warn` granularity.** Mass drift (a
Datto-wide schema change) inflates not just the logs but the returned `warnings[]` — one
full-`ZodError`-bearing `ProblemError` per device. Accepted as-is and documented as unbounded by
design, mirroring the log signal rather than capping. Separately, `warn`'s diagnostics change
granularity from one page-level line to one line per divergent device; this was added to Breaking
Changes as a deliberate, release-noted outcome alongside the sink change. (engineer)

**Revision-driven duplication and doc-accuracy slips.** Iterative revision left the envelope
hard-fail mechanism restated in ~6 places; it was consolidated so **Decision 2** is the single
normative source and other sites reference the observable outcome tersely. A later edit that added a
third Breaking Change left the lead-in reading "Two"; corrected to "Three." (architect)

## Key decisions

- **Validate per device, not per page**, with rejections carried in the existing
  `Result.warnings[]` — the smallest change that scopes rejection to the offending device and needs
  no `Result` type change. Alternatives (relaxing `DeviceSchema`, enum sentinel fallbacks,
  fail-hard-plus-relaxation) were rejected in the design as hiding drift or silently rewriting data.
- **Envelope errors are protocol errors, separate from device drift** — hard-fail via direct
  `safeParse`, mode-gated to `strict`/`warn`. This deliberately does not reuse the `validate()` seam,
  precisely because `validate()`'s `warn` branch would let a malformed page slip past.
- **`warn` returns items raw/unparsed**, preserving the documented drift-workaround's exact
  passthrough contract rather than gaining Zod key-stripping.
- **Logging ownership is split by contract**: the per-item helper owns its own `logger.error` calls
  because it partitions and continues; `getDeviceByUid`'s own `catch` owns the strict single-value
  `logger.error`; `validate()` deliberately never logs in `strict` (it throws, and the caller decides
  fatality). This prevents double-logging and keeps the single-value seam a pure throw.
- **`logger` is optional-with-default** on `validate()`, trading a seam-level guarantee for a
  caller-level one (the client passes `config.logger ?? defaultLogger`) in order to keep the existing
  test and public arity stable.
- **Rejected — a meta-invariant sentence naming the three `ValidationMode` interpretation sites**
  (`validate()`, the per-item helper, the envelope path). The architect proposed anchoring these as
  "the only" sites to make an implicit coupling explicit; the reviser rejected it as additive
  documentation the design is decisive and plannable without — each site is already singly and fully
  specified where it belongs, and Non-Goal 4 (no new modes) bounds the surface a maintainer could
  shift. The architect accepted the rejection and did not re-assert it in subsequent rounds.

## Known limitations

- **`warnings[]` is unbounded by design.** Under mass drift it grows one full-`ZodError`-bearing
  entry per divergent device, mirroring the log signal with no cap or summarization. Accepted
  explicitly; a flood is treated as the correct alarm that the schema needs updating.
- **Mid-walk envelope hard-fail discards earlier valid devices.** A later page's malformed envelope
  aborts the walk and drops all accumulated valid devices and warnings — accepted as consistent with
  today's abort, since pagination cannot proceed past an unreadable `nextPageUrl`. (The engineer
  noted, without raising it as a finding, that earlier pages' strict rejections will already have
  emitted `logger.error` even though the call ultimately returns `{ ok: false }` — judged a correct
  signal, since those devices genuinely drifted.)
- **Three release-noted behavioral changes**, none to the public type surface: strict now returns
  `{ ok: true }` with warnings on drifted accounts (consumers branching on `!result.ok` to detect
  drift must inspect `result.warnings`); `warn` now hard-fails a structurally malformed envelope where
  it previously returned `{ ok: true, value: [] }`; and `warn` diagnostics change both sink
  (`config.logger`) and granularity (one line per divergent device).
- **Deferred out of scope** (per the design): relaxing `DeviceSchema` to match observed
  non-workstation devices — reserved as an evidence-driven follow-up informed by this design's logs —
  and a dedicated rejected-devices channel distinct from `warnings[]`.
