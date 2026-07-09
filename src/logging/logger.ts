import { z } from "zod";

/**
 * Logger interface for Datto RMM client operations. Implement this interface to
 * provide custom logging behavior.
 *
 * The client always wraps the injected logger in a UDF-masking decorator
 * (`withUdfMasking`, see `src/logging/mask.ts`) before handing it to any internal
 * layer, so a `DattoLogger` implementation never needs to redact UDF values itself.
 *
 * @example
 * ```typescript
 * const logger: DattoLogger = {
 *   debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta),
 *   info: (msg, meta) => console.info(`[INFO] ${msg}`, meta),
 *   warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta),
 *   error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta),
 * };
 * ```
 */
export type DattoLogger = {
  /** Log debug-level messages. */
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  /** Log info-level messages. */
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  /** Log warn-level messages. */
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  /** Log error-level messages. */
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Zod schema for a single logger method: `(message: string, meta?: Record<string, unknown>) => void`. */
const logMethodSchema = z.function({
  input: [z.string(), z.record(z.string(), z.unknown()).optional()],
  output: z.void(),
});

/**
 * Zod schema for {@link DattoLogger}. Validates that a supplied logger has
 * `debug`/`info`/`warn`/`error` methods with the correct signature.
 */
export const dattoLoggerSchema = z.object({
  debug: logMethodSchema,
  info: logMethodSchema,
  warn: logMethodSchema,
  error: logMethodSchema,
});

/**
 * Default logger, backed directly by the global `console`. `Console`'s methods are
 * structurally compatible with {@link DattoLogger} (each accepts a message and
 * arbitrary extra arguments), so no wrapping is needed.
 */
export const consoleLogger: DattoLogger = console;
