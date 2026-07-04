import axios, { AxiosInstance, AxiosError } from "axios";
import { Result, ProblemError } from "./result.js";
import { SlidingWindowRateLimiter } from "./rateLimiter.js";
import { LoggerLike } from "./logger.js";

export interface RetryOptions {
  maxAttempts: number;
}

export interface HttpClientDeps {
  axios?: AxiosInstance;
  rateLimiter: SlidingWindowRateLimiter;
  logger: LoggerLike;
  retry: RetryOptions;
}

export class HttpClient {
  private axios: AxiosInstance;
  constructor(private deps: HttpClientDeps) {
    this.axios = deps.axios ?? axios.create();
  }

  async request<T>(config: any): Promise<Result<T>> {
    for (let attempt = 1; attempt <= this.deps.retry.maxAttempts; attempt++) {
      if (!(await this.deps.rateLimiter.acquire())) {
        const err: ProblemError = {
          type: "rate-limit",
          title: "Rate limit exceeded",
          status: 429,
        };
        return { ok: false, error: err };
      }
      try {
        const resp = await this.axios.request(config);
        return { ok: true, value: resp.data, raw: resp.data };
      } catch (e) {
        if (attempt === this.deps.retry.maxAttempts) {
          return { ok: false, error: mapAxiosError(e) };
        }
      }
    }
    return {
      ok: false,
      error: { type: "network-error", title: "Unknown", status: 0 },
    };
  }
}

export function mapAxiosError(e: unknown): ProblemError {
  if (axios.isAxiosError(e)) {
    const ae = e as AxiosError;
    return {
      type: "http-error",
      title: ae.message,
      status: ae.response?.status ?? 0,
      detail: ae.response?.statusText,
      raw: ae.response?.data,
    };
  }
  return { type: "network-error", title: String(e), status: 0 };
}
