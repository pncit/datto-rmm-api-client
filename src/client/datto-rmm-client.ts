import { AuthManager } from "../auth/auth-manager";
import { DattoValidationError } from "../errors";
import { consoleLogger } from "../logging/logger";
import { withUdfMasking } from "../logging/mask";
import { createHttpClient } from "../http/http-client";
import { MultiWindowRateLimiter } from "../rate-limit/rate-limiter";

import {
  dattoRmmClientConfigSchema,
  type DattoRmmClientConfig,
} from "./datto-client-config";
import { AccountResource } from "./resources/account-resource";
import { AlertResource } from "./resources/alert-resource";
import { DeviceResource } from "./resources/device-resource";
import { JobResource } from "./resources/job-resource";
import { SiteResource } from "./resources/site-resource";

/**
 * `DattoRmmClient` (R1, R2, R9, R10–R14, design "Public surface" / Overview): constructs and
 * wires every layer below the resource namespaces — config validation, the UDF-masking logger
 * boundary (R20), the dual-layer rate limiter (R11), the shared interceptor-bearing axios
 * instance (R12), and the throwing OAuth2 `AuthManager` (R10) — then mounts the resource
 * namespaces on top.
 *
 * **Phase 7 scope (this class):** mounts the five namespaces this phase implements — `account`,
 * `sites`, `devices`, `alerts`, `jobs`. Phase 8 adds the remaining five (`audit`, `filters`,
 * `users`, `activityLogs`, `system`) and the public `createDattoRmmClient(config)` factory (plan
 * Phase 8 Step 6) — this class is not yet exported from `src/index.ts` (the old barrel stays
 * active per the plan's coexistence rule; plan Phase 7 Step 6: "Do not touch `src/index.ts`
 * yet").
 *
 * **Construction order matters:** the shared axios instance is built via `createHttpClient`
 * (Phase 5) with no authentication wired in (by design — see that module's doc); `AuthManager`
 * then attaches its own request interceptor onto that same instance via `attachTo`, and is wired
 * as `createHttpClient`'s `onUnauthorized` hook (`() => authManager.invalidate()`) so a 401
 * discards the stale cached token before the transport's single automatic retry. Every resource
 * is constructed with that one shared axios instance and the one masked logger — per
 * `BaseResource`'s doc, there is exactly one axios instance in the client, so every request any
 * resource makes is rate-limited, retried, and error-mapped by the same stack.
 */
export class DattoRmmClient {
  readonly account: AccountResource;
  readonly sites: SiteResource;
  readonly devices: DeviceResource;
  readonly alerts: AlertResource;
  readonly jobs: JobResource;

  constructor(config: DattoRmmClientConfig) {
    const parsed = dattoRmmClientConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new DattoValidationError(parsed.error, "request", {
        context: "DattoRmmClient config",
      });
    }
    const validated = parsed.data;

    const logger = withUdfMasking(validated.logger ?? consoleLogger);

    const rateLimiter = new MultiWindowRateLimiter({
      readLimit: validated.rateLimit?.readLimit,
      writeAggregateLimit: validated.rateLimit?.writeAggregateLimit,
      windowSeconds: validated.rateLimit?.windowSeconds,
      logger,
    });

    const authManager = new AuthManager({
      apiUrl: validated.apiUrl,
      apiKey: validated.apiKey,
      apiSecret: validated.apiSecret,
      tokenRefreshPct: validated.tokenRefreshPct,
      logger,
    });

    const axiosInstance = createHttpClient({
      apiUrl: validated.apiUrl,
      userAgentExtra: validated.userAgentExtra,
      retry: validated.retry,
      rateLimiter,
      onUnauthorized: () => authManager.invalidate(),
      logger,
    });
    authManager.attachTo(axiosInstance);

    this.account = new AccountResource(axiosInstance, logger);
    this.sites = new SiteResource(axiosInstance, logger);
    this.devices = new DeviceResource(axiosInstance, logger);
    this.alerts = new AlertResource(axiosInstance, logger);
    this.jobs = new JobResource(axiosInstance, logger);
  }
}
