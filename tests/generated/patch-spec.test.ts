import { describe, test, expect } from "vitest";

import {
  patchSpec,
  TIMESTAMP_FIELDS,
  REQUEST_RESPONSE_SPLITS,
  EXPECTED_ORPHANED_COMPONENTS,
} from "../../scripts/patch-spec.mjs";

/**
 * The same `SchemaNode`/`OpenApiSpecFragment` shape `patch-spec.mjs` and `widen-response-enums.mjs`
 * themselves are typed against (see `scripts/lib/schema-walk.mjs`), reused here rather than
 * duplicated so a real call into `patchSpec` is checked structurally against the exact type its
 * own JSDoc declares — not a second, potentially-diverging local approximation of it.
 */
type SchemaNode = import("../../scripts/lib/schema-walk.mjs").SchemaNode;

interface SpecFragment {
  openapi: string;
  paths: Record<
    string,
    Record<string, import("../../scripts/lib/schema-walk.mjs").OpenApiOperation>
  >;
  components: { schemas: Record<string, SchemaNode> };
  [key: string]: unknown;
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

/**
 * Adds (or extends) a single `paths[pathKey][method]` operation onto a copy of `fragment`'s
 * `paths`, leaving every other anchor `buildValidSpecFragment` already carries untouched — so
 * each test below exercises exactly one extra operation against an otherwise-valid fragment.
 */
function withOperation(
  fragment: SpecFragment,
  pathKey: string,
  method: string,
  operation: import("../../scripts/lib/schema-walk.mjs").OpenApiOperation,
): SpecFragment {
  return {
    ...fragment,
    paths: {
      ...fragment.paths,
      [pathKey]: { ...(fragment.paths[pathKey] ?? {}), [method]: operation },
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

  test("leaves an array-level enum untouched when items carries no enum of its own (not redundant)", () => {
    const spec = buildValidSpecFragment();
    spec.components.schemas.Device.properties!.oddArrayField = {
      type: "array",
      enum: ["device", "user"],
      items: { type: "string" },
    };

    patchSpec(spec);

    const oddArrayField = spec.components.schemas.Device.properties!.oddArrayField;
    expect(oddArrayField.enum).toEqual(["device", "user"]);
    expect(oddArrayField.items!.enum).toBeUndefined();
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

  describe("missing success responses", () => {
    test("synthesizes a 200 from a schema consistently misattached to error-code responses", () => {
      const spec = withOperation(buildValidSpecFragment(), "/v2/widget/{id}", "get", {
        responses: {
          "401": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Device" } },
            },
          },
          "403": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Device" } },
            },
          },
          "500": { description: "Internal Server Error" },
        },
      });

      patchSpec(spec);

      const synthesized = spec.paths["/v2/widget/{id}"].get!.responses!["200"];
      expect(synthesized).toBeDefined();
      expect(synthesized.content!["application/json"].schema).toEqual({
        $ref: "#/components/schemas/Device",
      });
    });

    test("synthesizes a 200 from a schema under '*/*' content type, not just application/json", () => {
      const spec = withOperation(buildValidSpecFragment(), "/v2/widget/{id}", "put", {
        responses: {
          "400": {
            content: { "*/*": { schema: { $ref: "#/components/schemas/Device" } } },
          },
        },
      });

      patchSpec(spec);

      const synthesized = spec.paths["/v2/widget/{id}"].put!.responses!["200"];
      expect(synthesized.content!["application/json"].schema).toEqual({
        $ref: "#/components/schemas/Device",
      });
    });

    test("leaves a documented void-write operation without a 200/204 (no inferable schema anywhere)", () => {
      const spec = withOperation(
        buildValidSpecFragment(),
        "/v2/alert/{alertUid}/resolve",
        "post",
        {
          responses: {
            "401": { description: "Request can not be authorized." },
            "500": { description: "Internal Server Error" },
          },
        },
      );

      patchSpec(spec);

      expect(
        spec.paths["/v2/alert/{alertUid}/resolve"].post!.responses!["200"],
      ).toBeUndefined();
    });

    test("throws when an undocumented operation has no 200/204 and no inferable response schema", () => {
      const spec = withOperation(buildValidSpecFragment(), "/v2/widget", "post", {
        responses: {
          "401": { description: "Request can not be authorized." },
          "500": { description: "Internal Server Error" },
        },
      });

      expect(() => patchSpec(spec)).toThrow(/POST \/v2\/widget/);
    });

    test("throws when error-code responses carry inconsistent schemas (cannot safely synthesize)", () => {
      const spec = withOperation(buildValidSpecFragment(), "/v2/widget/{id}", "get", {
        responses: {
          "401": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Device" } },
            },
          },
          "403": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AuthUser" } },
            },
          },
        },
      });

      expect(() => patchSpec(spec)).toThrow(/GET \/v2\/widget\/\{id\}/);
    });
  });

  describe("orphaned alertContext schema pruning", () => {
    test("prunes *Context schemas orphaned by the alertContext rewrite, anchored to EXPECTED_ORPHANED_COMPONENTS", () => {
      const spec = buildValidSpecFragment();
      spec.components.schemas.Alert.properties!.alertContext = {
        oneOf: [{ $ref: "#/components/schemas/ActionContext" }],
      };
      spec.components.schemas.ActionContext = {
        type: "object",
        allOf: [{ $ref: "#/components/schemas/AlertContext" }],
        properties: { action: { type: "string" } },
      };
      spec.components.schemas.AlertContext = {
        type: "object",
        properties: { "@class": { type: "string" } },
      };
      expect(EXPECTED_ORPHANED_COMPONENTS).toContain("ActionContext");
      expect(EXPECTED_ORPHANED_COMPONENTS).toContain("AlertContext");

      patchSpec(spec);

      expect(spec.components.schemas.ActionContext).toBeUndefined();
      expect(spec.components.schemas.AlertContext).toBeUndefined();
    });

    test("throws when the alertContext rewrite orphans a component not documented in EXPECTED_ORPHANED_COMPONENTS", () => {
      const spec = buildValidSpecFragment();
      spec.components.schemas.Alert.properties!.alertContext = {
        oneOf: [{ $ref: "#/components/schemas/MysteryContext" }],
      };
      spec.components.schemas.MysteryContext = { type: "object", properties: {} };

      expect(() => patchSpec(spec)).toThrow(/MysteryContext/);
    });

    test("leaves a component referenced by the old alertContext oneOf alone if it's still reachable elsewhere", () => {
      const spec = buildValidSpecFragment();
      spec.components.schemas.Alert.properties!.alertContext = {
        oneOf: [{ $ref: "#/components/schemas/ActionContext" }],
      };
      spec.components.schemas.ActionContext = {
        type: "object",
        properties: { action: { type: "string" } },
      };
      // Also reachable via a live operation — not actually orphaned by the rewrite.
      spec.paths["/v2/widget/{id}"] = {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ActionContext" } },
              },
            },
          },
        },
      };

      patchSpec(spec);

      expect(spec.components.schemas.ActionContext).toBeDefined();
    });
  });
});
