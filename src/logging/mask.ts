import type { DattoLogger } from "./logger";

/**
 * Matches a UDF key at any nesting depth: `udf1`, `udf42`, `udf300`, etc.
 *
 * This is one of three independent definitions of "what is a UDF key" in this codebase — the
 * others are `scripts/sanitize-fixtures.mjs`'s `SECRET_KEY_PATTERNS` (the at-rest control, R17)
 * and `src/schema-overrides/device-overrides.ts`'s `UDF_KEY_PATTERN` (the reconciled `udf` record
 * schema's key shape, R8). This one is the in-log control (R20). All three exist to identify the
 * same wire concept and must stay in lockstep: `tests/unit/security/udf-key-pattern-consistency.test.ts`
 * asserts they agree on a representative key set and fails the build if a future edit to any one
 * of them drifts from the other two. Exported (rather than module-private) so that test can import
 * this exact pattern instead of re-deriving it.
 */
export const UDF_KEY = /^udf\d+$/;

/**
 * Redacts a non-null UDF value, regardless of its wire type (string, number, nested
 * object/array). The replacement preserves the original value's length so a masked
 * log line stays diagnostically useful without ever carrying the raw value.
 *
 * This is a total function: it never throws. `meta` is caller-supplied and not
 * constrained to JSON-parsed wire values, so a UDF key could carry a `bigint`,
 * `symbol`, function, or circular object — all of which defeat `JSON.stringify`
 * (it throws rather than serializing them). Those inputs fall back to
 * `String(value)`, which cannot throw, so the logging boundary always redacts
 * instead of crashing the call it's meant to protect.
 */
function mask(value: unknown): string {
  if (typeof value === "string") {
    return `[redacted - ${value.length} characters]`;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return `[redacted - ${serialized.length} characters]`;
    }
  } catch {
    // Non-serializable (circular reference, BigInt, etc.) — fall through.
  }
  const asString = String(value);
  return `[redacted - ${asString.length} characters]`;
}

/**
 * True for a plain data object — one created as `{}` or via `Object.create(null)` —
 * as opposed to a `Date`, `Error`, `Map`/`Set`, or other class instance. Wire-derived
 * UDF structures are always JSON, i.e. plain objects/arrays/scalars, so `scrub` only
 * needs to (and should only) recurse into these; a non-plain object's data mostly
 * lives outside its own-enumerable keys (e.g. `Error#message`/`#stack`) and would be
 * silently destroyed by rebuilding it from `Object.entries`.
 */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Sentinel returned in place of an object that is its own ancestor in the value being
 * walked, so `scrub`'s recursion terminates instead of overflowing the call stack.
 */
const CIRCULAR_PLACEHOLDER = "[circular]";

/**
 * Recursively walks a log call's `meta` object, replacing every non-null value under
 * a `udf<N>` key — at any nesting depth, including inside a nested `udf` record — with
 * a redacted placeholder. Null/absent UDF values and all non-UDF structure pass through
 * unchanged. Recursion is restricted to arrays and plain objects (see
 * {@link isPlainObject}); any other object (`Date`, `Error`, `Map`, a class instance,
 * …) is returned as-is rather than flattened.
 *
 * `seen` tracks the current recursion's live ancestors (added on entry, removed on
 * exit) so a circular reference — a routine shape for a logged request/response object
 * (`req.parent === req`, or a parent/child back-reference) — resolves to
 * {@link CIRCULAR_PLACEHOLDER} instead of recursing forever and crashing the log call
 * with a `RangeError`. Because entries are removed on exit, the same object reached via
 * two independent (non-circular) branches is still walked in each — only a genuine
 * ancestor cycle is short-circuited.
 */
function scrub(value: unknown, seen: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR_PLACEHOLDER;
    }
    seen.add(value);
    try {
      return value.map((item) => scrub(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    if (seen.has(value)) {
      return CIRCULAR_PLACEHOLDER;
    }
    seen.add(value);
    try {
      return scrubEntries(value as Record<string, unknown>, seen);
    } finally {
      seen.delete(value);
    }
  }
  return value;
}

/**
 * Scrubs a plain record's entries (redacting UDF keys, recursing into non-UDF ones via
 * {@link scrub}), threading the shared cycle-detection `seen` set through the walk.
 */
function scrubEntries(
  meta: Record<string, unknown>,
  seen: Set<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(meta)) {
    out[key] =
      UDF_KEY.test(key) && entryValue != null
        ? mask(entryValue)
        : scrub(entryValue, seen);
  }
  return out;
}

/**
 * Scrubs a log call's top-level `meta` record. This is the typed entry point
 * `withUdfMasking` uses to cross out of `scrub`'s `unknown -> unknown` signature: a
 * `DattoLogger` call's `meta` is always a `Record<string, unknown>` (never an array —
 * see `DattoLogger`'s parameter type), so this function's real `Record -> Record`
 * return type asserts the boundary correctly instead of relying on a cast that a future
 * edit to `scrub` could silently invalidate. Starts a fresh cycle-detection `seen` set
 * per top-level call.
 */
function scrubMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return scrubEntries(meta, new Set<object>());
}

/**
 * Wraps a {@link DattoLogger} so every call's `meta` is scrubbed of raw UDF values
 * before reaching the underlying logger (R20).
 *
 * This is the client's single logging boundary: `DattoRmmClient` constructs
 * `withUdfMasking(config.logger ?? consoleLogger)` once and threads the wrapped logger
 * through every layer. Two conditions bound what this guarantees:
 * - **Only `meta` is scrubbed, never the message string.** A call site that
 *   interpolated a wire value into the message text would bypass it, so call sites
 *   must pass wire-derived values through `meta`, never format them into the message.
 * - **Only plain-object/array structure inside `meta` is walked.** A value embedded
 *   inside a non-plain object — a `Date`, `Map`, `Error`, or any other class instance —
 *   is returned by {@link scrub} unmasked (see {@link isPlainObject}); this is
 *   deliberate (rebuilding a non-plain object from its own-enumerable keys would
 *   silently destroy it), but it means a raw wire payload placed inside such an object
 *   is **not** scrubbed. Concretely: `DattoApiError#response` (`src/errors/datto-api-error.ts`)
 *   holds the raw response body, so logging `{ err }` where `err` is a caught
 *   `DattoApiError` does **not** redact any UDF value nested in `err.response` — call
 *   sites must not place a raw wire payload inside `meta` under the assumption it will
 *   be scrubbed; extract only the fields actually needed and pass those as plain data.
 */
export function withUdfMasking(logger: DattoLogger): DattoLogger {
  const wrap =
    (method: "debug" | "info" | "warn" | "error"): DattoLogger[typeof method] =>
    (message, meta) =>
      meta === undefined
        ? logger[method](message)
        : logger[method](message, scrubMeta(meta));

  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}
