import type { DattoLogger } from "./logger";

/** Matches a UDF key at any nesting depth: `udf1`, `udf42`, `udf300`, etc. */
const UDF_KEY = /^udf\d+$/;

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
 * Recursively walks a log call's `meta` object, replacing every non-null value under
 * a `udf<N>` key — at any nesting depth, including inside a nested `udf` record — with
 * a redacted placeholder. Null/absent UDF values and all non-UDF structure pass through
 * unchanged. Recursion is restricted to arrays and plain objects (see
 * {@link isPlainObject}); any other object (`Date`, `Error`, `Map`, a class instance,
 * …) is returned as-is rather than flattened.
 */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    return scrubMeta(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Scrubs a plain record's top-level entries (redacting UDF keys, recursing into
 * non-UDF ones via {@link scrub}). This is the typed entry point `withUdfMasking` uses
 * to cross out of `scrub`'s `unknown -> unknown` signature: a `DattoLogger` call's
 * `meta` is always a `Record<string, unknown>` (never an array — see `DattoLogger`'s
 * parameter type), so this function's real `Record -> Record` return type asserts the
 * boundary correctly instead of relying on a cast that a future edit to `scrub` could
 * silently invalidate.
 */
function scrubMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(meta)) {
    out[key] =
      UDF_KEY.test(key) && entryValue != null
        ? mask(entryValue)
        : scrub(entryValue);
  }
  return out;
}

/**
 * Wraps a {@link DattoLogger} so every call's `meta` is scrubbed of raw UDF values
 * before reaching the underlying logger (R20).
 *
 * This is the client's single logging boundary: `DattoRmmClient` constructs
 * `withUdfMasking(config.logger ?? consoleLogger)` once and threads the wrapped logger
 * through every layer, so no call site — current or future — can leak an unmasked UDF
 * value. The guarantee holds only because every wire-derived log value is carried in
 * `meta`; this decorator scrubs `meta`, never the message string, so a call site that
 * interpolated a wire value into the message text would bypass it. Call sites must
 * pass wire-derived values through `meta`, never format them into the message.
 */
export function withUdfMasking(logger: DattoLogger): DattoLogger {
  const wrap =
    (method: "debug" | "info" | "warn" | "error"): DattoLogger[typeof method] =>
    (message, meta) =>
      logger[method](message, meta ? scrubMeta(meta) : meta);

  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}
