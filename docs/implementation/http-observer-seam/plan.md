# Plan: HTTP Observer Seam

- **Plan ID:** http-observer-seam
- **Design Document:** docs/implementation/http-observer-seam/design.md
- **Repo Context Checked:** Read the two transport layers the seam instruments — `src/http/http-client.ts` (`createHttpClient`: rate-limit request interceptor registered first, identity fulfilled response handler `(response) => response`, and `handleResponseError` which maps/retries; retries via `instance.request(config)` re-run the whole chain; the `!axios.isAxiosError(error)` guard rethrows non-axios errors — including `AuthManager`'s `DattoApiError` and rate-limiter rejects) and `src/auth/auth-manager.ts` (`AuthManager.performRefresh`: bare `grantClient` with no interceptors, body built as `new URLSearchParams({...}).toString()`, `try/catch` mapping every failure to `DattoApiError`, `tokenResponseSchema.safeParse` after a 2xx; `attachTo` registers the Bearer request interceptor on the shared instance from a separate module). Read `src/client/datto-rmm-client.ts` (constructs rate limiter → `AuthManager` → shared instance via `createHttpClient` → `authManager.attachTo(axiosInstance)`; threads the `withUdfMasking`-wrapped logger into each). Read `src/client/datto-client-config.ts` (`dattoRmmClientConfigSchema` = `z.strictObject`, `logger: dattoLoggerSchema.optional()`). Read `src/logging/logger.ts` (`DattoLogger` type + `dattoLoggerSchema = z.object({...z.function({input,output})...})` — the shape-only precedent). Read `src/http/axios-augment.d.ts` (the private, never-imported `declare module "axios"` that adds `rateDescriptor` — the stash precedent, deliberately kept out of `dist/index.d.ts`). Read `src/index.ts` (exports `DattoLogger` directly, plus `export * from "./public-types"`), `src/public-types.ts` (curated named re-exports; hand-authored public types like `DattoLogger` are exported straight from `index.ts`, not here). Read `src/client/resources/base-resource.ts` (`paginate` issues `this.axios.get` per page through the shared instance — pagination fidelity falls out of shared-instance instrumentation). Read `src/errors/datto-api-error.ts` / `src/errors/index.ts` (`DattoApiError`, `DattoApiError.fromAxiosError`, `build403Error`/`buildRateLimitError` are private to `http-client.ts`). Checked test layout: `tests/unit/http/http-client.test.ts` and `tests/unit/auth/auth-manager.test.ts` use `nock` + `vitest` with `@/` alias; `tests/generated/surface-pin.ts` is the compile-only surface pin (`@ts-expect-error` for absent exports); `tests/unit/client/surface.test.ts` is the runtime barrel test. Confirmed build: `tsup` (`dts: true`, single entry `src/index.ts`); current `dist/index.d.ts` has zero `declare module` lines (verified) but does legitimately reference `AxiosInstance`/`AxiosError` via `BaseResource.axios` and `DattoApiError.fromAxiosError` — so the axios-free guarantee for the observer must be gated at the observer's own source file, not by a blanket grep of `dist`.
- **External Research:** Verified `zod@4.4.3` is the installed version; the codebase's shape-only function validation uses `z.function({ input: [...], output: z.void() })` (`src/logging/logger.ts`) — the observer schema mirrors this exact form. Confirmed axios ^1.10.0 request interceptors run in **LIFO** (reverse-registration) order, so an interceptor registered *first* executes *last* — the mechanism Decision 5 relies on to fire `onRequest` after the rate-limit and Bearer interceptors. No new dependencies are required; `nock` and `vitest` (already dev deps) cover every new test.
- **Assumptions:**
  - The observer callbacks are delivered raw and are **never** wrapped by `withUdfMasking` (Decision 6 / R9) — the client redacts nothing.
  - Mirroring `dattoLoggerSchema`'s `z.function` shape-only validation keeps the callbacks pass-through (invocable, un-wrapped) after `safeParse`, exactly as the logger is today (verified by the logger's own working behavior; a new test asserts a supplied `onRequest` is invoked with the raw body).
  - `src/http/axios-augment.d.ts` is never imported by any value module in `src/index.ts`'s graph, so extending it with the observer stash keeps the `declare module "axios"` block out of `dist/index.d.ts` (the existing `rateDescriptor` precedent).
  - Firing `onError` once per dispatched attempt from inside `handleResponseError` (after the `!axios.isAxiosError` guard) is the single terminal-selection point for the shared instance; the non-dispatched paths (rate-limiter reject, Bearer `getToken()` throw) are non-axios rejects the guard rethrows before the fire, so they never fire a shared-instance `onError` (Decision 4 rule 2).
- **Quality Bar:** Extensibility and best practices prioritized. Backwards compatibility not prioritized unless explicitly stated. (This work is purely additive — no breaking changes.)

---

