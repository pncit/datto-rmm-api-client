## architect — round 1

Code Review Mode (exhaustive). Scope taken from `git diff main...HEAD`, restricted to the Phase 2
production/behavioral surface: `src/client.ts`, the new `src/internal/devicesEnvelope.ts`,
`src/__tests__/devicesMethod.test.ts`, and the `## Resilient validation` README section. I read the
original `main:src/client.ts` to diff behavior directly, plus `src/validation.ts` (Phase 1, unchanged
here), `src/schemas.ts`, `src/result.ts`, `src/index.ts`, and `package.json` to check boundaries and
the publish surface. This is my first architect turn on this phase; the existing
`implementation-auditor`/`reviser` turns belong to other agents and I do not carry their IDs — I
reviewed independently. Tests were **not** run (assumed passing per role).

### What I evaluated and found sound

**Architecture & ownership / layering.** The two-concern split (structural envelope vs. per-device
validation) lands the right responsibilities in the right places: the structural page contract lives
in an internal schema, per-item drift handling stays in the Phase-1 `validateItems` seam, and
`client.ts` orchestrates without re-implementing either. Dependency direction is clean and
acyclic: `client.ts → internal/devicesEnvelope.ts → schemas.ts` (public), and `internal` depends on
public `PaginationDataSchema` rather than the reverse. No new cross-layer or deep imports; `zod`/
`PaginationDataSchema` correctly moved out of `client.ts` into the envelope module.

**Boundaries / public surface (R4).** `src/index.ts` is untouched and still barrels only
`client/config/result/schemas`; the envelope module is deliberately un-barrelled, mirroring the
already-non-public `validation.ts`. No new top-level `export` in `client.ts`/`config.ts` (R4 guard b
holds). `DevicesPageSchema`/`DevicesPage` remain exported and byte-unchanged even though the runtime
path stopped using them — correct per R4. Accidental future barreling of `internal/` is mechanically
caught by the existing R4 exit-gate guard (any `index.ts` edit trips it), so the in-repo boundary is
enforced, not merely conventional.

**Data model / public API.** No exported type changed. `getAccountDevices`/`getDeviceByUid`
signatures are identical; the only runtime-shape change (`warnings` now always present as `[]` on the
batch success path) rides on the already-optional `Result.warnings` field, is type-safe, and is
documented in the README with the `.length`-not-truthiness caveat the plan required. The
single-value success paths (`getDeviceByUid`, `updateDeviceUdfs`) legitimately omit `warnings` (no
batch to partition), consistent with `warnings?` being optional.

**Data flow & error mapping.** All three `validation-error` sites share one shape (type/status
constants, path-named concise `detail`, full `ZodError` only in `raw`); the envelope hard-fail's
`firstIssuePath` reuse is the correct single-source-of-truth choice over re-inlining. Off-path
null-safety is correct at **both** dereference sites (`p?.devices` extractor and
`page?.pageDetails?.nextPageUrl` walk-advance), and the `off` cast + optional chaining keeps the
"never throw" `Result` contract mode-independent. Mid-walk envelope failure discarding the
accumulator matches the design's Decision-2 pagination-abort semantics. The `nextParams = undefined`
after page 1 and the generic pagination constraint are both carried over unchanged from `main` (no
regression).

**Performance.** Per-page `items.push(...partition.valid)`/`warnings.push(...)` spreads are bounded
by page size (Datto pages are small, ≤ a few hundred), so no argument-count/allocation risk on the
hot path. Validation is a single `safeParse` per envelope plus one per device — no added O(n²) work.

**Security.** Log lines and `ProblemError.detail` carry only device identity (`id`/`uid`, already in
the payload) and a Zod issue path — no credentials/tokens. `safeParse` fails closed on non-object /
primitive / null bodies rather than throwing. The envelope hard-fail is observable through the
configured logger, not `console`.

**NPM package quality.** The un-barrelled `internal/` module ships in `dist/` and, absent a
package `exports` map, is technically deep-importable — but this is a pre-existing property of the
established un-barrelled-privacy pattern (`validation.ts`), it exposes no secret/build-internal, and
adding an `exports` map is out of this phase's scope and would risk existing deep-import consumers.
Not a Phase 2 defect.

No architectural, boundary, data-model, public-API, performance, or security issue rises to a
finding. The phase is faithful to the design and plan in both letter and intent.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| _(none)_ | | | | | No architect-domain findings this round. | |
