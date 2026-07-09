#!/usr/bin/env node
/**
 * Spec patch step — the first stage of `npm run generate`.
 *
 * Reads the committed, frozen `spec/openapi.json` and writes the transient
 * `spec/openapi.patched.json` that Orval actually consumes, applying deterministic
 * structural corrections generation cannot infer on its own:
 *
 *  - Known timestamp properties typed `string`/`date-time` are retyped to `integer`/`int64`
 *    (Datto returns epoch-ms at runtime, not ISO strings).
 *  - `Alert.alertContext`'s `oneOf` (a `*Context` fan-out the wire's Jackson `@class`
 *    discriminator does not match) is replaced with a permissive `@class`-tagged open object;
 *    the now-dead `*Context` schemas that oneOf was the only reference to are pruned (see
 *    `pruneOrphanedContextSchemas`).
 *  - `ProxySettings` is split into a request-only clone (`ProxySettingsRequest`) so the two
 *    write sites that reference it no longer share a TS type with the (enum-bearing) response
 *    schema — see REQUEST_RESPONSE_SPLITS below for why this is necessary.
 *  - Operations whose spec `responses` has no `200`/`204` entry but has the real success schema
 *    misattached to an error code get a synthesized `200` (see `patchMissingSuccessResponses`).
 *  - Two classes of malformed JSON-Schema keyword usage that Orval's zod generator translates
 *    into TypeScript that does not compile are stripped spec-wide (see
 *    `fixMalformedNonStringConstraints`): a `pattern` on a non-`string` schema (Orval emits
 *    `.regex()`, which does not exist on `ZodNumber`/`ZodBoolean`/etc.), and a redundant
 *    top-level `enum` on an `array`-typed schema that already carries the real enum on `items`
 *    (Orval chains `.enum(...)` onto the already-built `zod.array(...)`, which is not a
 *    `ZodArray` method). The array-enum fix only deletes the top-level `enum` when `items` genuinely
 *    carries its own `enum` — the precondition that makes the top-level one redundant; an
 *    array-typed schema whose only enum constraint sits at the array level (no `items.enum`) is
 *    left untouched, since deleting it there would silently change the constraint rather than
 *    remove a duplicate. Both classes are confirmed, as-is, in the committed `spec/openapi.json`
 *    (`ActivityLog.date`, the `entities` query parameter of `GET /v2/activity-logs`) — found by
 *    actually running `npm run generate` + `npm run typecheck` against the real spec, not
 *    anticipated in advance.
 *
 * Every timestamp/alertContext/split/missing-response correction fails loud (throws, non-zero
 * exit) if its expected anchor is missing or drifts from what it expects, so a future spec
 * refresh that renames/relocates one of these fields breaks `npm run generate` at this step
 * instead of silently reshipping the defect. The two malformed-keyword fixes are a general,
 * spec-wide sweep rather than a fixed anchor list (the defect is the malformed keyword
 * combination itself, wherever it occurs), so they do not fail loud on a zero count — a future
 * spec that no longer has the defect is not drift, it's a fix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { walkSchema } from "./lib/schema-walk.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../spec/openapi.json");
const PATCHED_SPEC_PATH = resolve(__dirname, "../spec/openapi.patched.json");

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
];

/**
 * Component-schema timestamp fields Datto's spec documents as `string`/`date-time` but that
 * are epoch-ms integers in every observed real response.
 */
export const TIMESTAMP_FIELDS = {
  Device: ["lastSeen", "lastReboot", "lastAuditDate", "creationDate"],
  AuthUser: ["created", "lastAccess"],
  Alert: ["timestamp", "resolvedOn"],
};

