## architect — round 2

Plan Review Mode, round 2. Re-read the current `plan.md` against `design.md` and the live
`datto-rmm-api-client` repo (`src/client.ts`, `src/validation.ts`, `src/result.ts`, `src/schemas.ts`,
`src/index.ts`). Applied the in-progress-review procedure: first re-verified my four round-1 findings,
then hunted for new issues on my axes (module boundaries & dependency direction, data model/schema,
public API surface, phase sequencing, hot paths). Prior `plan-auditor`/`engineer`/`reviser` turns and
their findings are all `Closed`; I do not re-adjudicate their axes (requirement traceability, logging
quality, DRY, exit-gate staging).

### Re-verification of my round-1 findings (all reviser-marked `Fixed`)
- **architect-r1-f1** (device-hardcoded generic seam) — `validateItems<T>`/`toProblemError` now take an
  injected `entityLabel: string` (caller passes `"Device"`); no domain copy is baked into the generic
  seam (plan L56, L61, L94–101, L128–140). Reuse for a future collection endpoint is unblocked.
  **Ratified → Closed.**
- **architect-r1-f2** (`ZodError.message` dumped into envelope `title`) — envelope failure now uses a
  short stable `title: "Malformed devices page envelope"` with `parsed.error.message` in `detail` and
  the `ZodError` in `raw` (plan L195, L257–263), mirroring `toProblemError`. **Ratified → Closed.**
- **architect-r1-f3** (design-mandated envelope/fixture drift test not encoded) — Phase 2 now lists a
  direct `DevicesEnvelopeSchema.safeParse(...)` acceptance test over all three page fixtures (plan
  L310). Ratified as *present* — but the way the plan tells the implementor to reach the non-exported
  schema is itself inconsistent; see **architect-r2-f1** below. **Closed (superseded by r2-f1).**
- **architect-r1-f4** (off-mode non-array `devices` throws) — `validateItems`' `off` branch now guards
  with `Array.isArray(items) ? … : []` (plan L103) and Phase 1/2 tests cover it. The guard closes the
  *non-array-`devices`* case but not the *null/primitive page* case; see **architect-r2-f3**.
  **Closed (residual gap tracked as r2-f3).**

### Axis notes (round 2)
- **Public API surface / boundaries:** `src/index.ts` barrels `export * from "./client.js"` (line 1),
  so **everything exported from `client.ts` is public**. The plan leans on this exact fact to keep the
  envelope schema internal ("non-`export` const in `client.ts`", L36/L192) — correct — but the Phase 2
  test step then asks for a "test-only re-export" of that same const, which is self-contradictory and
  R4-violating (f1). Relatedly, the R4 exit-gate grep watches only `schemas/result/index.ts` and is
  blind to public-surface growth via new `client.ts`/`config.ts` exports (f2).
- **Phase sequencing:** sound — Phase 1 leaves `client.ts` compiling on the old 3-arg `validate`/old
  `getAllPages`; exported-but-unused `validateItems` is not a `tsc` error. No finding.
- **Data model / dependency direction:** `validation.ts → {logger.ts, result.ts, zod}` introduces no
  cycle (both are leaves; `result.ts`/`logger.ts` import nothing back). Envelope `z.object` strips
  unknown top-level keys but the path only reads `pageDetails`/`devices`, and `z.array(z.unknown())`
  preserves each device intact for per-item validation — no data loss on the used path. No finding.
