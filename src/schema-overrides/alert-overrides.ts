import { z } from "zod";

import { getAlertResponse } from "../generated/schemas/-v2-alert/-v2-alert.zod";

/**
 * The reconciled `alertContext` schema (R8): a permissive, `@class`-tagged open object matching
 * the Phase-2 spec patch (`Alert.alertContext` → `{ type: 'object', properties: { '@class':
 * {type:'string'} }, additionalProperties: true }`). Reality uses a Jackson `@class` discriminator
 * (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`, …) whose real property sets match none of the
 * spec's ~30 dead `*Context` schemas (design "Current State"), so this stays a genuinely open
 * object rather than a `oneOf`/discriminated union.
 *
 * Orval's zod target does not translate the patched spec's `additionalProperties: true` into a
 * `.catchall()` — the generated `getAlertResponse.alertContext` (`-v2-alert.zod.ts`) is `z.object({
 * '@class': z.string().optional() })` with **no** catchall, silently closed to any other key. This
 * override adds the catchall the patch step's `additionalProperties: true` actually means, so an
 * alert's real context fields (whatever `@class` value they accompany) survive validation instead
 * of being the one property this open object happens to declare.
 */
export const alertContextSchema = z
  .object({ "@class": z.string().optional() })
  .catchall(z.unknown());

/**
 * The reconciled `Alert` response schema: the generated `getAlertResponse` (`GET
 * /api/v2/alert/{uid}`, `-v2-alert.zod.ts`) with its `alertContext` field re-composed onto
 * {@link alertContextSchema}. Reused for every Alert-shaped response (open/resolved alert lists
 * walked by `paginate`, device/site-scoped alert lists) — the same reconciled entity everywhere.
 */
export const alertResponseSchema = getAlertResponse.extend({
  alertContext: alertContextSchema
    .optional()
    .describe(
      "Alert context; polymorphic on the wire's Jackson '@class' discriminator.",
    ),
});

/**
 * Every top-level `Alert` field whose subtree contains an open (codemod-widened) response enum at
 * any depth: the top-level `priority`, and `responseActions` (each element's own `actionType` is
 * an enum — design "25 enums… are present and accurate"). See `./device-overrides.ts`'s
 * `DEVICE_WIDENED_FIELDS` doc for why the *containing* top-level field, not the nested enum
 * itself, is what's listed here.
 */
export const ALERT_WIDENED_FIELDS = ["priority", "responseActions"] as const;
