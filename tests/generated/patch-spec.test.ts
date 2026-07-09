import { describe, test, expect } from "vitest";

import {
  patchSpec,
  TIMESTAMP_FIELDS,
  REQUEST_RESPONSE_SPLITS,
} from "../../scripts/patch-spec.mjs";

/**
 * A minimal, deliberately loose structural type for the tiny OpenAPI-shaped fragments these
 * tests build — mirroring how patch-spec.mjs itself treats the spec (a plain, dynamically
 * shaped JSON document navigated with optional chaining, not a strongly-typed OpenAPI model).
 */
interface SchemaNode {
  type?: string;
  format?: string;
  enum?: string[];
  oneOf?: unknown[];
  $ref?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: boolean | SchemaNode;
  [key: string]: unknown;
}

interface SpecFragment {
  openapi: string;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, SchemaNode> };
}

/**
 * A minimal but complete spec fragment carrying every anchor `patchSpec` expects: the
 * timestamp fields (Device/AuthUser/Alert), `Alert.alertContext`, and the `ProxySettings`
 * request/response split's shared schema plus both its ref locations. Individual tests delete
 * one anchor at a time to exercise the fail-loud path.
 */
function buildValidSpecFragment(): SpecFragment {
  return {
    openapi: "3.1.0",
    paths: {
      "/v2/site/{siteUid}/settings/proxy": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProxySettings" },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Device: {
          type: "object",
          properties: {
            lastSeen: { type: "string", format: "date-time" },
            lastReboot: { type: "string", format: "date-time" },
            lastAuditDate: { type: "string", format: "date-time" },
            creationDate: { type: "string", format: "date-time" },
          },
        },
        AuthUser: {
          type: "object",
          properties: {
            created: { type: "string", format: "date-time" },
            lastAccess: { type: "string", format: "date-time" },
          },
        },
        Alert: {
          type: "object",
          properties: {
            timestamp: { type: "string", format: "date-time" },
            resolvedOn: { type: "string", format: "date-time" },
            alertContext: {
              oneOf: [{ $ref: "#/components/schemas/SomeContext" }],
            },
          },
        },
        ProxySettings: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["http", "socks4", "socks5"] },
          },
        },
        CreateSiteRequest: {
          type: "object",
          properties: {
            proxySettings: { $ref: "#/components/schemas/ProxySettings" },
          },
        },
      },
    },
  };
}

describe("patchSpec", () => {
  test("retypes every documented timestamp field to integer/int64 and drops any enum", () => {
    const spec = buildValidSpecFragment();
    patchSpec(spec);

    for (const [schemaName, fields] of Object.entries(TIMESTAMP_FIELDS) as [
      string,
      string[],
    ][]) {
      for (const field of fields) {
        const prop = spec.components.schemas[schemaName].properties![field];
        expect(prop.type).toBe("integer");
        expect(prop.format).toBe("int64");
        expect(prop.enum).toBeUndefined();
      }
    }
  });

  test("replaces Alert.alertContext with a permissive @class-tagged open object", () => {
    const spec = buildValidSpecFragment();
    patchSpec(spec);

    const alertContext = spec.components.schemas.Alert.properties!.alertContext;
    expect(alertContext.oneOf).toBeUndefined();
    expect(alertContext.type).toBe("object");
    expect(alertContext.additionalProperties).toBe(true);
    expect(alertContext.properties!["@class"]).toEqual({ type: "string" });
  });

  test("splits a shared enum-bearing schema into a request-only clone and retargets every ref location", () => {
    const spec = buildValidSpecFragment();
    patchSpec(spec);

    for (const {
      sharedSchema,
      requestSchema,
      refLocations,
    } of REQUEST_RESPONSE_SPLITS as {
      sharedSchema: string;
      requestSchema: string;
      refLocations: string[][];
    }[]) {
      // The clone exists and matches the original shape.
      expect(spec.components.schemas[requestSchema]).toEqual(
        buildValidSpecFragment().components.schemas[sharedSchema],
      );
      // Every declared ref location now points at the clone, not the shared schema.
      for (const path of refLocations) {
        let node: unknown = spec;
        for (const key of path) node = (node as Record<string, unknown>)[key];
        expect((node as { $ref: string }).$ref).toBe(
          `#/components/schemas/${requestSchema}`,
        );
      }
      // The original shared schema is untouched and still what the response side sees.
      expect(
        spec.components.schemas[sharedSchema].properties!.type.enum,
      ).toEqual(["http", "socks4", "socks5"]);
    }
  });

  test("throws when a documented timestamp field is missing (drift, not silently skipped)", () => {
    const spec = buildValidSpecFragment();
    delete spec.components.schemas.Device.properties!.lastSeen;

    expect(() => patchSpec(spec)).toThrow(/Device\.lastSeen/);
  });

  test("throws when Alert.alertContext is missing", () => {
    const spec = buildValidSpecFragment();
    delete spec.components.schemas.Alert.properties!.alertContext;

    expect(() => patchSpec(spec)).toThrow(/Alert\.alertContext/);
  });

  test("throws when a request/response split ref location no longer points at the expected shared schema", () => {
    const spec = buildValidSpecFragment();
    spec.components.schemas.CreateSiteRequest.properties!.proxySettings = {
      $ref: "#/components/schemas/Other",
    };

    expect(() => patchSpec(spec)).toThrow(
      /CreateSiteRequest\.properties\.proxySettings/,
    );
  });

  test("strips an invalid pattern from a non-string schema (Orval would otherwise emit ZodNumber#regex)", () => {
    const spec = buildValidSpecFragment();
    spec.components.schemas.Device.properties!.oddNumericField = {
      type: "number",
      pattern: "seconds.nanoseconds",
    };

    patchSpec(spec);

    expect(
      spec.components.schemas.Device.properties!.oddNumericField.pattern,
    ).toBeUndefined();
  });

  test("strips a redundant top-level enum on an array-typed schema, keeping the real items enum", () => {
    const spec = buildValidSpecFragment();
    spec.components.schemas.Device.properties!.entities = {
      type: "array",
      enum: ["device", "user"],
      items: { type: "string", enum: ["device", "user"] },
    };

    patchSpec(spec);

    const entities = spec.components.schemas.Device.properties!.entities;
    expect(entities.enum).toBeUndefined();
    expect(entities.items!.enum).toEqual(["device", "user"]);
  });

  test("applying patchSpec to the same original fragment twice produces byte-identical output", () => {
    // patch-spec.mjs's CLI entrypoint always re-reads the frozen spec/openapi.json from scratch
    // (never re-patches its own prior output — see main()); this is the guarantee that matters
    // for R15, exercised end-to-end against the real spec by reproducibility.test.ts. Here we
    // confirm patchSpec is a deterministic pure function of its input: two independent fragments
    // with identical starting content patch to identical output.
    const first = patchSpec(buildValidSpecFragment());
    const second = patchSpec(buildValidSpecFragment());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
