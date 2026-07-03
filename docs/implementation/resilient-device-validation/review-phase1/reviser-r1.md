## reviser — round 1

| ID | Disposition | Rationale (and, for Fixed, what changed) |
|----|-------------|-------------------------------------------|
| implementation-auditor-r1-f1 | Fixed | Changed `src/__tests__/validation.test.ts`'s "strict on invalid data throws" assertion from bare `.toThrow()` to `.toThrow(ZodError)`, importing `ZodError` from `zod/v4`. This pins the thrown *type*, not just that something throws, matching the plan's "throws a `ZodError`" requirement and the load-bearing `e instanceof ZodError` check Phase 2's `getDeviceByUid` depends on. |
| implementation-auditor-r1-f2 | Fixed | Added `jest.spyOn(console, "warn").mockImplementation(() => {})` (restored via `finally` → `mockRestore()`) plus `expect(consoleWarnSpy).not.toHaveBeenCalled()` to both `warn`-path tests: `validate`'s "warn on invalid data" case (`src/__tests__/validation.test.ts`) and `validateItems`'s "warn, mixed" case. This guards against a regression that left a hardcoded `console.warn(...)` alongside the new `logger.warn(...)`, which the mock-logger assertion alone could not catch. |

Verification: `npm run build` exits 0; `npm test` — `validation.test.ts` (all 11 tests, including the two revised) passes. The two failures in `devicesMethod.test.ts` and one in `deviceSchema.test.ts` are pre-existing and out of Phase 1 scope (confirmed via `git stash` — identical 3 failures on the pre-revision tree); they exercise `client.ts`, which Phase 2 wires up, not `validation.ts`.
