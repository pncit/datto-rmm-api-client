/**
 * A cached OAuth2 access token, plus the timestamps {@link AuthManager} needs to compute
 * proactive-refresh timing against `tokenRefreshPct`.
 */
export interface TokenInfo {
  readonly accessToken: string;
  /** When this token was issued (epoch ms) — the TTL baseline `tokenRefreshPct` is measured from. */
  readonly issuedAt: number;
  /** When this token expires (epoch ms). */
  readonly expiresAt: number;
}

/**
 * In-memory single-token cache. Ported unchanged in behavior from the retired
 * `src/tokenStore.ts`'s `InMemoryTokenStore` (`set`/`get`/`invalidate`, one token at a time, no
 * persistence) — the only difference is {@link TokenInfo} now also carries `issuedAt` so
 * `AuthManager` (`./auth-manager.ts`) can compute the token's remaining-lifetime percentage
 * instead of the old fixed 60s pre-expiry window (R10).
 */
export class InMemoryTokenStore {
  private token: TokenInfo | undefined;

  set(token: TokenInfo): void {
    this.token = token;
  }

  get(): TokenInfo | undefined {
    return this.token;
  }

  invalidate(): void {
    this.token = undefined;
  }
}
