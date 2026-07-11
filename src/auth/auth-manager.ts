import axios, { type AxiosError, type AxiosInstance } from "axios";
import { z } from "zod";

import { DEFAULT_TIMEOUT_MS, DEFAULT_TOKEN_REFRESH_PCT } from "../defaults";
import { DattoApiError } from "../errors";
import type { DattoHttpObserver } from "../http/http-observer";
import { captureRequest, fireError, fireRequest, fireResponse } from "../http/observer";
import type { DattoLogger } from "../logging/logger";

import { InMemoryTokenStore, type TokenInfo } from "./token-store";

/**
 * Zod schema for the OAuth2 password-grant token response Datto's `/auth/oauth/token` endpoint
 * returns. The grant response is unvalidated external input at a trust boundary — without this
 * check, a malformed body (missing `access_token`, non-numeric `expires_in`) would silently
 * compute a `NaN` expiry and cache an unusable `accessToken: undefined` token that
 * `needsRefresh` then never flags for refresh.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export interface AuthManagerConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Percentage of the token's original TTL remaining that triggers a proactive refresh. Default: {@link DEFAULT_TOKEN_REFRESH_PCT}. */
  readonly tokenRefreshPct?: number;
  /** Per-request socket timeout for the grant/refresh round-trip, in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Optional logger for refresh observability. Never logs the request body or credentials. */
  readonly logger?: DattoLogger;
  /**
   * Optional HTTP-observer callbacks, fired once for the grant/refresh round-trip this class
   * dispatches (design Decision 2/5). Unlike {@link AuthManagerConfig.logger}, which is always
   * UDF-masked, this is threaded through **raw/unmasked** — the observer receives the serialized
   * grant body (carrying the API key) and response exactly as sent/received.
   */
  readonly httpObserver?: DattoHttpObserver;
}

const GRANT_PATH = "/auth/oauth/token";
const GRANT_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * Datto RMM's public OAuth2 password-grant client credentials — a fixed, non-secret
 * `client_id`/`client_secret` pair every consumer of the API uses (the caller's own
 * `apiKey`/`apiSecret` are the actual username/password of the grant, sent in the request body).
 */
const BASIC_AUTH_USERNAME = "public-client";
const BASIC_AUTH_PASSWORD = "public";

/**
 * OAuth2 password-grant token lifecycle for the Datto RMM v2 API (R10). Ported from the retired
 * `0.1.x` `AuthManager` (`src/auth.ts`, deleted in Phase 8), refactored to **throw** instead of
 * returning the old non-throwing result contract (Decision 4), and to drive proactive refresh
 * from `tokenRefreshPct` (remaining-TTL percentage) rather than the old fixed 60s pre-expiry
 * window.
 *
 * **Transport isolation (Phase 5 Step 4, critical):** the token round-trip is not a v2 endpoint
 * and must not carry a Bearer header, consume the v2 read rate-limit window, or run through the
 * shared instance's 429/403 retry+classification path. This class therefore issues its
 * grant/refresh POST through its own **bare** axios instance — constructed here, with none of
 * `../http/http-client.ts`'s interceptors — so the token call can never consume the API budget
 * or attach v2 auth. {@link attachTo} is the *only* place this class touches the shared,
 * interceptor-bearing instance, and it does so purely to attach the outgoing `Authorization`
 * header, never to issue the grant/refresh call itself.
 */
export class AuthManager {
  private readonly store = new InMemoryTokenStore();
  private readonly grantClient: AxiosInstance;
  private readonly refreshPct: number;
  /** The in-flight refresh, if any — shared by every concurrent caller so a burst of
   * `getToken()` calls against an empty/stale cache produces exactly one grant round-trip. */
  private pendingRefresh: Promise<TokenInfo> | undefined;

