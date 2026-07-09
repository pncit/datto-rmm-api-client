import { z } from "zod";

import type { ActivityLog } from "../../generated/types/activityLog";
import type { GetActivitiesParams } from "../../generated/types/getActivitiesParams";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";

/**
 * `GET /api/v2/activity-logs`'s item schema (`ActivityLog`). A plain mirror of the generated
 * shape — no UDF/alertContext defect to reconcile — with one real spec enum field (`entity`,
 * `'DEVICE' | 'USER'`).
 *
 * `entity` degrades to passthrough at runtime the same way every enum node does under
 * `parseLenient` (Phase 4), independent of whether the entity is otherwise reconciled in
 * `schema-overrides/`. The generated `ActivityLog["entity"]` type is already codemod-widened
 * (`ActivityLogEntity | (string & {})`) while this hand-written schema's `z.enum([...])` is
 * authored closed — the same compile-time/runtime asymmetry `filter-schema.ts`'s `filterSchema`
 * documents for `Filter["type"]` — so `tests/generated/schema-mirror-pin.ts` pins this schema
 * against `ActivityLog` with **two** pins: a `keyof` pin over `entity` by key-set equality only
 * (so the enum field's presence/absence is still checked without a doomed-to-fail literal-enum
 * comparison), plus a full structural `Omit<ActivityLog, "entity">` pin covering every other
 * field — including the nested `site`/`user` objects and scalar types — which, unlike key-set
 * equality, also fails if a same-named field's type changes.
 *
 * @internal Exported only so `tests/generated/schema-mirror-pin.ts` can pin it against
 * `ActivityLog` — not resource API. The `src/index.ts` barrel must never `export *` from this
 * module.
 */
export const activityLogSchema = z.object({
  id: z.string().optional(),
  entity: z.enum(["DEVICE", "USER"]).optional(),
  category: z.string().optional(),
  action: z.string().optional(),
  date: z.number().optional(),
  site: z
    .object({
      id: z.number().optional(),
      name: z.string().optional(),
    })
    .optional(),
  deviceId: z.number().optional(),
  hostname: z.string().optional(),
  user: z
    .object({
      id: z.number().optional(),
      userName: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
  details: z.string().optional(),
  hasStdOut: z.boolean().optional(),
  hasStdErr: z.boolean().optional(),
});

/**
 * `client.activityLogs` (R1, R2, design "Public surface", plan Phase 8 Step 4: "activity log
 * reads (paginated)"): the account's activity log, genuinely tagged `-v2-activity-logs` (a single
 * operation) in the committed spec.
 */
export class ActivityLogResource extends BaseResource {
  /** `GET /api/v2/activity-logs` — the account's activity log entries, fully paginated. */
  async list(params?: GetActivitiesParams): Promise<ActivityLog[]> {
    const result = await this.paginate(
      "/api/v2/activity-logs",
      "activities",
      activityLogSchema,
      params,
      "GET /activity-logs",
    );
    return narrow<ActivityLog[]>(result);
  }
}
