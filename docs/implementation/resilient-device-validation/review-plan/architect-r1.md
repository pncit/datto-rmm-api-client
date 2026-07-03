## architect — round 1

Plan Review Mode, round 1. Reviewed `plan.md` against `design.md` and the live
`datto-rmm-api-client` repo (`src/client.ts`, `src/validation.ts`, `src/result.ts`, `src/schemas.ts`).
The prior turns in this dir are `plan-auditor`/`reviser` (requirement-traceability and
compile/exit-gate mechanics) — all their findings are already `Closed`. I do not re-raise those;
my axes are the structural ones: module boundaries & dependency direction, data model/schema,
public API surface, phase sequencing, and hot paths. The plan is well-grounded and buildable; the
findings below are boundary/coupling and internal-consistency issues, not showstoppers.

Axis notes:
- **Boundaries/dependency direction:** `validation.ts` gains a new dependency on `result.ts`
  (`ProblemError`) and takes on ZodError→ProblemError mapping + device-identity extraction — see f1.
- **Data model/schema:** envelope error's `ProblemError` shape is internally inconsistent with the
  per-device one (f2); the design-mandated envelope/fixture drift test is not encoded (f3).
- **Public API surface:** `getAllPages` is `private`, `validateItems` is exported from a
  non-barrelled module (`validation.ts` is not in `index.ts`), `validate()` gains an optional
  trailing param — all non-breaking. No public-surface finding.
- **Phase sequencing:** Phase 1 leaves the repo in a working intermediate state (old 3-arg
  `validate` calls in `client.ts` keep compiling; `validateItems` exported-but-unused is not a tsc
  error). Sequencing is sound. No finding.
- **Hot paths:** per-device `safeParse` is O(n) equivalent to today's whole-page parse; per-page
  spread is bounded by page size. `warnings[]`/`raw: ZodError` unboundedness is design-ruled. No
  finding. One off-mode boundary error-handling gap (f4).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | Boundaries | Phase 1 Steps 2–3; `validateItems`/`toProblemError`/`extractIdentity` in `src/validation.ts` | The generic `validateItems<T>` seam hardcodes **device-domain** semantics: `toProblemError` sets `title: "Device failed schema validation"` and `detail: \`Device ${identity} failed…\``, and `extractIdentity` probes `id`/`uid`. The design explicitly earmarks this helper for reuse ("the per-item validation helper and envelope/item split generalize to any future paginated collection endpoint" — design Future Considerations), so a second, non-device collection endpoint would emit "Device failed schema validation" for non-devices. It also relocates ZodError→`ProblemError` mapping (a transport/boundary concern) and its new `result.ts` dependency into the generic validation module rather than the client boundary. | Resolve the contradiction one of two ways: (a) keep `validateItems<T>` generic and **inject** the item-description/title — e.g. pass a `toProblemError`/`describeItem` mapper (or `{ title, identify }`) from the client so the seam carries no device strings and the ZodError→`ProblemError` mapping lives at the caller; or (b) drop the reuse framing and have the plan state explicitly that `validateItems`/`toProblemError` are device-scoped for now (generalization deferred), so the coupling is a conscious choice rather than an accidental block to the design's stated reuse. |
| architect-r1-f2 | Medium | Open | DataModel | Phase 2 Step 2 snippet, `getAllPages` envelope-failure return (`title: parsed.error.message`) | The new envelope-error `ProblemError` dumps the full multi-line `ZodError.message` into `title`, while the same feature's `toProblemError` establishes the correct convention — a short stable `title` ("Device failed schema validation"), specifics in `detail`, the `ZodError` in `raw`. `ProblemError.title` is a required short human label; a `ZodError` blob there is a poor consumer-facing title and is internally inconsistent with the per-device path introduced alongside it. | Give the envelope failure a stable title (e.g. `"Malformed devices page envelope"`) with `parsed.error.message` in `detail` and the `ZodError` in `raw`, mirroring `toProblemError`'s structure. (Note `getDeviceByUid`'s `title: e.message` is preexisting and out of scope; at minimum the **new** envelope path should adopt the clean convention rather than propagate the old one.) |
| architect-r1-f3 | Low | Open | DataModel | Phase 2 Tests list; envelope schema in Step 1 | `DevicesEnvelopeSchema` (client.ts) structurally duplicates `DevicesPageSchema`'s `pageDetails` wrapper. The design names an explicit mitigation for this drift risk — "a test asserts the envelope accepts the existing page fixtures" (design Risks & Mitigations, row 3) — but the plan's test list does not encode it; it is only *incidentally* exercised by the existing "returns validated data"/"paginates automatically" cases. | Add the design-mandated test to Phase 2: assert `DevicesEnvelopeSchema.safeParse(...)` succeeds on every existing page fixture (`devicesPage.json`, `devicesPage1.json`, `devicesPage2.json`), so the envelope-vs-`DevicesPageSchema` consistency the design flagged is guarded directly rather than by side effect. |
| architect-r1-f4 | Low | Open | Boundaries | Phase 2 Step 2 snippet, `off` branch (`page = res.value as P`) + `validateItems`/extractor spread | In `off` mode `getAllPages` runs `items.push(...extractor(page))` (via `validateItems` `off` → `items as T[]`, then the caller spread) on an unvalidated `res.value as P` with `extractor = (p) => p.devices ?? []`. If `devices` is a non-array object, the spread throws a raw `TypeError` that escapes `getAccountDevices`, violating the client's Result contract (every failure returned as `{ ok: false }`, never thrown) at a public boundary. This is preexisting, but the plan is rewriting `getAllPages` and can preserve the contract cheaply. The auditor scoped this out of R8's *tests*; the boundary error-handling defect itself is unaddressed. | While `getAllPages` is open, guard the off path (e.g. `const raw = extractor(page); if (!Array.isArray(raw)) return []`-equivalent, or `Array.isArray` check before spread) so a non-array `devices` in `off` yields `{ ok: true, value: [] }` / an empty page rather than a thrown `TypeError`, keeping the Result contract mode-independent. |