/**
 * Shared-schema splits: a component schema referenced by both a requestBody (directly or
 * nested) and a response, where the shared schema declares an `enum`. Left alone, the
 * enum-widening codemod (scripts/widen-response-enums.mjs) would have to choose between
 * widening the shared TS type (silently loosening the compile-time request contract) or
 * leaving it closed (silently keeping the response type closed, reviving the R5 hazard) — it
 * cannot do both for one shared type. The fix is structural: give the request side its own
 * component schema so the two are no longer the same generated TS type.
 *
 * Confirmed by a full transitive $ref scan of spec/openapi.json (properties/items/allOf/oneOf/
 * anyOf/additionalProperties, cycle-safe): `ProxySettings.type` (enum `http|socks4|socks5`) is
 * the one such case in the current spec — reached directly by `POST
 * /v2/site/{siteUid}/settings/proxy`'s requestBody and, nested one level, by `PUT /v2/site`'s
 * `CreateSiteRequest.properties.proxySettings`; and reached from the response side by `GET
 * /v2/site/{siteUid}`, `GET /v2/site/{siteUid}/settings`, and `GET /v2/account/sites`. Every
 * other shared component (`Udf`, `JobComponentVariable`) carries no `enum`, so it is left alone
 * (widening is a no-op on an enum-free schema; splitting it would be unnecessary churn).
 *
 * Each entry names the shared schema, the new request-only clone's name (matching this spec's
 * own `*Request` naming convention — see `CreateSiteRequest`/`SiteRequest`/
 * `CreateQuickJobRequest`/`Variable Creation Request`/`Variable Update Request`, none of which
 * are ever reached from a response), and the exact JSON-pointer-style paths (as arrays of keys)
 * to the `$ref` nodes that must be retargeted from the shared schema to the clone.
 */
export const REQUEST_RESPONSE_SPLITS = [
  {
    sharedSchema: "ProxySettings",
    requestSchema: "ProxySettingsRequest",
    refLocations: [
      [
        "paths",
        "/v2/site/{siteUid}/settings/proxy",
        "post",
        "requestBody",
        "content",
        "application/json",
        "schema",
      ],
      [
        "components",
        "schemas",
        "CreateSiteRequest",
        "properties",
        "proxySettings",
      ],
    ],
  },
];

/**
 * Component schemas expected to become unreferenced once `patchAlertContext` replaces
 * `Alert.alertContext`'s `oneOf` with the permissive open object: the concrete `*Context`
 * variant schemas the old `oneOf` branched on, plus their common `AlertContext` base (itself
 * only ever `$ref`'d, via `allOf`, by those variants). Verified against the real spec: every
 * one of these is `$ref`'d from nowhere but the old `alertContext` `oneOf` (or, for
 * `AlertContext`, from nowhere but those variants' own `allOf`) — deleting them removes 28 dead
 * component schemas Orval would otherwise faithfully generate and export as committed types for
 * no operation to ever reach. See `pruneOrphanedContextSchemas` for the fail-loud anchoring.
 */
export const EXPECTED_ORPHANED_COMPONENTS = [
  "AlertContext",
  "ActionContext",
  "AntivirusContext",
  "BackupManagementContext",
  "CustomSNMPContext",
  "DiskHealthContext",
  "DiskUsageContext",
  "EndpointSecurityThreatContext",
  "EndpointSecurityWindowsDefenderContext",
  "EventLogContext",
  "FanContext",
  "FileSystemContext",
  "NetworkMonitorContext",
  "OnlineOfflineStatusContext",
  "PatchContext",
  "PingContext",
  "PrinterContext",
  "PsuContext",
  "RansomWareContext",
  "ResourceUsageContext",
  "SNMPProbeContext",
  "ScriptContext",
  "SecCenterContext",
  "SecurityManagementContext",
  "StatusContext",
  "TemperatureContext",
  "WindowsPerformanceContext",
  "WmiContext",
];

/**
 * Operations whose `responses` has no `200`/`204` entry and whose error-code responses
 * (`400`/`401`/`403`/`404`) carry no schema either — verified directly against the real spec:
 * every one of these writes returns no body on success. Consulted only when
 * `patchMissingSuccessResponses` finds no inferable schema for an operation: membership here is
 * what lets that operation pass as an intentional void write instead of failing loud as an
 * undocumented gap. A future spec refresh that gives one of these operations a real response body
 * is handled automatically (it no longer has zero schemas, so this list is never consulted for
 * it); a refresh that puts some *other*, undocumented operation into the same no-schema state
 * fails loud until that operation is reviewed and added here.
 */
export const VOID_WRITE_OPERATIONS = [
  "PUT /v2/site/{siteUid}/variable",
  "PUT /v2/device/{deviceUid}/site/{siteUid}",
  "PUT /v2/account/variable",
  "POST /v2/site/{siteUid}/variable/{variableId}",
  "DELETE /v2/site/{siteUid}/variable/{variableId}",
  "POST /v2/device/{deviceUid}/warranty",
  "POST /v2/device/{deviceUid}/udf",
  "POST /v2/alert/{alertUid}/resolve",
  "POST /v2/account/variable/{variableId}",
  "DELETE /v2/account/variable/{variableId}",
];

