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
import { ActivityLogResource } from "./resources/activity-log-resource";
import { AlertResource } from "./resources/alert-resource";
import { AuditResource } from "./resources/audit-resource";
import { DeviceResource } from "./resources/device-resource";
import { FilterResource } from "./resources/filter-resource";
import { JobResource } from "./resources/job-resource";
import { SiteResource } from "./resources/site-resource";
import { SystemResource } from "./resources/system-resource";
import { UserResource } from "./resources/user-resource";

/**
 * `DattoRmmClient` (R1, R2, R9, R10–R14, design "Public surface" / Overview): constructs and
 * wires every layer below the resource namespaces — config validation, the UDF-masking logger
 * boundary (R20), the dual-layer rate limiter (R11), the shared interceptor-bearing axios
 * instance (R12), and the throwing OAuth2 `AuthManager` (R10) — then mounts all ten resource
 * namespaces on top, covering every one of the 53 paths / 57 operations in the committed spec
 * (R1, verified mechanically by `tests/unit/client/coverage-map.test.ts`).
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
  readonly audit: AuditResource;
  readonly filters: FilterResource;
  readonly users: UserResource;
  readonly activityLogs: ActivityLogResource;
  readonly system: SystemResource;

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
      // Threaded raw/unmasked — unlike `logger`, the observer's whole purpose is un-redacted
      // delivery (design Decision 6 / R9); it must never pass through `withUdfMasking`.
      httpObserver: validated.httpObserver,
    });

    const axiosInstance = createHttpClient({
      apiUrl: validated.apiUrl,
      userAgentExtra: validated.userAgentExtra,
      retry: validated.retry,
      rateLimiter,
      onUnauthorized: () => authManager.invalidate(),
      logger,
      // Threaded raw/unmasked — unlike `logger`, the observer's whole purpose is un-redacted
      // delivery (design Decision 6 / R9); it must never pass through `withUdfMasking`.
      httpObserver: validated.httpObserver,
    });
    authManager.attachTo(axiosInstance);

    this.account = new AccountResource(axiosInstance, logger);
    this.sites = new SiteResource(axiosInstance, logger);
    this.devices = new DeviceResource(axiosInstance, logger);
    this.alerts = new AlertResource(axiosInstance, logger);
    this.jobs = new JobResource(axiosInstance, logger);
    this.audit = new AuditResource(axiosInstance, logger);
    this.filters = new FilterResource(axiosInstance, logger);
    this.users = new UserResource(axiosInstance, logger);
    this.activityLogs = new ActivityLogResource(axiosInstance, logger);
    this.system = new SystemResource(axiosInstance, logger);
  }
}

/**
 * Constructs a {@link DattoRmmClient} (R1, R2, design "Public surface"). The sole entry point
 * `src/index.ts` exports for creating a client — a thin, named factory over `new
 * DattoRmmClient(config)` so consumers never need the `new` keyword, matching `fuze-api`'s own
 * `createFuzeClient` convention (design Decision 1: converge on `fuze-api`'s architecture).
 *
 * @throws {DattoValidationError} If `config` fails validation (see the constructor).
 */
export function createDattoRmmClient(
  config: DattoRmmClientConfig,
): DattoRmmClient {
  return new DattoRmmClient(config);
}
