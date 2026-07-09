/**
 * Closed (no index signature) mirrors of the permissive `SchemaNode`/`OpenApiOperation` typedefs
 * declared in `scripts/lib/schema-walk.mjs`, for use ONLY as the `satisfies` target of
 * hand-written OpenAPI fixture object literals in the `tests/generated/*.test.ts` suites.
 *
 * The production typedefs carry a blanket `[key: string]: unknown` index signature — needed for
 * their one real caller, `patch-spec.mjs`'s / `widen-response-enums.mjs`'s `main()`, whose spec
 * comes from `JSON.parse`'s untyped result and genuinely carries countless real OpenAPI fields
 * (`title`, `description`, `default`, …) the walker doesn't model. That same index signature is
 * exactly what lets a *hand-typed* fixture with a typo'd key type-check with zero diagnostics:
 * any string key, with any value, is a valid member of an indexed type, so
 * `{ respnoses: {...} }` silently satisfies `OpenApiOperation`.
 *
 * These closed variants restore excess-property checking for genuinely hand-typed fixtures via
 * the `satisfies` operator — e.g. `{ ... } satisfies StrictOpenApiOperation` — applied at the
 * point each fixture literal is constructed. `satisfies` checks the literal against the closed
 * type without changing the literal's own inferred type, so the checked value still flows
 * unchanged into the production functions' permissive, indexed parameter types: a *named*
 * interface lacking its own index signature is not structurally assignable to a type that
 * requires one (verified directly — this is why these types are never used as an explicit
 * variable/return type annotation, only as a `satisfies` target), but a plain object literal is
 * exempt from that requirement, and `satisfies` preserves the value's literal-inferred type
 * rather than widening it to the (unindexed) checked type.
 */

export interface StrictSchemaNode {
  type?: string;
  format?: string;
  description?: string;
  pattern?: string;
  enum?: unknown[];
  $ref?: string;
  properties?: Record<string, StrictSchemaNode>;
  items?: StrictSchemaNode;
  additionalProperties?: boolean | StrictSchemaNode;
  allOf?: StrictSchemaNode[];
  oneOf?: StrictSchemaNode[];
  anyOf?: StrictSchemaNode[];
}

export interface StrictOpenApiOperation {
  parameters?: Array<{ schema?: StrictSchemaNode }>;
  requestBody?: { content?: Record<string, { schema?: StrictSchemaNode }> };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: StrictSchemaNode }>;
    }
  >;
}
