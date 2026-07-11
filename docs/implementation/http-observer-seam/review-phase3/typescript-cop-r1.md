## typescript-cop — round 1

Scope: `git diff main` working-tree changes for Phase 3 — `src/auth/auth-manager.ts`,
`src/client/datto-rmm-client.ts`, `tests/unit/auth/auth-manager.test.ts` (Phases 1–2's
`src/http/http-observer.ts`/`src/http/observer.ts` are already committed/reviewed and unchanged
here; read for context only). The production diff is small and disciplined: `captureRequest`/
`fireRequest`/`fireResponse`/`fireError` are consumed exactly as Phase 1 exports them, no inline
capture/normalization/mapping is added, the caught `err` stays `unknown` end-to-end (no cast) and
is handed to `fireError` unmapped per R8/Decision 4, and `AuthManagerConfig.httpObserver` /
`DattoRmmClient`'s threading are correctly and simply typed with no new `any`/broad types. No
boundary-validation, exhaustiveness, async-correctness, or public-type-hygiene issues found in the
production code.

One minor unsafe-cast pattern in the new test code.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Low | Open | TypeHole | `tests/unit/auth/auth-manager.test.ts:348` | `new URLSearchParams(requestEvent.body as string)` casts `requestEvent.body` (typed `unknown`) to `string` via `as`. The preceding `expect(typeof requestEvent.body).toBe("string")` is a runtime assertion, not a type guard — the cast itself is unsound at the type level and would silently mis-type if that assertion line were ever edited/reordered away. | Replace the cast with a narrowing check the compiler can see, e.g. `if (typeof requestEvent.body !== "string") throw new Error("expected string body"); const params = new URLSearchParams(requestEvent.body);` — or a small local type-guard helper — so the `URLSearchParams` call is type-safe without relying on an assertion elsewhere in the test. |
