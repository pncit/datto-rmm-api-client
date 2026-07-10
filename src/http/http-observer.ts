import { z } from "zod";

/**
 * Public HTTP-observer contract (design "Callback payloads", plan Phase 1). Defines the seam a
 * consumer with a compliance/audit obligation uses to watch every outbound HTTP exchange the
 * client makes, without ever touching axios.
 *
 * **This module must stay axios-free.** No type here may reference the underlying HTTP
 * library's instance, response, error, or header-wrapper types — the five types below are the
 * *entire* published contract, and importing that library here would leak its types into
 * `dist/index.d.ts` the moment a consumer imports this package.
 */

/** A plain, transport-agnostic header map — the underlying HTTP library's header wrapper normalized away. */
export type DattoHttpHeaders = Record<string, string | string[] | undefined>;

/** The outbound half of one observed HTTP attempt, delivered immediately before dispatch. */
export interface DattoHttpRequestEvent {
  /** The HTTP method, uppercased (e.g. `"GET"`, `"POST"`). */
  method: string;
  /** The absolute resolved request URL (`baseURL` + path) exactly as dispatched. */
  url: string;
  /** Wire-form request headers, including `Authorization: Bearer ...` when present. */
  headers: DattoHttpHeaders;
  /**
   * The request body at wire fidelity: the serialized `application/x-www-form-urlencoded`
   * string for the OAuth grant, the pre-serialization object for a JSON write.
   */
  body: unknown;
}

/** The successful (2xx) terminal half of one observed HTTP attempt. */
export interface DattoHttpResponseEvent {
  /** The HTTP method, uppercased. Matches the `onRequest` event for the same attempt. */
  method: string;
  /** The absolute resolved request URL. Matches the `onRequest` event for the same attempt. */
  url: string;
  /** The request headers captured at `onRequest` for this same attempt. */
  requestHeaders: DattoHttpHeaders;
  /** The request body captured at `onRequest` for this same attempt. */
  requestBody: unknown;
  /** The response's HTTP status code. */
  statusCode: number;
  /** Wire-form response headers. */
  responseHeaders: DattoHttpHeaders;
  /** The parsed response body. */
  responseBody: unknown;
  /** Elapsed time, in milliseconds, from dispatch to response — excludes rate-limiter throttle wait. */
  durationMs: number;
}

/** The failing (non-2xx, or no response at all) terminal half of one observed HTTP attempt. */
export interface DattoHttpErrorEvent {
  /** The HTTP method, uppercased. Matches the `onRequest` event for the same attempt. */
  method: string;
  /** The absolute resolved request URL. Matches the `onRequest` event for the same attempt. */
  url: string;
  /** The request headers captured at `onRequest` for this same attempt. */
  requestHeaders: DattoHttpHeaders;
  /** The request body captured at `onRequest` for this same attempt. */
  requestBody: unknown;
  /**
   * The raw request error, handed off exactly as the transport produced it — never mapped or
   * re-derived. Typed `unknown` because a `throw` guarantees nothing about an error's shape; the
   * SDK's own thrown `DattoApiError` is a *separate* value the caller receives, not this field.
   */
  error: unknown;
  /** The response's HTTP status code, present only when a response was actually received. */
  statusCode?: number;
  /** Wire-form response headers, present only when a response was actually received. */
  responseHeaders?: DattoHttpHeaders;
  /** The parsed response body, present only when a response was actually received. */
  responseBody?: unknown;
  /** Elapsed time, in milliseconds, from dispatch to error — excludes rate-limiter throttle wait. */
  durationMs: number;
}

/**
 * Optional HTTP-observer callbacks on {@link DattoRmmClientConfig} (`../client/datto-client-config.ts`).
 * Every callback is independently optional; the client fires each once per physical HTTP attempt
 * it makes internally — including every retried attempt, the OAuth token grant/refresh call, and
 * every pagination page.
 *
 * **RAW, UN-REDACTED delivery.** Unlike {@link DattoLogger} (`../logging/logger.ts`), which is
 * always UDF-masked and carries no bodies or headers, these callbacks receive the exchange
 * exactly as it went over the wire — including the `Authorization: Bearer` token on every
 * shared-instance request and the API key in the OAuth grant's form body. The client redacts
 * nothing; a consumer with a compliance/audit obligation must redact on their own side before
 * persisting an event.
 *
 * A callback that throws, or returns a rejected promise, can never alter, delay, or fail the
 * request — the failure is caught, swallowed, and reported once to the client's logger at `warn`.
 */
export interface DattoHttpObserver {
  /** Fires immediately before an attempt is dispatched (post-throttle, post-auth). */
  onRequest?(event: DattoHttpRequestEvent): void;
  /** Fires when an attempt receives a 2xx response. */
  onResponse?(event: DattoHttpResponseEvent): void;
  /** Fires when an attempt receives a non-2xx response, or no response at all. */
  onError?(event: DattoHttpErrorEvent): void;
}

/**
 * Shape-only schema for a single observer callback: validates that a supplied value is callable,
 * without constraining what it does with its argument (mirrors {@link dattoLoggerSchema}'s
 * per-method `z.function` approach in `../logging/logger.ts`).
 */
const observerCallbackSchema = z
  .function({ input: [z.any()], output: z.void() })
  .optional();

/**
 * Zod schema for {@link DattoHttpObserver}. Validates structure only — that each supplied
 * callback is a function — never the event shape a consumer's callback is invoked with, so
 * parsing never strips or redacts a field from the raw payload (R9). `.strictObject` rejects any
 * key beyond the three known callbacks.
 */
export const dattoHttpObserverSchema = z.strictObject({
  onRequest: observerCallbackSchema,
  onResponse: observerCallbackSchema,
  onError: observerCallbackSchema,
});
