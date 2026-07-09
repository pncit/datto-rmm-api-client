import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  enumFieldPaths,
  parseLenient,
} from "../../../src/validation/schema-leniency";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDebugLogger() {
  const debug = vi.fn();
  return { logger: { debug }, debugMock: debug };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("parseLenient", () => {
  describe("happy path", () => {
    it("returns identical output to safeParse when there are no unknown properties", () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const data = { name: "Alice", age: 30 };
      const { logger } = createMockDebugLogger();

      const lenientResult = parseLenient(schema, data, logger);
      const directResult = schema.safeParse(data);

      expect(lenientResult.success).toBe(true);
      expect(directResult.success).toBe(true);
      if (lenientResult.success && directResult.success) {
        expect(lenientResult.data).toEqual(directResult.data);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown detection at root
  // ---------------------------------------------------------------------------

  describe("unknown detection at root", () => {
    it("strips an extra key from a root-level object and logs it at debug, aggregated", () => {
      const schema = z.object({ name: z.string() });
      const data = { name: "Alice", extra: "should-be-stripped" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "test-context");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice" });
        expect(result.data).not.toHaveProperty("extra");
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({
          context: "test-context",
          field: "extra",
          count: 1,
          total: 1,
        }),
      );
      // The stripped value itself is never logged (log noise + unnecessary data exposure).
      expect(debugMock.mock.calls[0]?.[1]).not.toHaveProperty("value");
    });

    it("reports each distinct extra key from a root-level object as its own group", () => {
      const schema = z.object({ id: z.number() });
      const data = { id: 1, foo: "a", bar: "b" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 1 });
      }
      expect(debugMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Nested detection (3+ levels deep)
  // ---------------------------------------------------------------------------

  describe("nested detection", () => {
    it("detects unknowns at 3 levels of nesting with the correct dotted field path", () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            value: z.string(),
          }),
        }),
      });
      const data = {
        level1: {
          level2: {
            value: "ok",
            deepExtra: "should-go",
          },
        },
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "nested-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ level1: { level2: { value: "ok" } } });
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({
          context: "nested-ctx",
          field: "level1.level2.deepExtra",
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Array items — the index-dropping / aggregation behavior
  // ---------------------------------------------------------------------------

  describe("array items", () => {
    it("detects unknowns inside array items with a field path that carries no array index", () => {
      const itemSchema = z.object({ id: z.number() });
      const schema = z.array(itemSchema);
      const data = [
        { id: 1, extra1: "a" },
        { id: 2, extra2: "b" },
      ];
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "array-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      }
      expect(debugMock).toHaveBeenCalledTimes(2);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra1" }),
      );
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra2" }),
      );
    });

    it("aggregates the same unknown key stripped from every item into one summarized debug call", () => {
      const itemSchema = z.object({ id: z.number() });
      const schema = z.array(itemSchema);
      const data = [
        { id: 1, extra: "a" },
        { id: 2, extra: "b" },
        { id: 3, extra: "c" },
      ];
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "agg-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({
          context: "agg-ctx",
          field: "extra",
          count: 3,
          total: 3,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Record values
  // ---------------------------------------------------------------------------

  describe("record values", () => {
    it("detects unknowns inside record values", () => {
      const valueSchema = z.object({ name: z.string() });
      const schema = z.record(z.string(), valueSchema);
      const data = {
        key1: { name: "Alice", extra: "x" },
        key2: { name: "Bob", bonus: "y" },
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "record-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          key1: { name: "Alice" },
          key2: { name: "Bob" },
        });
      }
      expect(debugMock).toHaveBeenCalledTimes(2);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "key1.extra" }),
      );
    });

    it("does not recurse into a record with a z.unknown() value type", () => {
      const schema = z.record(z.string(), z.unknown());
      const data = { key1: { anything: true, goes: "here" } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "record-unknown-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
      expect(debugMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Union branches (discriminated union)
  // ---------------------------------------------------------------------------

  describe("union branches", () => {
    it("detects unknowns in the matched branch of a discriminated union", () => {
      const branchA = z.object({ type: z.literal("a"), valueA: z.string() });
      const branchB = z.object({ type: z.literal("b"), valueB: z.number() });
      const schema = z.union([branchA, branchB]);

      const data = { type: "a", valueA: "hello", extra: "strip-me" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "union-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ type: "a", valueA: "hello" });
        expect(result.data).not.toHaveProperty("extra");
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra", context: "union-ctx" }),
      );
    });

    it("matches the most specific (broadest key set) union branch first", () => {
      const narrowOption = z.object({ type: z.string() });
      const broadOption = z.object({ type: z.string(), value: z.string() });
      const schema = z.union([narrowOption, broadOption]);

      const data = { type: "x", value: "y", extra: "z" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "subset-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ type: "x", value: "y" });
        expect(result.data).not.toHaveProperty("extra");
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra" }),
      );
    });

    it("handles non-object union options (primitives) gracefully", () => {
      const schema = z.union([
        z.literal("red"),
        z.literal("green"),
        z.literal("blue"),
      ]);
      const data = "red";
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "prim-union-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("red");
      }
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("strips unknowns inside array-typed union branches with no index in the field path", () => {
      const itemSchema = z.object({ id: z.number() });
      const schema = z.union([
        z.array(itemSchema),
        z.object({ fallback: z.boolean() }),
      ]);

      const data = [{ id: 1, extra: "strip-me" }, { id: 2 }];
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "union-array-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra", context: "union-array-ctx" }),
      );
    });

    it("strips unknowns inside record-typed union branches", () => {
      const valueSchema = z.object({ name: z.string() });
      const schema = z.union([
        z.object({ type: z.literal("specific") }),
        z.record(z.string(), valueSchema),
      ]);

      const data = { key1: { name: "Alice", extra: "gone" } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "union-record-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key1: { name: "Alice" } });
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({
          field: "key1.extra",
          context: "union-record-ctx",
        }),
      );
    });

    it("no longer fails on a union missing every branch's fields, under blanket field leniency", () => {
      // R5 makes every named object field tolerate null/absent regardless of the branch's own
      // required-ness, so a union that relies on a required discriminator key to disambiguate
      // can no longer be forced to fail by withholding it — the permissive wrapped schema
      // accepts the first branch with all its fields simply absent. Datto's generated response
      // schemas contain no `z.union` (verified: no `zod.union(`/`zod.discriminatedUnion(` in any
      // `src/generated/schemas/**/*.zod.ts`), so this tradeoff does not affect real Datto
      // response validation; it is captured here as a documented, deliberate consequence of R5's
      // blanket per-field leniency for any future response schema that does use one.
      const branchA = z.object({ type: z.literal("a"), unique: z.string() });
      const branchB = z.object({ type: z.literal("b"), other: z.string() });
      const schema = z.union([branchA, branchB]);

      const data = { unrelated: "value" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "no-match-ctx");

      expect(result.success).toBe(true);
      expect(debugMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Optional / nullable unwrap
  // ---------------------------------------------------------------------------

  describe("optional unwrap", () => {
    it("detects unknowns inside an optional object after unwrap", () => {
      const schema = z.object({
        nested: z.object({ val: z.string() }).optional(),
      });
      const data = { nested: { val: "ok", surprise: "gone" } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "opt-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ nested: { val: "ok" } });
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "nested.surprise" }),
      );
    });
  });

  describe("nullable unwrap", () => {
    it("returns null unchanged for a nullable object with a null value", () => {
      const schema = z.object({
        item: z.object({ val: z.string() }).nullable(),
      });
      const data = { item: null };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "null-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ item: null });
      }
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("detects unknowns inside a nullable object with a non-null value", () => {
      const schema = z.object({
        item: z.object({ val: z.string() }).nullable(),
      });
      const data = { item: { val: "ok", extra: "nope" } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "nullable-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ item: { val: "ok" } });
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // strictObject input
  // ---------------------------------------------------------------------------

  describe("strictObject input", () => {
    it("transforms z.strictObject() correctly, detects and strips unknowns", () => {
      const schema = z.strictObject({
        id: z.number(),
        name: z.string(),
      });
      const data = { id: 1, name: "Test", extraField: "unexpected" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "strict-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 1, name: "Test" });
        expect(result.data).not.toHaveProperty("extraField");
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extraField", context: "strict-ctx" }),
      );
    });

    it("handles nested strictObject schemas", () => {
      const schema = z.strictObject({
        outer: z.strictObject({
          inner: z.string(),
        }),
      });
      const data = {
        outer: { inner: "val", nestedExtra: true },
        rootExtra: 42,
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "nested-strict");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ outer: { inner: "val" } });
      }
      expect(debugMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Pipe schema
  // ---------------------------------------------------------------------------

  describe("pipe schema", () => {
    it("detects unknowns through a pipe schema using its output schema", () => {
      const outputSchema = z.object({ parsed: z.boolean() });
      const pipeSchema = z
        .string()
        .transform((s) => JSON.parse(s) as unknown)
        .pipe(outputSchema);

      const data = JSON.stringify({ parsed: true, extra: "hidden" });
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(pipeSchema, data, logger, "pipe-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ parsed: true });
        expect(result.data).not.toHaveProperty("extra");
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra", context: "pipe-ctx" }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Default schema
  // ---------------------------------------------------------------------------

  describe("default schema", () => {
    it("detects unknowns through a default schema by unwrapping to the inner type", () => {
      const innerSchema = z.object({ name: z.string() });
      const schema = innerSchema.default({ name: "fallback" });

      const data = { name: "actual", bonus: "strip" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "default-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "actual" });
        expect(result.data).not.toHaveProperty("bonus");
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
    });

    it("uses the default value when input is undefined", () => {
      const innerSchema = z.object({ name: z.string() });
      const schema = innerSchema.default({ name: "fallback" });

      const data = undefined;
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "default-undef-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "fallback" });
      }
      expect(debugMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Cache behavior
  // ---------------------------------------------------------------------------

  describe("cache behavior", () => {
    it("reuses the cached transformation for the same schema", () => {
      const schema = z.object({ a: z.string() });
      const data1 = { a: "one", extra1: "x" };
      const data2 = { a: "two", extra2: "y" };
      const { logger: logger1 } = createMockDebugLogger();
      const { logger: logger2 } = createMockDebugLogger();

      const result1 = parseLenient(schema, data1, logger1, "cache-1");
      const result2 = parseLenient(schema, data2, logger2, "cache-2");

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data).toEqual({ a: "one" });
        expect(result2.data).toEqual({ a: "two" });
      }
    });

    it("shared sub-schemas work correctly when cached across parent schemas", () => {
      const shared = z.object({ id: z.number() });
      const schema1 = z.object({ item: shared });
      const schema2 = z.object({ other: shared });
      const { logger, debugMock } = createMockDebugLogger();

      parseLenient(schema1, { item: { id: 1 } }, logger);
      parseLenient(schema2, { other: { id: 2 } }, logger);

      const r1 = parseLenient(
        schema1,
        { item: { id: 3, extra: "a" } },
        logger,
        "cache-s1",
      );
      const r2 = parseLenient(
        schema2,
        { other: { id: 4, extra: "b" } },
        logger,
        "cache-s2",
      );

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      if (r1.success) {
        expect(r1.data).toEqual({ item: { id: 3 } });
      }
      if (r2.success) {
        expect(r2.data).toEqual({ other: { id: 4 } });
      }
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "item.extra", context: "cache-s1" }),
      );
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "other.extra", context: "cache-s2" }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // No-logger fast path
  // ---------------------------------------------------------------------------

  describe("no-logger fast path", () => {
    it("delegates directly to safeParse when no logger is provided", () => {
      const schema = z.object({ name: z.string() });
      const data = { name: "Alice", extra: "should-be-stripped-silently" };

      const result = parseLenient(schema, data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice" });
        expect(result.data).not.toHaveProperty("extra");
      }
    });

    it("no-logger result matches schema.safeParse exactly", () => {
      const schema = z.object({ id: z.number(), tags: z.array(z.string()) });
      const data = { id: 42, tags: ["a", "b"] };

      const lenientResult = parseLenient(schema, data);
      const directResult = schema.safeParse(data);

      expect(lenientResult).toEqual(directResult);
    });
  });

  // ---------------------------------------------------------------------------
  // Context propagation
  // ---------------------------------------------------------------------------

  describe("context propagation", () => {
    it("includes the context string in every debug call", () => {
      const schema = z.object({
        a: z.object({ b: z.string() }),
      });
      const data = {
        a: { b: "ok", extraNested: 1 },
        extraRoot: 2,
      };
      const { logger, debugMock } = createMockDebugLogger();
      const ctx = "POST /company/search [wire]";

      parseLenient(schema, data, logger, ctx);

      expect(debugMock).toHaveBeenCalledTimes(2);
      for (const call of debugMock.mock.calls) {
        expect(call[1]).toHaveProperty("context", ctx);
      }
    });

    it("uses (unknown) as the default context when none is provided", () => {
      const schema = z.object({ x: z.string() });
      const data = { x: "ok", y: "extra" };
      const { logger, debugMock } = createMockDebugLogger();

      parseLenient(schema, data, logger);

      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ context: "(unknown)" }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Failure passthrough
  // ---------------------------------------------------------------------------

  describe("failure passthrough", () => {
    it("returns failure unchanged when the permissive safeParse fails", () => {
      const schema = z.object({ name: z.string() });
      const data = { name: 123 }; // wrong type — leniency never coerces types
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "fail-ctx");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      expect(debugMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles empty objects", () => {
      const schema = z.object({});
      const data = { unexpected: "value" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "empty-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
    });

    it("handles deeply nested optional chains", () => {
      const schema = z.object({
        a: z
          .object({
            b: z
              .object({
                c: z.string(),
              })
              .optional(),
          })
          .optional(),
      });
      const data = { a: { b: { c: "deep", extra: "gone" } } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "deep-opt");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ a: { b: { c: "deep" } } });
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
    });

    it("handles null values in nullable schemas", () => {
      const schema = z.object({
        field: z.string().nullable(),
      });
      const data = { field: null };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "null-field");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ field: null });
      }
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("does not report a value within the declared enum set", () => {
      const schema = z.object({ status: z.enum(["active", "inactive"]) });
      const data = { status: "active", extra: "strip" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "enum-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ status: "active" });
      }
      // Only the strip is reported — 'active' is a declared member, so no widening event.
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra" }),
      );
    });

    it("handles literal schemas as terminals", () => {
      const schema = z.object({ kind: z.literal("fixed") });
      const data = { kind: "fixed", bonus: true };
      const { logger } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "literal-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ kind: "fixed" });
      }
    });

    it("handles boolean, number, string schemas as terminals", () => {
      const schema = z.object({
        flag: z.boolean(),
        count: z.number(),
        label: z.string(),
      });
      const data = { flag: true, count: 42, label: "hi", extra: "bye" };
      const { logger } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ flag: true, count: 42, label: "hi" });
      }
    });

    it("handles z.unknown() as a terminal type (no recursion)", () => {
      const schema = z.object({ data: z.unknown() });
      const data = {
        data: { anything: true, nested: { deep: 1 } },
        extra: "strip",
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "unknown-val");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          data: { anything: true, nested: { deep: 1 } },
        });
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "extra" }),
      );
    });

    it("handles objects inside arrays inside records, with no array index in the field path", () => {
      const itemSchema = z.object({ id: z.number() });
      const schema = z.record(z.string(), z.array(itemSchema));
      const data = {
        group1: [{ id: 1, extra: "a" }],
        group2: [{ id: 2 }, { id: 3, extra: "b" }],
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "complex-ctx");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          group1: [{ id: 1 }],
          group2: [{ id: 2 }, { id: 3 }],
        });
      }
      // group1's and group2's "extra" strips are different fields ('group1.extra' vs
      // 'group2.extra'), so they do not collapse into one group; group2's two items sharing
      // the same field would collapse together if both had carried the extra key.
      expect(debugMock).toHaveBeenCalledTimes(2);
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "group1.extra" }),
      );
      expect(debugMock).toHaveBeenCalledWith(
        "stripped unknown response property",
        expect.objectContaining({ field: "group2.extra" }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Round-trip correctness
  // ---------------------------------------------------------------------------

  describe("round-trip correctness", () => {
    it("parseLenient output matches safeParse for data with no unknowns", () => {
      const schema = z.object({
        name: z.string(),
        items: z.array(z.object({ id: z.number() })),
        meta: z.object({ tag: z.string() }).optional(),
      });
      const data = {
        name: "Test",
        items: [{ id: 1 }, { id: 2 }],
        meta: { tag: "v1" },
      };
      const { logger } = createMockDebugLogger();

      const lenientResult = parseLenient(schema, data, logger);
      const directResult = schema.safeParse(data);

      expect(lenientResult.success).toBe(true);
      expect(directResult.success).toBe(true);
      if (lenientResult.success && directResult.success) {
        expect(lenientResult.data).toEqual(directResult.data);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Enum degradation (R5) — Datto-specific extension
  // ---------------------------------------------------------------------------

  describe("enum degradation", () => {
    it("widens and reports a response enum field carrying an unobserved value, without dropping the item", () => {
      const schema = z.object({
        deviceClass: z.enum(["device", "printer", "esxihost"]),
      });
      const data = { deviceClass: "rmmnetworkdevice" };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "GET /device");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ deviceClass: "rmmnetworkdevice" });
      }
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({
          context: "GET /device",
          field: "deviceClass",
          value: "rmmnetworkdevice",
          count: 1,
          total: 1,
        }),
      );
    });

    it("reports a nested enum field's widening with a dotted field path", () => {
      const schema = z.object({
        antivirus: z.object({
          antivirusStatus: z.enum(["enabled", "disabled"]),
        }),
      });
      const data = { antivirus: { antivirusStatus: "unknown-status" } };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger);

      expect(result.success).toBe(true);
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({
          field: "antivirus.antivirusStatus",
          value: "unknown-status",
        }),
      );
    });

    it("aggregates the same widened enum value across an array of 50 items into one summarized debug call", () => {
      const itemSchema = z.object({
        deviceClass: z.enum(["device", "printer", "esxihost"]),
      });
      const schema = z.array(itemSchema);
      const data = Array.from({ length: 50 }, () => ({
        deviceClass: "rmmnetworkdevice",
      }));
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "GET /devices");

      expect(result.success).toBe(true);
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({
          field: "deviceClass",
          value: "rmmnetworkdevice",
          count: 50,
          total: 50,
        }),
      );
    });

    it("reports total against the enclosing array's length for an enveloped list response, not the top-level object", () => {
      // Datto's dominant real response shape wraps the named array in a `pageDetails` envelope
      // (`{ pageDetails: {...}, devices: [...] }`), so the top-level parsed value is an object,
      // not an array. `total` must still reflect `devices.length`, not `1`.
      const itemSchema = z.object({
        deviceClass: z.enum(["device", "printer", "esxihost"]),
      });
      const schema = z.object({
        pageDetails: z.object({ count: z.number(), totalCount: z.number() }),
        devices: z.array(itemSchema),
      });
      const data = {
        pageDetails: { count: 848, totalCount: 848 },
        devices: [
          ...Array.from({ length: 845 }, () => ({ deviceClass: "device" })),
          ...Array.from({ length: 3 }, () => ({
            deviceClass: "rmmnetworkdevice",
          })),
        ],
      };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "GET /site/devices");

      expect(result.success).toBe(true);
      expect(debugMock).toHaveBeenCalledTimes(1);
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({
          field: "devices.deviceClass",
          value: "rmmnetworkdevice",
          count: 3,
          total: 848,
        }),
      );
    });

    it("reports distinct widened values as separate groups within the same aggregated call", () => {
      const itemSchema = z.object({
        deviceClass: z.enum(["device", "printer", "esxihost"]),
      });
      const schema = z.array(itemSchema);
      const data = [
        { deviceClass: "rmmnetworkdevice" },
        { deviceClass: "rmmnetworkdevice" },
        { deviceClass: "rmmnetworkdevice" },
        { deviceClass: "quantumdevice" },
      ];
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "GET /devices");

      expect(result.success).toBe(true);
      expect(debugMock).toHaveBeenCalledTimes(2);
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({
          value: "rmmnetworkdevice",
          count: 3,
          total: 4,
        }),
      );
      expect(debugMock).toHaveBeenCalledWith(
        "widened response enum",
        expect.objectContaining({ value: "quantumdevice", count: 1, total: 4 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Nullability / presence leniency (R5) — Datto-specific extension
  // ---------------------------------------------------------------------------

  describe("nullability and presence leniency", () => {
    it("tolerates null on a spec-non-nullable field", () => {
      const schema = z.object({ name: z.string() });
      const data = { name: null };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "null-tolerant");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: null });
      }
      // Tolerated silently — this is not an unknown key or an enum widening.
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("tolerates an entirely absent, spec-non-optional field", () => {
      const schema = z.object({ name: z.string() });
      const data = {};
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger, "absent-tolerant");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("name");
      }
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("tolerates null on a spec-non-nullable enum field without reporting a widening", () => {
      const schema = z.object({ deviceClass: z.enum(["device", "printer"]) });
      const data = { deviceClass: null };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ deviceClass: null });
      }
      expect(debugMock).not.toHaveBeenCalled();
    });

    it("tolerates null on a spec-non-nullable nested object field", () => {
      const schema = z.object({
        antivirus: z.object({ antivirusStatus: z.string() }),
      });
      const data = { antivirus: null };
      const { logger, debugMock } = createMockDebugLogger();

      const result = parseLenient(schema, data, logger);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ antivirus: null });
      }
      expect(debugMock).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// enumFieldPaths
// ---------------------------------------------------------------------------

describe("enumFieldPaths", () => {
  it("returns an empty array for a schema with no enums", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    expect(enumFieldPaths(schema)).toEqual([]);
  });

  it("returns the top-level dotted path of an enum field", () => {
    const schema = z.object({ deviceClass: z.enum(["device", "printer"]) });
    expect(enumFieldPaths(schema)).toEqual(["deviceClass"]);
  });

  it("returns nested dotted paths at multiple depths, sorted", () => {
    const schema = z.object({
      deviceClass: z.enum(["device", "printer"]),
      antivirus: z.object({
        antivirusStatus: z.enum(["enabled", "disabled"]),
      }),
      patchManagement: z.object({
        patchStatus: z.enum(["upToDate", "outOfDate"]),
      }),
    });
    expect(enumFieldPaths(schema)).toEqual([
      "antivirus.antivirusStatus",
      "deviceClass",
      "patchManagement.patchStatus",
    ]);
  });

  it("finds an enum field nested inside an array with no index segment", () => {
    const schema = z.object({
      alerts: z.array(z.object({ priority: z.enum(["high", "low"]) })),
    });
    expect(enumFieldPaths(schema)).toEqual(["alerts.priority"]);
  });

  it("finds an enum field through optional and nullable wrapping", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive"]).optional().nullable(),
    });
    expect(enumFieldPaths(schema)).toEqual(["status"]);
  });

  it("finds an enum field through a union branch", () => {
    const schema = z.union([
      z.object({ kind: z.literal("a"), status: z.enum(["on", "off"]) }),
      z.object({ kind: z.literal("b") }),
    ]);
    expect(enumFieldPaths(schema)).toEqual(["status"]);
  });
});
