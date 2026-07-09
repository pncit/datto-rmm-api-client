/**
 * Narrows `value` to a plain object — excludes `null` and arrays, which pass `typeof === "object"`
 * but are never treated as a keyed record by callers of this guard. Shared by every module that
 * needs to distinguish a JSON object body from a string/array/primitive one before doing keyed
 * lookups on it (`errors/datto-api-error.ts`'s message/request-id extraction,
 * `http/http-client.ts`'s 403 body-wording check).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
