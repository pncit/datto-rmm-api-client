## reviser — round 2

| ID | Disposition | Rationale (and, for Fixed, what changed) |
|----|-------------|-------------------------------------------|
| implementation-auditor-r2-f1 | Fixed | Dropped the stale `(Phase 2)` plan-phase parentheticals from the two `src/validation.ts` comments (the `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` header comment at the top of the file, and the `toProblemError` JSDoc above its declaration), rephrasing both in the present tense ("reused by ... the envelope hard-fail in client.ts" / "shared by validateItems' rejections and getDeviceByUid's catch") so the rationale for the shared shape/module placement survives without referencing the build plan. |
| implementation-auditor-r2-f2 | Fixed | Changed `src/__tests__/validation.test.ts`'s strict-mixed `validateItems` assertion from `expect(warnings[0].raw).toBeDefined()` to `expect(warnings[0].raw).toBeInstanceOf(ZodError)` (`ZodError` already imported), pinning that `raw` carries the actual `ZodError` instance rather than merely a non-undefined value, consistent with the design's R2 requirement and the r1-f1 fix pattern. |

Verification: `npm run build` exits 0; `npx jest src/__tests__/validation.test.ts` — all 10 tests pass. `git diff --name-only HEAD` shows only `src/validation.ts` and `src/__tests__/validation.test.ts` changed — no protected file (`schemas.ts`/`result.ts`/`index.ts`) touched, R4 guard holds.