## Summary
- **Executive Summary:** This adds an optional "HTTP observer" to the Datto RMM client so a consumer with a compliance/audit obligation can watch every outbound HTTP exchange the client makes — the request, the response or error, and how long it took — without ever touching the underlying HTTP library (axios). The client keeps full ownership of authentication, rate limiting, retries, and pagination; the observer is a pure spectator that is handed the raw request/response data (including secrets) so the consumer can redact and record it however their pipeline requires. A misbehaving observer callback can never slow down, alter, or fail a real request. This restores a capability that existed in 0.1.x (inject-an-axios-instance-and-add-interceptors) in a safe, transport-agnostic form, unblocking adoption of 1.0.x for compliance-bound consumers.
- **Goals:**
  - Add an optional `httpObserver` (`onRequest`/`onResponse`/`onError`) to `DattoRmmClientConfig`; absence changes nothing.
  - Fire once per **physical HTTP attempt** — retries are never collapsed; a `429 → retry → 200` surfaces as two attempts.
  - Cover the two internal exchanges 0.1.x consumers relied on: the OAuth token grant/refresh and every pagination page.
  - Deliver request/response bodies at wire fidelity, un-redacted (grant body as the serialized urlencoded string; JSON writes as the pre-serialization object; JSON responses as the parsed object).
  - Guarantee a callback `throw` or returned-promise rejection can never alter, delay, or fail the request.
  - Export exactly **five** axios-free public types: `DattoHttpObserver`, `DattoHttpRequestEvent`, `DattoHttpResponseEvent`, `DattoHttpErrorEvent`, `DattoHttpHeaders`.
- **Non-Goals:**
  - Reinstating `axiosInstance` injection or accepting caller-supplied interceptors — the transport stays internal and the strict schema keeps rejecting `axiosInstance`.
  - Exposing any axios type in the public contract.
  - Client-side redaction of any field (the consumer redacts).
  - Firing on post-2xx / non-HTTP failures (`DattoValidationError`, the grant's malformed-token `DattoApiError`, pagination cursor/guard failures).
  - Changing any existing auth, rate-limit, retry, or pagination behavior.

---

## Implementation Notes for the Implementor(s)
- **Scope discipline:** implement exactly one phase at a time; run that phase's Exit Gate before starting the next. Do not begin instrumenting a transport layer (Phase 2/3) until Phase 1's public types, schema, and internal helper exist.
- **Expected commands:** `npm run typecheck`, `npm test`, and (for the type-surface gates) `npm run build`. The `@/` import alias maps to `src/` in tests. Tests use `vitest` + `nock`.
- **Do NOT:**
  - Do **not** wrap the observer in `withUdfMasking` or redact any field — raw delivery is the whole point (Decision 6 / R9). The masked logger is used **only** to report a swallowed callback failure.
  - Do **not** `await` a callback's return value and do **not** let a callback `throw` or rejection escape — route every invocation through the Phase 1 swallow-wrapper.
  - Do **not** import `src/http/axios-augment.d.ts` from any value module — that would leak `declare module "axios"` into `dist/index.d.ts`.
  - Do **not** re-read `response.config.data`/`.headers` for the terminal event's request fields — reuse the stash captured at `onRequest` (axios has by then serialized the body and normalized the headers).
  - Do **not** add any axios type to `src/http/http-observer.ts` (the public-types module) — it must stay axios-free.
  - Do **not** change the shared instance's existing retry/rate-limit/error-mapping outcomes; the seam only observes.

---

## Phase 1: Public observer types, config schema, and the internal observer helper

### Goal
Establish the seam's contract and shared plumbing without changing any request behavior: the five axios-free public types plus a shape-only Zod schema (`src/http/http-observer.ts`), the strict-config acceptance of `httpObserver` (R1, R10), the public exports, the per-attempt stash augmentation, and the single internal helper module (`src/http/observer.ts`) that owns the three primitives both transport layers will consume — the invoke-and-swallow-with-`warn` wrapper (R7), the `AxiosHeaders`→plain-`Record` normalizer, and the capture/event assembler (Decision 5, R5). At the end of this phase the types compile and export, the schema validates and round-trips a raw observer, and the helper is unit-tested in isolation; no interceptor or grant path fires yet.

**Requirements:** R1, R5, R7, R8, R9, R10

### Steps
1. **Author the public types + shape-only schema**: Create `src/http/http-observer.ts` with `DattoHttpHeaders`, `DattoHttpRequestEvent`, `DattoHttpResponseEvent`, `DattoHttpErrorEvent`, `DattoHttpObserver`, and `dattoHttpObserverSchema`.
   - Files: `src/http/http-observer.ts` (new)
   - Notes: This file **must not import axios** (gated). `onError`'s `error` field is typed `unknown` — the raw request error is handed off as-is, so no error type needs importing (Decision 4 / R8 per the engineer-r1-f1 ruling). The schema mirrors `dattoLoggerSchema` exactly — `z.strictObject` of three optional `z.function` fields. Document the raw-delivery contract prominently in the `DattoHttpObserver` doc comment (Risk mitigation: consumer must redact; payloads carry bearer tokens and the API key), and note on the `error` field that it is the raw thrown value (`unknown`), never a mapped/re-derived error.
2. **Accept `httpObserver` in the strict config schema**: Add `httpObserver: dattoHttpObserverSchema.optional()` to `dattoRmmClientConfigSchema`.
   - Files: `src/client/datto-client-config.ts`
   - Notes: `.strictObject` continues to reject `axiosInstance` and unknown keys (R10). Add a `.describe(...)` noting raw, unmasked delivery (unlike the logger).
3. **Export the five types from the public barrel**: Add a `export type { ... } from "./http/http-observer"` line to `src/index.ts`, alongside the existing `DattoLogger` export.
   - Files: `src/index.ts`
   - Notes: Hand-authored public types go straight through `index.ts` (the `DattoLogger` precedent), **not** through `public-types.ts` (which is for generated/reconciled entity types).
4. **Extend the private axios augmentation with the per-attempt stash**: Add an optional `__dattoObserverCapture?: ObserverCapture` field to both `AxiosRequestConfig` and `InternalAxiosRequestConfig` in `src/http/axios-augment.d.ts`, importing `ObserverCapture` as a type from `./observer`.
   - Files: `src/http/axios-augment.d.ts`
   - Notes: Keep this file un-imported by any value module (its existing doc explains why). The stash holds the captured request payload (`method`/`url`/`headers`/`body`) plus the dispatch timestamp.
5. **Create the internal observer helper**: Create `src/http/observer.ts`. Its **complete** exported surface is exactly these primitives — and **both instrumentation sites (Phase 2 interceptor, Phase 3 `performRefresh`) route through them; neither hand-builds a capture inline nor maps an error site-locally**, so the two sites cannot drift (design Decision 2):
   - `ObserverCapture` (internal type): `{ method, url, headers, body, startedAt }`.
   - `normalizeHeaders(headers: unknown): DattoHttpHeaders` — the sole `AxiosHeaders`→plain-`Record` normalizer.
   - `captureRequest({ method, url, headers, body }): ObserverCapture` — **the shared capture-and-stash assembler** (design Decision 2; engineer-r1-f3 ruling). It owns method-uppercasing (`(method ?? "get").toUpperCase()`), header normalization (via `normalizeHeaders`), and stamps `startedAt = Date.now()`. Callers pass the **absolute resolved** `url` (architect-r1-f2). Both sites build every capture through this one function so uppercasing/normalization can never diverge.
   - `invokeObserver(logger, callbackName, fn, event)` — the swallow-wrapper; `callbackName` is `"onRequest" | "onResponse" | "onError"` and is included in the swallow `warn` (message and `meta`) so a swallowed failure is attributable (engineer-r1-f5 ruling).
   - `fireRequest`, `fireResponse`, `fireError` — build the matching `DattoHttp*Event` from a capture (+ response/error) and route the callback through `invokeObserver`. Each accepts `observer: DattoHttpObserver | undefined` and is a no-op when it is absent.
   - Files: `src/http/observer.ts` (new)
   - Notes: Internal-only — never re-exported from `index.ts`, so it never reaches `dist/index.d.ts` (like `axios-augment.d.ts`). `invokeObserver` calls the callback synchronously in a `try/catch`; on a synchronous `throw` it logs one `warn` (naming the callback) and swallows; when the return value is thenable it attaches a `.catch` (without awaiting) that logs one `warn` and swallows (R7). **There is no `mapObserverError` and no error-mapping in this module** — under the engineer-r1-f1 ruling `onError.error` is `unknown`. `fireError`'s pinned signature is `fireError(logger, observer, capture, rawError: unknown)`: it passes `rawError` **straight through** to `onError.error` unchanged (no pre-map, no 5th `mappedError` argument). It populates `statusCode`/`responseHeaders`/`responseBody` **only when a response is present**, narrowing via `axios.isAxiosError(rawError) && rawError.response` (or structural `rawError.response`); a non-axios `rawError` (the grant's transport-failure case) yields **no** response fields (R8/R6).

