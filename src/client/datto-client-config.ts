import { z } from "zod";

import { DEFAULT_RETRY, DEFAULT_TOKEN_REFRESH_PCT } from "../defaults";
import { dattoLoggerSchema } from "../logging/logger";

/**
 * Zod schema for an optional retry-policy override.
 *
 * Every field is independently optional; an unset field (or an entirely absent
 * `retry` object) falls back to `DEFAULT_RETRY` (`src/defaults.ts`) at the point the
 * HTTP transport (Phase 5's `http-client.ts`) consumes it — the schema itself applies
 * no defaults, so `DEFAULT_RETRY` stays the single source of the actual values.
 */
const retryConfigSchema = z.strictObject({
  maxAttempts: z.number().int().min(1).optional(),
  baseDelayMs: z.number().int().min(0).optional(),
  maxDelayMs: z.number().int().min(0).optional(),
});

/**
 * Zod schema for optional overrides of the committed rate-limit table
 * (`src/rate-limit/rate-limits.ts`, Phase 5). Every field is independently optional;
 * an unset field falls back to the table's exported constant.
 */
const rateLimitConfigSchema = z.strictObject({
  readLimit: z.number().int().min(1).optional(),
  writeAggregateLimit: z.number().int().min(1).optional(),
  windowSeconds: z.number().int().min(1).optional(),
});

/**
 * Zod schema for validating {@link DattoRmmClientConfig}. `.strictObject` rejects any
 * unknown key, so a config carrying a retired `0.1.x` field (`autoRefresh`,
 * `validationMode`) or a never-supported one (`axiosInstance`) fails validation
 * immediately rather than being silently ignored.
 */
export const dattoRmmClientConfigSchema = z.strictObject({
  apiUrl: z
    .url({ message: "apiUrl must be a valid URL" })
    .describe(
      "Base URL of the Datto RMM API (e.g. https://zinfandel-api.centrastage.net)",
    ),
  apiKey: z
    .string()
    .min(1, "apiKey is required and cannot be empty")
    .describe("OAuth2 password-grant API key"),
  apiSecret: z
    .string()
    .min(1, "apiSecret is required and cannot be empty")
    .describe("OAuth2 password-grant API secret"),
  logger: dattoLoggerSchema
    .optional()
    .describe(
      "Optional structured logger. Every log call is routed through the UDF-masking decorator before reaching it, regardless of this setting.",
    ),
  userAgentExtra: z
    .string()
    .optional()
    .describe(
      "Optional suffix appended to the client's default User-Agent header.",
    ),
  tokenRefreshPct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      `Percentage of the token's original TTL remaining that triggers a proactive refresh. Default: ${DEFAULT_TOKEN_REFRESH_PCT}`,
    ),
  retry: retryConfigSchema
    .optional()
    .describe(
      `Optional retry-policy override for the HTTP transport. Unset fields fall back to DEFAULT_RETRY (${JSON.stringify(DEFAULT_RETRY)}).`,
    ),
  rateLimit: rateLimitConfigSchema
    .optional()
    .describe(
      "Optional overrides for the committed rate-limit table. Unset fields fall back to the table's exported constants.",
    ),
});

/**
 * Configuration for {@link DattoRmmClient} (`../client/datto-rmm-client.ts`, wired in Phase 7).
 * Type is inferred directly from {@link dattoRmmClientConfigSchema} to keep a single source of
 * truth.
 *
 * @example
 * ```typescript
 * const config: DattoRmmClientConfig = {
 *   apiUrl: 'https://zinfandel-api.centrastage.net',
 *   apiKey: 'my-api-key',
 *   apiSecret: 'my-api-secret',
 *   logger: myLogger,
 * };
 * ```
 */
export type DattoRmmClientConfig = z.infer<typeof dattoRmmClientConfigSchema>;