function refName(ref) {
  return ref.replace("#/components/schemas/", "");
}

function getAtPath(root, path) {
  let node = root;
  for (const key of path) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

function patchTimestamps(spec, missing) {
  for (const [schemaName, fields] of Object.entries(TIMESTAMP_FIELDS)) {
    const props = spec.components?.schemas?.[schemaName]?.properties;
    for (const field of fields) {
      const prop = props?.[field];
      if (prop) {
        prop.type = "integer";
        prop.format = "int64";
        delete prop.enum;
      } else {
        missing.push(`${schemaName}.${field}`);
      }
    }
  }
}

/**
 * Replaces `Alert.alertContext` with the permissive `@class`-tagged open object.
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @param {string[]} missing
 * @returns {string[]} the component names the old `oneOf` `$ref`'d (before it was overwritten),
 *   for `pruneOrphanedContextSchemas` to consider — empty if `alertContext` was missing (already
 *   recorded in `missing`) or had no `oneOf`.
 */
function patchAlertContext(spec, missing) {
  const alertProps = spec.components?.schemas?.Alert?.properties;
  if (!alertProps?.alertContext) {
    missing.push("Alert.alertContext");
    return [];
  }

  const oldOneOf = Array.isArray(alertProps.alertContext.oneOf)
    ? alertProps.alertContext.oneOf
    : [];
  const oldContextNames = oldOneOf
    .map((branch) =>
      typeof branch?.$ref === "string" ? refName(branch.$ref) : undefined,
    )
    .filter((name) => name !== undefined);

  alertProps.alertContext = {
    type: "object",
    description:
      "Alert context; polymorphic on the wire's Jackson '@class' discriminator. The spec's " +
      "generated *Context schemas do not model the real property sets, so this is a " +
      "permissive open object rather than a oneOf.",
    properties: { "@class": { type: "string" } },
    additionalProperties: true,
  };

  return oldContextNames;
}

function patchRequestResponseSplits(spec, missing) {
  for (const {
    sharedSchema,
    requestSchema,
    refLocations,
  } of REQUEST_RESPONSE_SPLITS) {
    const sharedNode = spec.components?.schemas?.[sharedSchema];
    if (!sharedNode) {
      missing.push(`components.schemas.${sharedSchema}`);
      continue;
    }

    for (const path of refLocations) {
      const node = getAtPath(spec, path);
      const expectedRef = `#/components/schemas/${sharedSchema}`;
      if (!node || node.$ref !== expectedRef) {
        missing.push(`${path.join(".")} (expected $ref: ${expectedRef})`);
        continue;
      }
      node.$ref = `#/components/schemas/${requestSchema}`;
    }

    // Clone after rewriting refLocations so the clone itself isn't touched by the rewrite above.
    spec.components.schemas[requestSchema] = structuredClone(sharedNode);
  }
}

/**
 * Every `#/components/schemas/*` name reachable, transitively through `$ref`, from some
 * operation's parameters, requestBody, or any response (any code, any content type) — the same
 * "does anything still use this?" question `pruneOrphanedContextSchemas` and
 * `patchMissingSuccessResponses` each need answered, computed once here.
 */
function computeReachableComponentNames(spec) {
  const schemas = spec.components?.schemas ?? {};
  const reachable = new Set();

  function followRefs(node) {
    walkSchema(
      node,
      (subNode) => {
        if (typeof subNode.$ref === "string") {
          const name = refName(subNode.$ref);
          if (!reachable.has(name)) {
            reachable.add(name);
            followRefs(schemas[name]);
          }
        }
      },
      new Set(),
    );
  }

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (
        !HTTP_METHODS.includes(method) ||
        !operation ||
        typeof operation !== "object"
      )
        continue;
      for (const param of operation.parameters ?? []) {
        if (param?.schema) followRefs(param.schema);
      }
      for (const content of Object.values(
        operation.requestBody?.content ?? {},
      )) {
        if (content?.schema) followRefs(content.schema);
      }
      for (const response of Object.values(operation.responses ?? {})) {
        for (const content of Object.values(response?.content ?? {})) {
          if (content?.schema) followRefs(content.schema);
        }
      }
    }
  }

  return reachable;
}