### Opinionated Implementation Notes (Examples)
```typescript
// src/http/http-observer.ts
import { z } from "zod";

export type DattoHttpHeaders = Record<string, string | string[] | undefined>;

export interface DattoHttpRequestEvent {
  method: string;
  url: string;
  headers: DattoHttpHeaders;
  body: unknown; // grant: serialized urlencoded string; JSON write: pre-serialization object
}

export interface DattoHttpResponseEvent {
  method: string; url: string;
  requestHeaders: DattoHttpHeaders; requestBody: unknown;
  statusCode: number; responseHeaders: DattoHttpHeaders; responseBody: unknown;
  durationMs: number;
}

export interface DattoHttpErrorEvent {
  method: string; url: string;
  requestHeaders: DattoHttpHeaders; requestBody: unknown;
  error: unknown;                    // the raw request error, handed off as-is (Decision 4 / R8)
  statusCode?: number;              // present iff a response was received
  responseHeaders?: DattoHttpHeaders;
  responseBody?: unknown;
  durationMs: number;
}

/**
 * RAW, UN-REDACTED delivery: unlike DattoLogger, these callbacks receive bearer tokens
 * and the grant's API key verbatim. The client redacts nothing — the consumer must.
 */
export interface DattoHttpObserver {
  onRequest?(event: DattoHttpRequestEvent): void;
  onResponse?(event: DattoHttpResponseEvent): void;
  onError?(event: DattoHttpErrorEvent): void;
}

const callbackSchema = z
  .function({ input: [z.any()], output: z.void() })
  .optional();

export const dattoHttpObserverSchema = z.strictObject({
  onRequest: callbackSchema,
  onResponse: callbackSchema,
  onError: callbackSchema,
});
```

