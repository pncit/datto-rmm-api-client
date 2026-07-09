## typescript-cop — round 2

Re-verified all three round-1 findings against the current diff (`src/rate-limit/rate-limiter.ts`,
`src/auth/auth-manager.ts`) and re-scanned every file touched since round 1 (`src/http/http-client.ts`'s
new `onUnauthorized`/401-retry path, `src/errors/datto-api-error.ts`'s new `sanitizeAxiosErrorCause`,
`AuthManager`'s new single-flight `pendingRefresh` coalescing and `timeoutMs`, and the two new
`src/util/{sleep,is-record}.ts` extractions) for new type holes, unsafe casts, boundary-validation
gaps, and exhaustiveness regressions. Found none: the new `RetryTrackedConfig` intersection, the
`axios.isAxiosError` narrowing + `AxiosError<unknown>` cast in `performRefresh`'s catch, and every
`as`/`in` usage remain justified and safe (own-property-proven or already-narrowed).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | High | Closed | BoundaryValidation | — | — | ratified: `writeWindowFor` (`src/rate-limit/rate-limiter.ts:118-121`) now gates on `Object.hasOwn(WRITE_LIMITS, opKey)` instead of `opKey in WRITE_LIMITS`, so an inherited `Object.prototype` key (`toString`, `constructor`, …) can no longer resolve to a non-numeric limit. Regression test (`does not use an inherited Object.prototype property as a write limit for a colliding opKey`) confirms an `opKey: "toString"` write now falls back to `DEFAULT_WRITE_LIMIT` and throttles normally at 100. |
| typescript-cop-r1-f2 | High | Closed | BoundaryValidation | — | — | ratified: `performRefresh` (`src/auth/auth-manager.ts:165-178`) now `safeParse`s the grant's 200 body against `tokenResponseSchema` (`z.object({ access_token: z.string().min(1), expires_in: z.number().positive() })`) before trusting it, throwing `DattoApiError` on a malformed body instead of caching `accessToken: undefined`/`expiresAt: NaN`. Two regression tests cover a missing `access_token` and a non-numeric `expires_in`. |
| typescript-cop-r1-f3 | Medium | Closed | Exhaustiveness | — | — | ratified: the `kind === 'read' ? … : …` ternary is replaced by `windowsFor`'s `switch (descriptor.kind)` (`src/rate-limit/rate-limiter.ts:131-142`) with a `default` branch assigning to a `never`-typed variable, so an unhandled third `kind` is a compile error here. Regression test forces an unrecognized `kind` via a cast and asserts it throws rather than silently matching the write path. |

