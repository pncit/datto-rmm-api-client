import { z, ZodError } from "zod/v4";
import { validate, validateItems } from "../validation";
import { LoggerLike } from "../logger";

const schema = z.object({ id: z.number(), name: z.string() });

function mockLogger(): LoggerLike {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe("validate", () => {
  test("strict on valid data returns the parsed value", () => {
    const logger = mockLogger();
    const result = validate(schema, { id: 1, name: "a" }, "strict", logger);
    expect(result).toEqual({ id: 1, name: "a" });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("strict on invalid data throws a ZodError and does not log", () => {
    const logger = mockLogger();
    expect(() =>
      validate(schema, { id: "nope", name: "a" }, "strict", logger),
    ).toThrow(ZodError);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("warn on invalid data returns raw value and logs the failing path via logger.warn, not console", () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const logger = mockLogger();
      const data = { id: 1, name: 123 };
      const result = validate(schema, data, "warn", logger);
      expect(result).toEqual(data);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [message] = (logger.warn as jest.Mock).mock.calls[0];
      expect(message).toContain("name");
      expect(message).not.toContain("\n");
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  test("off returns raw data with no logger calls", () => {
    const logger = mockLogger();
    const data = { anything: "goes" };
    const result = validate(schema, data, "off", logger);
    expect(result).toEqual(data);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("3-arg call (no logger) still works using the default logger", () => {
    const result = validate(schema, { id: 1, name: "a" }, "strict");
    expect(result).toEqual({ id: 1, name: "a" });
  });
});

describe("validateItems", () => {
  const validItem = { id: 1, name: "a" };
  const invalidItem = { id: 2, name: 123 };

  test("strict, mixed [valid, invalid] returns only the valid item and one warning", () => {
    const logger = mockLogger();
    const { valid, warnings } = validateItems(
      schema,
      [validItem, invalidItem],
      "strict",
      "Device",
      logger,
    );
    expect(valid).toEqual([validItem]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("validation-error");
    expect(warnings[0].title).toBe("Device failed schema validation");
    expect(warnings[0].detail).toContain("id=2");
    expect(warnings[0].detail).toContain("name");
    expect(warnings[0].raw).toBeInstanceOf(ZodError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = (logger.error as jest.Mock).mock.calls[0];
    expect(message).toContain(warnings[0].detail);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("strict, invalid item missing id and uid falls back to index N in detail", () => {
    const logger = mockLogger();
    const { warnings } = validateItems(
      schema,
      [{ name: 123 }],
      "strict",
      "Device",
      logger,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail).toContain("index 0");
  });

  test("warn, mixed returns all items raw/unmutated (unknown keys survive), no warnings, logs via logger not console", () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const logger = mockLogger();
      const validWithExtraKey = { ...validItem, extra: "keepme" };
      const { valid, warnings } = validateItems(
        schema,
        [validWithExtraKey, invalidItem],
        "warn",
        "Device",
        logger,
      );
      expect(valid).toEqual([validWithExtraKey, invalidItem]);
      expect((valid[0] as any).extra).toBe("keepme");
      expect(warnings).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [message] = (logger.warn as jest.Mock).mock.calls[0];
      expect(message).toContain("id=2");
      expect(message).toContain("name");
      expect(logger.error).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  test("off, mixed returns all items as-is with no warnings and no logger calls", () => {
    const logger = mockLogger();
    const { valid, warnings } = validateItems(
      schema,
      [validItem, invalidItem],
      "off",
      "Device",
      logger,
    );
    expect(valid).toEqual([validItem, invalidItem]);
    expect(warnings).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("off, items deliberately not an array returns empty result without throwing", () => {
    const logger = mockLogger();
    expect(() =>
      validateItems(
        schema,
        "not an array" as unknown as unknown[],
        "off",
        "Device",
        logger,
      ),
    ).not.toThrow();
    const { valid, warnings } = validateItems(
      schema,
      "not an array" as unknown as unknown[],
      "off",
      "Device",
      logger,
    );
    expect(valid).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