```typescript
// src/http/observer.ts  (INTERNAL — never exported from index.ts)
import axios, { type AxiosResponse } from "axios";
import type { DattoLogger } from "../logging/logger";
import type {
  DattoHttpObserver,
  DattoHttpHeaders,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
  DattoHttpErrorEvent,
} from "./http-observer";

type ObserverCallbackName = "onRequest" | "onResponse" | "onError";

export interface ObserverCapture {
  method: string;
  url: string;
  headers: DattoHttpHeaders;
  body: unknown;
  startedAt: number; // Date.now() taken AFTER throttle/auth, at the dispatch point
}

export function normalizeHeaders(headers: unknown): DattoHttpHeaders {
  if (!headers) return {};
  // AxiosHeaders exposes toJSON(); a plain object is spread as-is.
  const raw =
    typeof (headers as { toJSON?: () => unknown }).toJSON === "function"
      ? (headers as { toJSON: () => unknown }).toJSON()
      : headers;
  return { ...(raw as Record<string, string | string[] | undefined>) };
}

/**
 * The single capture-and-stash assembler BOTH instrumentation sites route through (Decision 2),
 * so method-uppercasing and header normalization can never drift between them. `url` must be the
 * absolute resolved URL (baseURL + path) — the caller composes it (architect-r1-f2).
 */
export function captureRequest(args: {
  method: string | undefined;
  url: string;
  headers: unknown;
  body: unknown;
}): ObserverCapture {
  return {
    method: (args.method ?? "get").toUpperCase(),
    url: args.url,
    headers: normalizeHeaders(args.headers),
    body: args.body,
    startedAt: Date.now(),
  };
}

/** Invoke a callback so a throw or a returned rejection can never affect the request (R7). */
export function invokeObserver(
  logger: DattoLogger | undefined,
  callbackName: ObserverCallbackName,
  fn: ((event: never) => void) | undefined,
  event: unknown,
): void {
  if (!fn) return;
  try {
    const ret = (fn as (e: unknown) => unknown)(event);
    if (ret && typeof (ret as PromiseLike<unknown>).then === "function") {
      (ret as PromiseLike<unknown>).then?.(undefined, () =>
        logger?.warn(`httpObserver ${callbackName} callback rejected; ignored`, {
          callback: callbackName,
        }),
      );
    }
  } catch {
    logger?.warn(`httpObserver ${callbackName} callback threw; ignored`, {
      callback: callbackName,
    });
  }
}

export function fireRequest(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
): void {
  if (!observer) return;
  const event: DattoHttpRequestEvent = {
    method: capture.method,
    url: capture.url,
    headers: capture.headers,
    body: capture.body,
  };
  invokeObserver(logger, "onRequest", observer.onRequest, event);
}

export function fireResponse(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
  response: AxiosResponse<unknown>,
): void {
  if (!observer) return;
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
  invokeObserver(logger, "onResponse", observer.onResponse, event);
}

/**
 * Fire onError. `rawError` is handed STRAIGHT THROUGH to `onError.error` as `unknown` — no
 * mapping (Decision 4 / R8). Response fields are populated ONLY when a response is present.
 */
export function fireError(
  logger: DattoLogger | undefined,
  observer: DattoHttpObserver | undefined,
  capture: ObserverCapture,
  rawError: unknown,
): void {
  if (!observer) return;
  const response = axios.isAxiosError(rawError) ? rawError.response : undefined;
  const event: DattoHttpErrorEvent = {
    method: capture.method,
    url: capture.url,
    requestHeaders: capture.headers,
    requestBody: capture.body,
    error: rawError, // raw pass-through — never re-mapped
    durationMs: Date.now() - capture.startedAt,
    ...(response
      ? {
          statusCode: response.status,
          responseHeaders: normalizeHeaders(response.headers),
          responseBody: response.data,
        }
      : {}),
  };
  invokeObserver(logger, "onError", observer.onError, event);
}
```

### Tests (in this phase)
- `tests/unit/http/observer.test.ts` (new): `normalizeHeaders` flattens an `AxiosHeaders` instance to a plain record and passes a plain object through; `captureRequest` uppercases the method (`"get"` → `"GET"`), normalizes an `AxiosHeaders` argument, preserves the absolute `url` it is handed verbatim, and stamps a numeric `startedAt`; `invokeObserver` (a) swallows a synchronous `throw` and logs exactly one `warn` **whose message/`meta` names the failing callback** (e.g. `onResponse`), (b) swallows a returned rejected promise with one `warn` (also naming the callback) and produces **no** unhandled rejection, (c) is a no-op when the callback is `undefined`, (d) never awaits (returns synchronously even when the callback returns a slow-resolving promise); `fireError` delivers the **exact** `rawError` object it was handed to `onError.error` **unchanged** (identity-equal) for both an `AxiosError` and a plain non-axios `Error`, populates `statusCode`/`responseHeaders`/`responseBody` when the `AxiosError` carries a `response`, and populates **none** of those response fields for the non-axios error (R8/R6).
- `tests/unit/client/datto-client-config.test.ts` (extend, or add if absent): a config carrying an `httpObserver` with all three raw callbacks passes `dattoRmmClientConfigSchema.safeParse` and the parsed callbacks are still invocable (round-trip / pass-through — proves shape-only validation does not neuter raw delivery); `axiosInstance` and unknown keys still fail validation (R10).
- `tests/generated/surface-pin.ts` (extend): add positive type-only imports of the five observer types from `../../src/index` used in a typed position, proving they are exported (a removed export breaks `npm run typecheck`).

### Documentation (if needed)
- Doc comments only in this phase (the `DattoHttpObserver` raw-delivery warning). README prose lands in Phase 4 once the behavior is wired.

### Exit Gate