/**
 * Deletes the component schemas `patchAlertContext`'s rewrite orphaned — scoped strictly to the
 * schemas the old `alertContext` `oneOf` itself `$ref`'d (plus their own `allOf` bases,
 * transitively), never a whole-spec "delete anything unreachable" sweep: a shared component like
 * `ProxySettings` can legitimately lose reachability from one ref location (the
 * request/response split above) while staying reachable via others, and this function must never
 * touch schemas outside the alertContext blast radius.
 *
 * Anchored and fail-loud: a candidate that is *not* in `EXPECTED_ORPHANED_COMPONENTS` is not
 * deleted — it is reported as drift, since silently deleting a component schema nobody
 * documented reviewing is exactly the "known defect corrected deterministically" failure mode
 * this whole patch step exists to avoid, not create. A candidate still reachable some other way
 * (e.g. a future spec starts referencing one of these schemas again) is simply left alone.
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @param {string[]} oldContextNames the component names `patchAlertContext`'s old `oneOf` `$ref`'d
 * @param {string[]} missing
 * @returns {void}
 */
function pruneOrphanedContextSchemas(spec, oldContextNames, missing) {
  if (oldContextNames.length === 0) return;

  const schemas = spec.components?.schemas ?? {};
  const candidates = new Set(oldContextNames.filter((name) => schemas[name]));
  const queue = [...candidates];
  while (queue.length > 0) {
    const name = queue.shift();
    for (const sub of schemas[name]?.allOf ?? []) {
      if (typeof sub.$ref !== "string") continue;
      const baseName = refName(sub.$ref);
      if (schemas[baseName] && !candidates.has(baseName)) {
        candidates.add(baseName);
        queue.push(baseName);
      }
    }
  }

  const reachable = computeReachableComponentNames(spec);
  const orphaned = [...candidates].filter((name) => !reachable.has(name)).sort();

  for (const name of orphaned) {
    if (!EXPECTED_ORPHANED_COMPONENTS.includes(name)) {
      missing.push(
        `components.schemas.${name} (newly unreferenced after the alertContext patch, but ` +
          `not documented in EXPECTED_ORPHANED_COMPONENTS — review before pruning)`,
      );
      continue;
    }
    delete schemas[name];
  }
}

function responseSchema(response) {
  const content = response?.content;
  if (!content) return undefined;
  return content["application/json"]?.schema ?? content["*/*"]?.schema;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}

/**
 * For every operation whose `responses` has no `200`/`204` entry, synthesizes one from the
 * operation's own error-code responses when it safely can, and fails loud otherwise.
 *
 * Datto's spec has a systemic documentation bug: for most operations there is no `200`/`204`
 * entry at all — the real success schema is instead misattached to an error code (`400`/`401`/
 * `403`/`404`), consistently the *same* schema across every error code that carries one for a
 * given operation (verified directly against the real spec: zero operations have conflicting
 * schemas across their error-code responses). Left uncorrected, Orval's zod target — which only
 * emits a runtime response validator when an operation's own `200`/`204` entry has a schema —
 * generates zero response schemas for these operations, even though the `types` target (which
 * generates per-component, not per-response-code) generates the DTOs fine; downstream schema
 * composition and typed response parsing (Phase 6/7) need the zod schema too.
 *
 * Three outcomes per operation missing `200`/`204`:
 *  - **Exactly one distinct schema** across its error-code responses: synthesize a `200` using
 *    that schema. This is the common case (verified: the large majority of affected operations).
 *  - **No schema anywhere**: a legitimate void write (verified: every remaining case really does
 *    return no body on success, matching the write's expected semantics). Left alone *only* if
 *    the operation is in the documented `VOID_WRITE_OPERATIONS` anchor list; otherwise this is
 *    reported as drift (an operation with no inferable response that nobody has reviewed) rather
 *    than silently treated as intentional.
 *  - **More than one distinct schema** across error codes: cannot safely pick one automatically;
 *    reported as drift naming the operation (none exist in the current spec).
 *
 * An operation with no `responses` object at all is skipped entirely — a minimal spec fragment
 * genuinely missing that OpenAPI-required field is a different, out-of-scope validity problem,
 * not the misattached-schema defect this function corrects. `VOID_WRITE_OPERATIONS` membership is
 * checked only in the forward direction (an unlisted no-schema operation is drift); a spec that
 * simply doesn't declare one of the documented void-write paths (e.g. a minimal test fragment, or
 * a future spec where that operation gained a real response) is not itself drift — the forward
 * check already catches the only unsafe outcome (silently treating an unreviewed operation as
 * void).
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @param {string[]} missing
 * @returns {void}
 */
