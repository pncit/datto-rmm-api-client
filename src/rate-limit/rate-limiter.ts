import type { DattoLogger } from "../logging/logger";
import { sleep } from "../util/sleep";

import {
  DEFAULT_WRITE_LIMIT,
  READ_LIMIT,
  WINDOW_SECONDS,
  WRITE_AGGREGATE_LIMIT,
  WRITE_LIMITS,
  type WriteOpKey,
} from "./rate-limits";

/**
 * Rate-limit classification a caller attaches to a single outgoing request (Phase 6's
 * `BaseResource` primitives, and `paginate`'s explicit read tag). `kind: 'read'` consults only
 * the read window; `kind: 'write'` consults both the aggregate-write window and the per-opKey
 * write window.
 *
 * `opKey` is deliberately a plain `string` here, not {@link WriteOpKey}: resource call sites are
 * compile-checked against the closed `WriteOpKey` union at the point they construct a
 * descriptor (Phase 6/7), while this untyped boundary keeps the {@link DEFAULT_WRITE_LIMIT}
 * fallback reachable for a hypothetical direct/untyped caller — the only path that reaches it
 * (see `rate-limits.ts`).
 */
export interface RateDescriptor {
  readonly kind: "read" | "write";
  readonly opKey?: string;
}

/** Optional overrides for the committed table's scalar limits (`src/client/datto-client-config.ts`'s `rateLimit` config field, wired in Phase 7/8). Every field independently falls back to the table's exported constant when omitted. */
export interface RateLimiterOptions {
  readonly readLimit?: number;
  readonly writeAggregateLimit?: number;
  readonly windowSeconds?: number;
  /** Optional logger for throttle-wait observability. No bodies/headers are logged. */
  readonly logger?: DattoLogger;
}

/**
 * A single sliding-window request counter. Ports the retired `src/rateLimiter.ts`'s
 * `SlidingWindowRateLimiter` prune-then-check algorithm (drop timestamps older than the window,
 * compare the remaining count against the limit), but reports *how long* until the window has
 * room (`msUntilRoom`) rather than a boolean accept/reject — the shape
 * {@link MultiWindowRateLimiter.acquire} needs to reconcile multiple windows (read; aggregate
 * write + per-opKey write) against one wait time.
 */
class SlidingWindow {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }

  /** Milliseconds until this window has room for one more entry; `0` means room right now. */
  msUntilRoom(now: number): number {
    this.prune(now);
    if (this.timestamps.length < this.limit) {
      return 0;
    }
    return this.timestamps[0]! + this.windowMs - now;
  }

  record(now: number): void {
    this.timestamps.push(now);
  }
}

/**
 * Dual-layer + per-operation rate limiter modeling Datto's real `system/request_rate` contract
 * (design "Dual-layer rate limiter", R11): a read sliding window, an aggregate-write sliding
 * window, and a lazily-created per-opKey write window map (seeded from the committed
 * {@link WRITE_LIMITS} table, falling back to {@link DEFAULT_WRITE_LIMIT} for an opKey with no
 * table entry).
 *
 * `acquire` **throttles rather than rejects**: per the design ("A write burst that would exceed
 * a per-operation limit is throttled locally per the correct tier" — Success Criteria; "local
 * limiting exists to avoid provoking [a 403 IP-block]" — Decision 3), a request that would
 * exceed the tightest applicable window's budget is delayed (via `setTimeout`) until room opens,
 * rather than failing client-side. This keeps every request the client actually sends inside the
 * server's real budget instead of merely reporting that a caller *would have* exceeded it, which
 * is the whole reason local limiting exists over relying solely on server 429s.
 */
export class MultiWindowRateLimiter {
  private readonly windowMs: number;
  private readonly readWindow: SlidingWindow;
  private readonly aggregateWriteWindow: SlidingWindow;
  private readonly writeWindows = new Map<string, SlidingWindow>();
  private readonly logger: DattoLogger | undefined;

  constructor(options?: RateLimiterOptions) {
    this.windowMs = (options?.windowSeconds ?? WINDOW_SECONDS) * 1000;
    this.readWindow = new SlidingWindow(
      options?.readLimit ?? READ_LIMIT,
      this.windowMs,
    );
    this.aggregateWriteWindow = new SlidingWindow(
      options?.writeAggregateLimit ?? WRITE_AGGREGATE_LIMIT,
      this.windowMs,
    );
    this.logger = options?.logger;
  }

  private writeWindowFor(opKey: string | undefined): SlidingWindow {
    const key = opKey ?? "(unspecified)";
    let window = this.writeWindows.get(key);
    if (!window) {
      // `Object.hasOwn` (not `in`) deliberately excludes inherited `Object.prototype` keys
      // (`toString`, `constructor`, `__proto__`, …): `in` would match those for an
      // untyped/adversarial opKey and hand back a function/object as `limit` instead of a number.
      const limit =
        opKey !== undefined && Object.hasOwn(WRITE_LIMITS, opKey)
          ? WRITE_LIMITS[opKey as WriteOpKey]
          : DEFAULT_WRITE_LIMIT;
      window = new SlidingWindow(limit, this.windowMs);
      this.writeWindows.set(key, window);
    }
    return window;
  }

  /** The set of windows `descriptor` must clear, per its `kind`. Exhaustively matched (rather
   * than an `else`-as-write ternary) so a future third `kind` fails to compile here instead of
   * silently falling through the write path. */
  private windowsFor(descriptor: RateDescriptor): SlidingWindow[] {
    switch (descriptor.kind) {
      case "read":
        return [this.readWindow];
      case "write":
        return [this.aggregateWriteWindow, this.writeWindowFor(descriptor.opKey)];
      default: {
        const exhaustive: never = descriptor.kind;
        throw new Error(`Unhandled RateDescriptor kind: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Resolves once every window applicable to `descriptor` has room, recording this request's
   * timestamp in each of them atomically at that point. Reads consult only the read window;
   * writes consult both the aggregate-write window and the op-key window — "the tightest
   * applicable set" (design), so a request only proceeds once neither ceiling would be exceeded.
   */
  async acquire(descriptor: RateDescriptor): Promise<void> {
    const windows = this.windowsFor(descriptor);

    for (;;) {
      const now = Date.now();
      const waitMs = Math.max(0, ...windows.map((w) => w.msUntilRoom(now)));
      if (waitMs === 0) {
        for (const w of windows) w.record(now);
        return;
      }
      this.logger?.debug("throttling request until rate-limit window has room", {
        kind: descriptor.kind,
        opKey: descriptor.opKey,
        waitMs,
      });
      await sleep(waitMs);
    }
  }
}
