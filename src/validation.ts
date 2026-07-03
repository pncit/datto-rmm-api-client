import { ZodError, ZodType } from "zod/v4";
import { defaultLogger, LoggerLike } from "./logger.js";
import { ProblemError } from "./result.js";

export type ValidationMode = "strict" | "warn" | "off";

// Single source of truth for the validation-error ProblemError type/status; reused by
// toProblemError (below) and by the envelope hard-fail in client.ts, which can't call
// toProblemError because its title differs.
export const VALIDATION_ERROR_TYPE = "validation-error";
export const VALIDATION_ERROR_STATUS = 400;

/**
 * Single-value validation seam (used by getDeviceByUid). The trailing `logger` parameter is
 * optional and defaults to `defaultLogger`, so existing 3-arg call sites keep compiling.
 */
export function validate<T>(
  schema: ZodType<T>,
  data: unknown,
  mode: ValidationMode,
  logger: LoggerLike = defaultLogger,
): T {
  if (mode === "off") {
    return data as T;
  }
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  switch (mode) {
    case "strict":
      // The caller decides fatality and owns any logging; validate() does not log here.
      throw result.error;
    case "warn": {
      // Name the failing path, not the raw multi-line ZodError.message blob (mirrors toProblemError).
      const path = result.error.issues[0]?.path?.join(".") || "(root)";
      logger.warn(`Validation warning at path: ${path}`);
      return data as T; // raw passthrough preserved
    }
    default:
      throw new Error(`Unknown validation mode: ${mode}`);
  }
}

/**
 * Array validation seam (used by the pagination path). Validates each element of `items`
 * individually and partitions the results by mode. Never throws — a divergent element is
 * either dropped (strict) or kept raw (warn), never fatal to the batch.
 *
 * `entityLabel` is generic (e.g. "Device") so this helper carries no domain-specific copy and
 * can be reused for a future paginated collection endpoint.
 */
export function validateItems<T>(
  schema: ZodType<T>,
  items: unknown[],
  mode: ValidationMode,
  entityLabel: string,
  logger: LoggerLike = defaultLogger,
): { valid: T[]; warnings: ProblemError[] } {
  if (mode === "off") {
    // Array.isArray guard: a non-array `items` yields [], never a thrown TypeError.
    return { valid: (Array.isArray(items) ? items : []) as T[], warnings: [] };
  }

  const valid: T[] = [];
  const warnings: ProblemError[] = [];
  items.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      // warn returns raw (unparsed) even for valid items so unknown keys survive; strict returns parsed.
      valid.push(mode === "warn" ? (item as T) : result.data);
      return;
    }
    // Build the ProblemError once; its `detail` (identity + failing path) drives both the log
    // line and the warnings[] entry, so they describe the same failure.
    const problem = toProblemError(entityLabel, result.error, item, index);
    if (mode === "warn") {
      logger.warn(`Validation warning: ${problem.detail}`);
      valid.push(item as T); // nothing dropped in warn
    } else {
      logger.error(`Validation error: ${problem.detail}`);
      warnings.push(problem);
    }
  });
  return { valid, warnings };
}

/**
 * Builds the single `validation-error` ProblemError shape shared by validateItems' rejections
 * and getDeviceByUid's catch. Exported for that reuse; validation.ts is not part of the
 * src/index.ts barrel, so this stays off the public surface.
 */
export function toProblemError(
  entityLabel: string,
  error: ZodError,
  item: unknown,
  index: number,
): ProblemError {
  const identity = extractIdentity(item) ?? `index ${index}`;
  const path = error.issues[0]?.path?.join(".") || "(root)";
  return {
    type: VALIDATION_ERROR_TYPE,
    title: `${entityLabel} failed schema validation`,
    status: VALIDATION_ERROR_STATUS,
    detail: `${entityLabel} ${identity} failed validation at path: ${path}`,
    raw: error,
  };
}

function extractIdentity(item: unknown): string | undefined {
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    if (typeof rec.id === "number" || typeof rec.id === "string")
      return `id=${rec.id}`;
    if (typeof rec.uid === "string") return `uid=${rec.uid}`;
  }
  return undefined;
}
