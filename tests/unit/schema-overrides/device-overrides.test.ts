import { describe, expect, it } from "vitest";

import {
  DEVICE_WIDENED_FIELDS,
  deviceResponseSchema,
  udfSchema,
} from "@/schema-overrides/device-overrides";

describe("udfSchema", () => {
  it("accepts udf1 and udf300 (the full udf1…udf300 range) as string values", () => {
    const result = udfSchema.safeParse({ udf1: "value1", udf300: "value300" });
    expect(result.success).toBe(true);
  });

  it("accepts a null udf value", () => {
    const result = udfSchema.safeParse({ udf7: null });
    expect(result.success).toBe(true);
  });

  it("accepts a numeric udf value (not just strings — a UDF is not guaranteed to be a string)", () => {
    const result = udfSchema.safeParse({ udf3: 12345 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.udf3).toBe(12345);
    }
  });

  it("accepts a boolean udf value", () => {
    const result = udfSchema.safeParse({ udf42: true });
    expect(result.success).toBe(true);
  });

  it("accepts an object udf value", () => {
    const result = udfSchema.safeParse({
      udf9: { key: "BitLockerRecoveryKey" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an array udf value", () => {
    const result = udfSchema.safeParse({ udf10: ["a", "b"] });
    expect(result.success).toBe(true);
  });

  it("rejects a key that does not match the udf<N> pattern", () => {
    const result = udfSchema.safeParse({ notAUdf: "value" });
    expect(result.success).toBe(false);
  });
});

describe("deviceResponseSchema", () => {
  it("validates a device carrying a non-string udf300 value alongside other fields", () => {
    const result = deviceResponseSchema.safeParse({
      uid: "device-uid-1",
      hostname: "server1",
      deviceClass: "rmmnetworkdevice",
      udf: { udf1: "value1", udf300: 42, udf7: null },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.udf).toEqual({
        udf1: "value1",
        udf300: 42,
        udf7: null,
      });
      expect(result.data.deviceClass).toBe("rmmnetworkdevice");
    }
  });

  it("validates a device with udf omitted entirely", () => {
    const result = deviceResponseSchema.safeParse({ uid: "device-uid-2" });
    expect(result.success).toBe(true);
  });
});

describe("DEVICE_WIDENED_FIELDS", () => {
  it("lists the top-level fields whose subtree carries an open response enum", () => {
    expect(DEVICE_WIDENED_FIELDS).toEqual([
      "deviceClass",
      "antivirus",
      "patchManagement",
    ]);
  });
});
