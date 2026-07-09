import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import { DEFAULT_RETRY, MAX_RETRY_AFTER_MS } from "../defaults";
import { DattoApiError } from "../errors";
import type {
  MultiWindowRateLimiter,
  RateDescriptor,
} from "../rate-limit/rate-limiter";

/**
 * Shared HTTP transport (Phase 5, R10–R12): builds the **single**, interceptor-bearing axios
 * instance every `BaseResource` primitive (Phase 6) sends through. There is no
 * `axios-mutator.ts` and no generated endpoints layer in play (Phase 1 Step 3) — this module
 * constructs the instance directly.
 *
 * Wires two request-lifecycle concerns:
 * - **Rate limiting** (request interceptor): reads `config.rateDescriptor` (attached by the
 *   caller — a `BaseResource` primitive or `paginate`) and awaits
 *   {@link MultiWindowRateLimiter.acquire} before the request is sent, defaulting to
 *   `{ kind: 'read' }` when no descriptor is present so an untagged request is never sent
 *   unthrottled.
 * - **Error mapping + retry** (response interceptor): maps a failed request to
 *   {@link DattoApiError}, retrying network errors and 5xx responses with exponential backoff,
 *   honoring a 429 `Retry-After` (bounded by {@link MAX_RETRY_AFTER_MS}), and surfacing a 403
 *   immediately — classified `ip-block` vs `forbidden` via {@link isRateLimitBlock} — with no
 *   retry (Non-Goal: no auto-recovery from an IP block).
 *
 * Authentication is **not** wired here: `AuthManager` (`../auth/auth-manager.ts`) attaches its
 * own request interceptor onto the instance this module returns, keeping the Bearer-token
 * lifecycle independent of the rate-limit/retry transport (Phase 5 Step 4's transport-isolation
 * rule — the auth grant/refresh round-trip itself uses a wholly separate, bare axios instance
 * with none of this module's interceptors).
 */

/** Default `User-Agent` product token, before any `userAgentExtra` suffix. */
const DEFAULT_USER_AGENT = "datto-rmm-api-client";

/** Exponential-backoff multiplier applied per retry attempt (fuze-api parity). */
const BACKOFF_MULTIPLIER = 2;

/** Resolved retry policy — every field always present, `DEFAULT_RETRY`-backed. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** A caller-supplied partial override of {@link RetryPolicy} (`DattoRmmClientConfig['retry']`). */
export type RetryPolicyOverride = Partial<RetryPolicy>;

export interface HttpClientConfig {
  /** Base URL every request is resolved against (`DattoRmmClientConfig['apiUrl']`). */
  readonly apiUrl: string;
  /** Optional suffix appended to the default `User-Agent` header. */
  readonly userAgentExtra?: string;
  /** Optional retry-policy override; unset fields fall back to {@link DEFAULT_RETRY}. */
  readonly retry?: RetryPolicyOverride;
  /** The limiter every request's `rateDescriptor` is checked against before sending. */
  readonly rateLimiter: MultiWindowRateLimiter;
}

function buildUserAgent(extra: string | undefined): string {
  return extra ? `${DEFAULT_USER_AGENT} ${extra}` : DEFAULT_USER_AGENT;
}

