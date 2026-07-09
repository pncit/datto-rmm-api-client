import { z } from "zod";

/**
 * The "Variable" item schema shared by every collection this phase's resources validate that
 * walks a `{ pageDetails, variables }` envelope (`AccountResource.variables`,
 * `SiteResource.variables`).
 *
 * Unlike `Device`/`Site`/`Alert` — each of which has a standalone single-entity `GET` endpoint
 * (`getByUid`, `getSite`, `getAlert`) whose generated response schema a paginated list's item
 * schema can reuse verbatim — Datto's spec declares no single-variable `GET` endpoint. Orval
 * therefore inlines the identical `{ id?, name?, value?, masked? }` shape independently inside
 * both `getAccountVariablesResponse` (`-v2-account.zod.ts`) and `getSiteVariablesResponse`
 * (`-v2-site.zod.ts`) — two separately-generated schema objects with no shared identity. Hand
 * -writing this once and importing it from both `AccountResource` and `SiteResource` avoids
 * validating against two independently-generated, differently-named duplicates of the same
 * entity: the same "tag file's own duplicate" hazard `device-overrides.ts` documents for
 * `Device`, applied to the one other entity this phase's resources share across namespaces.
 *
 * No reconciliation is needed here (unlike `Device`/`Alert`, which correct a real production
 * defect): a `Variable` carries no UDF/alertContext-style defect, so this is a plain mirror of
 * the generated `Variable` type's shape, not an override — it does not belong in
 * `src/schema-overrides/`, which is reserved for correcting a known production defect (R8), not
 * merely deduplicating an identically-shaped generated schema.
 */
export const variableSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  masked: z.boolean().optional(),
});
