import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { z } from "zod";

import { DattoValidationError } from "../../errors";
import type { DattoLogger } from "../../logging/logger";
import type { WriteOpKey } from "../../rate-limit/rate-limits";
import { pageDetailsSchema } from "../../schema-overrides/pagination";
import { isRecord } from "../../util/is-record";
import { type Lenient, parseLenient } from "../../validation/schema-leniency";

/**
 * Coerces a Zod schema's inferred output type to a specific type `T`.
 *
 * Ported from `fuze-api`'s identical helper. Addresses the structural-vs-nominal divergence
 * between a **reconciled** override schema's own `z.infer` (e.g. `z.infer<typeof
 * deviceResponseSchema>`, which still carries the *closed*, pre-graft enum types for
 * `deviceClass`/`antivirus`/`patchManagement`) and the **exported** entity type it backs (`Device`,
 * `src/schema-overrides/types.ts`, which grafts on the codemod-widened open-enum subtrees — see
 * that module's doc). `schema-overrides/types.ts` performs exactly this cast (inline, as `schema
 * as unknown as z.ZodType<Device>`, rather than importing this helper — that module sits *below*
 * `client/resources` in this codebase's dependency direction, so importing from here would invert
 * it) to bind `deviceSchema`/`alertSchema` to their reconciled types; this export remains
 * available for any future reconciled entity that doesn't get its own named schema binding there.
 *
 * **This narrows only the schema's own declared type, not `BaseResource`'s `Lenient<T>`
 * wrapper.** Every `http*` primitive still returns `Lenient<T>` around whatever type its schema
 * argument claims — `this.httpGet(path, coerceSchema<Device>(deviceResponseSchema), ctx)` yields
 * `Promise<Lenient<Device>>`, not `Promise<Device>`. A resource method that wants its own clean
 * declared return type re-asserts that separately, at its own return site, via `narrow<T>`
 * (`./narrow.ts`) — the two helpers are not interchangeable and do not compete for the same job:
 * this one retypes a *schema*, `narrow` retypes an already-`Lenient`-wrapped *value*.
 *
 * Runtime validation is unaffected — `.safeParse`/`parseLenient` always run against the real
 * schema; only the compile-time type assertion changes.
 */
export function coerceSchema<T>(schema: z.ZodTypeAny): z.ZodType<T> {
  return schema as z.ZodType<T>;
}

/** Caps how many of a dropped array's per-item errors `validateArrayResponse` reports in one
 * summary line, so a systematic drift (one mistyped field dropping every item on a page) still
 * produces a small, readable `warn` rather than embedding hundreds of zod error trees in `meta`. */
const MAX_REPORTED_DROP_ERRORS = 5;

/** Fallback label used in a diagnostic/error's `context` field when a call site omits one. */
const UNKNOWN_CONTEXT = "(unknown)";

/** Human-readable label for a value's type in a diagnostic, distinguishing `undefined`/`null`
 * from every other `typeof` result (both of which are otherwise reported as `"object"`). */
function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value;
}

/** Hard ceiling on how many pages `paginate` will walk before treating the cursor chain as
 * pathological — a self-referential `nextPageUrl` (a cycle, also caught earlier and more cheaply
 * by the visited-URL check below) or an ever-advancing one that simply never reaches a terminal
 * value — and aborting rather than hanging or growing `items` without bound. Chosen generously
 * above any real Datto collection's page count (even a very large MSP account's device/alert list
 * at the API's own page size) so it only ever fires on a pathological chain, never a legitimate
 * one. */
const MAX_PAGINATION_PAGES = 10_000;

/** Builds a `DattoValidationError('response')` for one of `paginate`'s guardrails (the
 * cross-origin, cycle, and page-cap checks below) — each has no wire payload to run `.safeParse`
 * against, but `DattoValidationError` still requires a real `ZodError`; a single hand-built
 * `custom`-code issue supplies one without inventing a parallel error-construction path. */
function paginateGuardError(
  message: string,
  context: string,
): DattoValidationError {
  return new DattoValidationError(
    new z.ZodError([{ code: "custom", path: ["nextPageUrl"], message }]),
    "response",
    { context },
  );
}

/** Parses `value` as a URL (resolved against `base` when relative), returning `undefined` rather
 * than throwing on a malformed value. */
