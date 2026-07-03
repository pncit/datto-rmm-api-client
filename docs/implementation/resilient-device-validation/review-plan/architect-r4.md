## architect — round 4

Plan Review Mode, in-progress review (round 4). Re-read the current `plan.md` against `design.md`
and the live `datto-rmm-api-client` source (`src/client.ts` — freshly re-read at HEAD, `src/validation.ts`,
`src/schemas.ts`, `src/logger.ts`, `src/index.ts`, `src/result.ts`). Applied the in-progress-review
procedure: first re-verified my two round-3 findings against the reviser-r5 dispositions and the
current plan text, then hunted for new issues on my axes only — module boundaries & dependency
direction, data model/schema, public API surface, phase sequencing, hot paths. Prior
`plan-auditor`/`engineer`/`reviser` turns and their findings are `Closed`; the two still-`Open`
findings from engineer-r4 (test coverage of the mid-walk discard, and envelope `detail` blob
consistency) are on the Engineer's axes (testing / error-surface) and I do not re-adjudicate or
duplicate them.

### Re-verification of my round-3 findings (both reviser-r5 `Accepted`)
- **architect-r3-f1** (off-mode `null`/primitive page throws at the `nextPageUrl` read, a second
  dereference the r2-f3 extractor fix didn't cover) — resolved. The walk-advance is now
  `nextUrl = page?.pageDetails?.nextPageUrl` in Step 3 prose (L209), the off-path null-safety
  narrative (L210, which now names **both** dereference sites — `extractor(page)` and the
  `nextPageUrl` read — as requiring `page?.`), and the snippet (L304). The "Off, `null`/primitive
  page body does not throw" test (L348) was strengthened to exercise the **`null`** case
  specifically (a string auto-boxes so `"s".pageDetails` is `undefined` and would pass even the buggy
  form). Confirmed against live `src/client.ts:64` (`nextUrl = data.pageDetails?.nextPageUrl`), which
  the snippet correctly re-authors with the leading `page?.`. In strict/warn `page = parsed.data` is a
  validated non-null object, so `page?.` is a harmless no-op there. **Ratified → Closed.**
- **architect-r3-f2** (prose instructed a `private logger: LoggerLike = config.logger ?? defaultLogger`
  **field initializer**, which cannot reference the bare constructor parameter-property `config` and
  fails `npm run build` with TS2663) — resolved. Implementation Notes (L37) and Phase 2 Step 1 (L200,
  L202) now instruct declaring an **uninitialized** `private logger: LoggerLike` (or `logger!`) field
  and **assigning `this.logger = config.logger ?? defaultLogger` in the constructor body**, matching
  the authoritative snippet (L246–249). Verified against live `src/client.ts:17`
  (`constructor(private config: DattoRmmClientConfig)`) that a body assignment is the only form that
  compiles, and that `strictPropertyInitialization` is satisfied by the constructor-body assignment.
  **Ratified → Closed.**

### Axis notes (round 4) — verified against live source
- **Generics / type-soundness (data model):** re-derived the full `getAllPages<T, P>` generic chain
  against the live `PaginationDataSchema`. The call `getAllPages<Device, DevicesEnvelope>(…,
  DevicesEnvelopeSchema, DeviceSchema, (p) => p?.devices ?? [])` type-checks: `DevicesEnvelope`
  (`{ pageDetails?: PaginationData; devices?: unknown[] }`) satisfies the constraint
  `P extends { pageDetails?: { nextPageUrl: string | null } }` (PaginationData carries
  `nextPageUrl: string | null` plus extra fields — assignable in the width-subtyping direction);
  `DevicesEnvelopeSchema` is assignable to `ZodType<P>`; `page?.pageDetails?.nextPageUrl` types as
  `string | null | undefined` into `nextUrl`; `extractor(page): unknown[]` feeds `validateItems`'s
  `items: unknown[]`. This mirrors the already-proven live `DevicesPageSchema`/`DevicesPage` pattern.
  Sound — no finding.
- **Boundaries / dependency direction:** `src/internal/devicesEnvelope.ts` depends only on `zod/v4`
  + `../schemas.js` (`PaginationDataSchema`); `client.ts → internal/devicesEnvelope` is a clean inward
  edge with no cycle. `validation.ts → {logger.ts, result.ts, zod}` is acyclic (leaves import nothing
  back). Sound — no finding.
- **Public API surface:** the envelope schema stays off `index.ts` (un-barrelled `src/internal/`),
  exit-gate guard (a) trips on any `index.ts` edit and guard (b) on a new top-level `export` in the
  barrelled `client.ts`/`config.ts`. I considered whether shipping `dist/internal/devicesEnvelope.js`
  makes the schema deep-importable — but the review has already (rounds 2–3, and the design's own
  "internal detail" framing) established that un-barrelled = off the R4 public surface, and the same
  is true of the already-`Closed` `validation.ts` (`validateItems`/`toProblemError`/constants).
  Deep-import reachability is a package-hygiene axis orthogonal to R4 (which fixes the *type surface*
  of existing exports); raising it would contradict the accepted convention and implicate a closed
  decision. Not a finding.
- **Phase sequencing:** unchanged from r3 — Phase 1 leaves `client.ts` compiling on the 3-arg
  `validate` (new `logger` param optional) and the old whole-page `getAllPages`; exported-but-unused
  `validateItems`/`toProblemError`/constants are not `tsc` errors; the always-present `warnings: []`
  shape change is Phase-2-only and the two existing `devicesMethod.test.ts` cases assert via
  `.length`/property checks (not whole-object `toEqual`), so it does not break them. Sound.
- **Hot paths:** envelope `safeParse` over opaque `z.unknown()` items + N per-device `safeParse`
  ≈ today's single whole-page parse; `items.push(...partition.valid)` / `warnings.push(...)` spreads
  are bounded by **page** size (not total inventory), so no argument-count blow-up. Design-ruled
  (`warnings[]`/`raw: ZodError` unboundedness). No finding.

No new findings on my axes this round. The plan is converged, internally consistent, and buildable
with respect to module boundaries, the data model, the public surface, phase sequencing, and hot
paths. My two prior findings are ratified `Closed`; the remaining open items belong to the
Engineer's axes.

## Findings

| ID | Severity | Status |
|----|----------|--------|
| _(none this round — no new architect-axis findings; architect-r3-f1 and architect-r3-f2 re-verified `Closed` above)_ | — | — |