```bash
npm run typecheck
npm test
npm run build
grep -q 'DattoHttpObserver' dist/index.d.ts
! grep -q 'declare module' dist/index.d.ts
! grep -Eq "from ['\"]axios['\"]" src/http/http-observer.ts
! grep -Eq '\bAxios[A-Z]' src/http/http-observer.ts
```

- `src/http/observer.ts` is not re-exported from `src/index.ts` (internal-only).
- No existing test regressed.

---

## Phase 2: Instrument the shared axios instance

### Goal
Make the shared instance (`createHttpClient`) fire the observer once per physical attempt: `onRequest` at the post-throttle, post-auth dispatch point (capturing-and-stashing the request payload + timestamp whenever `httpObserver` is present, independent of which callbacks are supplied), `onResponse` from the fulfilled response handler on a 2xx, and `onError` from `handleResponseError` (after the `!axios.isAxiosError` guard) on every dispatched non-2xx or transport failure — including retried attempts, so a `429 → retry → 200` yields `onError(429)` then `onResponse(200)`. Thread the raw (unmasked) observer from `DattoRmmClient` into `createHttpClient`. Pagination fidelity (R4) falls out for free because every page issues through this instance.

**Requirements:** R2, R4, R5, R6, R7, R8, R9

### Steps
1. **Add `httpObserver` to `HttpClientConfig`**: New optional field, threaded raw.
   - Files: `src/http/http-client.ts`
   - Notes: Also thread the existing masked `logger` into `invokeObserver` for swallow-`warn` (already present on the config). Add a doc comment on the new `httpObserver` field explicitly noting it is delivered **raw/unmasked** — unlike the adjacent masked `logger` field — so a future reader does not assume logger parity (engineer-r1-f8).
2. **Register the observer request interceptor FIRST**: Inside `createHttpClient`, register the observer's request interceptor **before** the rate-limit interceptor so that under axios LIFO it runs **last** — after rate-limit acquisition and after the Bearer interceptor `AuthManager.attachTo` adds later. In it, build the capture through the **shared `captureRequest` assembler** (never inline) with the **absolute resolved** `url` — `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` (architect-r1-f2) — passing `requestConfig.method`, `requestConfig.headers`, and `requestConfig.data`; stash it onto `requestConfig.__dattoObserverCapture` (unconditionally overwritten every pass), then fire `onRequest` from the stash.
   - Files: `src/http/http-client.ts`
   - Notes: Capture-and-stash runs whenever `httpObserver` is present, **not** gated on `onRequest` (Decision 5) — an `onError`-only consumer still gets a populated stash. `captureRequest` owns the method-uppercasing and `normalizeHeaders` call, so this site does **not** re-implement them inline (design Decision 2 / engineer-r1-f3). `body` is `requestConfig.data` (the pre-serialization object, R5) because this interceptor runs before axios's `transformRequest`. Only register the interceptor at all when `httpObserver` is defined (zero overhead otherwise).
3. **Fire `onResponse` from the fulfilled response handler**: In the existing `instance.interceptors.response.use((response) => response, ...)`, when `response.config.__dattoObserverCapture` is present, fire `onResponse` with the stashed request fields, `response.status`, `normalizeHeaders(response.headers)`, `response.data`, and `durationMs = Date.now() - startedAt`.
   - Files: `src/http/http-client.ts`
4. **Fire `onError` once per dispatched attempt in `handleResponseError`**: Thread the observer into `handleResponseError` by adding **`httpObserver?: DattoHttpObserver` as its 6th positional parameter, inserted immediately before `error`** (after `logger`) — the new signature is `handleResponseError(instance, retryPolicy, onUnauthorized, logger, httpObserver, error)`, and the response-interceptor call site passes `config.httpObserver` in that slot. After the `if (!axios.isAxiosError(error)) throw error;` guard, read the stash **directly off the globally-augmented `error.config`** — `error.config?.__dattoObserverCapture` (the `axios-augment.d.ts` augment puts `__dattoObserverCapture` on `InternalAxiosRequestConfig`, so no cast through `RetryTrackedConfig` is needed — and `RetryTrackedConfig` does not carry that field). If the stash is present, fire `onError` with `fireError(logger, httpObserver, cap, error)` — the raw `AxiosError` is handed **straight through** to `onError.error` (no `mapObserverError`, no pre-map; engineer-r1-f1 ruling), and `fireError` itself adds `statusCode`/response fields when `error.response` exists. Leave all existing retry/throw logic below unchanged.
   - Files: `src/http/http-client.ts`
   - Notes: Placing the fire **after** the guard is what excludes the two non-dispatched paths (rate-limiter reject; Bearer `getToken()` throwing a `DattoApiError`) — both are non-axios rejects the guard rethrows first (Decision 4 rule 2). Firing once here (the interceptor runs once per attempt) means a retried attempt fires its terminal `onError` before `instance.request(config)` re-dispatches and the request interceptor overwrites the stash for attempt N+1 (R2). The 6th-positional-param approach keeps `handleResponseError`'s stable signature; the options-object refactor is **not** mandated (engineer-r1-f7). Naming note: the stash field is `__datto`-prefixed (`__dattoObserverCapture`) whereas its `axios-augment.d.ts` sibling `rateDescriptor` is unprefixed — the `__datto` prefix is retained deliberately to mark this as private per-attempt instrumentation state (matching the `__dattoRetryCount`/`__dattoUnauthorizedRetried` retry keys), and the augment is kept (not switched to a local intersection) because design Decision 5 / Schema-and-wiring mandates the `rateDescriptor` augment precedent (engineer-r1-f6).
