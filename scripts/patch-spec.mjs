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
 *    discriminator does not match) is replaced with a permissive `@class`-tagged open object.
 *  - `ProxySettings` is split into a request-only clone (`ProxySettingsRequest`) so the two
 *    write sites that reference it no longer share a TS type with the (enum-bearing) response
 *    schema — see REQUEST_RESPONSE_SPLITS below for why this is necessary.
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
 * Every timestamp/alertContext/split correction fails loud (throws, non-zero exit) if its
 * expected anchor is missing, so a future spec refresh that moves or renames one of these fields
 * breaks `npm run generate` at this step instead of silently reshipping the defect. The two
 * malformed-keyword fixes are a general, spec-wide sweep rather than a fixed anchor list (the
 * defect is the malformed keyword combination itself, wherever it occurs), so they do not fail
 * loud on a zero count — a future spec that no longer has the defect is not drift, it's a fix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../spec/openapi.json");
const PATCHED_SPEC_PATH = resolve(__dirname, "../spec/openapi.patched.json");

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

function patchAlertContext(spec, missing) {
  const alertProps = spec.components?.schemas?.Alert?.properties;
  if (alertProps?.alertContext) {
    alertProps.alertContext = {
      type: "object",
      description:
        "Alert context; polymorphic on the wire's Jackson '@class' discriminator. The spec's " +
        "generated *Context schemas do not model the real property sets, so this is a " +
        "permissive open object rather than a oneOf.",
      properties: { "@class": { type: "string" } },
      additionalProperties: true,
    };
  } else {
    missing.push("Alert.alertContext");
  }
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
 * Walks every JSON-Schema node reachable from the spec's `components.schemas` and from every
 * operation's parameters/requestBody/response bodies, invoking `visit(node)` once per distinct
 * schema object. Does not follow `$ref` (component schemas are already walked directly, so
 * following refs would just revisit the same objects through a second path).
 */
function walkAllSchemaNodes(spec, visit) {
  const visitedNodes = new Set();

  function walkNode(node) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    visit(node);
    for (const propSchema of Object.values(node.properties ?? {}))
      walkNode(propSchema);
    if (node.items) walkNode(node.items);
    if (
      node.additionalProperties &&
      typeof node.additionalProperties === "object"
    ) {
      walkNode(node.additionalProperties);
    }
    for (const keyword of ["allOf", "oneOf", "anyOf"]) {
      for (const sub of node[keyword] ?? []) walkNode(sub);
    }
  }

  for (const schema of Object.values(spec.components?.schemas ?? {}))
    walkNode(schema);

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== "object") continue;
      for (const param of operation.parameters ?? []) {
        if (param?.schema) walkNode(param.schema);
      }
      const requestSchema =
        operation.requestBody?.content?.["application/json"]?.schema;
      if (requestSchema) walkNode(requestSchema);
      for (const response of Object.values(operation.responses ?? {})) {
        const responseSchema = response?.content?.["application/json"]?.schema;
        if (responseSchema) walkNode(responseSchema);
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

export function patchSpec(spec) {
  const missing = [];

  patchTimestamps(spec, missing);
  patchAlertContext(spec, missing);
  patchRequestResponseSplits(spec, missing);

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
