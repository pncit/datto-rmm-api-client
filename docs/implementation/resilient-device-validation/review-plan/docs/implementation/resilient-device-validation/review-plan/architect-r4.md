## architect — round 4

Plan Review Mode, in-progress review (round 4). Re-read the current `plan.md` against `design.md`
and the live `datto-rmm-api-client` source (`src/client.ts`, `src/validation.ts`, `src/schemas.ts`,
`src/result.ts`, `src/logger.ts`, `src/index.ts`, `src/__tests__/devicesMethod.test.ts`, and the
`fixtures/*.json` pageDetails/devices shapes). Applied the in-progress-review procedure: first
re-verified my two round-3 findings against the reviser-r5 dispositions and the current plan text,
then hunted for new issues on my axes (module boundaries & dependency direction, data model/schema,
public API surface, phase sequencing, hot paths). Prior `plan-auditor`/`engineer`/`reviser` findings
are all `Closed`; I do not re-adjudicate their axes.

### Re-verification of my round-3 findings (both reviser-r5 `Accept`ed)
- **architect-r3-f1** (off-mode `null` page throws at the `nextPageUrl` read — the sibling deref the
  r2-f3 fix missed) — resolved: the walk-advance is now `nextUrl = page?.pageDetails?.nextPageUrl`
  (`page?.` before `pageDetails`) in Step 3 prose, the snippet (plan L304), and the off-path
  null-safety narrative (L210) which now names **both** deref sites (extractor + `nextPageUrl` read).
  Confirmed against the two deref sites and the `null`-specific test (L348, which correctly notes a
  string-only test would false-pass). In strict/warn `page = parsed.data` is non-null so `page?.` is a
  harmless no-op. **Ratified → Closed.**
- **architect-r3-f2** (field-initializer `private logger = config.logger ?? defaultLogger` fails
  TS2663 because `config` is a parameter property) — resolved: L37, L200/L202 now instruct an
  **uninitialized** `private logger: LoggerLike` field **assigned in the constructor body**
  (`this.logger = config.logger ?? defaultLogger;`), matching the snippet (L246–248). Verified against
  live `src/client.ts:17` (`constructor(private config: DattoRmmClientConfig)`). **Ratified → Closed.**

### Axis notes (round 4)
- **Boundaries / dependency direction:** `client.ts → internal/devicesEnvelope.ts → {zod, schemas.ts}`
  and `validation.ts → {logger.ts, result.ts, zod}` — all inward edges, no cycles (schemas/result/logger
  import nothing back). Confirmed live `index.ts` barrels only `client/config/result/schemas`, so the
  new exports in `validation.ts` and `src/internal/*` stay off the public surface. No new finding.
- **Data model / schema:** verified live fixtures — `pageDetails` carries `count/totalCount/prevPageUrl/
  nextPageUrl` with `nextPageUrl: ""` (empty string, falsy) on terminal pages, so `while (nextUrl)`
  terminates correctly and all three fixtures satisfy `PaginationDataSchema` (required prev/next). The
  envelope's `z.array(z.unknown())` preserves each raw device for per-item validation. Strict returns
  parsed devices exactly as today (old path also read `extractor` off the parsed page). No new finding.
- **Public API surface:** both exit-gate guards cover the leak paths (index.ts edit → guard (a); new
  top-level `export` in client/config → guard (b)); Phase 2 adds no top-level export to `client.ts`
  (`getAllPages` stays `private`; touched methods are class members). No new finding.
- **Phase sequencing:** Phase 1 leaves `client.ts` compiling on the 3-arg `validate` (new `logger`
  optional) and the old `getAllPages`; exported-but-unused `validateItems`/`toProblemError` are not
  tsc errors; the two existing `devicesMethod.test.ts` cases assert via `.length`/property checks (not
  whole-object `toEqual`), so always-present `warnings: []` does not break them. No new finding.
- **Hot paths:** envelope `safeParse` (opaque `z.unknown()` items) + N per-device `safeParse` ≈ today's
  one whole-page parse; per-page spreads bounded by page size. Design-ruled. No new finding.

