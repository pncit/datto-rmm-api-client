/**
 * Compile-time-only regression pin (R19, plan Phase 8 Step 7/8): proves the retired 0.1.x
 * `Result`/`ProblemError` types, and a sample of the raw generated request/query-params surface,
 * are **not** exported from the public barrel (`src/index.ts`).
 *
 * Each `@ts-expect-error` directive below only typechecks successfully *because* the named export
 * does not exist on `src/index.ts`. If any of them were ever (re)introduced — a stray
 * `export * from './generated/types'`, or a resurrected `Result`/`ProblemError` — the directive
 * itself fails as "unused" (TypeScript's `reportUnusedTsExpectErrorDirectives`, on by default),
 * catching the regression at `npm run typecheck` rather than silently widening the published
 * `1.0.0` surface. This is the compile-time half of `tests/unit/client/surface.test.ts`'s "the
 * retired names … are not exported" assertion — a *type* export has no runtime footprint to check
 * with a plain `expect(...)`, so it must be proven here instead.
 *
 * Picked up directly by `tsconfig.test.json`'s `include: ["tests/**\/*.ts", ...]` glob, alongside
 * `schema-mirror-pin.ts`/`lenient-type-pin.ts`; contains no runtime assertions and is never
 * imported by a `*.test.ts` file.
 */

// The retired 0.1.x Result/ProblemError contract (R9, Decision 4) must never be re-exported.
// @ts-expect-error Result is retired (R9) — must not be exported from the public barrel.
import type { Result } from "../../src/index";
// @ts-expect-error ProblemError is retired (R9) — must not be exported from the public barrel.
import type { ProblemError } from "../../src/index";

// The raw generated request-body/query-params surface must never leak (Phase 8 Step 7) — only
// the hand-curated `src/public-types.ts` list is exported. `VariableCreationRequest`/
// `GetDeviceAuditByMacAddressParams` are real generated-only types no resource method's public
// signature uses directly (variable creates take the reconciled `*VariableCreateInput` types
// instead; `getDeviceByMacAddress` takes a bare `macAddress: string`, not a params object) —
// deliberately absent from `public-types.ts`, so a stray `export * from './generated/types'` is
// exactly what would make these two imports newly (and wrongly) succeed.
// @ts-expect-error VariableCreationRequest is a raw generated type, not curated for the public surface.
import type { VariableCreationRequest } from "../../src/index";
// @ts-expect-error GetDeviceAuditByMacAddressParams is a raw generated type, not curated for the public surface.
import type { GetDeviceAuditByMacAddressParams } from "../../src/index";

// Positive pin (plan Phase 1, R1/Success Criteria): the five HTTP-observer types must be
// exported from the public barrel. Unlike the `@ts-expect-error` imports above, these are
// ordinary type-only imports referenced in a typed position below — if any were removed (or
// renamed) from `src/index.ts`, this file fails `npm run typecheck` with an unresolved-import
// error rather than silently narrowing the published surface.
import type {
  DattoHttpErrorEvent,
  DattoHttpHeaders,
  DattoHttpObserver,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
} from "../../src/index";

type _ObserverSurfacePin = {
  observer: DattoHttpObserver;
  request: DattoHttpRequestEvent;
  response: DattoHttpResponseEvent;
  error: DattoHttpErrorEvent;
  headers: DattoHttpHeaders;
};
