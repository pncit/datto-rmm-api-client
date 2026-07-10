# HTTP Observer Seam Design

Tracking: None

## Problem Statement

The 1.0.x rewrite deliberately took ownership of the HTTP transport: it constructs its own axios instances, wires authentication, rate limiting, retry, and pagination into them, and hard-rejects a caller-supplied `axiosInstance` through the strict config schema (`dattoRmmClientConfigSchema`). This is a correct decision — handing the transport instance to a consumer re-couples them to axios and lets them clobber the auth/rate-limit/retry wiring the client exists to guarantee.

That decision removed a capability some consumers depended on in 0.1.x without a replacement. In 0.1.x a consumer could inject an axios instance and register interceptors to emit a redacted observability artifact for every Datto RMM HTTP exchange — request URL/method/headers/body, response status/headers/body, duration, and error — into a compliance/audit pipeline. That artifact covered the internal OAuth token-grant call (whose form body carries the API key) and every pagination page. In 1.0.2 there is no supported way to observe HTTP exchanges at all: the only observability surface is `DattoLogger`, which is deliberately body/header-free and UDF-masked, so it cannot carry the raw request/response payloads an audit artifact needs.

The cost of inaction is that a consumer with a compliance obligation to record every outbound HTTP exchange cannot adopt 1.0.x. Their only alternatives are to fork the transport or stay on 0.1.x — both of which forfeit the very isolation the 1.0.x transport was built to provide.

---

## Vision

The client exposes a transport-agnostic **HTTP observer seam**: a set of optional, pure-observer callbacks on `DattoRmmClientConfig` that fire for every HTTP exchange the client performs, delivering a structured, raw (un-redacted) payload of the request, the response or error, and the duration. The axios instances stay entirely internal — auth, rate limiting, retry, and pagination remain the client's own, and axios never enters the public type contract. The seam is the HTTP-layer analogue of the design language 1.0.x already established with the structured `DattoLogger` observer and the structured `DattoApiError`/`DattoValidationError` errors: expose a structured surface, never the internals that produce it.

### Goals

- Let a consumer observe every HTTP exchange the client makes — request, response/error, and duration — without access to axios.
- Fire once per physical HTTP attempt, so retried exchanges are never collapsed.
- Cover the two internal exchanges 0.1.x consumers relied on: the OAuth token grant/refresh call and each pagination page.
- Deliver request/response bodies at wire fidelity, un-redacted, leaving all redaction to the consumer.
- Guarantee that a misbehaving observer can never alter, delay, or fail the request.

### Non-Goals

- Reinstating `axiosInstance` injection — the transport stays internal and the strict schema keeps rejecting it.
- Exposing axios request/response/error objects, or otherwise adding axios to the public type contract. The payload is a structured, transport-agnostic shape.
- Client-side redaction of any field. The seam delivers raw; the consumer redacts.
- Observing post-2xx or non-HTTP failures. Response schema validation (`DattoValidationError`), the grant's malformed-token `DattoApiError`, and pagination cursor/guard failures do not fire `onError` (see Decision 4).
- Changing any existing auth, rate-limit, retry, or pagination behavior. The seam only observes what the transport already does.

---

## Requirements

| ID | Requirement | Kind | Source |
|----|-------------|------|--------|
| R1 | `DattoRmmClientConfig` accepts an optional `httpObserver` grouping optional `onRequest`/`onResponse`/`onError` callbacks; its absence leaves all behavior unchanged. | Functional | Goal: observe every exchange |
| R2 | Each callback fires **once per physical HTTP attempt**; retries are never collapsed — a `429 → retry → 200` sequence surfaces as two observed attempts. | Functional | Goal: per-attempt fidelity |
| R3 | The internal OAuth token grant/refresh call is observed, with its body delivered as the raw serialized `application/x-www-form-urlencoded` string as sent on the wire. | Functional | Goal: cover internal exchanges |
| R4 | Each pagination page is observed as its own request plus terminal (`onResponse`/`onError`) event. | Functional | Goal: cover internal exchanges |
| R5 | Request and response bodies are delivered in their developer-facing transport form, never pre-redacted: form/urlencoded requests (the grant) as the **serialized string** exactly as sent on the wire; JSON requests as the **pre-serialization object** (explicitly the object, not the literal serialized wire bytes); JSON responses as the parsed object. | Functional | Goal: wire fidelity |
| R6 | `onResponse` fires for an attempt that receives a 2xx; `onError` fires for an attempt that receives any non-2xx **or** no response at all, carrying `statusCode` and response fields when a response was received. | Functional | Stakeholder decision |
| R7 | A `throw` from any callback — and a rejection from an accidentally-async callback — is caught and swallowed and never alters, delays, or fails the request; callbacks are invoked synchronously and their return value is **not awaited**, but when the return value is thenable a `.catch` is attached (without awaiting it) that logs once at `warn` and swallows, so neither a synchronous `throw` nor an async rejection can propagate or delay the request. | Non-functional | Goal: observer cannot affect the request |
| R8 | `onError`'s error field is typed and guaranteed to be a `DattoApiError`; the seam never delivers an unmapped error or a raw axios error, and no callback field's type references an axios type. | Non-functional | Non-Goal: axios stays out of the contract |
| R9 | The observer receives raw, un-redacted payloads (including bearer tokens and the API key in the grant body) — an explicit exemption from the UDF/logger masking boundary; the client redacts nothing. | Non-functional | Non-Goal: consumer redacts |
| R10 | The strict config schema accepts `httpObserver` (validated shape-only, like the logger) and continues to reject unknown keys and `axiosInstance`. | Functional | Current state: strict schema |

