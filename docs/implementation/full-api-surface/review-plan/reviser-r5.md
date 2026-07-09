## reviser — round 5

Addressed both `Open` findings from `plan-auditor-r5.md`. Verified each against the sibling
`../fuze-api` repo and the design before editing (dedupe pipeline confirmed at `fuze-api/package.json`
line 48 `"generate": "orval && node scripts/dedupe-generated-index.mjs"`, and the script's own header
explains Orval "sometimes generates duplicate export lines"; the design consistently names the module
`src/schema-overrides.ts` at lines 219/240/470). Human ruling recorded for the prior round: Phase 9's
secret-scanner was rightly removed (a bad idea from the start) and the plan already reflects that — no
further Phase 9 change was needed this round.

Internal self-review (fresh read) found no new inconsistencies from these edits: the inserted Phase 2
dedupe step is renumbered cleanly (steps now 1–6), no cross-reference elsewhere points at a shifted
Phase 2 step number, and the `spec-overrides`→`schema-overrides` rename is total (zero residual
`spec-overrides` occurrences) across the coexistence rule, the hand-edit note, the Phase 6 goal/step,
the Files line, and the test path.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| plan-auditor-r5-f1 | Fixed | Ported `fuze-api`'s dropped dedupe step back into the generation pipeline. `npm run generate` (Phase 1 Step 2, line 60) is now `patch-spec → orval → dedupe-generated-index → widen-response-enums`; the created-in-Phase-2 note (line 61) lists the new script and states the pipeline order/rationale. Added Phase 2 Step 3 "Port the generated-index dedupe step" (`scripts/dedupe-generated-index.mjs`, copied near-verbatim — only `GENERATED_INDEX_PATH` re-pointed at this repo's `src/generated/types/index.ts`), running after Orval and before the enum-widen scan of `src/generated/types/**`; subsequent Phase 2 steps renumbered (generate-and-commit → Step 5, reproducibility → Step 6, which now also confirms dedupe idempotence). Added a unit test `tests/generated/dedupe-index.test.ts` (removes a `.js`/no-extension duplicate pair, preserves non-export lines, second pass is a no-op). This restores fidelity to the plan's own "Port, don't reinvent" rule and closes the risk that a duplicated committed index trips the Phase 2 `npm run lint` gate. |
| plan-auditor-r5-f2 | Fixed | Renamed the module to align with the design's `src/schema-overrides.ts` name: replaced every `src/spec-overrides/` reference with `src/schema-overrides/` (coexistence rule line 38, never-hand-edit note line 39, Phase 6 goal line 387, Phase 6 Step 3 line 396, Files line 401, test path `tests/unit/schema-overrides/*.test.ts` line 427). Kept the directory-split form for readability and added a one-line clarification in Phase 6 Step 3 that it overrides the **generated zod schemas** *after* generation and must not be confused with Phase 2's `scripts/patch-spec.mjs`, which corrects the spec *before* generation — removing the misleading "spec" label the auditor flagged. |

### Carry-forward (prior rounds, all ratified Closed)
- r1: f1–f7. r2: f1–f4. r3: f1, f2. r4: f1 (dangling `mediator-hardstop-r1.md` citation removed; Phase 9 secret-scanner removal upheld per human ruling).
