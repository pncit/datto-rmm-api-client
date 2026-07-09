#!/usr/bin/env node
/**
 * Response-enum-widening codemod — the last step of `npm run generate`.
 *
 * Rewrites every generated **response** enum type in `src/generated/types/**` so its emitted
 * TypeScript type is the open form `EnumUnion | (string & {})` (R5): an unobserved future
 * server-side value type-checks instead of the codebase claiming an exhaustiveness the runtime
 * `parseLenient` (Phase 4) deliberately relaxes. Request-side enums (bodies, query/path/header
 * parameters) are left closed, since the client controls what it sends (R6). The transform is
 * idempotent — running it twice is a no-op — so `npm run generate` stays byte-reproducible (R15).
 *
 * ## Discrimination: how a "response" enum is told apart from a "request" enum
 *
 * Orval (mode: 'tags-split', client: 'axios') hoists every enum-typed property — at every
 * nesting depth — into its own file/type, named by concatenating the declaring parent's name
 * with the field's name (e.g. `Device.deviceClass` -> `DeviceDeviceClass`; a per-operation query
 * parameter's own enum field -> e.g. `GetActivitiesOrder`). Two consequences follow directly
 * from inspecting the real generated output (not the inline-literal-union shape a spec-writer
 * might expect):
 *
 *   1. A hoisted type's name does **not** reliably end in a recognizable request-side suffix —
 *      only the *immediate* parent's name is prepended, so a deeply-nested field's hoisted name
 *      can lose the ancestor suffix entirely (e.g. a query-parameter enum ends up named
 *      `GetActivitiesOrder`, not `GetActivitiesParamsOrder` — Orval derives it from the
 *      operation, not the literal `*Params` type name). An `endsWith` check on the suffix list
 *      alone under-widens: it would also leave nested *response* enums closed.
 *   2. Datto's spec never uses an anonymous inline request body — every write operation's body
 *      is a `$ref` to a **named** component schema (`Udf`, `Warranty`, `ProxySettings`,
 *      `CreateSiteRequest`, …), so those top-level request types carry no distinguishing suffix
 *      at all; nothing marks them request-side by name.
 *
 * So this codemod uses two complementary mechanisms, both operating on the **name graph** the
 * generated files themselves declare (never on hand-parsed TS syntax beyond simple
 * import/declaration extraction):
 *
 *   (a) **Per-operation root suffixes** (`REQUEST_ROOT_SUFFIXES`) — a top-level generated type
 *       whose name ends in `Body|Params|Parameter|Parameters|Query|QueryParams|Header|Headers|
 *       PathParameters` is a per-operation parameter/anonymous-body type and is request-side by
 *       construction (OpenAPI parameters/headers are never response types).
 *   (b) **Spec-derived named-component roots** (`computeRequestOnlyComponentNames`) — a named
 *       `#/components/schemas/*` entity reachable from some operation's `requestBody` and from
 *       **no** response is request-only; this is exactly how Datto's named write-body schemas
 *       (`Udf`, `Warranty`, `ProxySettingsRequest`, …) are identified, since they carry no suffix.
 *
 * Both root sets are then expanded **transitively** by following each root file's own
 * `import type { X } from './x'` lines (however deep the real nesting goes) — this is what
 * correctly excludes a hoisted grandchild like `ProxySettingsRequestType` or
 * `GetActivitiesOrder` without needing to reverse-engineer Orval's exact per-field naming rule.
 * Every enum-shaped declaration reached by this expansion is left closed; every other is widened.
 *
 * ## The shared-schema hazard this discrimination depends on
 *
 * The two mechanisms above only work if no single named component schema is reachable from
 * *both* a requestBody and a response while declaring an enum — such a schema would generate one
 * shared TS type, and widening it would silently loosen the compile-time request contract.
 * `verifyNoSharedEnumBearingSchemas` checks this transitively (through `properties`/`items`/
 * `allOf`/`oneOf`/`anyOf`/`additionalProperties`, cycle-safe) against the patched spec and
 * throws, naming the offending schema(s) and the reaching operations, if it ever finds one. A
 * real instance of exactly this hazard (`ProxySettings.type`) was found in Datto's spec and
 * resolved in `scripts/patch-spec.mjs` (see `REQUEST_RESPONSE_SPLITS`) by cloning the schema so
 * the request and response paths no longer share a generated TS type; this check is the
 * regression guard that would catch a *future* refresh reintroducing the same hazard elsewhere.
 *
 * ## Post-conditions (`verifyWideningHappened`)
 *
 * The discrimination mechanism, and the widening itself, both rest entirely on regexes matched
 * against Orval's exact current generated-output text (`IMPORT_RE`, `ENUM_ALIAS_RE`). Neither had
 * any assertion that it matched anything, so a future Orval/formatter change that silently breaks
 * those regexes would widen 0 files (or under-widen) with a plausible-looking log line and exit
 * 0 — no other Phase 2 gate catches this (reproducibility only proves committed == regenerated,
 * not that widening happened at all). `main()` now asserts two invariants derived from the
 * *patched spec* — not from the same generated-file text the widening pass parses, so a format
 * drift in that text can't defeat its own check — after the widening pass runs.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { walkSchema } from "./lib/schema-walk.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATCHED_SPEC_PATH = resolve(__dirname, "../spec/openapi.patched.json");
const TYPES_DIR = resolve(__dirname, "../src/generated/types");

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
 * Per-operation parameter/header/anonymous-body type suffixes Orval uses for request-side root
 * types. Datto's spec has no anonymous request body today (every write body is a named $ref —
 * see `computeRequestOnlyComponentNames`), but `Body` is kept for a future spec revision that
 * introduces one, and to mirror the plan's documented suffix set exactly.
 */
