import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BaseError } from "../../../src/errors/base-error";
import { DattoValidationError } from "../../../src/errors/datto-validation-error";

function makeZodError(): z.ZodError {
  const result = z
    .object({ deviceClass: z.string() })
    .safeParse({ deviceClass: 5 });
  if (result.success) {
    throw new Error("expected a validation failure fixture to actually fail");
  }
  return result.error;
}

describe("DattoValidationError", () => {
  it("is an instanceof BaseError and Error", () => {
    const err = new DattoValidationError(makeZodError(), "response");
    expect(err).toBeInstanceOf(BaseError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DattoValidationError");
  });

  it("carries the stage and pretty-prints the message", () => {
    const zodError = makeZodError();
    const err = new DattoValidationError(zodError, "response");

    expect(err.stage).toBe("response");
    expect(err.zodError).toBe(zodError);
    expect(err.prettyMessage).toBe(z.prettifyError(zodError));
    expect(err.message).toContain("Validation failed for response");
    expect(err.message).toContain(err.prettyMessage);
  });

  it("distinguishes request from response stage", () => {
    const err = new DattoValidationError(makeZodError(), "request");
    expect(err.stage).toBe("request");
    expect(err.message).toContain("Validation failed for request");
  });

  it("carries optional payload and context", () => {
    const err = new DattoValidationError(makeZodError(), "response", {
      payload: { deviceClass: 5 },
      context: "GET /device/{uid}",
    });

    expect(err.payload).toEqual({ deviceClass: 5 });
    expect(err.context).toBe("GET /device/{uid}");
  });

  it("leaves payload and context undefined when omitted", () => {
    const err = new DattoValidationError(makeZodError(), "response");
    expect(err.payload).toBeUndefined();
    expect(err.context).toBeUndefined();
  });

  it("getErrorTree returns the zod treeified error", () => {
    const zodError = makeZodError();
    const err = new DattoValidationError(zodError, "response");
    expect(err.getErrorTree()).toEqual(z.treeifyError(zodError));
  });
});
