import type { DattoLogger } from "./logger";

/** Matches a UDF key at any nesting depth: `udf1`, `udf42`, `udf300`, etc. */
const UDF_KEY = /^udf\d+$/;

/**
 * Redacts a non-null UDF value, regardless of its wire type (string, number, nested
 * object/array). The replacement preserves the original value's length so a masked
 * log line stays diagnostically useful without ever carrying the raw value.
 */
function mask(value: unknown): string {
  const asString = typeof value === "string" ? value : JSON.stringify(value);
  return `[redacted - ${asString.length} characters]`;
}

/**
 * Recursively walks a log call's `meta` object, replacing every non-null value under
 * a `udf<N>` key — at any nesting depth, including inside a nested `udf` record — with
 * a redacted placeholder. Null/absent UDF values and all non-UDF structure pass through
 * unchanged.
 */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] =
        UDF_KEY.test(key) && entryValue != null
          ? mask(entryValue)
          : scrub(entryValue);
    }
    return out;
  }
  return value;
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
    (fn: DattoLogger["debug"]): DattoLogger["debug"] =>
    (message, meta) =>
      fn(message, meta ? (scrub(meta) as Record<string, unknown>) : meta);

  return {
    debug: wrap(logger.debug),
    info: wrap(logger.info),
    warn: wrap(logger.warn),
    error: wrap(logger.error),
  };
}