- **Hot paths:** envelope `safeParse` (cheap: `z.unknown()` items) + N per-device `safeParse` ≈ today's
  one whole-page parse; per-page spreads bounded by page size. Design-ruled. No finding.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r2-f1 | High | Open | PublicSurface | Phase 2 Tests, "Envelope schema accepts existing fixtures" (plan L310); vs. L10/L36/L192 non-export mandate; `src/index.ts` L1 `export * from "./client.js"` | The plan requires `DevicesEnvelopeSchema` to be a **non-`export` const in `client.ts`** to keep it off the public surface (L36, L192) — necessary precisely because `index.ts` does `export * from "./client.js"`, so *any* export from `client.ts` becomes public. But the fixture-acceptance test added to satisfy my r1-f3 must *reference* that const, and the plan proposes doing so "via a small test-only re-export **or** by importing the module under test" (L310). Importing it requires exporting it from `client.ts`, which the barrel then re-exports as public API — a direct R4 violation (a new public schema export) and a contradiction of the plan's own non-export instruction. The only barrel-safe alternatives (reconstruct the schema inline in the test) defeat the guard's purpose (it would assert against a *copy*, not the real envelope schema the client uses). So the test as specified is not implementable without either violating R4 or negating the test's value. | Resolve by moving `DevicesEnvelopeSchema` out of `client.ts` into a dedicated module that `index.ts` does **not** barrel (e.g. `src/internal/devicesEnvelope.ts`, sibling to the non-barrelled `validation.ts`), and have both `client.ts` and the test import it from there — mirroring how `validateItems`/`toProblemError` stay non-public by living in the un-barrelled `validation.ts`. Update L36/L192 accordingly. If the schema must remain in `client.ts`, drop the direct-safeParse test and state that envelope/fixture consistency is guarded only indirectly (reverting r1-f3) — but the module-move is the clean fix that keeps both R4 and the direct test. |
| architect-r2-f2 | Medium | Open | PublicSurface | Both exit gates' R4 guard (plan L175, L331); `src/index.ts` L1–4 (`export *` of client/config/result/schemas) | The mechanically-enforced R4 guard greps `git diff --name-only HEAD` for `^src/(schemas\|result\|index)\.ts$` only. But the public surface is the union of **all** exports from every barrelled module — `client.ts`, `config.ts`, `result.ts`, `schemas.ts` — because `index.ts` re-exports each with `export *`. A new `export` added to `client.ts` (the very file both phases modify, and the file the envelope schema lives in) widens the public API **without touching any grep-watched file and without changing `index.ts`**. So the guard the plan calls "mechanically enforcing … the internal envelope schema is never exported (R4)" (L335) cannot actually detect the leak it names — it has a blind spot exactly where the risk is. | Back R4 with a guard that observes the *effective* public surface rather than a fixed file list: e.g. emit declarations (`tsc --emitDeclarationOnly` to a temp dir) and diff `dist/index.d.ts` against a committed baseline, or add a test that snapshots `Object.keys(await import("../index.js"))`, or at minimum add `git diff HEAD src/client.ts \| grep -qE '^\+export ' && fail` to the fenced block. This closes the client.ts/config.ts export-leak path that the current schemas/result/index-only grep misses. |
| architect-r2-f3 | Low | Open | Boundaries | Phase 2 Step 2 off branch + snippet (plan L248–249, L268–269); `validateItems` off guard (L103); "Off, non-array `devices`" test (L317) | The r1-f4 fix guards `Array.isArray(items)` *inside* `validateItems`, but in the off path `getAllPages` computes `extractor(page)` **before** calling `validateItems` — `validateItems(itemSchema, extractor(page), …)`. With `page = res.value as P` (no envelope check in off) and `extractor = (p) => p.devices ?? []`, if the off-mode body is `null` or a primitive, `p.devices` dereferences `null`/a non-object and throws a `TypeError` that escapes `getAccountDevices`, violating the client's "never throw, always `{ ok: false/true }`" Result contract — the same contract r1-f4 set out to keep mode-independent. The new "Off, non-array `devices`" test (L317) uses a non-array `devices` on a **well-formed page object**, so it exercises the `validateItems` guard but never the null/primitive-`page` case, and the guard's location cannot cover it (the throw is in extractor evaluation, upstream of the guard). Preexisting in spirit, but `getAllPages` is being rewritten and the plan now *claims* the contract is mode-independent. | Make the off path null-safe at the dereference site: use an optional-chained extractor (`(p) => p?.devices ?? []`) for the devices endpoint, or guard `page` is a non-null object before calling `extractor` in the off branch of `getAllPages`. Extend the off-mode test to include a `null`/primitive response body asserting `{ ok: true, value: [] }` (no throw), so the "Result contract mode-independent" claim is actually exercised. |
