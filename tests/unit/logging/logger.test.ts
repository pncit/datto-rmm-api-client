import { describe, expect, it } from "vitest";

import { consoleLogger, dattoLoggerSchema } from "../../../src/logging/logger";

describe("dattoLoggerSchema", () => {
  it("accepts a valid logger", () => {
    const logger = {
      debug: (_message: string, _meta?: Record<string, unknown>) => {},
      info: (_message: string, _meta?: Record<string, unknown>) => {},
      warn: (_message: string, _meta?: Record<string, unknown>) => {},
      error: (_message: string, _meta?: Record<string, unknown>) => {},
    };

    expect(dattoLoggerSchema.safeParse(logger).success).toBe(true);
  });

  it("rejects a logger missing a required method", () => {
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      // error is missing
    };

    expect(dattoLoggerSchema.safeParse(logger).success).toBe(false);
  });

  it("rejects a logger whose method is not a function", () => {
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: "not a function",
    };

    expect(dattoLoggerSchema.safeParse(logger).success).toBe(false);
  });

  it("accepts the default consoleLogger", () => {
    expect(dattoLoggerSchema.safeParse(consoleLogger).success).toBe(true);
  });
});
