import { DattoRmmClientConfig } from "./config.js";
import { defaultLogger, LoggerLike } from "./logger.js";
import { SlidingWindowRateLimiter } from "./rateLimiter.js";
import { HttpClient } from "./httpClient.js";
import { AuthManager } from "./auth.js";
import {
  validate,
  validateItems,
  toProblemError,
  firstIssuePath,
  VALIDATION_ERROR_TYPE,
  VALIDATION_ERROR_STATUS,
  VALIDATION_ERROR_PREFIX,
  ValidationMode,
} from "./validation.js";
import { Device, DeviceSchema } from "./schemas.js";
import {
  DevicesEnvelopeSchema,
  DevicesEnvelope,
} from "./internal/devicesEnvelope.js";
import { ZodError, ZodType } from "zod/v4";
import { Result, ProblemError } from "./result.js";

// Single source of truth for the envelope hard-fail's title, reused in the log line, the
// ProblemError.title, and the detail template so the phrase can't drift across the three
// call sites (mirrors firstIssuePath's single-source-of-truth role for the failing path).
const MALFORMED_ENVELOPE_TITLE = "Malformed devices page envelope";

export class DattoRmmClient {
  private rateLimiter: SlidingWindowRateLimiter;
  private http: HttpClient;
  private auth: AuthManager;
  private validationMode: ValidationMode;
  private logger: LoggerLike;

  constructor(private config: DattoRmmClientConfig) {
    this.validationMode = config.validationMode ?? "strict";
    // Resolved once; `getAllPages`/`getDeviceByUid` read `this.logger` rather than re-deriving
    // `config.logger ?? defaultLogger` per call. Assigned in the constructor body (not an inline
    // field initializer) because `config` is a constructor parameter property here, and a field
    // initializer cannot reference the bare parameter name.
    this.logger = config.logger ?? defaultLogger;
    this.rateLimiter = new SlidingWindowRateLimiter({
      requestsPerWindow: config.rateLimit?.requestsPerWindow ?? 600,
      windowSeconds: config.rateLimit?.windowSeconds ?? 60,
      throttleThresholdPct: config.rateLimit?.throttleThresholdPct ?? 90,
    });
    this.http = new HttpClient({
      axios: config.axiosInstance,
      rateLimiter: this.rateLimiter,
      logger: this.logger,
      retry: { maxAttempts: config.retry?.maxAttempts ?? 3 },
    });
    this.auth = new AuthManager(this.http, config);
  }

  /**
   * Walks `pageDetails.nextPageUrl` pagination, validating each page in two passes: the
   * structural "envelope" (is this a well-formed page at all?) via a direct `envelopeSchema`
   * `safeParse`, then each raw element of `extractor(page)` individually via `validateItems`.
   * A divergent item is scoped to itself (dropped + warned in `strict`, kept raw + warned in
   * `warn`, passed through in `off`) so it never blocks the rest of the page or account (R1).
   * A malformed envelope is a protocol error and aborts the whole walk (R5) — validated in
   * `strict`/`warn` only; `off` runs no envelope check and reads the walk cursor best-effort,
   * preserving its raw-passthrough contract (R8).
   */
  private async getAllPages<
    T,
    P extends { pageDetails?: { nextPageUrl: string | null } },
  >(
    url: string,
    token: string,
    params: Record<string, any> | undefined,
    envelopeSchema: ZodType<P>,
    itemSchema: ZodType<T>,
    extractor: (page: P) => unknown[],
  ): Promise<Result<T[]>> {
    let nextUrl: string | null | undefined = url;
    let nextParams = params;
    const items: T[] = [];
    const warnings: ProblemError[] = [];

    while (nextUrl) {
      const res: Result<unknown> = await this.http.request<unknown>({
        method: "GET",
        url: nextUrl,
        headers: { Authorization: `Bearer ${token}` },
        params: nextParams,
      });
      if (!res.ok) return res; // axios error already handled

      let page: P;
      if (this.validationMode === "off") {
        // off: no validation of any kind, including the envelope — best-effort walk over the
        // raw body, exactly as today.
        page = res.value as P;
      } else {
        // Envelope validated via a direct safeParse — deliberately NOT validate() — because
        // validate()'s warn branch logs-and-passes-through, which would let a malformed page
        // slip past the R5 hard-fail guarantee. This check is identical in strict and warn.
        const parsed = envelopeSchema.safeParse(res.value);
        if (!parsed.success) {
          // Compute the failing path once; reuse it for both the log line and the
          // ProblemError.detail so every validation-error site shares one concise, path-named
          // convention and detail is never a raw multi-line ZodError.message blob.
          const envelopePath = firstIssuePath(parsed.error);
          this.logger.error(
            `${VALIDATION_ERROR_PREFIX}: ${MALFORMED_ENVELOPE_TITLE} at ${nextUrl} (path: ${envelopePath})`,
          );
          return {
            ok: false,
            error: {
              type: VALIDATION_ERROR_TYPE,
              title: MALFORMED_ENVELOPE_TITLE,
              status: VALIDATION_ERROR_STATUS,
              detail: `${MALFORMED_ENVELOPE_TITLE} (path: ${envelopePath})`,
              raw: parsed.error,
            },
          };
        }
        page = parsed.data;
      }

      const partition = validateItems(
        itemSchema,
        extractor(page),
        this.validationMode,
        "Device",
        this.logger,
      );
      items.push(...partition.valid);
      warnings.push(...partition.warnings);

      // Optional-chain `page` itself, not only `.pageDetails`: in `off` mode `page` may be
      // null/a primitive (no envelope check ran), and this is a separate statement the
      // extractor's own `p?.devices` guard cannot cover.
      nextUrl = page?.pageDetails?.nextPageUrl;
      nextParams = undefined;
    }

    // `warnings` is always present, even when empty, on a clean/fully-valid account — a stable
    // shape is simpler for consumers to test (`result.warnings.length`) than an optional field
    // whose absence also means "no warnings".
    return { ok: true, value: items, warnings };
  }