5. **Thread the raw observer through the client**: In `DattoRmmClient`, pass `validated.httpObserver` into `createHttpClient`'s config **unmasked** (do not route through `withUdfMasking`).
   - Files: `src/client/datto-rmm-client.ts`

### Opinionated Implementation Notes (Examples)
```typescript
// createHttpClient — register observer FIRST so it runs LAST (post-throttle, post-auth).
if (config.httpObserver) {
  instance.interceptors.request.use((requestConfig) => {
    // Build EVERY capture through the shared assembler — never inline (Decision 2).
    const capture = captureRequest({
      method: requestConfig.method,
      url: `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}`, // absolute resolved URL
      headers: requestConfig.headers,
      body: requestConfig.data, // pre-serialization object (R5)
    });
    requestConfig.__dattoObserverCapture = capture; // unconditional overwrite
    fireRequest(config.logger, config.httpObserver, capture);
    return requestConfig;
  });
}
// ...rate-limit interceptor registered AFTER the block above...

instance.interceptors.response.use(
  (response) => {
    const cap = response.config.__dattoObserverCapture;
    if (cap) {
      fireResponse(config.logger, config.httpObserver, cap, response);
    }
    return response;
  },
  (error) => handleResponseError(instance, retryPolicy, config.onUnauthorized, config.logger, config.httpObserver, error),
);

// inside handleResponseError, immediately after the isAxiosError guard.
// Read the stash off the globally-augmented config directly — no RetryTrackedConfig cast.
const cap = error.config?.__dattoObserverCapture;
if (cap) {
  fireError(logger, httpObserver, cap, error); // raw AxiosError handed straight through (R8)
}
```

### Tests (in this phase)
- `tests/unit/http/http-client.test.ts` (extend), using `nock`:
  - 2xx read fires `onRequest` then `onResponse`; the observed request headers carry `Authorization: Bearer ...` (attach a Bearer interceptor in the test to mirror `attachTo`) and the response event carries the parsed body and a numeric `durationMs`.
  - `429 (Retry-After) → 200` fires `onRequest` twice and yields `onError(statusCode 429)` then `onResponse(statusCode 200)` — two observed attempts (R2/R6).
  - A JSON write (`post`) delivers `body`/`requestBody` as the **pre-serialization object**, not the serialized string (R5).
  - The terminal event's `requestHeaders`/`requestBody` equal what `onRequest` captured for the same attempt (assert they are the stash, not re-read serialized `response.config`).
  - Every event's `url` is the **absolute resolved** URL (`` `${apiUrl}${path}` ``), not the bare relative path (architect-r1-f2).
  - A transport failure (network error, no response) fires `onError` whose `error` is the **raw thrown error handed off unchanged** (identity-equal, not a re-derived `DattoApiError`) and with **no** `statusCode` (R8); a non-2xx fires `onError` whose `error` is the raw `AxiosError` with `statusCode` present.
  - `durationMs` excludes throttle: inject a rate limiter whose `acquire` delays before dispatch and assert `durationMs` reflects only the (near-instant, nock) round-trip, not the injected delay (Decision 5).
  - An **`onError`-only** observer (no `onRequest`) still receives a terminal `onError` on a non-2xx with `requestHeaders`/`requestBody`/`durationMs` populated from the stash (Decision 5 capture-independent-of-callback).
  - A callback that throws, and one returning a rejected promise, leave the request outcome unchanged and log one `warn` (R7).

### Documentation (if needed)
- None in this phase (README lands in Phase 4).

### Exit Gate

```bash
npm run typecheck
npm test
npm run build
! grep -q 'declare module' dist/index.d.ts
```

- Existing `http-client.test.ts` cases pass unchanged (no behavior regression).
- `npm run build` + the `declare module` check run here because Phase 2 makes axios-importing `src/http/observer.ts` reachable from the `index.ts` value graph (via `http-client.ts`), so a leaked `declare module "axios"` would first surface at this phase. (No blanket `grep 'axios' dist/index.d.ts` — `dist/index.d.ts` already references `AxiosInstance`/`AxiosError` legitimately via `BaseResource.axios` / `DattoApiError.fromAxiosError`.)

---

## Phase 3: Instrument the OAuth grant/refresh path

### Goal
Make `AuthManager.performRefresh` fire the observer for the token grant/refresh attempt: capture-and-stash at its own dispatch point (the grant client carries no interceptors), fire `onRequest` before the POST with `body` equal to the **serialized `application/x-www-form-urlencoded` string** as sent on the wire (R3/R5), fire `onResponse` on a 2xx **before** `tokenResponseSchema.safeParse` runs (so a malformed-token 2xx fires exactly one terminal event — `onResponse` — and never `onError`, Decision 4 rule 3), and fire `onError` in the existing `catch` for a non-2xx or transport failure handing off the **raw caught error** as `unknown` (R8 per the engineer-r1-f1 ruling — the observer no longer receives a mapped error). The method still constructs and **rethrows** its own `DattoApiError` to the caller exactly as today — only the observer stops receiving the mapped form. All existing logging (`logger?.debug`/`logger?.warn`) and the `issuedAt` token-TTL anchor are **preserved unchanged** (engineer-r1-f2 / Cluster 2). The grant's captured header map omits `Authorization` by design (the `Basic public-client:public` header is applied internally by axios); the API key rides in the captured body. Thread the raw observer from `DattoRmmClient` into `AuthManager`.

