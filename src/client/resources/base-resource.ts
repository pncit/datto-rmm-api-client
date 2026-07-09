import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { z } from "zod";

import { DattoValidationError } from "../../errors";
import type { DattoLogger } from "../../logging/logger";
import type { WriteOpKey } from "../../rate-limit/rate-limits";
import { pageDetailsSchema } from "../../schema-overrides/pagination";
import { parseLenient } from "../../validation/schema-leniency";

/**
 * Coerces a Zod schema's inferred output type to a specific type `T`.
 *
 * Ported from `fuze-api`'s identical helper. Addresses the structural-vs-nominal divergence
 * between a **reconciled** override schema's own `z.infer` (e.g. `z.infer<typeof
 * deviceResponseSchema>`, which still carries the *closed*, pre-graft enum types for
 * `deviceClass`/`antivirus`/`patchManagement`) and the **exported** entity type it backs (`Device`,
 * `src/schema-overrides/types.ts`, which grafts on the codemod-widened open-enum subtrees — see
 * that module's doc). A resource method (Phase 7/8) declaring `Promise<Device>` passes
 * `coerceSchema<Device>(deviceResponseSchema)` to `httpGet`/`httpPost`/etc. so the primitive's
 * generic response type matches the method's own declared return type.
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
 * `httpGet`/`httpPost`/`httpPut`/`httpPatch`/`httpDelete` — plus `validateRequest` (strict, R6),
 * `validateResponse`/`validateArrayResponse` (lenient, R5/R7), and the strict-cursor `paginate`
 * walker (R3). Every primitive sends through the **single**, interceptor-bearing axios instance
 * built in Phase 5 (`createHttpClient`) — there is no generated endpoints layer and no second
 * transport — so every request a resource makes is rate-limited, retried, and error-mapped by that
 * one shared stack.
 *
 * **Primitive naming.** Named `http*` rather than `get`/`post`/`put`/`patch`/`delete` (fuze-api's
 * names) so a resource subclass can expose a public method of the same or a related name — e.g.
 * `DeviceResource.get(uid)` — without a `TS2416` incompatible-override collision or its body
 * silently recursing into itself. **Resource classes call only these `http*` primitives, never
 * `this.axios` directly** — that is what guarantees every request carries a `RateDescriptor` and
 * runs through validation.
 *
 * **Five primitives, not four.** The plan (mirroring `fuze-api`) names `httpGet`/`httpPost`/
 * `httpPatch`/`httpDelete`. Datto's real, committed spec (`spec/openapi.json`) uses **no `PATCH`
 * operations at all** and instead uses `PUT` for five write operations this project's own
 * WriteOpKey table requires (`device-move`, `device-job-create`, `site-create`,
 * `site-variable-set`'s create half, `account-variable-set`'s create half) — confirmed by reading
 * every non-`GET` `(method, path)` pair in the committed spec. Without a validated `httpPut`
 * primitive, Phase 7/8 could not implement those required (R1) operations without a resource
 * either bypassing `BaseResource` (calling `this.axios.put` directly — defeating the
 * single-validated-primitive architecture this class exists to provide) or mis-sending them as
 * `POST`/`PATCH` against a server that does not accept that verb for those paths. `httpPut` is
 * added here, mirroring `httpPost`'s exact shape, as the minimal fix. `httpPatch` is kept even
 * though no current Datto write uses it — it costs nothing to keep, matches the plan's pinned name
 * (`fuze-api` parity — Decision 1), and a future spec revision may add one.
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
  ): Promise<TResponse> {
    const response = await this.axios.get(path, {
      params,
      rateDescriptor: { kind: "read" },
    });
    return this.validateResponse(response.data, responseSchema, context);
  }

  /** Bodiless `POST` (e.g. `POST /alert/{uid}/resolve`): no request body to validate. */
  protected httpPost<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse>
  ): Promise<TResponse>;
  /** Body-carrying `POST` (e.g. `POST /device/{uid}/udf`): `body` is validated against
   * `bodySchema` before the request is sent (R6). */
  protected httpPost<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<TResponse>;
  protected httpPost<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<TResponse> {
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
  ): Promise<TResponse>;
  /** Body-carrying `PUT` (e.g. `PUT /site` — `site-create`). */
  protected httpPut<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<TResponse>;
  protected httpPut<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<TResponse> {
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
  ): Promise<TResponse>;
  /** Body-carrying `PATCH`. */
  protected httpPatch<TBody, TResponse>(
    path: string,
    ...args: BodiedWriteArgs<TBody, TResponse>
  ): Promise<TResponse>;
  protected httpPatch<TResponse>(
    path: string,
    ...args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>
  ): Promise<TResponse> {
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
   * is the 3-element bodiless tail or the 5-element body-carrying tail, validating the body first
   * (bodied case only) and always validating the response leniently. */
  private async sendWrite<TResponse>(
    send: WriteSender,
    path: string,
    args: BodilessWriteArgs<TResponse> | BodiedWriteArgs<unknown, TResponse>,
  ): Promise<TResponse> {
    if (args.length === 3) {
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
   * `parseLenient` (given the logger this class always supplies) actually returns `Lenient<T>` —
   * every named field additionally admits `null` on top of its own declared optionality (see that
   * type's doc, `src/validation/schema-leniency.ts`). Re-asserting the narrower `T` here keeps
   * every resource method's declared return type (`Device`, `Alert`, …) the clean, documented
   * shape those types are meant to be; a `T`-typed field being unexpectedly `null` at runtime is
   * exactly the reality response leniency exists to tolerate, not a guarantee this cast invents.
   *
   * @internal
   */
  protected validateResponse<T>(
    data: unknown,
    schema: z.ZodType<T>,
    context: string,
  ): T {
    const result = parseLenient(schema, data, this.logger, context);
    if (!result.success) {
      throw new DattoValidationError(result.error, "response", { context });
    }
    return result.data as T;
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
   * @internal
   */
  protected validateArrayResponse<T>(
    data: unknown,
    itemSchema: z.ZodType<T>,
    context: string,
  ): T[] {
    const items: T[] = [];
    const dropped: Array<{ index: number; error: string }> = [];

    if (Array.isArray(data)) {
      for (let index = 0; index < data.length; index++) {
        const result = parseLenient(
          itemSchema,
          data[index],
          this.logger,
          context,
        );
        if (result.success) {
          items.push(result.data as T);
        } else {
          dropped.push({ index, error: z.prettifyError(result.error) });
        }
      }
    }

    if (dropped.length > 0) {
      this.logger.warn("dropped invalid response array items", {
        context: context || UNKNOWN_CONTEXT,
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
   * @param startPath - The first page's request path
   * @param arrayKey - The envelope's named-array key (e.g. `'devices'`, `'alerts'`)
   * @param itemSchema - Zod schema each array item is validated against
   * @param params - Optional query-string parameters for the **first** request only —
   *   `nextPageUrl` already carries whatever query state the server needs for subsequent pages
   * @param context - Label for the call site, threaded into leniency diagnostics and any thrown
   *   `DattoValidationError`
   * @throws {DattoValidationError} If any page's `pageDetails` cursor is missing or malformed
   */
  protected async paginate<T>(
    startPath: string,
    arrayKey: string,
    itemSchema: z.ZodType<T>,
    params: Record<string, unknown> | undefined,
    context: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = startPath;
    let pageParams = params;

    while (url) {
      const { data } = await this.axios.get(url, {
        params: pageParams,
        rateDescriptor: { kind: "read" },
      });
      const cursor = pageDetailsSchema.safeParse(
        (data as Record<string, unknown> | undefined)?.pageDetails,
      );
      if (!cursor.success) {
        throw new DattoValidationError(cursor.error, "response", { context });
      }
      items.push(
        ...this.validateArrayResponse(
          (data as Record<string, unknown> | undefined)?.[arrayKey],
          itemSchema,
          context,
        ),
      );
      url = cursor.data.nextPageUrl || null;
      pageParams = undefined;
    }

    return items;
  }
}
