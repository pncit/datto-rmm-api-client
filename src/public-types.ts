/**
 * Hand-maintained, curated public type surface (R19, design "Public surface", plan Phase 8
 * Step 7).
 *
 * `src/index.ts` re-exports every name here — deliberately never a wildcard re-export of the
 * generated types module, which would (a) publish the raw, **pre-reconciliation** `Device`/`Alert`
 * shapes (literal `udf1…udf300` properties, the spec's dead `alertContext` shape) instead of the
 * reconciled runtime contract the resources actually validate and return, and (b) dump the entire
 * regeneration-volatile generated
 * surface — every `*Body`/`*Params`/`*Query`/internal envelope DTO, the ~28 now-unreferenced
 * `*Context` component schemas (silently no longer emitted as types at all, since the Phase 2
 * patch step's `alertContext` replacement leaves them unreachable from any operation) — as public
 * API, so a future spec/Orval rename becomes a silent breaking change with no diff-gate.
 *
 * Every name below is either:
 *  - a **reconciled** entity type or write-input type, sourced from `schema-overrides` (the
 *    `z.infer` single source of truth, already carrying the codemod-widened open-enum graft — see
 *    that module's `types.ts` doc), or
 *  - a **response DTO / request-body / query-params type** a resource method's public signature
 *    actually uses, for an entity `schema-overrides` does not touch — re-exported *by name* from
 *    `./generated/types` (never `export *`).
 *
 * Because every line below is a direct named re-export, a spec regeneration that renames or
 * removes one of these types fails `npm run typecheck` (a broken import) rather than silently
 * changing the published `1.0.0` surface — the enforcement is the re-export itself, not a
 * separate test. Keep this list synchronized with the ten `*Resource` classes' public method
 * signatures (`src/client/resources/*.ts`): every parameter/return type they name must resolve
 * here.
 */

// Reconciled entity types + write-input types (R5/R8 single source of truth).
export type {
  Device,
  Alert,
  DeviceUdfInput,
  DeviceWarrantyInput,
  SiteVariableCreateInput,
  SiteVariableUpdateInput,
  AccountVariableCreateInput,
  AccountVariableUpdateInput,
  SiteProxyInput,
} from "./schema-overrides";

// Response DTOs, request bodies, and query-params types for entities `schema-overrides` does not
// touch — re-exported by name (never `export *`) from the generated types.
export type { Account } from "./generated/types/account";
export type { ActivityLog } from "./generated/types/activityLog";
export type { AuthUser } from "./generated/types/authUser";
export type { AuthUserKey } from "./generated/types/authUserKey";
export type { Component } from "./generated/types/component";
export type { CreateQuickJobRequest } from "./generated/types/createQuickJobRequest";
export type { CreateQuickJobResponse } from "./generated/types/createQuickJobResponse";
export type { CreateSiteRequest } from "./generated/types/createSiteRequest";
export type { DeviceAudit } from "./generated/types/deviceAudit";
export type { DeviceNetworkInterface } from "./generated/types/deviceNetworkInterface";
export type { DnetSiteMappingsDto } from "./generated/types/dnetSiteMappingsDto";
export type { ESXiHostAudit } from "./generated/types/eSXiHostAudit";
export type { Filter } from "./generated/types/filter";
export type { Job } from "./generated/types/job";
export type { JobComponent } from "./generated/types/jobComponent";
export type { JobResults } from "./generated/types/jobResults";
export type { JobStdData } from "./generated/types/jobStdData";
export type { PaginationConfiguration } from "./generated/types/paginationConfiguration";
export type { PrinterAudit } from "./generated/types/printerAudit";
export type { RateStatusResponse } from "./generated/types/rateStatusResponse";
export type { Site } from "./generated/types/site";
export type { SiteRequest } from "./generated/types/siteRequest";
export type { SiteSettings } from "./generated/types/siteSettings";
export type { Software } from "./generated/types/software";
export type { StatusResponse } from "./generated/types/statusResponse";
export type { Variable } from "./generated/types/variable";

// Query-params types every paginated/optional-filter resource method accepts.
export type { GetAccountVariablesParams } from "./generated/types/getAccountVariablesParams";
export type { GetActivitiesParams } from "./generated/types/getActivitiesParams";
export type { GetComponentsParams } from "./generated/types/getComponentsParams";
export type { GetCustomFiltersParams } from "./generated/types/getCustomFiltersParams";
export type { GetDefaultsFiltersParams } from "./generated/types/getDefaultsFiltersParams";
export type { GetDeviceAuditSoftwareParams } from "./generated/types/getDeviceAuditSoftwareParams";
export type { GetDeviceOpenAlertsParams } from "./generated/types/getDeviceOpenAlertsParams";
export type { GetDeviceResolvedAlertsParams } from "./generated/types/getDeviceResolvedAlertsParams";
export type { GetDnetSiteMappingsParams } from "./generated/types/getDnetSiteMappingsParams";
export type { GetJobComponentsParams } from "./generated/types/getJobComponentsParams";
export type { GetSiteDeviceFiltersParams } from "./generated/types/getSiteDeviceFiltersParams";
export type { GetSiteDevicesParams } from "./generated/types/getSiteDevicesParams";
export type { GetSiteDevicesWithNetworkInterfaceParams } from "./generated/types/getSiteDevicesWithNetworkInterfaceParams";
export type { GetSiteOpenAlertsParams } from "./generated/types/getSiteOpenAlertsParams";
export type { GetSiteResolvedAlertsParams } from "./generated/types/getSiteResolvedAlertsParams";
export type { GetSitesParams } from "./generated/types/getSitesParams";
export type { GetSiteVariablesParams } from "./generated/types/getSiteVariablesParams";
export type { GetUserAccountClosedAlertsParams } from "./generated/types/getUserAccountClosedAlertsParams";
export type { GetUserAccountDevicesParams } from "./generated/types/getUserAccountDevicesParams";
export type { GetUserAccountOpenAlertsParams } from "./generated/types/getUserAccountOpenAlertsParams";
export type { GetUsersParams } from "./generated/types/getUsersParams";