function patchMissingSuccessResponses(spec, missing) {
  for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (
        !HTTP_METHODS.includes(method) ||
        !operation ||
        typeof operation !== "object"
      )
        continue;

      const responses = operation.responses;
      if (!responses || responses["200"] || responses["204"]) continue;

      const opLabel = `${method.toUpperCase()} ${pathKey}`;
      const distinctSchemas = [];
      for (const response of Object.values(responses)) {
        const schema = responseSchema(response);
        if (schema && !distinctSchemas.some((s) => deepEqual(s, schema))) {
          distinctSchemas.push(schema);
        }
      }

      if (distinctSchemas.length === 1) {
        responses["200"] = {
          description:
            "OK (success response synthesized from the spec's misattached error-code " +
            "schema — see patch-spec.mjs's patchMissingSuccessResponses)",
          content: {
            "application/json": { schema: structuredClone(distinctSchemas[0]) },
          },
        };
      } else if (distinctSchemas.length === 0) {
        if (!VOID_WRITE_OPERATIONS.includes(opLabel)) {
          missing.push(
            `${opLabel} (no 200/204 and no inferable response schema; not a documented ` +
              `void write in VOID_WRITE_OPERATIONS)`,
          );
        }
      } else {
        missing.push(
          `${opLabel} (no 200/204; ${distinctSchemas.length} inconsistent response schemas ` +
            `across error codes, cannot synthesize)`,
        );
      }
    }
  }
}

/**
 * Walks every JSON-Schema node reachable from the spec's `components.schemas` and from every
 * operation's parameters/requestBody/response bodies, invoking `visit(node)` once per distinct
 * schema object. Does not follow `$ref` (component schemas are already walked directly, so
 * following refs would just revisit the same objects through a second path).
 */
function walkAllSchemaNodes(spec, visit) {
  const visited = new Set();

  for (const schema of Object.values(spec.components?.schemas ?? {})) {
    walkSchema(schema, visit, visited);
  }

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== "object") continue;
      for (const param of operation.parameters ?? []) {
        if (param?.schema) walkSchema(param.schema, visit, visited);
      }
      const requestSchema =
        operation.requestBody?.content?.["application/json"]?.schema;
      if (requestSchema) walkSchema(requestSchema, visit, visited);
      for (const response of Object.values(operation.responses ?? {})) {
        const responseBodySchema =
          response?.content?.["application/json"]?.schema;
        if (responseBodySchema) walkSchema(responseBodySchema, visit, visited);
      }
    }
  }
}

/**
 * Strips two classes of malformed keyword usage — see the module doc — spec-wide. Returns the
 * counts fixed (for logging); never fails loud, since there is no fixed anchor list, only a
 * malformed-condition sweep.
 */
function fixMalformedNonStringConstraints(spec) {
  let patternOnNonStringFixed = 0;
  let redundantArrayEnumFixed = 0;

  walkAllSchemaNodes(spec, (node) => {
    if (
      typeof node.pattern === "string" &&
      typeof node.type === "string" &&
      node.type !== "string"
    ) {
      delete node.pattern;
      patternOnNonStringFixed++;
    }
    if (
      node.type === "array" &&
      Array.isArray(node.enum) &&
      Array.isArray(node.items?.enum)
    ) {
      delete node.enum;
      redundantArrayEnumFixed++;
    }
  });

  return { patternOnNonStringFixed, redundantArrayEnumFixed };
}

/**
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @returns {import('./lib/schema-walk.mjs').OpenApiSpecFragment}
 */
export function patchSpec(spec) {
  const missing = [];

  patchTimestamps(spec, missing);
  const oldContextNames = patchAlertContext(spec, missing);
  patchRequestResponseSplits(spec, missing);
  patchMissingSuccessResponses(spec, missing);
  pruneOrphanedContextSchemas(spec, oldContextNames, missing);

  if (missing.length > 0) {
    throw new Error(
      `patch-spec: missing expected schema fields: ${missing.join(", ")}`,
    );
  }

  fixMalformedNonStringConstraints(spec);

  return spec;
}

function main() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const patched = patchSpec(spec);
  writeFileSync(
    PATCHED_SPEC_PATH,
    JSON.stringify(patched, null, 2) + "\n",
    "utf8",
  );
  console.log(`patch-spec: wrote ${PATCHED_SPEC_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
