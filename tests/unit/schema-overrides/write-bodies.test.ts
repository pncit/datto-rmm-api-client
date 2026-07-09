import { describe, expect, it } from "vitest";

import { udfWriteBodySchema } from "@/schema-overrides/write-bodies";

describe("udfWriteBodySchema", () => {
  it("accepts a body with at least one udf field set", () => {
    const result = udfWriteBodySchema.safeParse({ udf5: "new-value" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body (no udf field provided)", () => {
    const result = udfWriteBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (the generated body is a strict object)", () => {
    const result = udfWriteBodySchema.safeParse({ notAUdf: "value" });
    expect(result.success).toBe(false);
  });
});