export const REQUEST_ROOT_SUFFIXES = [
  "Body",
  "Params",
  "Parameter",
  "Parameters",
  "Query",
  "QueryParams",
  "Header",
  "Headers",
  "PathParameters",
];

function toPascalCase(rawName) {
  return rawName
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function refName(ref) {
  return ref.replace("#/components/schemas/", "");
}

/**
 * Recursively collects every `#/components/schemas/*` name reachable from `node`, following
 * `$ref`, `properties`, `items`, `additionalProperties`, and `allOf`/`oneOf`/`anyOf`. Cycle-safe
 * via `visitedRefs` (component names already expanded) and `visitedNodes` (object identity, for
 * non-$ref cycles within a single schema tree).
 */
function collectComponentRefs(node, schemas, visitedRefs, visitedNodes) {
  walkSchema(
    node,
    (subNode) => {
      if (typeof subNode.$ref !== "string") return;
      const name = refName(subNode.$ref);
      if (!visitedRefs.has(name)) {
        visitedRefs.add(name);
        collectComponentRefs(schemas[name], schemas, visitedRefs, visitedNodes);
      }
    },
    visitedNodes,
  );
}

/** True if `name`'s own schema, or any schema nested within it, declares an `enum`. */
function componentHasEnum(name, schemas, visitedNames) {
  if (visitedNames.has(name)) return false;
  visitedNames.add(name);
  return schemaHasEnum(schemas[name], schemas, visitedNames);
}

function schemaHasEnum(node, schemas, visitedNames) {
  let found = false;
  walkSchema(node, (subNode) => {
    if (found) return;
    if (Array.isArray(subNode.enum)) {
      found = true;
      return;
    }
    if (
      typeof subNode.$ref === "string" &&
      componentHasEnum(refName(subNode.$ref), schemas, visitedNames)
    ) {
      found = true;
    }
  });
  return found;
}

/** Builds `{ requestReach, responseReach }`: component name -> Set of `METHOD /path` labels. */
function buildReachabilityMaps(spec) {
  const schemas = spec.components?.schemas ?? {};
  const requestReach = new Map();
  const responseReach = new Map();

  const addReach = (map, refs, opLabel) => {
    for (const name of refs) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(opLabel);
    }
  };

  for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (
        !HTTP_METHODS.includes(method) ||
        !operation ||
        typeof operation !== "object"
      )
        continue;
      const opLabel = `${method.toUpperCase()} ${pathKey}`;

      const requestSchema =
        operation.requestBody?.content?.["application/json"]?.schema;
      if (requestSchema) {
        const refs = new Set();
        collectComponentRefs(requestSchema, schemas, refs, new Set());
        addReach(requestReach, refs, opLabel);
      }

      for (const response of Object.values(operation.responses ?? {})) {
        const responseSchema = response?.content?.["application/json"]?.schema;
        if (responseSchema) {
          const refs = new Set();
          collectComponentRefs(responseSchema, schemas, refs, new Set());
          addReach(responseReach, refs, opLabel);
        }
      }
    }
  }

  return { requestReach, responseReach };
}

/**
 * Named component schemas reachable from a requestBody and from no response, PascalCased to
 * match Orval's generated type names (e.g. `'Variable Creation Request'` -> `'VariableCreationRequest'`).
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @returns {Set<string>}
 */
export function computeRequestOnlyComponentNames(spec) {
  const { requestReach, responseReach } = buildReachabilityMaps(spec);
  const requestOnly = new Set();
  for (const name of requestReach.keys()) {
    if (!responseReach.has(name)) requestOnly.add(toPascalCase(name));
  }
  return requestOnly;
}

/**
 * Throws if any named component schema is reachable from both a requestBody and a response
 * while declaring an enum (directly or in a nested schema) — see the module doc for why this
 * would break the request/response discrimination the widening pass depends on.
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @returns {void}
 */