function resolveRetryPolicy(
  override: RetryPolicyOverride | undefined,
): RetryPolicy {
  return {
    maxAttempts: override?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
    baseDelayMs: override?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
    maxDelayMs: override?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Exponential backoff for the `retryNumber`-th retry (1-indexed: the first retry passes `1`),
 * bounded by `policy.maxDelayMs`. Mirrors `fuze-api`'s `retry-interceptor.ts` `calculateDelay`.
 */
function calculateBackoffDelayMs(
  retryNumber: number,
  policy: RetryPolicy,
): number {
  const delay = policy.baseDelayMs * BACKOFF_MULTIPLIER ** (retryNumber - 1);
  return Math.min(delay, policy.maxDelayMs);
}

/**
 * Parses a `Retry-After` header value in either RFC 7231 form: delta-seconds (`"120"`) or an
 * HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns `undefined` when `raw` is absent or
 * neither form parses — the caller falls back to computed exponential backoff in that case (R12).
 */
function parseRetryAfterMs(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Case-insensitively reads a header value from an Axios response's headers object. */
function readHeader(
  headers: AxiosResponse["headers"] | undefined,
  name: string,
): unknown {
  if (!headers) return undefined;
  const record = headers as Record<string, unknown>;
  return (
    record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()]
  );
}

/** A rate-limit/block signal in a 403 body's common message-bearing keys. */
const RATE_LIMIT_BLOCK_PATTERN = /rate[\s._-]?limit|ip[\s._-]?block|blocked/i;

/**
 * Classifies a 403 response as a rate-limit IP-block penalty (`true`) or an ordinary
 * authorization failure (`false`). Datto returns 403 for both (design "The real rate-limit
 * model" / Phase 5 Step 3(c)); the status code alone does not distinguish them.
 *
 * A 403 is treated as an IP block when it carries a `Retry-After` header (the server's own
 * throttling signal) or its body's common message-bearing field mentions a rate-limit/block
 * marker. This is a documented, unit-tested heuristic, not a confirmed contract — Datto's real
 * IP-block 403 marker is Deferred Validation (plan Assumptions) — so it is exported as this one
 * named predicate rather than inlined at the 403 call site, making it the single place to
 * correct once the real marker is confirmed.
 */
export function isRateLimitBlock(
  response: AxiosResponse<unknown> | undefined,
): boolean {
  if (!response) {
    return false;
  }

  if (readHeader(response.headers, "Retry-After") !== undefined) {
    return true;
  }

  const data = response.data;
  const text =
    typeof data === "string"
      ? data
      : isRecord(data)
        ? JSON.stringify(data)
        : "";
  return RATE_LIMIT_BLOCK_PATTERN.test(text);
}

/** Hidden property this module uses to track how many attempts a given request has made so far. */
const RETRY_COUNT_KEY = "__dattoRetryCount";

type RetryTrackedConfig = InternalAxiosRequestConfig & {
  [RETRY_COUNT_KEY]?: number;
};

function buildRateLimitError(waitMs: number, error: AxiosError): DattoApiError {
  return new DattoApiError("Datto RMM API rate limit exceeded", {
    statusCode: 429,
    retryAfterMs: waitMs,
    response: error.response?.data,
    cause: error,
  });
}

function build403Error(error: AxiosError): DattoApiError {
  const code = isRateLimitBlock(error.response) ? "ip-block" : "forbidden";
  return new DattoApiError(
    code === "ip-block"
      ? "Datto RMM API IP block"
      : "Datto RMM API request forbidden",
    {
      statusCode: 403,
      code,
      response: error.response?.data,
      cause: error,
    },
  );
}

/**
 * Handles a failed response: classifies and throws immediately on 403 (no retry — Non-Goal); for
 * 429, honors `Retry-After` bounded by {@link MAX_RETRY_AFTER_MS} or throws with `retryAfterMs`
 * populated when the wait would exceed it; retries a network error or 5xx with exponential
 * backoff up to `retryPolicy.maxAttempts` total attempts; anything else (including retry
 * exhaustion) throws {@link DattoApiError.fromAxiosError}.
 */
async function handleResponseError(
  instance: AxiosInstance,
  retryPolicy: RetryPolicy,
  error: AxiosError,
): Promise<AxiosResponse> {
  const status = error.response?.status;

  if (status === 403) {
    throw build403Error(error);
  }

  const config = error.config as RetryTrackedConfig | undefined;
  if (!config) {
    // No request config on the error means there is nothing to retry against.
    throw DattoApiError.fromAxiosError(error);
  }

  const priorAttempts = config[RETRY_COUNT_KEY] ?? 0;
  const failedAttemptNumber = priorAttempts + 1;

  if (status === 429) {
    const waitMs =
      parseRetryAfterMs(readHeader(error.response?.headers, "Retry-After")) ??
      calculateBackoffDelayMs(failedAttemptNumber, retryPolicy);

    if (
      waitMs > MAX_RETRY_AFTER_MS ||
      failedAttemptNumber >= retryPolicy.maxAttempts
    ) {
      throw buildRateLimitError(waitMs, error);
    }

    await sleep(waitMs);
    config[RETRY_COUNT_KEY] = failedAttemptNumber;
    return instance.request(config);
  }

  const isNetworkError = error.response === undefined;
  const isServerError = status !== undefined && status >= 500 && status < 600;
  const isRetryable = isNetworkError || isServerError;

  if (isRetryable && failedAttemptNumber < retryPolicy.maxAttempts) {
    await sleep(calculateBackoffDelayMs(failedAttemptNumber, retryPolicy));
    config[RETRY_COUNT_KEY] = failedAttemptNumber;
    return instance.request(config);
  }

  throw DattoApiError.fromAxiosError(error);
}

/**
 * Builds the shared axios instance for the Datto RMM v2 API: `baseURL`, default JSON + branded
 * `User-Agent` headers, the rate-limit request interceptor, and the error-mapping/retry response
 * interceptor. Does not attach authentication — see this module's doc.
 */
export function createHttpClient(config: HttpClientConfig): AxiosInstance {
  const retryPolicy = resolveRetryPolicy(config.retry);

  const instance = axios.create({
    baseURL: config.apiUrl,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": buildUserAgent(config.userAgentExtra),
    },
  });

  instance.interceptors.request.use(async (requestConfig) => {
    const descriptor: RateDescriptor = requestConfig.rateDescriptor ?? {
      kind: "read",
    };
    await config.rateLimiter.acquire(descriptor);
    return requestConfig;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => handleResponseError(instance, retryPolicy, error),
  );

  return instance;
}
