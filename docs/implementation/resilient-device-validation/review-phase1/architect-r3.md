## architect — round 3

Code Review Mode, exhaustive. Round 3 in-progress review. Scope re-confirmed against `git diff main`:
the only production change is `src/validation.ts`; plus the unit test `src/__tests__/validation.test.ts`
and four pre-existing-drift fixture JSON files. No barrelled/protected module
(`schemas.ts`/`result.ts`/`index.ts`/`client.ts`) is touched, so the R4 public-surface guard holds and
`validateItems`/`toProblemError`/`firstIssuePath`/`VALIDATION_ERROR_*` remain genuinely non-public
(the `src/index.ts` barrel exports only `client`/`config`/`result`/`schemas`).

### Disposition of prior architect findings (re-verified against current `src/validation.ts`)

- **architect-r1-f1 (firstIssuePath duplication) → remains Closed, ratified.** `firstIssuePath` still
  exists as the single exported helper (line 23) and is the only site computing
  `issues[0]?.path?.join(".") || "(root)"`; both `validate`'s warn branch (line 50) and
  `toProblemError` (line 126) call it. No regression.
- **architect-r1-f2 (extractIdentity leaky-abstraction / honesty of "generic" claim) → remains Closed,
  ratified.** The doc comment (lines 136–142) still states the `id`/`uid`-only, best-effort limitation
  and directs differently-keyed callers to `identityOverride`. No regression.
- **architect-r1-f3 (array-centric builder can't carry a caller-known identity) → remains Closed,
  ratified.** `toProblemError`'s optional trailing `identityOverride?: string` (line 122) is still
  threaded ahead of the `extractIdentity(item) ?? \`index ${index}\`` fallback (lines 124–125);
  additive, sole call site unaffected. No regression.

### New finding this round

A single internal inconsistency surfaces on a fresh read of the constants block. The
`VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` pair is `export const` (lines 10–11) with an explicit
"reused by … the envelope hard-fail in client.ts" rationale — but the sibling
`VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` constants (lines 15–16), whose own comment makes the
*same* cross-file-reuse claim ("and — in client.ts — the envelope hard-fail emits one consistent,
greppable message"), are module-private. A non-exported const cannot be imported by `client.ts`, so
Phase 2 will be forced to hand-copy the string literals — reintroducing exactly the drift these
constants were introduced (in engineer-r1-f3) to prevent. This is the same single-source-of-truth
seam class as architect-r1-f1, and it is cheap to close now, before Phase 2 copies the pattern.

Everything else re-audits clean: ownership (`ZodError → ProblemError` DTO build and the path convention
sit at the validation boundary), dependency direction (`validation.ts → result.ts` pure types,
`→ logger.ts` pure; no cycle, no barrel leak), data flow (I/O injected via `LoggerLike`, pure
partitioning inside; `validate` strict throws without logging per caller-owns-fatality; `validateItems`
never throws in any mode), the `warnings: ProblemError[]` field name matches design R2 (rejected devices
into `Result.warnings[]`), public API is additive/off-barrel, and performance is a single linear
`forEach`+`safeParse` with one log line per divergent item. No further new findings.

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r3-f1 | Low | Open | Architecture | `src/validation.ts:13-16` (`VALIDATION_WARN_PREFIX` / `VALIDATION_ERROR_PREFIX`) | The two log-line prefix constants are module-private, yet their own comment states they exist so that "every validation-error/warning site (single-value, per-item, and — in client.ts — the envelope hard-fail) emits one consistent, greppable message shape." `client.ts` cannot import a non-exported const, so Phase 2's envelope hard-fail will hand-copy the literals `"Validation warning"` / `"Validation error"`, reintroducing the drift these constants (engineer-r1-f3) were added to eliminate. This directly contradicts the sibling `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` pair, which is `export const` for precisely the stated `client.ts` reuse. The centralization is only half-applied. | Make the two prefixes `export const` (matching `VALIDATION_ERROR_TYPE`/`_STATUS`), so Phase 2's `client.ts` envelope hard-fail imports the same prefix rather than re-typing the string — keeping the greppable-message convention a true single source of truth. If the intent is instead that `client.ts` will *not* share them, correct the comment on lines 13–16 to drop the "in client.ts — the envelope hard-fail" claim so it stops promising cross-file consistency the code can't deliver. |
| architect-r1-f1 | Low | Closed | Architecture | `src/validation.ts` (`firstIssuePath`) | Ratified in r2, re-verified in r3: the first-issue-path computation and `"(root)"` sentinel remain centralized in the exported `firstIssuePath` helper, called from both prior sites. | No action. |
| architect-r1-f2 | Low | Closed | Architecture | `src/validation.ts` (`extractIdentity`) | Ratified in r2, re-verified in r3: doc comment still states the `id`/`uid`-only best-effort limitation and directs differently-keyed callers to `identityOverride`. | No action. |
| architect-r1-f3 | Low | Closed | PublicAPI | `src/validation.ts` (`toProblemError` signature) | Ratified in r2, re-verified in r3: optional trailing `identityOverride?: string` still threaded ahead of the `extractIdentity`/`index` fallback; additive, sole call site unaffected. | No action. |
