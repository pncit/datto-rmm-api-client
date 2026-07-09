import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";

import { BaseError } from "../../../src/errors/base-error";
import { DattoApiError } from "../../../src/errors/datto-api-error";

function makeAxiosError(overrides: {
  message?: string;
  response?: Partial<AxiosResponse>;
}): AxiosError {
  const response = overrides.response
    ? ({
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: {} as AxiosResponse["config"],
        data: undefined,
        ...overrides.response,
      } as AxiosResponse)
    : undefined;

  return new AxiosError(
    overrides.message ?? "Request failed",
    undefined,
    undefined,
    undefined,
    response,
  );
}

describe("DattoApiError", () => {
  it("is an instanceof BaseError and Error", () => {
    const err = new DattoApiError("boom", { statusCode: 500 });
    expect(err).toBeInstanceOf(BaseError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DattoApiError");
  });

  it("stores every constructor option", () => {
    const cause = new Error("wrapped");
    const err = new DattoApiError("Rate limited", {
      statusCode: 429,
      response: { title: "Too Many Requests" },
      requestId: "req-123",
      retryAfterMs: 5000,
      code: "ip-block",
      cause,
    });

    expect(err.statusCode).toBe(429);
    expect(err.response).toEqual({ title: "Too Many Requests" });
    expect(err.requestId).toBe("req-123");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.code).toBe("ip-block");
    expect(err.cause).toBe(cause);
  });

  describe("fromAxiosError", () => {
    it("maps statusCode, response body, and message from a response with a message key", () => {
      const axiosErr = makeAxiosError({
        response: { status: 404, data: { message: "Device not found" } },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.statusCode).toBe(404);
      expect(err.response).toEqual({ message: "Device not found" });
      expect(err.message).toBe("Device not found");
      expect(err.cause).toBe(axiosErr);
    });

    it("falls back to statusCode 0 for a transport-level failure with no response", () => {
      const axiosErr = makeAxiosError({ message: "connect ECONNREFUSED" });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.statusCode).toBe(0);
      expect(err.response).toBeUndefined();
      expect(err.message).toBe("connect ECONNREFUSED");
    });

    it("extracts a requestId from a conventional request-id response header", () => {
      const axiosErr = makeAxiosError({
        response: {
          status: 500,
          headers: { "x-request-id": "abc-123" },
          data: { message: "Internal error" },
        },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.requestId).toBe("abc-123");
    });

    it("leaves requestId undefined when no conventional header is present", () => {
      const axiosErr = makeAxiosError({
        response: {
          status: 500,
          headers: {},
          data: { message: "Internal error" },
        },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.requestId).toBeUndefined();
    });

    it("leaves retryAfterMs and code unset (owned by the Phase 5 HTTP transport)", () => {
      const axiosErr = makeAxiosError({
        response: { status: 429, headers: { "retry-after": "5" }, data: {} },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.retryAfterMs).toBeUndefined();
      expect(err.code).toBeUndefined();
    });

    it("falls back to the axios message for a null response body", () => {
      const axiosErr = makeAxiosError({
        message: "Request failed with status code 500",
        response: { status: 500, data: null },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.message).toBe("Request failed with status code 500");
    });

    it("falls back to the axios message for an empty-string response body", () => {
      const axiosErr = makeAxiosError({
        message: "Request failed with status code 500",
        response: { status: 500, data: "" },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.message).toBe("Request failed with status code 500");
    });

    it("falls back to the axios message for a whitespace-only response body", () => {
      const axiosErr = makeAxiosError({
        message: "Request failed with status code 500",
        response: { status: 500, data: "   " },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.message).toBe("Request failed with status code 500");
    });

    it("falls back to JSON serialization when the response body has no known message key", () => {
      const axiosErr = makeAxiosError({
        response: { status: 400, data: { field: "apiKey", reason: "missing" } },
      });

      const err = DattoApiError.fromAxiosError(axiosErr);

      expect(err.message).toBe(
        JSON.stringify({ field: "apiKey", reason: "missing" }),
      );
    });
  });
});