export function verifyNoSharedEnumBearingSchemas(spec) {
  const schemas = spec.components?.schemas ?? {};
  const { requestReach, responseReach } = buildReachabilityMaps(spec);

  const offending = [];
  for (const [name, requestOps] of requestReach) {
    if (responseReach.has(name) && componentHasEnum(name, schemas, new Set())) {
      offending.push({
        name,
        requestOps: [...requestOps].sort(),
        responseOps: [...responseReach.get(name)].sort(),
      });
    }
  }

  if (offending.length > 0) {
    const detail = offending
      .map(
        (o) =>
          `${o.name} (reached by requestBody of ${o.requestOps.join(", ")} and response of ${o.responseOps.join(", ")})`,
      )
      .join("; ");
    throw new Error(
      `widen-enums: request/response share enum-bearing schema(s): ${detail} — split the shared schema or add a request-side suffix`,
    );
  }
}

const IMPORT_RE = /import type \{([^}]+)\} from '\.\/[^']+';/g;
const INTERFACE_NAME_RE = /export interface (\w+)/g;
const TYPE_ALIAS_NAME_RE = /export type (\w+) =/g;
const ENUM_ALIAS_RE = /export type (\w+) = typeof \1\[keyof typeof \1\];/g;

/** Extracts this generated file's own declared type name(s) and the local names it imports. */
function parseGeneratedFile(content) {
  const importNames = new Set();
  for (const match of content.matchAll(IMPORT_RE)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim();
      if (name) importNames.add(name);
    }
  }

  const primaryNames = new Set();
  for (const match of content.matchAll(INTERFACE_NAME_RE))
    primaryNames.add(match[1]);
  for (const match of content.matchAll(TYPE_ALIAS_NAME_RE))
    primaryNames.add(match[1]);

  return { importNames, primaryNames };
}

function widenEnumAliasLine(content) {
  return content.replace(ENUM_ALIAS_RE, (_match, name) => {
    return `export type ${name} = typeof ${name}[keyof typeof ${name}] | (string & {});`;
  });
}

function isRequestRootName(name, requestOnlyComponentNames) {
  return (
    REQUEST_ROOT_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    requestOnlyComponentNames.has(name)
  );
}

/** BFS-expands `roots` by following each name's own declared imports, transitively. */
function expandExcludedNames(roots, nameToImports) {
  const excluded = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    for (const imported of nameToImports.get(name) ?? []) {
      if (!excluded.has(imported)) {
        excluded.add(imported);
        queue.push(imported);
      }
    }
  }
  return excluded;
}

/**
 * Parses every file exactly once, returning the data both `widenGeneratedTypes` (the transform)
 * and `main`'s post-condition check need: each declared name's own imports (for transitive
 * exclusion expansion), the "root" subset of those names that are request-side by construction
 * (suffix match or in the spec-derived request-only set), and each file's own declared names (so
 * a second pass over the same files never has to re-parse them).
 *
 * @param {Map<string, string>} fileContentsByName
 * @param {Set<string>} requestOnlyComponentNames
 * @returns {{
 *   nameToImports: Map<string, Set<string>>,
 *   rootExcludedNames: Set<string>,
 *   primaryNamesByFile: Map<string, Set<string>>,
 * }}
 */
export function computeRootExclusion(fileContentsByName, requestOnlyComponentNames) {
  const nameToImports = new Map();
  const rootExcludedNames = new Set();
  const primaryNamesByFile = new Map();

  for (const [fileName, content] of fileContentsByName) {
    const { importNames, primaryNames } = parseGeneratedFile(content);
    primaryNamesByFile.set(fileName, primaryNames);
    for (const name of primaryNames) {
      nameToImports.set(name, importNames);
      if (isRequestRootName(name, requestOnlyComponentNames)) {
        rootExcludedNames.add(name);
      }
    }
  }

  return { nameToImports, rootExcludedNames, primaryNamesByFile };
}

function applyWidening(fileContentsByName, primaryNamesByFile, excludedNames) {
  const result = new Map();
  for (const [fileName, content] of fileContentsByName) {
    const primaryNames = primaryNamesByFile.get(fileName);
    const isExcludedFile = [...primaryNames].some((name) =>
      excludedNames.has(name),
    );
    result.set(fileName, isExcludedFile ? content : widenEnumAliasLine(content));
  }
  return result;
}

/**
 * Pure widening pass over an in-memory `{ fileName -> content }` map (excludes `index.ts` —
 * pass only the generated model files). Returns a new map with the same keys; entries whose
 * content is unchanged are returned byte-identical (so a caller can diff to decide whether to
 * write), making the transform trivially idempotent.
 *
 * @param {Map<string, string>} fileContentsByName
 * @param {Set<string>} requestOnlyComponentNames
 * @returns {Map<string, string>}
 */
