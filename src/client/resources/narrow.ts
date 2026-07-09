/**
 * Narrows `BaseResource`'s honest `Lenient<T>` return (every field independently null-admitting
 * on top of its own declared optionality — see `BaseResource.validateResponse`'s doc,
 * `./base-resource.ts`) to a resource method's own clean, declared return type (`Device`,
 * `Site`, `Account`, …).
 *
 * `BaseResource.validateResponse`'s own doc names this exact re-assertion as each resource
 * method's responsibility, performed via this helper — the value-level counterpart to that same
 * file's `coerceSchema` (`./base-resource.ts`), which retypes a *schema*'s declared output rather
 * than an already-`Lenient`-wrapped *value*; see that helper's doc for why the two are not
 * interchangeable. This is that value-level cast, applied once per resource method at the one
 * place it actually narrows the type, shared here (rather than redefined per resource file) so
 * every Phase 7/8 resource method uses the identical, documented idiom. Runtime validation has
 * already run by the time this is called — `narrow` only narrows the compile-time type of an
 * already-validated value; it performs no runtime check of its own.
 */
export function narrow<T>(value: unknown): T {
  return value as T;
}