---

## Current State

The client owns two axios instances, and every HTTP exchange the client makes flows through exactly one of them:

- **The shared instance** (`src/http/http-client.ts`, `createHttpClient`) carries a rate-limit **request** interceptor (`config.rateLimiter.acquire`) and an error-mapping/retry **response** interceptor (`handleResponseError`). `AuthManager.attachTo` adds a Bearer-token request interceptor to this same instance. Every resource request — including every pagination page — is issued through it. Retries are performed *inside* `handleResponseError` by re-invoking `instance.request(config)`, which re-runs the full interceptor chain; **each attempt is therefore already a distinct pass through the interceptors.** Non-2xx responses arrive at `handleResponseError` as an `AxiosError`; every terminal failure is mapped to a `DattoApiError` (`build403Error`, `buildRateLimitError`, `DattoApiError.fromAxiosError`) before it is thrown. Retried statuses (401 before its `onUnauthorized` retry, 429 before its `Retry-After` retry, 5xx/network before backoff) currently sleep and retry *without* constructing a `DattoApiError`.

- **The bare grant client** (`src/auth/auth-manager.ts`, `AuthManager.grantClient`) issues the OAuth2 password-grant `POST /auth/oauth/token` round-trip. It is constructed with **none** of the shared instance's interceptors, by design (transport isolation: the token call must not carry a Bearer header, consume the rate-limit window, or run the retry path). `AuthManager.performRefresh` builds the body as `new URLSearchParams({ grant_type, username, password }).toString()` — the raw wire string — and already wraps the call in a `try/catch` that maps every failure (axios error, malformed token response, non-axios error) to a `DattoApiError`.

- **Pagination** (`src/client/resources/base-resource.ts`, `BaseResource.paginate`) issues one `this.axios.get` per page against the shared instance, so page requests already flow through the shared instance's interceptors.

Config is validated by `dattoRmmClientConfigSchema` (`src/client/datto-client-config.ts`), a `z.strictObject` that rejects any unknown key — including `axiosInstance`. The existing `DattoLogger` (`src/logging/logger.ts`) is validated shape-only via `dattoLoggerSchema` (`z.function` per method) and is always wrapped in a UDF-masking decorator (`withUdfMasking`) before use; it deliberately logs no bodies or headers. `DattoRmmClient` (`src/client/datto-rmm-client.ts`) constructs the rate limiter, `AuthManager`, and the shared instance, then threads the masked logger into each. The public entry point (`src/index.ts`) re-exports the client factory, the config/logger types, the error hierarchy, and the curated `public-types` surface.

Nothing today lets a consumer observe raw HTTP exchanges. `axiosInstance` injection was never supported in 1.0.x; the logger is the only observability surface and is body/header-free and masked.

---

## Proposed Design

### Overview

Add an optional `httpObserver` to `DattoRmmClientConfig`: a `DattoHttpObserver` object with three optional callbacks — `onRequest`, `onResponse`, `onError`. `DattoRmmClient` threads the observer (unmasked, unlike the logger) into both transport layers. Each layer wraps its existing send path so that:

- immediately before an attempt is dispatched, `onRequest` fires with the method, the **absolute resolved** URL (`baseURL` + path), wire-form headers, and wire-form body;
- when the attempt returns a 2xx, `onResponse` fires with the request fields, the response status/headers/body, and the elapsed wire time;
- when the attempt returns a non-2xx or no response, `onError` fires with the request fields, the response fields (when a response was received), the mapped `DattoApiError`, and the elapsed wire time.

Because retries in the shared instance re-issue the request through the same instrumented path, and because pagination and the grant call each already issue distinct requests, R2/R3/R4 fall out of instrumenting the two send paths rather than requiring special-case code at each call site.

Every callback invocation is wrapped so that any thrown error or returned-promise rejection is caught, swallowed, and reported once to the masked logger at `warn` — never propagated into the request (R7).

### Key Concepts

- **HTTP attempt** — one physical dispatch of one request to the server. A logical operation may comprise several attempts (retries); a paginated read comprises one attempt per page; obtaining a token is its own attempt. The seam is defined per attempt, not per logical operation.
- **`DattoHttpObserver`** — the public interface grouping the three optional pure-observer callbacks, each typed against a named payload (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`). The interface, its three payload types, and the shared `DattoHttpHeaders` alias the payloads use for every header field are all exported from `src/index.ts` alongside `DattoLogger`, so a consumer can annotate a standalone callback function — or a standalone header-handling helper.
- **Terminal event** — each observed attempt emits exactly one of `onResponse` (2xx) or `onError` (non-2xx or no response), in addition to its one `onRequest`. There is no attempt that emits both a response and an error event, and none that emits neither.
- **Wire fidelity** — bodies are delivered in their developer-facing transport form: the serialized `x-www-form-urlencoded` string for the grant call, the pre-serialization request object for JSON writes (and the parsed object for responses), never pre-redacted (R5). Headers are delivered as a plain `DattoHttpHeaders` (`Record<string, string | string[] | undefined>`), with axios's `AxiosHeaders` normalized away.

### Callback payloads

The callbacks and their payload shapes (field names are the client's own; axios types appear nowhere):

The three payloads are **named** types (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`) that `DattoHttpObserver` references by name, so a consumer writing a callback as a standalone named function has an exported type to annotate its parameter. All three, plus `DattoHttpObserver` and the shared `DattoHttpHeaders` alias they reference for every header field, are exported from `src/index.ts` / `public-types` — **five** public types.

```typescript
type DattoHttpHeaders = Record<string, string | string[] | undefined>;

interface DattoHttpRequestEvent {
  method: string;
  url: string;                // the absolute resolved request URL (baseURL + path) exactly as dispatched, e.g. `${apiUrl}${path}` for a resource request and `${apiUrl}${GRANT_PATH}` for the grant — never a bare relative path (Decision 5, R3/R4)
  headers: DattoHttpHeaders; // shared-instance requests carry Authorization: Bearer; the grant's Authorization: Basic (public-client:public) is applied by axios internally and is absent by design
  body: unknown;             // the serialized urlencoded string for the grant, the pre-serialization request object for JSON (Decision 5, R5)
}

interface DattoHttpResponseEvent {
  method: string;
  url: string;                // the same absolute resolved URL captured on the request event (baseURL + path)
  requestHeaders: DattoHttpHeaders;
  requestBody: unknown;
  statusCode: number;
  responseHeaders: DattoHttpHeaders;
  responseBody: unknown;
  durationMs: number;
}

interface DattoHttpErrorEvent {
  method: string;
  url: string;                // the same absolute resolved URL captured on the request event (baseURL + path)
  requestHeaders: DattoHttpHeaders;
  requestBody: unknown;
  error: DattoApiError;              // always mapped; never a raw axios error
  statusCode?: number;              // present iff a response was received
  responseHeaders?: DattoHttpHeaders;
  responseBody?: unknown;
  durationMs: number;
}

interface DattoHttpObserver {
  onRequest?(event: DattoHttpRequestEvent): void;
  onResponse?(event: DattoHttpResponseEvent): void;
  onError?(event: DattoHttpErrorEvent): void;
}
```

### Design Decisions

#### Decision 1: An observer seam, not interceptor or instance injection

**Decision:** Expose observation as three optional pure-observer callbacks grouped under `httpObserver`, delivering a structured transport-agnostic payload. Do not reinstate `axiosInstance` and do not accept caller-supplied interceptors.

