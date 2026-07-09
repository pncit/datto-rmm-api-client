/**
 * Compile-time-only regression pin for `Lenient<T>` (`src/validation/schema-leniency.ts`) against
 * real, representative generated response types (`Device`, `Alert`, `AlertsPage`), covering a
 * nested object field, a nested array-of-objects field, and a nested enum field.
 *
 * This file contains no runtime assertions and is never imported by a `*.test.ts` file — it is
 * picked up directly by `tsconfig.test.json`'s `include: ["tests/**\/*.ts", ...]` glob, so
 * `npm run typecheck` (part of this phase's Exit Gate) fails the build the moment `Lenient<T>`'s
 * instantiation over these real types breaks: an "excessively deep instantiation" error, a type
 * mismatch against the expected shape below, or any other compile error on the type aliases in
 * this file. This turns an ad hoc, easily-forgotten manual check into a permanent, build-breaking
 * guard on the type-level contract Phase 6's `BaseResource` callers build on.
 *
 * Uses the standard `Equal`/`Expect` type-testing pattern (distributive-conditional-free strict
 * equality via a generic-function comparison) rather than `expectTypeOf`/`tsd`: this repo runs no
 * dedicated type-testing tool, and a plain `.ts` file checked by the existing `tsc -p
 * tsconfig.test.json` step needs no new dependency or script to be enforced on every
 * `npm run typecheck`.
 */
import type { Alert } from "../../src/generated/types/alert";
import type { AlertPriority } from "../../src/generated/types/alertPriority";
import type { AlertsPage } from "../../src/generated/types/alertsPage";
import type { AntivirusAntivirusStatus } from "../../src/generated/types/antivirusAntivirusStatus";
import type { Device } from "../../src/generated/types/device";
import type { ResponseActionActionType } from "../../src/generated/types/responseActionActionType";
import type { Lenient } from "../../src/validation/schema-leniency";

/** Strict type equality (standard type-testing idiom: compares assignability in both directions
 * via a generic-function trick, which -- unlike a bare `extends` check -- also distinguishes
 * `any`/`unknown`/union-vs-intersection edge cases that a naive comparison would conflate). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (
  <T>() => T extends B ? 1 : 2
)
  ? true
  : false;

/** Fails to compile unless its argument is the literal type `true`. */
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Device — named object field nullability (a plain scalar, a nested object, a nested enum)
// ---------------------------------------------------------------------------

// `hostname?: string` -> every named field additionally admits `null` (toLenientField).
type _DeviceHostname = Expect<
  Equal<Lenient<Device>["hostname"], string | null | undefined>
>;

// `deviceClass?: DeviceDeviceClass` (an open-enum primitive) passes through unchanged aside from
// the added `| null` — enums are primitives, not `object`, so `Lenient` does not recurse into
// their member union.
type _DeviceClassNullable = Expect<
  Equal<
    Lenient<Device>["deviceClass"],
    Device["deviceClass"] | null | undefined
  >
>;

// `antivirus?: Antivirus` — a nested named object — recurses: both the field itself and its own
// nested named fields (`antivirusStatus`) independently admit `null`.
type _DeviceAntivirusNullable = Expect<
  Equal<
    Lenient<Device>["antivirus"],
    { antivirusProduct?: string | null; antivirusStatus?: AntivirusAntivirusStatus | null } | null | undefined
  >
>;

// ---------------------------------------------------------------------------
// Alert / AlertsPage — array-of-objects field: the array field itself is nullable, but an
// element's presence in the array is not independently wrapped in `| null` (addCatchallRecursive's
// `array` case does not call `toLenientField` on the element schema).
// ---------------------------------------------------------------------------

type _AlertResponseActionsElementNotIndependentlyNull = Expect<
  Equal<
    Lenient<Alert>["responseActions"],
    | {
        actionTime?: string | null;
        actionType?: ResponseActionActionType | null;
        description?: string | null;
        actionReference?: string | null;
        actionReferenceInt?: string | null;
      }[]
    | null
    | undefined
  >
>;

// `priority?: AlertPriority` (open-enum primitive) at two nesting depths — both the top-level
// `Alert.priority` and the same field reached through `AlertsPage.alerts[number].priority` widen
// identically, proving `Lenient` recurses correctly through an array of a nested named type.
type _AlertPriorityNullable = Expect<
  Equal<Lenient<Alert>["priority"], AlertPriority | null | undefined>
>;

type _AlertsPageAlertsElementPriorityNullable = Expect<
  Equal<
    NonNullable<Lenient<AlertsPage>["alerts"]>[number]["priority"],
    AlertPriority | null | undefined
  >
>;
