/**
 * Resolves after `ms` milliseconds. Shared by every module that waits between attempts —
 * `http/http-client.ts`'s backoff/`Retry-After` waits and `rate-limit/rate-limiter.ts`'s
 * throttle waits — so there is exactly one definition of "wait `ms` milliseconds" across the
 * transport layer.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
