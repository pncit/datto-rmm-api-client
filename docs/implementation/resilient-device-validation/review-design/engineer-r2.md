## engineer — round 2

Design-review mode, round 2. My three round-1 findings (engineer-r1-f1 multi-page envelope
hard-fail discard, f2 unbounded `warnings[]`, f3 envelope-mechanism duplication) were all
dispositioned **Fixed** in reviser-r3; I re-read the amended text (L97 discard clause, L183/L195
success+test rows, L210 risk row, Decision 2 as the single normative envelope-mechanism source)
and consider them **closed** — not re-litigated here. The auditor rounds' items (plumbing
signature, warn raw-passthrough, envelope mode-gating, single-value logging split) I also treat
as closed.

This pass grounds the changing `validate()` seam against its **actual** call sites in
`src/client.ts` and `src/__tests__/deviceSchema.test.ts`. One concrete consistency gap surfaced
there; one smaller log-shape observation. The design remains sound and well-scoped — these are
tightenings.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| engineer-r2-f1 | Medium | Open | Consistency | Key Concepts "Logger-aware `validate()`" (L117) / Decision 3 (L143) / Success Criteria (L186) | The design says `validate()` "gains a logger parameter" and shows it as a required positional (`validate(schema, data, mode, logger)`, L117), while Success Criteria L186 asserts R4 is "verified by the existing `deviceSchema.test.ts` fixture **still validating unchanged**." But that test calls `validate(DeviceSchema, device, "strict")` with **three** arguments (`src/__tests__/deviceSchema.test.ts:11`). If the new `logger` parameter is required, that call no longer typechecks and `npm run build`/`npm test` (the very Verification gate at L191–193) fails until the test source is edited — contradicting "unchanged." If instead `logger` is optional (or defaults to `defaultLogger`), the existing call survives untouched and the claim holds — but then `warn`-mode's routing-to-`config.logger` guarantee (R6) depends on every real caller actually passing it, which the design should state. The design leaves the arity/optionality unspecified at the one place it's load-bearing. | Specify whether the new `validate()` `logger` parameter is required or optional/defaulted. If optional-with-`defaultLogger`, keep L186's "unchanged" claim and add one sentence that R6 relies on the client passing `config.logger` at the live call site. If required, correct L186 — the test call is a source change, however trivial — so the Planner doesn't treat an unchanged 3-arg test as a build-green invariant. |
| engineer-r2-f2 | Low | Open | Clarity | Per-item helper `warn` bullet (L112) / R8 (L46) / Breaking Changes (L168–171) | In `warn` mode the log **granularity** changes, not just the sink. Today `validate()` runs one `safeParse` on the whole page and emits a single `console.warn` carrying one page-level `ZodError`; the new per-item helper emits **one `logger.warn` per divergent device** (L112). So a consumer scraping `warn` output sees both a different sink (config.logger, correctly called out) *and* a different shape/volume (N per-device lines vs. one per-page line) — the latter is not noted among the two documented behavioral changes. It is arguably an improvement, but it is an observable change in a mode whose entire purpose is drift visibility. | Add a half-sentence to R8 or Breaking Changes item that `warn` diagnostics also change granularity from one per-page to one per divergent device (alongside the sink change), so the shift is a deliberate, release-noted outcome rather than an incidental side effect. No mechanism change. |
</content>
</invoke>
