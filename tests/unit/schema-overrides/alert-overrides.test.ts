import { describe, expect, it } from "vitest";

import {
  ALERT_WIDENED_FIELDS,
  alertContextSchema,
  alertResponseSchema,
} from "@/schema-overrides/alert-overrides";

describe("alertContextSchema", () => {
  it("accepts a '@class'-tagged context carrying fields the spec's dead *Context schemas do not model", () => {
    const result = alertContextSchema.safeParse({
      "@class": "comp_script_ctx",
      componentName: "My Script",
      exitCode: 0,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.componentName).toBe("My Script");
    }
  });

  it("accepts an object with no '@class' at all", () => {
    const result = alertContextSchema.safeParse({ someField: "value" });
    expect(result.success).toBe(true);
  });
});

describe("alertResponseSchema", () => {
  it("validates an alert carrying a real-shaped alertContext the generated schema alone would strip", () => {
    const result = alertResponseSchema.safeParse({
      alertUid: "alert-uid-1",
      priority: "Critical",
      alertContext: {
        "@class": "patch_ctx",
        patchTitle: "KB123456",
        installDate: 1700000000000,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alertContext).toEqual({
        "@class": "patch_ctx",
        patchTitle: "KB123456",
        installDate: 1700000000000,
      });
    }
  });

  it("validates an alert with alertContext omitted entirely", () => {
    const result = alertResponseSchema.safeParse({ alertUid: "alert-uid-2" });
    expect(result.success).toBe(true);
  });
});

describe("ALERT_WIDENED_FIELDS", () => {
  it("lists the top-level fields whose subtree carries an open response enum", () => {
    expect(ALERT_WIDENED_FIELDS).toEqual(["priority", "responseActions"]);
  });
});
