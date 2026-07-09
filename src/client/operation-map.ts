/**
 * The authoritative `{ method, path } -> client.<ns>.<method>` mapping table (R1, plan Phase 8
 * Step 8 "coverage-map test"): one entry per operation in the committed `spec/openapi.json`,
 * naming the exact `DattoRmmClient` namespace and resource method that implements it.
 *
 * `tests/unit/client/coverage-map.test.ts` is this table's only consumer. It (a) asserts this
 * table covers every `(method, path)` the committed spec declares **exactly once** — no spec
 * operation unmapped, no duplicate/omission slipping past a raw count — and (b) drives each
 * mapped method through a `nock` intercept scoped to its exact verb + path to prove the mapping
 * matches the real implementation, not just its own say-so. A bare operation *count* would pass
 * even if one namespace duplicated an operation while omitting another; this table, checked
 * against the spec's actual `(method, path)` set, cannot.
 *
 * **`specPath` is copied verbatim from the spec's own `paths` keys** (e.g. `/v2/site/{siteUid}`,
 * no `/api` prefix — every resource method's real request path prepends `/api` to this, which
 * `coverage-map.test.ts` accounts for when building its nock intercepts). Kept as a literal
 * spec-shaped path (not the concrete `/api/v2/...` request path) so this table reads as a direct,
 * side-by-side transcription of the spec's own `paths` object — the thing it is authoritative
 * against — rather than a derived/rewritten form a reader would have to mentally reverse to
 * cross-check.
 *
 * **Maintenance:** a spec refresh that adds, removes, or moves an operation must update this table
 * in the same change — `coverage-map.test.ts`'s first assertion (map-vs-spec set equality) fails
 * loudly otherwise, so an omission cannot silently ship.
 */

/** The ten `DattoRmmClient` namespace keys an {@link OperationMapEntry} may name. */
export type ResourceNamespace =
  | "account"
  | "sites"
  | "devices"
  | "alerts"
  | "jobs"
  | "audit"
  | "filters"
  | "users"
  | "activityLogs"
  | "system";

/** One row of the operation-coverage table. */
export interface OperationMapEntry {
  /** HTTP method exactly as declared in the committed spec's `paths[specPath]` object. */
  readonly specMethod: "get" | "post" | "put" | "delete";
  /** Path exactly as declared in the committed spec's `paths` object (no `/api` prefix). */
  readonly specPath: string;
  /** The `DattoRmmClient` namespace this operation is mounted under. */
  readonly ns: ResourceNamespace;
  /** The resource method name implementing this operation. */
  readonly method: string;
}