**Requirements:** R3, R5, R6, R7, R8, R9

### Steps
1. **Add `httpObserver` to `AuthManagerConfig`**: New optional field, threaded raw.
   - Files: `src/auth/auth-manager.ts`
   - Notes: Add a doc comment on the new `httpObserver` field explicitly noting it is delivered **raw/unmasked** — unlike the adjacent masked `logger` field beside it (engineer-r1-f8).
2. **Capture-and-stash + fire `onRequest` at the grant dispatch point**: In `performRefresh`, build the capture through the **shared `captureRequest` assembler** (never inline — design Decision 2 / engineer-r1-f3) with method `"POST"`, the **absolute resolved** `url` `` `${this.config.apiUrl}${GRANT_PATH}` `` (architect-r1-f2), headers `{ "Content-Type": "application/x-www-form-urlencoded" }` (the `Authorization: Basic` header is absent by design), and `body` the serialized wire string; fire `onRequest`. Do this **without disturbing** the existing `issuedAt = Date.now()` (L141) and `logger?.debug("refreshing…")` (L142).
   - Files: `src/auth/auth-manager.ts`
   - Notes: `body` is `body.toString()` — the exact wire string (already computed for the POST). `captureRequest` stamps its own `startedAt` (the observer's dispatch timestamp) which `durationMs` uses; the pre-existing `issuedAt` remains the **token-TTL anchor** and is a distinct value that stays exactly as today (they may coincide but serve different purposes — do not collapse `issuedAt` into `startedAt`).
3. **Fire `onResponse` on 2xx before `safeParse`**: Immediately after the `await this.grantClient.post(...)` resolves (a 2xx — axios rejects non-2xx into the `catch`), fire `onResponse` from the stash with `response.status`, `normalizeHeaders(response.headers)`, `response.data`, and `durationMs`. This is **before** the `tokenResponseSchema.safeParse` check, so a malformed-token 2xx cannot re-enter a terminal event.
   - Files: `src/auth/auth-manager.ts`
4. **Fire `onError` in the existing `catch`**: Preserve the existing `catch` body verbatim — the `logger?.warn("Datto RMM OAuth2 token refresh failed")` (L156) and the existing mapping/rethrow (axios → `DattoApiError.fromAxiosError(err)`; non-axios → `new DattoApiError("Datto RMM authentication failed", { statusCode: 0, cause: err })`) all stay. **Add** a single `fireError(this.config.logger, this.config.httpObserver, capture, err)` call that hands off the **raw caught `err`** as `unknown` (never the mapped `DattoApiError`; engineer-r1-f1 ruling) — `fireError` itself adds `statusCode`/response fields when `err` is an `AxiosError` with a `response`. Do this **before** the rethrow so both still happen.
   - Files: `src/auth/auth-manager.ts`
   - Notes: Do **not** fire `onError` on the malformed-token throw path (that follows a 2xx that already fired `onResponse`). The malformed-response `logger?.warn` (L168) and its `DattoApiError` throw also stay unchanged. The observer receives the **raw** error; the caller still receives the constructed/rethrown `DattoApiError`.
5. **Thread the raw observer through the client**: In `DattoRmmClient`, pass `validated.httpObserver` into the `AuthManager` config **unmasked**.
   - Files: `src/client/datto-rmm-client.ts`

### Opinionated Implementation Notes (Examples)
```typescript
// performRefresh — observer fires AROUND the existing logic; every existing line is preserved.
const issuedAt = Date.now();                                    // UNCHANGED — token-TTL anchor
this.config.logger?.debug("refreshing Datto RMM OAuth2 token"); // UNCHANGED

const wireBody = body.toString();
const capture = captureRequest({                                // shared assembler (Decision 2)
  method: "POST",
  url: `${this.config.apiUrl}${GRANT_PATH}`,                     // absolute resolved URL (architect-r1-f2)
  headers: { "Content-Type": "application/x-www-form-urlencoded" }, // Basic auth absent by design
  body: wireBody,                                               // serialized urlencoded string (R3/R5)
});
// capture.startedAt is the observer's dispatch timestamp; issuedAt above stays the TTL anchor.
fireRequest(this.config.logger, this.config.httpObserver, capture);

let response;
try {
  response = await this.grantClient.post<unknown>(GRANT_PATH, wireBody, {
    auth: { username: BASIC_AUTH_USERNAME, password: BASIC_AUTH_PASSWORD },
  });
} catch (err) {
  this.config.logger?.warn("Datto RMM OAuth2 token refresh failed"); // UNCHANGED
  fireError(this.config.logger, this.config.httpObserver, capture, err); // raw err handed off (R8)
  if (axios.isAxiosError(err)) {                                        // UNCHANGED mapping/rethrow
    throw DattoApiError.fromAxiosError(err as AxiosError<unknown>);
  }
  throw new DattoApiError("Datto RMM authentication failed", { statusCode: 0, cause: err });
}
// 2xx: fire BEFORE safeParse so a malformed body never fires onError.
fireResponse(this.config.logger, this.config.httpObserver, capture, response);

const parsed = tokenResponseSchema.safeParse(response.data);
// ...unchanged, including the malformed-response logger?.warn (L168) and its DattoApiError throw,
//    and the info { accessToken, issuedAt, expiresAt } construction that reuses issuedAt...
```

### Tests (in this phase)
- `tests/unit/auth/auth-manager.test.ts` (extend), using `nock`:
  - A successful grant fires `onRequest` then `onResponse`; `body`/`requestBody` equal the raw `grant_type=password&username=...&password=...` urlencoded string (R3/R5); the captured header map omits `Authorization` and the body contains the API key; the event `url` is the **absolute resolved** `` `${apiUrl}${GRANT_PATH}` `` (architect-r1-f2).
  - A grant POST returning **2xx with a malformed token body** fires exactly one terminal event — `onResponse` with the raw response body — and fires **no** `onError`, even though `performRefresh` throws a `DattoApiError` (Decision 4 rule 3).
  - A grant returning a non-2xx fires `onError` whose `error` is the **raw caught error handed off unchanged** (identity-equal, not the constructed `DattoApiError`) with `statusCode` present; a transport failure fires `onError` with `statusCode` absent (R8). In both cases `performRefresh` still **throws its own `DattoApiError`** to the caller (assert the thrown error is a `DattoApiError`, and — where feasible — that the existing `logger?.warn("…refresh failed")` still fires).
  - A throwing / rejecting callback leaves the grant outcome unchanged and logs one `warn` (R7).

### Documentation (if needed)
- None in this phase (README lands in Phase 4).

### Exit Gate

```bash
npm run typecheck
npm test
npm run build
! grep -q 'declare module' dist/index.d.ts
```

- Existing `auth-manager.test.ts` cases pass unchanged.
- `npm run build` + the `declare module` check run here because Phase 3 makes axios-importing `src/http/observer.ts` reachable from the `index.ts` value graph (via `auth-manager.ts`), so a leaked `declare module "axios"` would first surface at this phase. (No blanket `grep 'axios' dist/index.d.ts` — `dist/index.d.ts` already references `AxiosInstance`/`AxiosError` legitimately today.)

---

## Phase 4: End-to-end verification through the assembled client, and documentation

### Goal
Prove the seam behaves correctly across the fully-wired client — the cross-layer scenarios that only exist once both transport layers are instrumented — and document the raw-delivery contract for consumers. This phase adds no new production behavior; it wires the assembled-client integration tests and the README section, closing out the design's Success Criteria.

**Requirements:** R2, R3, R4, R6, R8, R9 (end-to-end verification of behavior wired in Phases 1–3)

### Steps
1. **Add assembled-client integration tests**: Exercise `createDattoRmmClient({ ..., httpObserver })` end-to-end with `nock` stubbing both the grant endpoint and resource/pagination endpoints.
   - Files: `tests/integration/http-observer.test.ts` (new)
   - Notes: Build the client via the public factory so the real wiring (grant → shared instance → resources → pagination) is under test.
2. **Document the seam in the README**: Add an "Observing HTTP exchanges (`httpObserver`)" section — the five types, the per-attempt/per-page semantics, and a prominent raw/un-redacted warning (bearer tokens + API key are delivered verbatim; the consumer must redact).
   - Files: `README.md`

### Opinionated Implementation Notes (Examples)
```typescript
// tests/integration/http-observer.test.ts
const events: Array<[string, unknown]> = [];
const observer: DattoHttpObserver = {
  onRequest: (e) => events.push(["req", e]),
  onResponse: (e) => events.push(["res", e]),
  onError: (e) => events.push(["err", e]),
};
const client = createDattoRmmClient({ apiUrl: BASE_URL, apiKey, apiSecret, httpObserver });
// nock: token grant 200, then a 2-page paginated read → expect grant events +
// one request+terminal per page (N pages ⇒ N request + N terminal events).
```

### Tests (in this phase)
- `tests/integration/http-observer.test.ts` (new), via `createDattoRmmClient`:
  - A paginated read of N pages invokes the observer N times (one `onRequest` + one terminal per page) — R4.
  - The token grant is observed (its own `onRequest`/`onResponse`) with the urlencoded-string body — R3, end-to-end.
  - A **lazy-refresh grant failure** (the Bearer `getToken()` throwing a `DattoApiError`) fires `onError` exactly **once** — on the grant attempt — and **never** a second `onError` on the shared instance (Decision 4 rule 2).
  - A `429 → retry → 200` on a resource read through the assembled client surfaces `onError(429)` then `onResponse(200)` — R2/R6.
  - `onError.error` is the **raw request error handed off unchanged** (typed `unknown`) in every failing case, while the SDK still throws its mapped `DattoApiError` to the caller (R8).
  - Omitting `httpObserver` entirely leaves request outcomes and event-free behavior unchanged (additive-only sanity).

### Documentation (if needed)
- `README.md`: new `httpObserver` section as above.

### Exit Gate

```bash
npm run typecheck
npm test
npm run build
grep -q 'DattoHttpObserver' dist/index.d.ts
! grep -q 'declare module' dist/index.d.ts
```

- README documents the raw/un-redacted contract and the per-attempt/per-page semantics.

---

## Deferred Validation (run after implementation is complete)
None — all validation is automated within phase exit gates. The seam is verified end-to-end with `nock`-stubbed HTTP (grant, resource, pagination, retry, and transport-failure paths) through the public `createDattoRmmClient` factory; no live Datto RMM credentials or deployed environment are required.