**Rationale:** The capability the consumer actually needs is *observation of every exchange*, not control of the transport. A pure-observer seam gives them exactly the request/response/error/duration fields their artifact consumes while the axios instances — and auth, rate limiting, retry, pagination — stay entirely internal and axios stays out of the public type contract. This matches the established 1.0.x language: expose a structured `DattoLogger` and structured errors rather than internals. Grouping the three callbacks in one object (rather than three top-level config fields) mirrors how the capability is a single concern and keeps the config surface small.

**Alternatives considered:**
- Reinstate `axiosInstance` injection: rejected — it re-couples consumers to axios and lets them clobber the client's auth/rate-limit/retry wiring, the exact regression 1.0.x removed. The consumer explicitly is not asking for it.
- Accept caller-supplied axios interceptors: rejected — still leaks axios into the contract and lets a consumer interfere with the request lifecycle, defeating R7 and the transport-isolation guarantees.
- Extend `DattoLogger` to carry bodies/headers: rejected — the logger is deliberately body/header-free and UDF-masked; overloading it to sometimes carry raw payloads would either break the masking guarantee for existing logger consumers or force redaction the seam explicitly must not do (R9).

#### Decision 2: Instrument both transport layers, not a single bolt-on interceptor

**Decision:** Thread the observer into both `createHttpClient` (the shared instance) and `AuthManager` (the grant client), invoking the callbacks from within each layer's send/error path rather than as a generic pair of interceptors added in one place. Both sites consume a **single internal helper module** (`src/http/observer.ts`) that owns the three primitives the two layers would otherwise re-implement: the invoke-and-swallow-with-`warn` wrapper (R7), the `AxiosHeaders`→plain-`Record` header normalizer, and the capture-and-stash payload assembler (Decision 5). The shared-instance interceptor and `performRefresh` call the same helper, so the two instrumentation points cannot drift in how they normalize headers, assemble payloads, or swallow callback failures.

**Rationale:** The grant call runs on the bare `grantClient`, which by design carries none of the shared instance's interceptors — so a single interceptor added to the shared instance could never satisfy R3. Instrumenting each layer at the point where it already knows the attempt boundary, the elapsed time, and the mapped `DattoApiError` is what lets `onError` carry the structured error (R8) and lets duration exclude throttle wait (Decision 5). The grant path already has the `try/catch` and the mapped error; the shared path's `handleResponseError` already sees every attempt's failure. Instrumentation sits where the needed facts already are. Because Decision 2 deliberately instruments two independent sites, the shared `observer.ts` helper is what keeps their header-normalization, payload-assembly, and swallow behavior identical; the helper stays internal and out of the published types, like the `axios-augment.d.ts` precedent.

**Alternatives considered:**
- One interceptor pair on the shared instance only: rejected — cannot observe the grant call (R3), and `onError` at generic-interceptor position would see the raw `AxiosError`, not the mapped `DattoApiError` (R8).
- A wrapper axios instance layered around each real instance: rejected — more moving parts than instrumenting the existing send paths, and it reintroduces an axios object at the boundary the seam exists to hide.

#### Decision 3: `onResponse` for 2xx, `onError` for everything else — one terminal event per attempt

**Decision:** An attempt that receives a 2xx fires `onResponse`; an attempt that receives any non-2xx, or no response at all, fires `onError`. Each attempt fires exactly one terminal event plus one `onRequest`. A retried attempt still fires its terminal `onError` before the retry is issued, so `429 → retry → 200` emits `onError(429)` then `onResponse(200)` — two fully observed attempts (R2, R6).

**Rationale:** This matches the consumer's own payload shape, in which `onError` carries an optional `statusCode`/response fields "present when a response was received" — i.e. `onError` is expected to fire on HTTP-level failures that *do* have a response (429/500/403), with `statusCode` absent only for transport failures. Splitting strictly on 2xx-vs-not gives one unambiguous terminal event per attempt, never both, so a consumer never has to de-duplicate a single attempt across two callbacks.

**Alternatives considered:**
- `onResponse` for any received response (including 429/500), `onError` only for no-response transport failures: rejected — it makes `onError`'s `statusCode`/response fields nearly dead (a transport failure has no status), contradicting the payload the consumer designed, and it forces the consumer to inspect status inside `onResponse` to tell success from failure.

#### Decision 4: `onError.error` is always a mapped `DattoApiError`, and the seam is HTTP-only

**Decision:** Type `onError.error` as `DattoApiError` and guarantee it is always a mapped `DattoApiError` — never `unknown`, never a raw axios error. Terminal-event selection follows three rules:

1. **Dispatched attempts** — the terminal event is selected by the **HTTP status of the physical response**, not by whether the surrounding method (`performRefresh`, `BaseResource.paginate`) later throws: 2xx fires `onResponse`, everything else fires `onError`.
2. **Non-dispatched attempts** fire no terminal event. The shared-instance `onError` fires **only for an attempt that reached dispatch** — i.e. whose per-attempt stash was written (which happens for every dispatched attempt whenever `httpObserver` is present, independent of which callbacks the consumer supplied — Decision 5); the gate keys off the stash, not off which of the three callbacks the consumer configured — which the implementation realizes by placing the `onError` call **after** `handleResponseError`'s `!axios.isAxiosError` rethrow guard. The two non-dispatched paths that must **not** fire it are (1) a rate-limiter `acquire()` rejection thrown from the rate-limit request interceptor and (2) the Bearer request interceptor's `getToken()` throwing a `DattoApiError` on a lazy grant/refresh failure (`AuthManager.attachTo`), which axios routes into `handleResponseError` where the `!axios.isAxiosError` guard rethrows it.
3. **Post-2xx failures** are **not** terminal: the attempt already received a 2xx and already fired `onResponse` (carrying the raw 2xx body). This covers response schema validation (`DattoValidationError`) raised in `BaseResource`, the grant's malformed-token `DattoApiError` thrown by `performRefresh` when `tokenResponseSchema.safeParse` rejects a 2xx token POST body, and pagination cursor/guard failures.

**Rationale:** Every HTTP-attempt failure the client acts on is already mapped to a `DattoApiError` before use, so the guarantee is real and the concrete type is honest — the seam's whole value is a *structured* artifact, and forcing the consumer to narrow out of `unknown` to read `statusCode`/`code`/`requestId` would undercut it. `unknown` would be honest only if the shape were not guaranteed; here it is. The non-dispatched gate (rule 2) is honest because both excluded paths throw from a request interceptor that runs *before* the observer interceptor (registered **first** → runs **last**, per Decision 5), so neither attempt reached the observer's dispatch-point capture nor holds a stash; firing `onError` at the top of `handleResponseError` — or guarding only the rate-limiter case — would double-report a grant failure already surfaced on the grant client's own `onError`, breaking the "one observed attempt ⇒ one terminal event" invariant. Consistent with Decision 5, the grant instrumentation fires `onResponse` off the resolved 2xx **before** `safeParse` runs, so a post-parse throw cannot re-enter a terminal event. Delivering `onError` on retried non-terminal attempts (429/5xx/401) requires constructing the mapped `DattoApiError` on those branches even though the client swallows it and retries — the deliberate cost of the honest guarantee, paid on the already-slow retry path.