export const OPERATION_MAP: readonly OperationMapEntry[] = [
  // account (-v2-account tag) — 12 spec operations, three rehomed to other namespaces
  // (getSites -> sites.list, getUserAccountOpenAlerts -> alerts.open,
  // getUserAccountClosedAlerts -> alerts.resolved) and one to users.list (getUsers), per
  // AccountResource's own doc (concept-over-tag grouping).
  { specMethod: "get", specPath: "/v2/account", ns: "account", method: "get" },
  {
    specMethod: "get",
    specPath: "/v2/account/alerts/open",
    ns: "alerts",
    method: "open",
  },
  {
    specMethod: "get",
    specPath: "/v2/account/alerts/resolved",
    ns: "alerts",
    method: "resolved",
  },
  {
    specMethod: "get",
    specPath: "/v2/account/components",
    ns: "account",
    method: "components",
  },
  {
    specMethod: "get",
    specPath: "/v2/account/devices",
    ns: "account",
    method: "devices",
  },
  {
    specMethod: "get",
    specPath: "/v2/account/dnet-site-mappings",
    ns: "account",
    method: "dnetSiteMappings",
  },
  { specMethod: "get", specPath: "/v2/account/sites", ns: "sites", method: "list" },
  { specMethod: "get", specPath: "/v2/account/users", ns: "users", method: "list" },
  {
    specMethod: "get",
    specPath: "/v2/account/variables",
    ns: "account",
    method: "variables",
  },
  {
    specMethod: "post",
    specPath: "/v2/account/variable/{variableId}",
    ns: "account",
    method: "updateVariable",
  },
  {
    specMethod: "put",
    specPath: "/v2/account/variable",
    ns: "account",
    method: "createVariable",
  },
  {
    specMethod: "delete",
    specPath: "/v2/account/variable/{variableId}",
    ns: "account",
    method: "deleteVariable",
  },

  // activity-logs (-v2-activity-logs tag) — 1 operation
  {
    specMethod: "get",
    specPath: "/v2/activity-logs",
    ns: "activityLogs",
    method: "list",
  },

  // alert (-v2-alert tag) — 4 operations, genuinely tagged alert
  { specMethod: "get", specPath: "/v2/alert/{alertUid}", ns: "alerts", method: "get" },
  {
    specMethod: "post",
    specPath: "/v2/alert/{alertUid}/mute",
    ns: "alerts",
    method: "mute",
  },
  {
    specMethod: "post",
    specPath: "/v2/alert/{alertUid}/resolve",
    ns: "alerts",
    method: "resolve",
  },
  {
    specMethod: "post",
    specPath: "/v2/alert/{alertUid}/unmute",
    ns: "alerts",
    method: "unmute",
  },

  // audit (-v2-audit tag) — 5 operations
  {
    specMethod: "get",
    specPath: "/v2/audit/device/macAddress/{macAddress}",
    ns: "audit",
    method: "getDeviceAuditByMacAddress",
  },
  {
    specMethod: "get",
    specPath: "/v2/audit/device/{deviceUid}",
    ns: "audit",
    method: "getDeviceAudit",
  },
  {
    specMethod: "get",
    specPath: "/v2/audit/device/{deviceUid}/software",
    ns: "audit",
    method: "getDeviceAuditSoftware",
  },
  {
    specMethod: "get",
    specPath: "/v2/audit/esxihost/{deviceUid}",
    ns: "audit",
    method: "getEsxiHostAudit",
  },
  {
    specMethod: "get",
    specPath: "/v2/audit/printer/{deviceUid}",
    ns: "audit",
    method: "getPrinterAudit",
  },

  // device (-v2-device tag) — 9 operations, two rehomed to alerts (concept-over-tag grouping)
  {
    specMethod: "get",
    specPath: "/v2/device/id/{deviceId}",
    ns: "devices",
    method: "getById",
  },
  {
    specMethod: "get",
    specPath: "/v2/device/macAddress/{macAddress}",
    ns: "devices",
    method: "getByMacAddress",
  },
  { specMethod: "get", specPath: "/v2/device/{deviceUid}", ns: "devices", method: "get" },
  {
    specMethod: "get",
    specPath: "/v2/device/{deviceUid}/alerts/open",
    ns: "alerts",
    method: "openForDevice",
  },
  {
    specMethod: "get",
    specPath: "/v2/device/{deviceUid}/alerts/resolved",
    ns: "alerts",
    method: "resolvedForDevice",
  },
  {
    specMethod: "post",
    specPath: "/v2/device/{deviceUid}/udf",
    ns: "devices",
    method: "setUdf",
  },
  {
    specMethod: "post",
    specPath: "/v2/device/{deviceUid}/warranty",
    ns: "devices",
    method: "setWarranty",
  },
  {
    specMethod: "put",
    specPath: "/v2/device/{deviceUid}/quickjob",
    ns: "devices",
    method: "createJob",
  },
  {
    specMethod: "put",
    specPath: "/v2/device/{deviceUid}/site/{siteUid}",
    ns: "devices",
    method: "move",
  },

  // filter (-v2-filter tag) — 2 operations
  {
    specMethod: "get",
    specPath: "/v2/filter/custom-filters",
    ns: "filters",
    method: "custom",
  },
  {
    specMethod: "get",
    specPath: "/v2/filter/default-filters",
    ns: "filters",
    method: "defaults",
  },

  // job (-v2-job tag) — 5 operations, all genuinely tagged job
  { specMethod: "get", specPath: "/v2/job/{jobUid}", ns: "jobs", method: "get" },
  {
    specMethod: "get",
    specPath: "/v2/job/{jobUid}/components",
    ns: "jobs",
    method: "getComponents",
  },
  {
    specMethod: "get",
    specPath: "/v2/job/{jobUid}/results/{deviceUid}",
    ns: "jobs",
    method: "getResults",
  },
  {
    specMethod: "get",
    specPath: "/v2/job/{jobUid}/results/{deviceUid}/stderr",
    ns: "jobs",
    method: "getStdErr",
  },
  {
    specMethod: "get",
    specPath: "/v2/job/{jobUid}/results/{deviceUid}/stdout",
    ns: "jobs",
    method: "getStdOut",
  },

  // site (-v2-site tag) — 15 operations, two rehomed to alerts; getSites (above) rehomed IN
  // from account.
  {
    specMethod: "delete",
    specPath: "/v2/site/{siteUid}/settings/proxy",
    ns: "sites",
    method: "deleteProxy",
  },
  {
    specMethod: "delete",
    specPath: "/v2/site/{siteUid}/variable/{variableId}",
    ns: "sites",
    method: "deleteVariable",
  },
  { specMethod: "get", specPath: "/v2/site/{siteUid}", ns: "sites", method: "get" },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/alerts/open",
    ns: "alerts",
    method: "openForSite",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/alerts/resolved",
    ns: "alerts",
    method: "resolvedForSite",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/devices",
    ns: "sites",
    method: "devices",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/devices/network-interface",
    ns: "sites",
    method: "devicesWithNetworkInterface",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/filters",
    ns: "sites",
    method: "deviceFilters",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/settings",
    ns: "sites",
    method: "settings",
  },
  {
    specMethod: "get",
    specPath: "/v2/site/{siteUid}/variables",
    ns: "sites",
    method: "variables",
  },
  { specMethod: "post", specPath: "/v2/site/{siteUid}", ns: "sites", method: "update" },
  {
    specMethod: "post",
    specPath: "/v2/site/{siteUid}/settings/proxy",
    ns: "sites",
    method: "updateProxy",
  },
  {
    specMethod: "post",
    specPath: "/v2/site/{siteUid}/variable/{variableId}",
    ns: "sites",
    method: "updateVariable",
  },
  { specMethod: "put", specPath: "/v2/site", ns: "sites", method: "create" },
  {
    specMethod: "put",
    specPath: "/v2/site/{siteUid}/variable",
    ns: "sites",
    method: "createVariable",
  },

  // system (-v2-system tag) — 3 operations
  {
    specMethod: "get",
    specPath: "/v2/system/pagination",
    ns: "system",
    method: "paginationConfiguration",
  },
  {
    specMethod: "get",
    specPath: "/v2/system/request_rate",
    ns: "system",
    method: "requestRate",
  },
  { specMethod: "get", specPath: "/v2/system/status", ns: "system", method: "status" },

  // user (-v2-user tag) — 1 operation
  {
    specMethod: "post",
    specPath: "/v2/user/resetApiKeys",
    ns: "users",
    method: "resetKeys",
  },
] as const;
