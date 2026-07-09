import { describe, expect, it } from "vitest";

import { pageDetailsSchema } from "@/schema-overrides/pagination";

describe("pageDetailsSchema", () => {
  it("accepts a well-formed cursor", () => {
    const result = pageDetailsSchema.safeParse({
      count: 1,
      totalCount: 2,
      prevPageUrl: null,
      nextPageUrl: "https://example.com/api/v2/account/devices?page=2",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null prevPageUrl/nextPageUrl (the normal end-of-walk terminal)", () => {
    const result = pageDetailsSchema.safeParse({
      count: 1,
      totalCount: 1,
      prevPageUrl: null,
      nextPageUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty-string nextPageUrl (the real Datto terminal form)", () => {
    const result = pageDetailsSchema.safeParse({
      count: 1,
      totalCount: 2,
      prevPageUrl: "https://example.com/api/v2/account/devices?page=1",
      nextPageUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing count (the R3 hard-fail trigger)", () => {
    const result = pageDetailsSchema.safeParse({
      totalCount: 2,
      prevPageUrl: null,
      nextPageUrl: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a mistyped totalCount", () => {
    const result = pageDetailsSchema.safeParse({
      count: 1,
      totalCount: "2",
      prevPageUrl: null,
      nextPageUrl: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an unknown extra envelope key (a benign added field, not R3's 'malformed')", () => {
    const result = pageDetailsSchema.safeParse({
      count: 1,
      totalCount: 1,
      prevPageUrl: null,
      nextPageUrl: null,
      pageSize: 50,
    });
    expect(result.success).toBe(true);
  });
});
