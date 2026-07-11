import axios, { type AxiosResponse } from "axios";

import type { DattoLogger } from "../logging/logger";

import type {
  DattoHttpErrorEvent,
  DattoHttpHeaders,
  DattoHttpObserver,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
} from "./http-observer";

/**
 * Internal HTTP-observer plumbing (design Decision 2, plan Phase 1). **Not exported from
 * `src/index.ts`** — like `./axios-augment.d.ts`, this module is a private implementation detail
 * that never reaches `dist/index.d.ts`.
 *
 * Both instrumentation sites the seam covers — the shared axios instance's request interceptor
 * (Phase 2) and `AuthManager.performRefresh` (Phase 3) — route every capture, header
 * normalization, and callback invocation through the primitives below, so the two sites cannot
 * drift in how they build an event or swallow a callback failure.
 */

type ObserverCallbackName = "onRequest" | "onResponse" | "onError";

/**
 * The per-attempt state captured at dispatch and reused by that same attempt's terminal event
 * (`onResponse`/`onError`). Stashed on the request config via the `__dattoObserverCapture`
 * augmentation (`./axios-augment.d.ts`) on the shared instance; held as a local variable at the
 * grant call site (`AuthManager.performRefresh`), which carries no interceptors to stash onto.
 */
export interface ObserverCapture {
  readonly method: string;
  readonly url: string;
  readonly headers: DattoHttpHeaders;
  readonly body: unknown;
  /** `Date.now()` taken at the dispatch point — after throttle acquisition and auth-header
   * attachment — so `durationMs` never folds in rate-limiter wait time. */
  readonly startedAt: number;
}

/**
 * Normalizes a header value into a plain, transport-agnostic {@link DattoHttpHeaders} record.
 * Axios's `AxiosHeaders` instances expose a `toJSON()` method; a plain object is spread as-is.
 * This is the **sole** `AxiosHeaders`-to-plain-`Record` normalizer both instrumentation sites use.
 */
export function normalizeHeaders(headers: unknown): DattoHttpHeaders {
  if (!headers) {
    return {};
  }
  const raw =
    typeof (headers as { toJSON?: () => unknown }).toJSON === "function"
      ? (headers as { toJSON: () => unknown }).toJSON()
      : headers;
  return { ...(raw as DattoHttpHeaders) };
}

/**
 * The single capture-and-stash assembler both instrumentation sites route through (design
 * Decision 2): it owns method-uppercasing and header normalization so the two sites' captures
 * can never diverge. The caller passes the **absolute resolved** `url` (`baseURL` + path) — this
 * function does not resolve it.
 */
export function captureRequest(args: {
  readonly method: string | undefined;
  readonly url: string;
  readonly headers: unknown;
  readonly body: unknown;
}): ObserverCapture {
  return {
    method: (args.method || "get").toUpperCase(),
    url: args.url,
    headers: normalizeHeaders(args.headers),
    body: args.body,
    startedAt: Date.now(),
  };
}

/**
 * Logs one swallow-`warn` for a failed observer callback, itself guarded: a consumer-supplied
 * `DattoLogger.warn` is shape-only validated and could throw. If it does, there is nothing further
 * that can be safely done — swallow that too, rather than letting a misbehaving logger reopen the
 * exact escape (an uncontrolled throw / unhandled rejection) `invokeObserver` exists to prevent.
 */
function safeWarn(
  logger: DattoLogger | undefined,
  callbackName: ObserverCallbackName,
  message: string,
): void {
  try {
    logger?.warn(message, { callback: callbackName });
  } catch {
    // The logger itself misbehaved; nothing further to do safely.
  }
}

/**
 * Invokes a single observer callback so that a synchronous `throw`, or a rejection from an
 * accidentally-async callback, can never propagate into or delay the request (R7). The callback
 * is invoked synchronously and its return value is never awaited; when the return value is
 * thenable, a `.catch`-equivalent handler is attached (without awaiting it) that swallows the
 * rejection. Every swallowed failure logs exactly one `warn`, naming the failing callback so it is
 * attributable — and that `warn` call is itself guarded (`safeWarn`) so a throwing logger can
 * never re-open the hole this function exists to close.
 *
 * Generic over the event type `E`, so each of the three call sites (`fireRequest`/`fireResponse`/
 * `fireError`) pins its own callback to its own event shape at compile time — e.g.
 * `invokeObserver<DattoHttpRequestEvent>(...)` — rather than sharing a single `never`-typed `fn`
 * parameter that erases the callback/event pairing.
 */
export function invokeObserver<E>(
  logger: DattoLogger | undefined,
  callbackName: ObserverCallbackName,
  fn: ((event: E) => void) | undefined,
  event: E,
): void {
  if (!fn) {
    return;
  }
  try {
    const returned: unknown = fn(event);
    if (
      returned !== null &&
      typeof returned === "object" &&
      typeof (returned as PromiseLike<unknown>).then === "function"
    ) {
      (returned as PromiseLike<unknown>).then(undefined, () => {
        safeWarn(
          logger,
          callbackName,
          `httpObserver ${callbackName} callback rejected; ignored`,
        );
      });
    }
  } catch {
    safeWarn(
      logger,
      callbackName,
      `httpObserver ${callbackName} callback threw; ignored`,
    );
  }
}

/** Fires `onRequest` from `capture`. A no-op when `observer` is absent. */
export function fireRequest(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
): void {
  if (!observer) {
    return;
  }
  const event: DattoHttpRequestEvent = {
    method: capture.method,
    url: capture.url,
    headers: capture.headers,
    body: capture.body,
  };
  invokeObserver<DattoHttpRequestEvent>(
    logger,
    "onRequest",
    observer.onRequest,
    event,
  );
}

/** Fires `onResponse` for a 2xx `response`, reusing `capture` for the request-side fields. */
export function fireResponse(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
  response: AxiosResponse<unknown>,
): void {
  if (!observer) {
    return;
  }
  const event: DattoHttpResponseEvent = {
    method: capture.method,
    url: capture.url,
    requestHeaders: capture.headers,
    requestBody: capture.body,
    statusCode: response.status,
    responseHeaders: normalizeHeaders(response.headers),
    responseBody: response.data,
    durationMs: Date.now() - capture.startedAt,
  };
  invokeObserver<DattoHttpResponseEvent>(
    logger,
    "onResponse",
    observer.onResponse,
    event,
  );
}

/**
 * Fires `onError` for a failed attempt. `rawError` is handed off to `onError.error` **exactly as
 * received** — never mapped or re-derived (design Decision 4 / R8). Response fields
 * (`statusCode`/`responseHeaders`/`responseBody`) are populated only when `rawError` is an
 * `AxiosError` carrying a `response`; a non-axios error (e.g. the grant's transport-failure case)
 * yields none of those fields.
 */
export function fireError(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
  rawError: unknown,
): void {
  if (!observer) {
    return;
  }
  const response = axios.isAxiosError(rawError) ? rawError.response : undefined;
  const event: DattoHttpErrorEvent = {
    method: capture.method,
    url: capture.url,
    requestHeaders: capture.headers,
    requestBody: capture.body,
    error: rawError,
    durationMs: Date.now() - capture.startedAt,
    ...(response
      ? {
          statusCode: response.status,
          responseHeaders: normalizeHeaders(response.headers),
          responseBody: response.data,
        }
      : {}),
  };
  invokeObserver<DattoHttpErrorEvent>(logger, "onError", observer.onError, event);
}
