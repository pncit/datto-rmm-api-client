/**
 * Narrows `BaseResource`'s honest `Lenient<T>` return (every field independently null-admitting
 * on top of its own declared optionality — see `BaseResource.validateResponse`'s doc,
 * `./base-resource.ts`) to a resource method's own clean, declared return type (`Device`,
 * `Site`, `Account`, …).
 *
 * `BaseResource`'s own doc names this exact re-assertion as each resource method's
 * responsibility: "A resource method that wants its own declared return type to be the clean
 * `Device`/`Alert`/etc. shape re-asserts that explicitly at its own return site — the same kind
 * of documented, intentional cast `coerceSchema` already names elsewhere in this file." This is
 * that cast, applied once per resource method at the one place it actually narrows the type,
 * shared here (rather than redefined per resource file) so every Phase 7/8 resource method uses
 * the identical, documented idiom. Runtime validation has already run by the time this is
 * called — `narrow` only narrows the compile-time type of an already-validated value; it
 * performs no runtime check of its own.
 */
export function narrow<T>(value: unknown): T {
  return value as T;
}