function parseAbsoluteUrl(value: string, base: string): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a page cursor's `nextPageUrl` against the axios instance's own configured `baseURL`
 * (the client's `apiUrl`), rejecting any cursor whose origin does not match it, and returns the
 * relative `pathname + search` to request instead of the raw absolute URL.
 *
 * Datto's real pagination envelope carries a fully-qualified absolute URL
 * (`spec/openapi.json`'s `PaginationConfiguration.nextPageUrl: string`). Axios treats an absolute
 * URL as authoritative and **ignores** the instance's configured `baseURL`, while the auth
 * interceptor still attaches the Datto bearer token to whatever host that URL names — so following
 * a server-controlled `nextPageUrl` unchecked would let a malicious or compromised upstream
 * response redirect the credentialed request to an attacker-controlled host (SSRF / credential
 * exfiltration). Reissuing the path+query against the configured `baseURL` — after confirming the
 * cursor's origin actually matches it — guarantees the token can never leave the configured host.
 *
 * `baseURL` being unset skips the check rather than rejecting every call: it is never actually
 * unset in production (`apiUrl` is a required, URL-validated `DattoRmmClientConfig` field), and a
 * bare `BaseResource` constructed directly against an axios instance with no configured `baseURL`
 * (e.g. in a unit test) has no origin to pin against in the first place.
 */
function resolveNextPageUrl(
  nextPageUrl: string,
  baseURL: string | undefined,
  context: string,
): string {
  if (!baseURL) {
    return nextPageUrl;
  }
  const resolved = parseAbsoluteUrl(nextPageUrl, baseURL);
  if (!resolved || resolved.origin !== new URL(baseURL).origin) {
    throw paginateGuardError(
      "nextPageUrl's origin does not match the configured apiUrl",
      context,
    );
  }
  return resolved.pathname + resolved.search;
}

/**
 * The argument tail `httpPost`/`httpPut`/`httpPatch` accept for a **bodiless** write — a write
 * whose real Datto endpoint carries no request payload at all (e.g. `POST
 * /alert/{uid}/resolve`), so there is nothing to run `validateRequest` against.
 */
type BodilessWriteArgs<TResponse> = readonly [
  responseSchema: z.ZodType<TResponse>,
  context: string,
  opKey: WriteOpKey,
];

/** `BodilessWriteArgs`'s tuple length — `sendWrite` dispatches on this rather than the bare
 * literal `3`, so the coupling between the tuple's shape and the dispatch check is named and
 * greppable at both ends. Kept next to `BodilessWriteArgs` itself so the two cannot silently
 * drift apart. */
const BODILESS_WRITE_ARITY = 3 as const;

/** The argument tail `httpPost`/`httpPut`/`httpPatch` accept for a **body-carrying** write. */
type BodiedWriteArgs<TBody, TResponse> = readonly [
  body: TBody,
  bodySchema: z.ZodType<TBody>,
  responseSchema: z.ZodType<TResponse>,
  context: string,
  opKey: WriteOpKey,
];

/** An axios method bound to one HTTP verb (`post`/`put`/`patch`), the shape `sendWrite` needs to
 * stay verb-agnostic across `httpPost`/`httpPut`/`httpPatch`. */
type WriteSender = (
  path: string,
  body: unknown,
  config: AxiosRequestConfig,
) => Promise<AxiosResponse>;

/**
 * Abstract base class for Datto RMM resource accessors (R2, R6, R7; design "`BaseResource`").
 *
 * Provides the validated HTTP primitives every `*Resource` class (Phase 7/8) extends —
 * `httpGet`/`httpGetArray`/`httpPost`/`httpPut`/`httpPatch`/`httpDelete` — plus `validateRequest`
 * (strict, R6), `validateResponse`/`validateArrayResponse` (lenient, R5/R7), and the strict-cursor
 * `paginate` walker (R3). Every primitive sends through the **single**, interceptor-bearing axios
 * instance built in Phase 5 (`createHttpClient`) — there is no generated endpoints layer and no
 * second transport — so every request a resource makes is rate-limited, retried, and error-mapped
 * by that one shared stack.
 *
 * **Primitive naming.** Named `http*` rather than `get`/`post`/`put`/`patch`/`delete` (fuze-api's
 * names) so a resource subclass can expose a public method of the same or a related name — e.g.
 * `DeviceResource.get(uid)` — without a `TS2416` incompatible-override collision or its body
 * silently recursing into itself. **Resource classes call only these `http*` primitives, never
 * `this.axios` directly** — that is what guarantees every request carries a `RateDescriptor` and
 * runs through validation.
 *
 * **Six primitives, not four.** The plan (mirroring `fuze-api`) names `httpGet`/`httpPost`/
 * `httpPatch`/`httpDelete`. Two are added here, each unblocking real R1 operations the plan's
 * four-primitive set has no way to serve correctly:
 * - `httpPut`. Datto's real, committed spec (`spec/openapi.json`) uses **no `PATCH` operations at
 *   all** and instead uses `PUT` for five write operations this project's own WriteOpKey table
 *   requires (`device-move`, `device-job-create`, `site-create`, `site-variable-set`'s create half,
 *   `account-variable-set`'s create half) — confirmed by reading every non-`GET` `(method, path)`
 *   pair in the committed spec. Without a validated `httpPut` primitive, Phase 7/8 could not
 *   implement those required operations without a resource either bypassing `BaseResource` (calling
 *   `this.axios.put` directly — defeating the single-validated-primitive architecture this class
 *   exists to provide) or mis-sending them as `POST`/`PATCH` against a server that does not accept
 *   that verb for those paths. `httpPut` mirrors `httpPost`'s exact shape.
 * - `httpGetArray`. Four real R1 GET operations (`getByMacAddress`, `getDeviceAuditByMacAddress`,
 *   `getStdOut`, `getStdErr`) return a **bare, non-paginated top-level array** — neither a single
 *   value (`httpGet`'s shape) nor a `{pageDetails, <array>}` envelope (`paginate`'s shape). Routing
 *   one through `httpGet` with a `z.array(...)` schema would run lenient validation over the
 *   *whole* array as one unit, so a single bad item fails the entire parse and `httpGet` throws —
 *   exactly the wholesale-collection failure R7 exists to prevent. `httpGetArray` gives these
 *   endpoints `paginate`'s same per-item leniency (via `validateArrayResponse`) without the
 *   envelope/cursor it doesn't have.
 *
 * `httpPatch` is kept even though no current Datto write uses it — it costs nothing to keep,
 * matches the plan's pinned name (`fuze-api` parity — Decision 1), and a future spec revision may
 * add one.
 *
 * **Bodied and bodiless writes.** Several real writes carry no request payload at all (`POST
 * /alert/{uid}/resolve`, `/mute`, `/unmute`; `POST /user/resetApiKeys`) and so have nothing for
 * `validateRequest` to run against. `httpPost`/`httpPut`/`httpPatch` are each overloaded for a
 * 3-arg bodiless form (`responseSchema, context, opKey`) and a 5-arg body-carrying form (`body,
 * bodySchema, responseSchema, context, opKey`) rather than adding a second primitive name — a
 * resource author reaches for the same primitive either way, with `validateRequest` running only
 * when there is a body to validate.
 */
export abstract class BaseResource {
  constructor(
    protected readonly axios: AxiosInstance,
    protected readonly logger: DattoLogger,
  ) {}

  /**
   * Performs a `GET` request and validates the response against `responseSchema` leniently (R5).
   *
   * @param path - API endpoint path (relative to the client's `apiUrl`)
   * @param responseSchema - Zod schema the response is validated against
   * @param context - Label for the call site (e.g. `'GET /device/{uid}'`), threaded into leniency
   *   diagnostics and any thrown `DattoValidationError`
   * @param params - Optional query-string parameters
   * @throws {DattoValidationError} If response validation fails
   */
  protected async httpGet<TResponse>(
    path: string,
    responseSchema: z.ZodType<TResponse>,
    context: string,
    params?: Record<string, unknown>,
  ): Promise<Lenient<TResponse>> {
    const response = await this.axios.get(path, {
      params,
      rateDescriptor: { kind: "read" },
    });
    return this.validateResponse(response.data, responseSchema, context);
  }

  /**
   * Performs a `GET` request whose response is a **bare, non-paginated top-level array** — not a
   * single value (`httpGet`'s shape) and not a `{pageDetails, <array>}` envelope (`paginate`'s
   * shape) — e.g. `getByMacAddress`, `getStdOut`. Validates the array leniently **per item** (R7)
   * via `validateArrayResponse`, so one malformed item is dropped rather than failing the whole
   * response the way routing this through `httpGet` with a `z.array(...)` schema would.
   *
   * @param path - API endpoint path (relative to the client's `apiUrl`)
   * @param itemSchema - Zod schema each array item is validated against
   * @param context - Label for the call site, threaded into leniency diagnostics
   * @param params - Optional query-string parameters
   */
  protected async httpGetArray<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    context: string,
    params?: Record<string, unknown>,
  ): Promise<Lenient<T>[]> {
    const response = await this.axios.get(path, {
      params,
      rateDescriptor: { kind: "read" },
    });
    return this.validateArrayResponse(response.data, itemSchema, context);
  }

  /** Bodiless `POST` (e.g. `POST /alert/{uid}/resolve`): no request body to validate. */
  protected httpPost<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse>
  ): Promise<Lenient<TResponse>>;
  /** Body-carrying `POST` (e.g. `POST /device/{uid}/udf`): `body` is validated against
   * `bodySchema` before the request is sent (R6). */
  protected httpPost<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<Lenient<TResponse>>;
  protected httpPost<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<Lenient<TResponse>> {
    return this.sendWrite(
      (p, body, config) => this.axios.post(p, body, config),
      path,
      args,
    );
  }

  /** Bodiless `PUT` (e.g. `PUT /device/{uid}/site/{siteUid}` — `device-move`, whose target site
   * is entirely path-carried). See this class's doc for why `httpPut` exists. */
  protected httpPut<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse>
  ): Promise<Lenient<TResponse>>;
  /** Body-carrying `PUT` (e.g. `PUT /site` — `site-create`). */
  protected httpPut<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<Lenient<TResponse>>;
  protected httpPut<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<Lenient<TResponse>> {
    return this.sendWrite(
      (p, body, config) => this.axios.put(p, body, config),
      path,
      args,
    );
  }

  /** Bodiless `PATCH`. No current Datto write uses this verb — kept for `fuze-api` parity and a
   * future spec revision (see this class's doc). */
  protected httpPatch<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse>
  ): Promise<Lenient<TResponse>>;
  /** Body-carrying `PATCH`. */
  protected httpPatch<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<Lenient<TResponse>>;
  protected httpPatch<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<Lenient<TResponse>> {
    return this.sendWrite(
      (p, body, config) => this.axios.patch(p, body, config),
      path,
      args,
    );
  }

  /**
   * Performs a `DELETE` request. Datto's delete endpoints (`filter-delete` and friends) carry no
   * request body and no meaningful response body — the server signals success with a 2xx — so,
   * unlike the other write primitives, there is nothing to validate on either side.
   *
   * @param path - API endpoint path, including any query string
   * @param opKey - The write rate-limit key for this operation (`src/rate-limit/rate-limits.ts`)
   */
  protected async httpDelete(path: string, opKey: WriteOpKey): Promise<void> {
    await this.axios.delete(path, {
      rateDescriptor: { kind: "write", opKey },
    });
  }

  /** Shared implementation behind `httpPost`/`httpPut`/`httpPatch`: dispatches on whether `args`
   * is the 3-element bodiless tail (`BodilessWriteArgs`) or the 5-element body-carrying tail
   * (`BodiedWriteArgs`), validating the body first (bodied case only) and always validating the
   * response leniently. */
  private async sendWrite<TResponse>(
    send: WriteSender,
    path: string,
    args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>,
  ): Promise<Lenient<TResponse>> {
    if (args.length === BODILESS_WRITE_ARITY) {
      const [responseSchema, context, opKey] = args;
      const response = await send(path, undefined, {
        rateDescriptor: { kind: "write", opKey },
      });
      return this.validateResponse(response.data, responseSchema, context);
    }

    const [body, bodySchema, responseSchema, context, opKey] = args;
    const validatedBody = this.validateRequest(body, bodySchema);
    const response = await send(path, validatedBody, {
      rateDescriptor: { kind: "write", opKey },
    });
    return this.validateResponse(response.data, responseSchema, context);
  }

  /**
   * Validates outgoing request data strictly (R6), throwing on the first failure.
   *
   * @internal
   */
  protected validateRequest<T>(data: T, schema: z.ZodType<T>): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new DattoValidationError(result.error, "request");
    }
    return result.data;
  }

  /**
   * Validates a single response value leniently (R5): unknown keys are stripped, null/absent is
   * tolerated on any field, and an undocumented enum member is widened to passthrough rather than
   * failing — all logged as aggregated `debug` diagnostics (Phase 4).
   *
   * `parseLenient` (given the logger this class always supplies) returns `Lenient<T>`, not the
   * bare `T` a schema's own `z.infer` would suggest: every named field additionally admits `null`
   * on top of its own declared optionality (see that type's doc, `src/validation/
   * schema-leniency.ts`). This method's own return type reflects that honestly — `Lenient<T>`, not
   * `T` — rather than re-asserting the narrower type, matching the type-honesty precedent Phase 4
   * itself established for `parseLenient` (a `T`-typed field silently admitting `null` at runtime
   * is exactly the defect `Lenient<T>` exists to surface at compile time, not hide again one layer
   * up). A resource method (Phase 7/8) that wants its own declared return type to be the clean
   * `Device`/`Alert`/etc. shape re-asserts that explicitly at its own return site via `narrow<T>`
   * (`./narrow.ts`) — a documented, intentional cast, the value-level counterpart to this file's
   * own `coerceSchema` (which retypes a *schema*, not an already-`Lenient`-wrapped value) — so the
   * narrowing is visible at the one place it is actually applied, not buried in this shared
   * primitive every resource method funnels through.
   *
   * @internal
   */
  protected validateResponse<T>(
    data: unknown,
    schema: z.ZodType<T>,
    context: string,
  ): Lenient<T> {
    const result = parseLenient(schema, data, this.logger, context);
    if (!result.success) {
      throw new DattoValidationError(result.error, "response", { context });
    }
    return result.data;
  }

  /**
   * Validates an array response leniently, **per item** (R7): each element is validated
   * independently via `validateResponse`'s same leniency, and an item that fails validation is
   * dropped rather than failing the whole response.
   *
   * Every drop for this one call is accumulated and reported as **one** aggregated `warn` summary
   * at the end — never one `warn` line per dropped row — mirroring how the benign strip/widen
   * diagnostics aggregate per `parseLenient` call (Phase 4 Step 3). This bounds a systematic drift
   * (one mistyped field dropping every item on an 848-device page) to a single `warn` line and
   * keeps the UDF masker off the per-row hot path. Per R20, the dropped rows' fields ride in
   * `meta` (masked by `withUdfMasking` before reaching the real sink), never the message string.
   *
   * **Non-array `data` is itself a diagnostic, not a silent empty result.** A genuinely-empty page
   * is `data` being an (empty) array — that emits no `warn`, since zero items is a legitimate
   * outcome. But `data` being `undefined`/`null`/non-array (a wrong `arrayKey`, or a spec drift that
   * renamed/removed the array field) is indistinguishable from "empty" unless reported: it emits
   * its own single `warn`, distinct from the per-item drop summary, so a caller sees a shape
   * problem instead of a page that silently vanished.
   *
   * @internal
   */
  protected validateArrayResponse<T>(
    data: unknown,
    itemSchema: z.ZodType<T>,
    context: string,
  ): Lenient<T>[] {
    const items: Lenient<T>[] = [];
    const dropped: Array<{ index: number; error: string }> = [];
    const label = context || UNKNOWN_CONTEXT;

    if (Array.isArray(data)) {
      for (let index = 0; index < data.length; index++) {
        const result = parseLenient(
          itemSchema,
          data[index],
          this.logger,
          label,
        );
        if (result.success) {
          items.push(result.data);
        } else {
          dropped.push({ index, error: z.prettifyError(result.error) });
        }
      }
    } else {
      this.logger.warn("response array field was not an array", {
        context: label,
        receivedType: describeType(data),
      });
    }

    if (dropped.length > 0) {
      this.logger.warn("dropped invalid response array items", {
        context: label,
        dropped: dropped.length,
        total: Array.isArray(data) ? data.length : 0,
        firstErrors: dropped.slice(0, MAX_REPORTED_DROP_ERRORS),
      });
    }

    return items;
  }

  /**
   * Walks a paginated collection's `{ pageDetails, <arrayKey> }` envelope, following
   * `pageDetails.nextPageUrl` until it is `null`/empty, and returns the full accumulated result
   * set (R3).
   *
   * Calls the shared axios instance directly rather than `httpGet` — this reads a two-part
   * envelope (a strict cursor plus a leniently-validated array), not a single schema-validated
   * value — and so must attach its own explicit `{ kind: 'read' }` `RateDescriptor` on every
   * page's request so this highest-volume read path is never sent unthrottled.
   *
   * Each page's cursor is validated **strictly** against the R3 `pageDetails` override
   * (`src/schema-overrides/pagination.ts`): a missing or malformed cursor **throws**
   * `DattoValidationError` and aborts the walk rather than silently truncating it. A `null` (or
   * empty-string — real Datto pages terminate with `nextPageUrl: ""`, which is equally falsy)
   * `nextPageUrl` is the normal end-of-walk terminal. Each page's named array validates leniently
   * via `validateArrayResponse` — leniency governs the item payloads, never the walk cursor.
   *
   * A non-terminal `nextPageUrl` is resolved via {@link resolveNextPageUrl} (cross-origin cursors
   * rejected — SSRF/credential-exfiltration guard) before being followed, and the walk itself is
   * bounded against a pathological cursor chain: a repeated URL (a cycle) is rejected the moment
   * it recurs, and the walk aborts outright past {@link MAX_PAGINATION_PAGES} pages regardless of
   * whether the URLs repeat, so neither a self-referential nor an ever-advancing `nextPageUrl` can
   * hang the process or grow `items` without bound.
   *
   * @param startPath - The first page's request path
   * @param arrayKey - The envelope's named-array key (e.g. `'devices'`, `'alerts'`)
   * @param itemSchema - Zod schema each array item is validated against
   * @param params - Optional query-string parameters for the **first** request only —
   *   `nextPageUrl` already carries whatever query state the server needs for subsequent pages
   * @param context - Optional label for the call site, threaded into leniency diagnostics and any
   *   thrown `DattoValidationError`; falls back to `'(unknown)'` when omitted (mirrors the plan's
   *   pinned `paginate(startPath, arrayKey, itemSchema, params?, context?)` signature, where both
   *   trailing parameters are optional — see this class's doc for why the `http*` primitives, whose
   *   overload dispatch depends on a fixed argument-tail length, require `context` while `paginate`,
   *   which has no such overload, does not)
   * @throws {DattoValidationError} If any page's `pageDetails` cursor is missing or malformed, if a
   *   `nextPageUrl` does not resolve to the configured `apiUrl`'s origin, or if the cursor chain is
   *   cyclic or exceeds {@link MAX_PAGINATION_PAGES}
   */
  protected async paginate<T>(
    startPath: string,
    arrayKey: string,
    itemSchema: z.ZodType<T>,
    params?: Record<string, unknown>,
    context?: string,
  ): Promise<Lenient<T>[]> {
    const items: Lenient<T>[] = [];
    let url: string | null = startPath;
    let pageParams = params;
    const label = context || UNKNOWN_CONTEXT;
    const baseURL = this.axios.defaults.baseURL;
    const visitedUrls = new Set<string>();

    while (url) {
      if (visitedUrls.has(url)) {
        throw paginateGuardError(
          "nextPageUrl repeated an already-fetched page, indicating a cyclic cursor chain",
          label,
        );
      }
      if (visitedUrls.size >= MAX_PAGINATION_PAGES) {
        throw paginateGuardError(
          `paginate exceeded the ${MAX_PAGINATION_PAGES}-page limit without reaching a terminal nextPageUrl`,
          label,
        );
      }
      visitedUrls.add(url);

      const { data } = await this.axios.get(url, {
        params: pageParams,
        rateDescriptor: { kind: "read" },
      });
      const record = isRecord(data) ? data : undefined;
      const cursor = pageDetailsSchema.safeParse(record?.pageDetails);
      if (!cursor.success) {
        throw new DattoValidationError(cursor.error, "response", {
          context: label,
        });
      }
      items.push(
        ...this.validateArrayResponse(record?.[arrayKey], itemSchema, label),
      );
      url = cursor.data.nextPageUrl
        ? resolveNextPageUrl(cursor.data.nextPageUrl, baseURL, label)
        : null;
      pageParams = undefined;
    }

    return items;
  }
}
