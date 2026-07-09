import axios, { type AxiosError, type AxiosInstance } from "axios";

import { DEFAULT_TOKEN_REFRESH_PCT } from "../defaults";
import { DattoApiError } from "../errors";

import { InMemoryTokenStore, type TokenInfo } from "./token-store";

/** The OAuth2 password-grant token response Datto's `/auth/oauth/token` endpoint returns. */
interface TokenResponse {
  readonly access_token: string;
  /** Token lifetime in seconds. */
  readonly expires_in: number;
}

export interface AuthManagerConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Percentage of the token's original TTL remaining that triggers a proactive refresh. Default: {@link DEFAULT_TOKEN_REFRESH_PCT}. */
  readonly tokenRefreshPct?: number;
}

const GRANT_PATH = "/auth/oauth/token";

/**
 * Datto RMM's public OAuth2 password-grant client credentials — a fixed, non-secret
 * `client_id`/`client_secret` pair every consumer of the API uses (the caller's own
 * `apiKey`/`apiSecret` are the actual username/password of the grant, sent in the request body).
 */
const BASIC_AUTH_USERNAME = "public-client";
const BASIC_AUTH_PASSWORD = "public";

/**
 * OAuth2 password-grant token lifecycle for the Datto RMM v2 API (R10). Ported from the retired
 * `src/auth.ts`'s `AuthManager`, refactored to **throw** instead of returning `Result<T>`
 * (Decision 4), and to drive proactive refresh from `tokenRefreshPct` (remaining-TTL percentage)
 * rather than the old fixed 60s pre-expiry window.
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

  constructor(private readonly config: AuthManagerConfig) {
    this.refreshPct = config.tokenRefreshPct ?? DEFAULT_TOKEN_REFRESH_PCT;
    this.grantClient = axios.create({
      baseURL: config.apiUrl,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
   */
  async refreshToken(): Promise<TokenInfo> {
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.config.apiKey,
      password: this.config.apiSecret,
    });

    const issuedAt = Date.now();
    let response;
    try {
      response = await this.grantClient.post<TokenResponse>(
        GRANT_PATH,
        body.toString(),
        {
          auth: {
            username: BASIC_AUTH_USERNAME,
            password: BASIC_AUTH_PASSWORD,
          },
        },
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        throw DattoApiError.fromAxiosError(err as AxiosError<unknown>);
      }
      throw new DattoApiError("Datto RMM authentication failed", {
        statusCode: 0,
        cause: err,
      });
    }

    const info: TokenInfo = {
      accessToken: response.data.access_token,
      issuedAt,
      expiresAt: issuedAt + response.data.expires_in * 1000,
    };
    this.store.set(info);
    return info;
  }

  /** Discards the cached token, forcing the next {@link getToken} call to refresh. */
  invalidate(): void {
    this.store.invalidate();
  }
}