  async getAccountDevices(
    params?: Record<string, any>,
  ): Promise<Result<Device[]>> {
    const tokenRes = await this.auth.getToken();
    if (!tokenRes.ok) return tokenRes as any;
    return this.getAllPages<Device, DevicesEnvelope>(
      `${this.config.apiUrl}/api/v2/account/devices`,
      tokenRes.value.accessToken,
      params,
      DevicesEnvelopeSchema,
      DeviceSchema,
      // Optional-chained: an `off`-mode null/primitive page body must not throw here.
      (p) => p?.devices ?? [],
    );
  }

  async getDeviceByUid(deviceUid: string): Promise<Result<Device>> {
    const tokenRes = await this.auth.getToken();
    if (!tokenRes.ok) return tokenRes as any;
    const res = await this.http.request<Device>({
      method: "GET",
      url: `${this.config.apiUrl}/api/v2/device/${deviceUid}`,
      headers: { Authorization: `Bearer ${tokenRes.value.accessToken}` },
    });
    if (!res.ok) return res; // axios error already handled
    try {
      return {
        ok: true,
        value: validate(
          DeviceSchema,
          res.value,
          this.validationMode,
          this.logger,
        ),
      };
    } catch (e) {
      if (e instanceof ZodError) {
        // Single device: no subset to salvage, so this stays fail-hard (R7). Build the
        // ProblemError once via the same shared builder validateItems uses, so every
        // validation-error site (per-device page rejections, this catch, the envelope
        // hard-fail) shares one shape — short stable title, specifics in detail, ZodError in raw.
        // No index/identityOverride: extractIdentity's id-first result already names the
        // divergent device (every valid Device carries a numeric `id`, per schemas.ts), so the
        // detail reads `id=...` rather than `uid=...` even though the endpoint is addressed by
        // uid — acceptable per plan (R2 permits either id or uid as the identity). `index`
        // defaults to 0 and is only reached as a fallback if `id` is itself absent from the
        // divergent payload.
        const problem = toProblemError("Device", e, res.value);
        this.logger.error(
          `${VALIDATION_ERROR_PREFIX}: getDeviceByUid: ${problem.detail}`,
        );
        return { ok: false, error: problem };
      }
      return {
        ok: false,
        error: { type: "unknown-error", title: String(e), status: 500, raw: e },
      };
    }
  }

  async updateDeviceUdfs(
    deviceUid: string,
    udf: Partial<Device["udf"]>,
  ): Promise<Result<void>> {
    const tokenRes = await this.auth.getToken();
    if (!tokenRes.ok) return tokenRes as any;
    const res = await this.http.request<void>({
      method: "PATCH",
      url: `${this.config.apiUrl}/api/v2/account/devices/${deviceUid}/udf`,
      headers: { Authorization: `Bearer ${tokenRes.value.accessToken}` },
      data: udf,
    });
    return res;
  }

  invalidateToken() {
    this.auth.invalidate();
  }
}

export function createDattoRmmClient(
  config: DattoRmmClientConfig,
): DattoRmmClient {
  return new DattoRmmClient(config);
}
