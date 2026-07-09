import type {
  AxiosError,
  AxiosResponseHeaders,
  RawAxiosResponseHeaders,
} from "axios";

import { BaseError } from "./base-error";

/**
 * 403 classification: a rate-limit IP-block penalty vs. an ordinary authorization
 * failure. Datto returns 403 for both; the caller that classifies which one applies
 * (Phase 5's `http-client.ts`) sets this explicitly via direct construction.
 */
export type DattoApiErrorCode = "ip-block" | "forbidden";

/** Options for constructing a {@link DattoApiError}. */
export interface DattoApiErrorOptions {
  /**
   * HTTP status code from the response. `0` denotes a transport-level failure with no
   * response at all (network error, timeout, DNS failure).
   */
  readonly statusCode: number;
  /** Raw response body from the API, if any. */
  readonly response?: unknown;
  /** Server-supplied request identifier, if the response carried one. */
  readonly requestId?: string;
  /** Milliseconds to wait before retrying, derived from a 429 `Retry-After` header. */
  readonly retryAfterMs?: number;
  /** 403 classification — see {@link DattoApiErrorCode}. */
  readonly code?: DattoApiErrorCode;
  /** The underlying error (typically an `AxiosError`) that caused this error. */
  readonly cause?: unknown;
}

/**
 * Common property keys that may carry a human-readable message in a Datto RMM error
 * response body. Order matters: first match wins.
 */
const ERROR_MESSAGE_KEYS = ["message", "error", "detail"] as const;

/**
 * Conventional HTTP header names that may carry a server-assigned request id. Datto's
 * OpenAPI document does not declare response headers for any operation, so this list is
 * a best-effort convention, not a confirmed contract; `requestId` is simply left
 * `undefined` when none of these are present. Order matters: first match wins.
 */
const REQUEST_ID_HEADERS = [
  "x-request-id",
  "x-requestid",
  "request-id",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extracts a human-readable error message from an unknown response payload. Checks
 * common message-bearing keys before falling back to JSON serialization.
 */
function extractErrorMessage(
  responseData: unknown,
  fallbackMessage: string,
): string {
  if (responseData === undefined) {
    return fallbackMessage;
  }

  if (typeof responseData === "string") {
    return responseData;
  }

  if (isRecord(responseData)) {
    for (const key of ERROR_MESSAGE_KEYS) {
      const value = responseData[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  try {
    return JSON.stringify(responseData);
  } catch {
    return String(responseData);
  }
}

/** Reads the first matching request-id header, if present. */
function extractRequestId(
  headers: AxiosResponseHeaders | RawAxiosResponseHeaders | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const record = headers as Record<string, unknown>;
  for (const key of REQUEST_ID_HEADERS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Error class for Datto RMM API failures — non-2xx HTTP responses and transport-level
 * failures (network errors, timeouts). Captures the HTTP status, the raw response body,
 * a server-supplied request id (when present), and, for a 429/403, the retry/block
 * classification.
 */
export class DattoApiError extends BaseError {
  /**
   * HTTP status code from the failed request. `0` denotes a transport-level failure
   * with no response.
   */
  public readonly statusCode: number;
  /** Raw response body from the API, if any. */
  public readonly response: unknown;
  /** Server-supplied request identifier, if the response carried one. */
  public readonly requestId: string | undefined;
  /** Milliseconds to wait before retrying (429 `Retry-After`), if applicable. */
  public readonly retryAfterMs: number | undefined;
  /** 403 classification — see {@link DattoApiErrorCode}. */
  public readonly code: DattoApiErrorCode | undefined;

  constructor(message: string, opts: DattoApiErrorOptions) {
    super(message, { cause: opts.cause });
    this.name = "DattoApiError";
    this.statusCode = opts.statusCode;
    this.response = opts.response;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
    this.code = opts.code;
  }

  /**
   * Builds a {@link DattoApiError} from a failed Axios request.
   *
   * This is a generic mapping only: `statusCode` falls back to `0` for a
   * transport-level failure with no HTTP response, and `requestId` is read from a
   * conventional response header if present. `retryAfterMs` and `code` are
   * intentionally left unset here — the 429 `Retry-After` parsing and the 403
   * ip-block/forbidden disambiguation both live entirely in the HTTP transport layer
   * (Phase 5's `http-client.ts`), which attaches them by constructing a
   * `DattoApiError` directly rather than through this generic path.
   */
  static fromAxiosError(err: AxiosError<unknown>): DattoApiError {
    const responseData = err.response?.data;
    const message = extractErrorMessage(responseData, err.message);

    return new DattoApiError(message, {
      statusCode: err.response?.status ?? 0,
      response: responseData,
      requestId: extractRequestId(err.response?.headers),
      cause: err,
    });
  }
}
