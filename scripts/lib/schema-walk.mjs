#!/usr/bin/env node
/**
 * Shared JSON-Schema subschema traversal, used by both spec-pipeline scripts.
 *
 * `patch-spec.mjs`'s malformed-keyword sweep and component-reachability scan, and
 * `widen-response-enums.mjs`'s component-ref collector and enum-presence check, all recurse
 * through the same shape — `properties`, `items`, an object-valued `additionalProperties`, and
 * each of `allOf`/`oneOf`/`anyOf` — previously reimplemented independently in each script
 * (including the `["allOf","oneOf","anyOf"]` keyword list appearing three times). `walkSchema` is
 * the one place that shape is expressed; each call site supplies its own `visit(node)` callback
 * for its own per-node action ($ref-follow, identity-visit, or enum-detect).
 *
 * @typedef {{
 *   type?: string,
 *   enum?: unknown[],
 *   $ref?: string,
 *   properties?: Record<string, SchemaNode>,
 *   items?: SchemaNode,
 *   additionalProperties?: boolean | SchemaNode,
 *   allOf?: SchemaNode[],
 *   oneOf?: SchemaNode[],
 *   anyOf?: SchemaNode[],
 *   [key: string]: unknown,
 * }} SchemaNode
 *
 * @typedef {{
 *   parameters?: Array<{ schema?: SchemaNode, [key: string]: unknown }>,
 *   requestBody?: { content?: Record<string, { schema?: SchemaNode }> },
 *   responses?: Record<string, {
 *     description?: string,
 *     content?: Record<string, { schema?: SchemaNode }>,
 *   }>,
 *   [key: string]: unknown,
 * }} OpenApiOperation
 *
 * @typedef {{
 *   paths?: Record<string, Record<string, OpenApiOperation>>,
 *   components?: { schemas?: Record<string, SchemaNode> },
 *   [key: string]: unknown,
 * }} OpenApiSpecFragment
 */

/**
 * JSON-Schema composition keywords whose array entries are themselves subschemas. Module-local:
 * consumed only by `walkSchema` below (no other importer exists — keep it that way rather than
 * exporting speculative public API nothing uses).
 *
 * @type {readonly string[]}
 */
const SUBSCHEMA_KEYWORDS = ["allOf", "oneOf", "anyOf"];

/** OpenAPI JSON-pointer prefix for a `#/components/schemas/*` reference. */
export const COMPONENTS_SCHEMAS_PREFIX = "#/components/schemas/";

/**
 * HTTP methods recognized as operations within an OpenAPI PathItem object. Shared by both
 * pipeline scripts so the recognized-method set can't drift between them.
 *
 * @type {readonly string[]}
 */
export const HTTP_METHODS = [
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
 * Strips the `#/components/schemas/` prefix from a component `$ref` string, e.g.
 * `'#/components/schemas/Device'` -> `'Device'`.
 *
 * @param {string} ref
 * @returns {string}
 */
export function refName(ref) {
  return ref.replace(COMPONENTS_SCHEMAS_PREFIX, "");
}

/**
 * Invokes `visit(node)` once for every schema node reachable from `root` via `properties`,
 * `items`, an object-valued `additionalProperties`, and each of `allOf`/`oneOf`/`anyOf` —
 * including `root` itself. Cycle-safe via `visited` (object identity); pass a shared `Set`
 * across sibling calls to visit each node at most once across a whole spec.
 *
 * Deliberately does **not** follow `$ref`: a `{ $ref }` node has no `properties`/`items`/etc. of
 * its own to recurse into, so this walker naturally stops there. A caller that needs to follow
 * refs (to continue into the referenced component's own schema) does so from inside `visit`, by
 * recursing into a fresh `walkSchema` call on the resolved schema — ref-graph cycle safety needs
 * a *name*-keyed visited set, not an object-identity one, so that stays the caller's
 * responsibility; only the caller knows whether following refs is even wanted.
 *
 * @param {SchemaNode | undefined} root
 * @param {(node: SchemaNode) => void} visit
 * @param {Set<object>} [visited]
 * @returns {void}
 */
export function walkSchema(root, visit, visited = new Set()) {
  if (!root || typeof root !== "object" || visited.has(root)) return;
  visited.add(root);
  visit(root);
  for (const propSchema of Object.values(root.properties ?? {})) {
    walkSchema(propSchema, visit, visited);
  }
  if (root.items) walkSchema(root.items, visit, visited);
  if (
    root.additionalProperties &&
    typeof root.additionalProperties === "object"
  ) {
    walkSchema(root.additionalProperties, visit, visited);
  }
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    // `root[keyword]` is `unknown` per SchemaNode's index signature (the keyword-specific fields
    // above are individually typed, but `allOf`/`oneOf`/`anyOf` are read generically here); narrow
    // to the documented `SchemaNode[] | undefined` shape explicitly rather than relying on `??`
    // over an `unknown`, which is not iterable under `checkJs`.
    const subSchemas = /** @type {SchemaNode[] | undefined} */ (root[keyword]);
    for (const sub of subSchemas ?? []) walkSchema(sub, visit, visited);
  }
}

/**
 * Invokes `visit(operation, opLabel)` once for every operation in `spec.paths` — every
 * `paths[pathKey][method]` entry whose `method` is a recognized HTTP method (see `HTTP_METHODS`)
 * and whose value is a non-null object. `opLabel` is the `"METHOD /path"` label used throughout
 * both pipeline scripts for diagnostics and error messages.
 *
 * Centralizes the `for (paths) -> for (methods, HTTP_METHODS filter) -> operation` boilerplate
 * previously reimplemented independently at each of `patch-spec.mjs`'s
 * `computeReachableComponentNames`/`patchMissingSuccessResponses`/`walkAllSchemaNodes` and
 * `widen-response-enums.mjs`'s `buildReachabilityMaps` — including, in `walkAllSchemaNodes`'s
 * case, a copy that had silently drifted to skip the `HTTP_METHODS` filter entirely and to read
 * only the `application/json` content type instead of every content type its three siblings
 * consider. Routing all four traversals through one function means a future filter or
 * content-type fix only has to land here, and can't drift between call sites again.
 *
 * @param {OpenApiSpecFragment} spec
 * @param {(operation: OpenApiOperation, opLabel: string) => void} visit
 * @returns {void}
 */
export function forEachOperation(spec, visit) {
  for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (
        !HTTP_METHODS.includes(method) ||
        !operation ||
        typeof operation !== "object"
      ) {
        continue;
      }
      visit(operation, `${method.toUpperCase()} ${pathKey}`);
    }
  }
}