**Alternatives considered:**
- `error: unknown` (the consumer's literal proposal): rejected — under-claims a shape the client can guarantee, giving worse ergonomics for no benefit. The consumer invited a stronger type.
- `error: DattoApiError | DattoValidationError`: rejected — `DattoValidationError` is a post-exchange, non-HTTP failure outside this seam's scope; including it in the type would imply the seam fires on validation failures, which it does not.

#### Decision 5: `onRequest` fires at dispatch; `durationMs` is wire time; request fields are captured-and-stashed

**Decision:** `onRequest` fires immediately before the attempt is dispatched — after rate-limit acquisition and after the auth/User-Agent/Content-Type headers are attached — and `durationMs` measures from that dispatch to the response (or error), excluding any rate-limiter throttle wait. On the shared instance this "post-throttle, post-auth" firing point is achieved by a specific mechanism: the observer's request interceptor is registered **first** inside `createHttpClient`, so that under axios's LIFO (reverse-registration) request-interceptor ordering it executes **last** — after the rate-limit interceptor and after the Bearer interceptor that `AuthManager.attachTo` registers later, from a separate module, on the already-built instance. Registering it in any other position would run it before the auth header is attached and observe an incomplete request.

Whenever `httpObserver` is present, the client **captures-and-stashes** the method, URL, headers, and body — alongside the dispatch timestamp — on the per-attempt internal request state (the `axios-augment.d.ts` `rateDescriptor` precedent) at that dispatch point, **independent of which of the three callbacks the consumer supplied**. This capture is a client-internal step (Decision 2's `observer.ts` capture-and-stash primitive), not a side-effect of a consumer callback: the consumer's `onRequest` (if present) is *invoked* from the same dispatch point, but its presence, absence, or `throw` never affects whether the stash is written. An `onError`-only or `onResponse`-only consumer — a valid config, since all three callbacks are independently optional (R1) — therefore still has a fully populated stash for its terminal event to reuse. On the shared instance the two response-side terminal events fire from the two response-interceptor slots symmetrically: `onResponse` fires from the **fulfilled** response handler (the identity `(response) => response` slot), and `onError` fires from the **rejected** handler inside `handleResponseError` (after its `!axios.isAxiosError` rethrow guard, per Decision 4). Both read the per-attempt stash placed by `onRequest`. The terminal events reuse the stashed payload: `onResponse`/`onError` populate their `requestHeaders`/`requestBody` from what `onRequest` captured, **not** by re-reading `response.config`. This matters because by the terminal event axios has already run `transformRequest` (overwriting `config.data` with the serialized body) and normalized `config.headers` to `AxiosHeaders`; re-reading them would yield the serialized JSON string instead of the object R5 intends and post-normalization headers that need not match what `onRequest` observed. The dispatch timestamp is taken **after** `rateLimiter.acquire` returns, so throttle wait is never folded into `durationMs`.

The stash is **unconditionally overwritten on every interceptor pass** (idempotent re-capture), never written conditionally ("only if absent"). This matters because retries re-issue via `instance.request(config)` reusing the **same** config object, so attempt N's stash persists on that object into attempt N+1; the request interceptor re-fires and overwrites it before attempt N+1's terminal event reads it. A conditional stash would make attempt N+1's terminal event report attempt N's stale request fields and `durationMs`, silently breaking R2 per-attempt fidelity. Terminal events read the stash before the next pass re-dispatches, so a config object reused across retries never leaks a prior attempt's capture.

The captured `url` is the **absolute resolved** request URL — `baseURL` concatenated with the path — not the bare relative path axios holds in `requestConfig.url`. The shared instance composes it as `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` at the dispatch point; the grant path composes `apiUrl + GRANT_PATH`. A bare relative path would be an incomplete audit artifact for "every outbound HTTP exchange" — the consumer's pipeline must be able to record which host each exchange hit, so the resolved URL is pinned rather than left transport-relative.

The grant path carries no interceptors (Decision 2), so it captures-and-stashes at its own dispatch point inside `performRefresh` — the same capture-and-stash rule, applied directly at the call site rather than through an interceptor.

The header contract has one documented exception on the grant call: `Authorization: Bearer` is present on shared-instance requests, but the grant's `Authorization: Basic` header (the non-secret `public-client:public` pair) is applied by axios internally from the per-request `auth:` option and is therefore **absent by design** from the captured header map. The security-relevant credential on the grant is the API key, which rides in the captured body and is captured faithfully.

**Rationale:** Firing after header attachment means `onRequest` observes the final on-the-wire headers (including the bearer token), and firing after rate-limit acquisition means `durationMs` reflects the network round-trip rather than time spent queued behind the throttle. Capturing at `onRequest` and reusing the stash keeps a single attempt's request fields identical across its `onRequest` and terminal events, at the form R5 specifies. This is the most faithful representation of the actual exchange for an audit artifact.

**Alternatives considered:**
- Fire `onRequest` at call entry (before throttle/auth): rejected — headers would be incomplete and `durationMs` would fold in throttle wait, misrepresenting the exchange.
- Re-read request fields off `response.config` at the terminal event instead of stashing: rejected — axios has by then serialized the body and normalized the headers, so the terminal `requestBody`/`requestHeaders` would diverge from what `onRequest` delivered and from R5's intended form.

#### Decision 6: Raw delivery — an explicit exemption from the masking boundary

**Decision:** The observer receives raw, un-redacted payloads. Unlike `DattoLogger`, the observer is **not** wrapped in `withUdfMasking`, and the client redacts nothing before invoking it — including bearer tokens in request headers and the API key in the grant body.

**Rationale:** The consumer's redactor operates on raw wire data (e.g. scrubbing the API key out of the grant's `grant_type=password&username=…` string) and explicitly owns all redaction (R5, R9). Masking or partially redacting before delivery would corrupt the wire fidelity their redactor depends on. The exemption is a conscious, documented divergence from the UDF-masking guarantee that governs the logger, justified by the seam's purpose: it exists to hand a compliance pipeline the raw exchange.

**Alternatives considered:**
- Apply UDF masking (logger parity): rejected — destroys the wire fidelity of R5 and defeats the consumer's own redactor, which needs the raw form.
- Client-side redaction of known secrets (bearer token, API key): rejected — the consumer explicitly does not want it, and any client-side redaction risks either over-scrubbing a field the consumer needs raw or under-scrubbing a field the client didn't anticipate. Raw delivery with a clear contract is safer than a partial guarantee.

### Schema and wiring

`dattoRmmClientConfigSchema` gains an optional `httpObserver` validated shape-only — a strict object whose three callbacks are optional function schemas — mirroring `dattoLoggerSchema`'s approach (validate structure, not behavior) and preserving the strict-object rejection of unknown keys and `axiosInstance` (R10). `DattoRmmClient` passes the validated observer into both `createHttpClient`'s config and `AuthManager`'s config (a new optional field on each), threaded raw (not through `withUdfMasking`).

On the shared instance the observer's request interceptor is registered **first** in `createHttpClient` so that, under axios's LIFO request-interceptor ordering, it runs **last** — after the rate-limit interceptor and after the Bearer interceptor `AuthManager.attachTo` registers later (Decision 5).

The private `rateDescriptor` augmentation pattern (`src/http/axios-augment.d.ts`) — an internal typecheck aid deliberately kept out of the published `dist/index.d.ts` — is the precedent for the per-attempt state the instrumentation stashes on the request config: the dispatch timestamp for `durationMs` **and** the captured request payload (method/url/headers/body) that the terminal events reuse (Decision 5). Such state stays internal and never reaches the published types.

A single internal helper module (`src/http/observer.ts`) provides the three primitives both instrumentation sites share — the swallow-wrapper (R7), the `AxiosHeaders`→plain-`Record` normalizer, and the capture-and-stash payload assembler (Decision 5) — so the shared-instance interceptor and `performRefresh` route through one implementation rather than two parallel ones. Like `axios-augment.d.ts`, this module is internal and never appears in the published types.

---

## Migration Strategy

Purely additive. `httpObserver` is optional; every existing config validates and behaves identically without it. No existing auth, rate-limit, retry, pagination, logging, or error behavior changes — the seam only observes.

### Breaking Changes

None.

### Data Migration

None.

---

## Success Criteria

- `DattoRmmClientConfig` accepts an optional `httpObserver`; omitting it leaves all behavior unchanged, and supplying it does not change any request outcome.
- `DattoHttpObserver`, its three named payload types (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), and the shared `DattoHttpHeaders` alias — **five** public types — are exported from `src/index.ts` and reference no axios type.
- A `429 → retry → 200` sequence invokes `onRequest` twice and yields `onError(429)` then `onResponse(200)` — two observed attempts.
- The OAuth token grant/refresh call invokes the observer, with `body`/`requestBody` equal to the raw `application/x-www-form-urlencoded` string.
- A paginated read of N pages invokes the observer N times (one request + one terminal event per page).
- A JSON write delivers its body as the pre-serialization request object; the grant delivers its body as the serialized urlencoded string.
- An attempt's terminal event (`onResponse`/`onError`) carries `requestHeaders`/`requestBody` identical to what `onRequest` observed for the same attempt — the stashed capture, not the serialized/normalized `response.config` values.
- The observed shared-instance request carries the `Authorization: Bearer` header; the grant's captured header map omits `Authorization` (the Basic header applied internally by axios), with the API key present in the captured body.
- Every event's `url` is the **absolute resolved** URL (`baseURL` + path): a resource request observes `` `${apiUrl}${path}` `` and the grant observes `` `${apiUrl}${GRANT_PATH}` ``, never a bare relative path.
- `durationMs` measures dispatch→response and excludes rate-limiter throttle wait: an injected throttle delay before dispatch is not folded into `durationMs`.
- `onError.error` is a `DattoApiError` in every case, including transport failures (`statusCode` absent) and mapped HTTP failures (`statusCode` present).
- A grant POST that returns 2xx with a **malformed** token body fires exactly one terminal event — `onResponse` with the raw response body — and does **not** fire `onError` (see Decision 4).
- A lazy-refresh grant failure (the Bearer request interceptor's `getToken()` throwing a `DattoApiError`) fires `onError` exactly **once** — on the grant attempt — and never a second `onError` on the shared instance (see Decision 4).
- A 2xx resource response fires `onResponse` from the shared instance's fulfilled response handler, carrying the stashed request fields and `durationMs`.
- An **`onError`-only** consumer (supplying no `onRequest`) still receives a terminal `onError` on a dispatched non-2xx attempt, with `requestHeaders`/`requestBody`/`durationMs` populated from the stash — proving capture-and-stash runs on the dispatch path whenever `httpObserver` is present, not gated on the `onRequest` callback.
- A callback that throws, or returns a rejected promise, does not alter, delay, or fail the request; the failure is logged once at `warn`.
- The config schema still rejects `axiosInstance` and other unknown keys.

### Verification

- `npm run typecheck` — the public surface compiles and exports exactly the five observer types — `DattoHttpObserver`, its three named payload types (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), and `DattoHttpHeaders` — with no axios type in their signatures.
- `npm test` — existing suites pass unchanged; new unit tests cover per-attempt firing (retry, pagination, grant), 2xx/non-2xx/transport-failure terminal selection, raw body/header fidelity, `DattoApiError` typing, and observer-throw isolation. Specifically: the observed shared-instance request carries `Authorization: Bearer`; the terminal event's `requestBody`/`requestHeaders` match the values `onRequest` captured for the same attempt (not the serialized/normalized `response.config`); the grant's captured headers omit `Authorization` while the body carries the API key; every event's `url` is the absolute resolved URL (`baseURL` + path) for both a resource request and the grant, never a bare relative path; a grant POST returning 2xx with a malformed token body fires exactly one terminal event — `onResponse` with the raw response body — and fires **no** `onError`, even though `performRefresh` throws a `DattoApiError`; an injected pre-dispatch throttle delay is excluded from `durationMs`; a lazy-refresh grant failure fires `onError` exactly once (on the grant attempt) and no second `onError` on the shared instance; an `onError`-only consumer (no `onRequest` supplied) still receives a terminal `onError` on a dispatched non-2xx attempt with `requestHeaders`/`requestBody`/`durationMs` populated from the stash; and an async callback returning a rejected promise leaves the request unaffected, logs one `warn`, and produces no unhandled rejection.
- Confirm `dist/index.d.ts` contains no `declare module "axios"` and no axios type in the observer signatures (the existing Phase 8 exit-gate check extended to the new surface).

### What Stays the Same

- All auth, rate-limit, retry, pagination, and error-mapping behavior.
- The `DattoLogger` contract and its UDF-masking boundary (the observer is a separate, unmasked surface).
- The strict config schema's rejection of `axiosInstance` and unknown keys.
- The curated public type surface (`public-types`), extended only by the new observer types.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Consumer assumes the seam redacts and logs a secret (bearer token, API key) into their pipeline | Medium | High | Document the raw-delivery contract (R9/Decision 6) prominently on `DattoHttpObserver`; the consumer's stated design already redacts on their side. |
| A transport-injected header (e.g. the grant call's `auth:` Basic header) is absent from the captured header map | Medium | Low | Document header fidelity as best-effort at dispatch time; the security-relevant field (the API key) rides in the body, which is captured faithfully. The absent Basic header is the non-secret `public-client:public` pair. |
| Interceptor/instrumentation ordering captures headers before the auth header is attached | Low | Medium | Pin the requirement (Decision 5) that `onRequest` observes post-auth, post-throttle state; cover with a test asserting the bearer header is present in the observed request. |
| Constructing a `DattoApiError` for every retried attempt adds overhead | Low | Low | The construction sits on the already-slow retry path (which sleeps before retrying); the allocation is negligible against the backoff wait. |
| An async observer callback's rejection becomes an unhandled rejection | Low | Medium | Callbacks are never awaited, but a thenable return value gets a `.catch` attached (not awaited) that swallows the rejection with a single `warn`, so an accidentally-async callback cannot leak an unhandled rejection (R7). |

---

## Future Considerations

### Enabled by This Design

- A built-in optional redacting observer implementation (shipped separately) for consumers who want a sensible default rather than writing their own redactor.
- Correlation metadata on the payload (e.g. an attempt/operation identifier) to let a consumer stitch retries of one logical operation together, should a consumer ask for it.
- Because the seam is transport-agnostic, a future change of HTTP transport away from axios requires no change to the observer contract.

### Deferred Decisions

- Correlation/attempt identifiers on the payload: out of scope now — the current consumer's artifact is per-attempt and self-contained, and adding identifiers before a concrete need risks designing the wrong shape. Revisit when a consumer needs to group attempts.
- A bundled redactor: out of scope now — the requesting consumer redacts on their side and explicitly wants raw delivery. Ship the raw seam first.

### Open Questions

- None.
</content>
</invoke>
