import { describe, expect, it } from "vitest";

import {
  createAccountVariableWriteBodySchema,
  createSiteVariableWriteBodySchema,
  deviceJobCreateBodySchema,
  siteCreateBodySchema,
  udfWriteBodySchema,
  updateAccountVariableWriteBodySchema,
  updateProxyWriteBodySchema,
  updateSiteVariableWriteBodySchema,
  warrantyWriteBodySchema,
} from "@/schema-overrides/write-bodies";

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

describe("siteCreateBodySchema (device-job-create's sibling: already spec-required)", () => {
  it("accepts a body with only the spec-required `name`", () => {
    const result = siteCreateBodySchema.safeParse({ name: "New Site" });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing `name` (spec's own required array, not this module)", () => {
    const result = siteCreateBodySchema.safeParse({ description: "no name" });
    expect(result.success).toBe(false);
  });
});

describe("deviceJobCreateBodySchema (already spec-required)", () => {
  it("accepts a body with both spec-required fields", () => {
    const result = deviceJobCreateBodySchema.safeParse({
      jobName: "Reboot",
      jobComponent: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing `jobComponent`", () => {
    const result = deviceJobCreateBodySchema.safeParse({ jobName: "Reboot" });
    expect(result.success).toBe(false);
  });
});

describe("warrantyWriteBodySchema", () => {
  it("accepts a string warrantyDate", () => {
    const result = warrantyWriteBodySchema.safeParse({
      warrantyDate: "2027-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null warrantyDate (the documented clear-the-date form)", () => {
    const result = warrantyWriteBodySchema.safeParse({ warrantyDate: null });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body (warrantyDate must be present, even if null)", () => {
    const result = warrantyWriteBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("createSiteVariableWriteBodySchema / createAccountVariableWriteBodySchema", () => {
  it("accepts a body with the required `name`", () => {
    expect(
      createSiteVariableWriteBodySchema.safeParse({ name: "VAR" }).success,
    ).toBe(true);
    expect(
      createAccountVariableWriteBodySchema.safeParse({ name: "VAR" }).success,
    ).toBe(true);
  });

  it("rejects a body missing `name`", () => {
    expect(
      createSiteVariableWriteBodySchema.safeParse({ value: "v" }).success,
    ).toBe(false);
    expect(
      createAccountVariableWriteBodySchema.safeParse({ value: "v" }).success,
    ).toBe(false);
  });
});

describe("updateSiteVariableWriteBodySchema / updateAccountVariableWriteBodySchema", () => {
  it("accepts a body with at least one field set", () => {
    expect(
      updateSiteVariableWriteBodySchema.safeParse({ value: "v" }).success,
    ).toBe(true);
    expect(
      updateAccountVariableWriteBodySchema.safeParse({ name: "n" }).success,
    ).toBe(true);
  });

  it("rejects a completely empty body", () => {
    expect(updateSiteVariableWriteBodySchema.safeParse({}).success).toBe(false);
    expect(updateAccountVariableWriteBodySchema.safeParse({}).success).toBe(
      false,
    );
  });
});

describe("updateProxyWriteBodySchema", () => {
  it("accepts a body with at least one field set", () => {
    const result = updateProxyWriteBodySchema.safeParse({ host: "proxy" });
    expect(result.success).toBe(true);
  });

  it("rejects a completely empty body", () => {
    const result = updateProxyWriteBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
