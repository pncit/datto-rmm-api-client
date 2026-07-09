import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DattoApiError,
  DattoValidationError,
  isDattoApiError,
  isDattoValidationError,
} from "../../../src/errors";

describe("errors barrel type guards", () => {
  it("isDattoApiError narrows only DattoApiError instances", () => {
    const apiError = new DattoApiError("boom", { statusCode: 500 });
    expect(isDattoApiError(apiError)).toBe(true);
    expect(isDattoApiError(new Error("plain"))).toBe(false);
    expect(isDattoApiError(undefined)).toBe(false);
  });

  it("isDattoValidationError narrows only DattoValidationError instances", () => {
    const zodError = new z.ZodError([]);
    const validationError = new DattoValidationError(zodError, "request");
    expect(isDattoValidationError(validationError)).toBe(true);
    expect(isDattoValidationError(new Error("plain"))).toBe(false);
    expect(isDattoValidationError(undefined)).toBe(false);
  });
});