New findings this round are two design-alignment **verification-coverage** gaps: a design-mandated
multi-page mid-walk-abort scenario that is specified in prose but no longer encoded as a test
(Medium), and an incompletely-tested R5 envelope failure-trigger set (Low). Both are gaps between the
design's stated verification and the plan's test list, not behavior/spec errors — the plan is
otherwise converged and buildable.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r4-f1 | Medium | Open | DataModel | Phase 2 Tests list (plan L338–350); mid-walk-abort behavior specified at plan L209 ("A mid-walk envelope failure discards accumulated items/warnings"); design Success Criterion L184 + Verification L196 | The design **explicitly** requires a test for the multi-page mid-walk abort: "In `strict`, a walk whose first pages yield valid devices but whose later page has a malformed envelope returns `{ ok: false }` … the earlier pages' valid devices and warnings are discarded (R5)" (design L184), re-listed in Verification as "a multi-page walk whose later page's envelope is malformed (hard fail discarding earlier valid devices)" (design L196). The plan **specifies** this behavior in prose (L209) but the current Phase 2 test list does **not** encode it: the closest case, "cross-page warnings accumulation" (L343), is the *happy* two-page path (both envelopes valid, divergent devices), which proves accumulation but never the abort-and-discard control flow. The distinct behavior — a later page's envelope hard-fail returning `{ ok: false }` and **throwing away** items/warnings already accumulated from earlier valid pages — is unverified. Notably `plan-auditor-r2-f2` (round 2) described "a mid-walk abort" as an existing case; it appears to have been dropped when the accumulation case was added, so this is a regression in the plan's coverage relative to both the design and an earlier plan revision. This is the one design Success Criterion (of eight) with no corresponding test. | Add a Phase 2 strict test: page1 `[valid1, divergent1]` with `nextPageUrl` → page2, where page2's body has a **malformed envelope** (e.g. `devices: "nope"`) → `result.ok === false`, `error.type === "validation-error"`, `error.title === "Malformed devices page envelope"`, **no** partial `value` (page1's `valid1` is discarded), and `logger.error` called for the envelope failure. This pins the "mid-walk envelope failure discards accumulated items/warnings" contract (plan L209) and closes design Success Criterion L184 / Verification L196. |
| architect-r4-f2 | Low | Open | DataModel | Phase 2 Step 2 scope prose (plan L206, "a body that is **not a JSON object** … → hard-fail"); Phase 2 Tests (plan L341 only tests `devices: "nope"`); design R5 (design L43) | R5 enumerates **three** envelope failure triggers: (a) response **not an object**, (b) `devices` **not an array**, (c) **unparseable** `pageDetails`/`nextPageUrl`. The plan's envelope-hard-fail tests exercise only (b) (`devices: "nope"`, L341/L345). Trigger (a) — a non-object body (string/HTML error page) → `z.object` rejects → hard-fail — is asserted in Step 2 prose (L206) as the *load-bearing complement* of the documented Step 2 gap (whose "object-lacking-both-keys → empty page" half **is** pinned by the engineer-r3-f3 test at L342), but the "non-object → hard-fail" half is untested. So the two-sided Step 2 contract is only half-verified: a regression that made a non-object body parse as an empty page (e.g. if the schema were loosened) would pass the suite. Trigger (c) is likewise untested. | Add at least a strict/warn test for a **non-object** body (e.g. a string like an HTML error page) → `{ ok: false, error: { type: "validation-error", title: "Malformed devices page envelope" } }` + one `logger.error`, so the non-object half of the Step 2 documented contract is pinned alongside the empty-page half. Optionally add a malformed-`pageDetails` case (e.g. `pageDetails: { nextPageUrl: 123 }`) to cover R5 trigger (c). This makes the "envelope hard-fail is scoped to non-object bodies, present-but-wrong-type `devices`, and unreadable `pageDetails`" claim (L206) fully verified rather than partly asserted. |