export function widenGeneratedTypes(
  fileContentsByName,
  requestOnlyComponentNames,
) {
  const { nameToImports, rootExcludedNames, primaryNamesByFile } =
    computeRootExclusion(fileContentsByName, requestOnlyComponentNames);
  const excluded = expandExcludedNames(rootExcludedNames, nameToImports);
  return applyWidening(fileContentsByName, primaryNamesByFile, excluded);
}

function walkTsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    if (entry === "index.ts") continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkTsFiles(fullPath).map((f) => join(entry, f)));
    } else if (entry.endsWith(".ts")) {
      files.push(entry);
    }
  }
  return files;
}

/**
 * Fail-loud post-conditions on the widening pass, derived from the patched spec rather than from
 * the generated-file text the widening pass itself parses (so a format drift in that text can't
 * defeat its own check):
 *
 *  - If any named component schema reachable from a response carries an enum (directly or
 *    nested) — which `verifyNoSharedEnumBearingSchemas` already proves cannot also be reachable
 *    from a request — at least one generated file must have been widened. Catches a future
 *    Orval/formatter change that makes `ENUM_ALIAS_RE`/`IMPORT_RE` silently stop matching:
 *    `changedCount` would otherwise stay 0 with no other symptom.
 *  - If the spec-derived request-only-component set is non-empty, at least one of those names
 *    must have resolved to a declared name in some generated file. Catches a mismatch between
 *    `computeRequestOnlyComponentNames`'s PascalCasing and Orval's actual naming (the
 *    discrimination graph silently excluding nothing it was supposed to).
 *
 * This does not, and cannot without reimplementing Orval's exact naming algorithm, prove every
 * individual response enum was widened and every individual request enum was excluded — it
 * proves the mechanism engaged at all, on both its inclusion and exclusion sides, instead of
 * silently no-op'ing.
 *
 * @param {import('./lib/schema-walk.mjs').OpenApiSpecFragment} spec
 * @param {Set<string>} requestOnlyComponentNames
 * @param {Set<string>} rootExcludedNames
 * @param {number} changedCount
 * @returns {void}
 */
export function verifyWideningHappened(
  spec,
  requestOnlyComponentNames,
  rootExcludedNames,
  changedCount,
) {
  const schemas = spec.components?.schemas ?? {};
  const { responseReach } = buildReachabilityMaps(spec);
  const hasResponseEnum = [...responseReach.keys()].some((name) =>
    componentHasEnum(name, schemas, new Set()),
  );
  if (hasResponseEnum && changedCount === 0) {
    throw new Error(
      "widen-response-enums: the patched spec has at least one response-reachable, enum-bearing " +
        "component schema, but 0 generated files were widened — ENUM_ALIAS_RE/IMPORT_RE likely no " +
        "longer match Orval's generated output shape",
    );
  }

  if (requestOnlyComponentNames.size > 0 && rootExcludedNames.size === 0) {
    throw new Error(
      "widen-response-enums: the patched spec has request-only component schema(s) " +
        `(${[...requestOnlyComponentNames].sort().join(", ")}), but none resolved to a declared ` +
        "type name in any generated file — computeRequestOnlyComponentNames's PascalCasing may no " +
        "longer match Orval's naming",
    );
  }
}

function main() {
  const patchedSpec = JSON.parse(readFileSync(PATCHED_SPEC_PATH, "utf8"));
  verifyNoSharedEnumBearingSchemas(patchedSpec);

  const requestOnlyComponentNames =
    computeRequestOnlyComponentNames(patchedSpec);

  const relativeFiles = walkTsFiles(TYPES_DIR);
  const fileContentsByName = new Map(
    relativeFiles.map((relPath) => [
      relPath,
      readFileSync(join(TYPES_DIR, relPath), "utf8"),
    ]),
  );

  const { nameToImports, rootExcludedNames, primaryNamesByFile } =
    computeRootExclusion(fileContentsByName, requestOnlyComponentNames);
  const excluded = expandExcludedNames(rootExcludedNames, nameToImports);
  const widened = applyWidening(fileContentsByName, primaryNamesByFile, excluded);

  let changedCount = 0;
  for (const [relPath, content] of widened) {
    if (content !== fileContentsByName.get(relPath)) {
      writeFileSync(join(TYPES_DIR, relPath), content, "utf8");
      changedCount++;
    }
  }

  verifyWideningHappened(
    patchedSpec,
    requestOnlyComponentNames,
    rootExcludedNames,
    changedCount,
  );

  console.log(
    `widen-response-enums: widened enum type(s) in ${changedCount} file(s)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