  constructor(private readonly config: AuthManagerConfig) {
    this.refreshPct = config.tokenRefreshPct ?? DEFAULT_TOKEN_REFRESH_PCT;
    this.grantClient = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: { "Content-Type": GRANT_CONTENT_TYPE },
    });
  }

  /**
   * Attaches a request interceptor to `instance` (the shared, interceptor-bearing axios
   * instance from `../http/http-client.ts`) that sets `Authorization: Bearer <token>` on every
   * outgoing request, obtaining/refreshing the token via {@link getToken} first. This is the
   * only interaction this class has with the shared instance — the grant/refresh call itself
   * always goes through the separate {@link grantClient}.
   */
  attachTo(instance: AxiosInstance): void {
    instance.interceptors.request.use(async (requestConfig) => {
      const token = await this.getToken();
      requestConfig.headers.set("Authorization", `Bearer ${token.accessToken}`);
      return requestConfig;
    });
  }

  /**
   * Returns a valid cached token, proactively refreshing first if its remaining lifetime has
   * fallen below `tokenRefreshPct` of its original TTL (or if there is no cached token yet).
   */
  async getToken(): Promise<TokenInfo> {
    const existing = this.store.get();
    if (existing && !this.needsRefresh(existing)) {
      return existing;
    }
    return this.refreshToken();
  }

  private needsRefresh(token: TokenInfo): boolean {
    const totalTtlMs = token.expiresAt - token.issuedAt;
    if (totalTtlMs <= 0) {
      return true;
    }
    const remainingPct = ((token.expiresAt - Date.now()) / totalTtlMs) * 100;
    return remainingPct < this.refreshPct;
  }

  /**
   * Performs the OAuth2 password-grant round-trip and caches the result. Throws
   * {@link DattoApiError} on failure — the one error-mapping site on the auth path, since the
   * bare {@link grantClient} deliberately carries none of the shared instance's response-error
   * interceptor (Phase 5 Step 3(b)/(c)).
   *
   * **Single-flight:** concurrent callers (e.g. several `BaseResource` calls firing in parallel
   * against an empty or just-expired cache) share the one in-flight grant round-trip rather than
   * each independently posting a grant request — a burst that would otherwise fire N simultaneous
   * grants, each overwriting the store (last write wins), and self-inflict load on the auth
   * endpoint precisely at client startup.
   */
  async refreshToken(): Promise<TokenInfo> {
    if (!this.pendingRefresh) {
      this.pendingRefresh = this.performRefresh().finally(() => {
        this.pendingRefresh = undefined;
      });
    }
    return this.pendingRefresh;
  }

  private async performRefresh(): Promise<TokenInfo> {
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.config.apiKey,
      password: this.config.apiSecret,
    });
    const wireBody = body.toString();

    const issuedAt = Date.now();
    this.config.logger?.debug("refreshing Datto RMM OAuth2 token");

    // Built through the shared `captureRequest` assembler (design Decision 2) — never inline —
    // so this site cannot drift from the shared instance's interceptor in how it uppercases the
    // method or normalizes headers. `Authorization` is omitted by design: the `Basic` header
    // below is applied internally by axios from the per-request `auth:` option (Decision 5); the
    // API key rides in `wireBody` instead. `capture.startedAt` is the observer's own dispatch
    // timestamp — distinct from `issuedAt` above, which remains the token-TTL anchor.
    const capture = captureRequest({
      method: "POST",
      url: this.grantClient.getUri({ url: GRANT_PATH }),
      headers: { "Content-Type": GRANT_CONTENT_TYPE },
      body: wireBody,
    });
    fireRequest(this.config.logger, this.config.httpObserver, capture);

    let response;
    try {
      response = await this.grantClient.post<unknown>(GRANT_PATH, wireBody, {
        auth: {
          username: BASIC_AUTH_USERNAME,
          password: BASIC_AUTH_PASSWORD,
        },
      });
    } catch (err) {
      this.config.logger?.warn("Datto RMM OAuth2 token refresh failed");
      // The raw caught error is handed straight through to `onError.error` — never the mapped
      // `DattoApiError` constructed below (design Decision 4 / R8).
      fireError(this.config.logger, this.config.httpObserver, capture, err);
      if (axios.isAxiosError(err)) {
        throw DattoApiError.fromAxiosError(err as AxiosError<unknown>);
      }
      throw new DattoApiError("Datto RMM authentication failed", {
        statusCode: 0,
        cause: err,
      });
    }

    // Fired on the resolved 2xx, BEFORE `safeParse` runs below — a malformed-token 2xx has
    // already fired its one terminal event here and must never also fire `onError` (Decision 4
    // rule 3).
    fireResponse(this.config.logger, this.config.httpObserver, capture, response);

    const parsed = tokenResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      this.config.logger?.warn(
        "Datto RMM OAuth2 token refresh returned a malformed response",
      );
      throw new DattoApiError(
        "Datto RMM authentication returned a malformed token response",
        {
          statusCode: response.status,
          cause: parsed.error,
        },
      );
    }

    const info: TokenInfo = {
      accessToken: parsed.data.access_token,
      issuedAt,
      expiresAt: issuedAt + parsed.data.expires_in * 1000,
    };
    this.store.set(info);
    return info;
  }

  /**
   * Discards the cached token, forcing the next {@link getToken} call to refresh. Intended to be
   * wired as `HttpClientConfig.onUnauthorized` (`../http/http-client.ts`, Phase 5) by the client
   * scaffold (Phase 7): a 401 on the shared instance means the cached token was rejected
   * server-side (revoked, or expired before the proactive-refresh window caught it), and
   * invalidating it here makes the transport's single automatic retry pick up a freshly-fetched
   * token instead of resending the same stale one.
   */
  invalidate(): void {
    this.store.invalidate();
  }
}
