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
 * shared-instance request and the API key and API secret in the OAuth grant's form body. The
 * client redacts nothing; a consumer with a compliance/audit obligation must redact on their own
 * side before persisting an event.
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
 * Shape-only schema factory for a single observer callback field: validates that a supplied value
 * is callable, without constraining what it does with its argument or its return value. Generic
 * *per field* (rather than one shared, field-agnostic validator) so `z.infer` preserves each
 * field's concrete callback type instead of collapsing all three to a common denominator — see
 * the round-2 regression this replaced, below.
 *
 * This deliberately does **not** mirror {@link dattoLoggerSchema}'s per-method `z.function`
 * approach (`../logging/logger.ts`). In the installed `zod` (4.x), `z.function(...).parse(fn)`
 * does not hand back `fn` itself — it returns a *validating proxy* that (a) is not identity-equal
 * to the supplied function and (b) throws a synchronous `ZodError` at call time if the callback
 * returns anything other than `undefined`, including a rejected promise from an async callback
 * (the rejection never reaches the caller as a promise — the proxy throws before returning it).
 * That is safe for `dattoLoggerSchema` only because every logger method is internal, void-
 * returning, and never async; it is incompatible with `DattoHttpObserver`, whose R7 guarantee
 * ("a rejection from an accidentally-async callback can never leak as an unhandled rejection")
 * requires `invokeObserver` (`./observer.ts`) — not the schema — to see and handle the callback's
 * actual return value. `z.custom` returns the input unchanged on success, so the raw function
 * reference the consumer supplied is what gets delivered.
 *
 * A round-1 fix collapsed this to a single **shared, field-agnostic**
 * `z.custom<(event: never) => unknown>()` reused for all three fields. That preserved the raw
 * identity pass-through, but because every field shared the same generic argument,
 * `z.infer<typeof dattoHttpObserverSchema>` — and therefore the directly-exported
 * `DattoRmmClientConfig["httpObserver"]` — typed every callback parameter as `never`, defeating
 * the entire point of the five published event types for the most idiomatic inline-config usage.
 * This per-field generic keeps the raw pass-through *and* restores per-field type precision.
 */
function observerCallbackSchema<Fn>() {
  return z.custom<Fn>((value) => typeof value === "function").optional();
}

/**
 * Zod schema for {@link DattoHttpObserver}. Validates structure only — that each supplied
 * callback is a function — never the event shape a consumer's callback is invoked with, so
 * parsing never strips or redacts a field from the raw payload (R9). `.strictObject` rejects any
 * key beyond the three known callbacks. Each field is keyed off `DattoHttpObserver`'s own
 * per-field type (rather than a re-spelled `(event: E) => unknown`), so the hand-authored
 * interface stays the single source of truth `z.infer` tracks.
 */
export const dattoHttpObserverSchema = z.strictObject({
  onRequest: observerCallbackSchema<DattoHttpObserver["onRequest"]>(),
  onResponse: observerCallbackSchema<DattoHttpObserver["onResponse"]>(),
  onError: observerCallbackSchema<DattoHttpObserver["onError"]>(),
});
