import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiWindowRateLimiter } from "@/rate-limit/rate-limiter";

describe("MultiWindowRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips the per-op write window for a 101st alert-resolve write (100 limit)", async () => {
    const limiter = new MultiWindowRateLimiter();

    for (let i = 0; i < 100; i++) {
      await limiter.acquire({ kind: "write", opKey: "alert-resolve" });
    }

    let resolved = false;
    void limiter.acquire({ kind: "write", opKey: "alert-resolve" }).then(() => {
      resolved = true;
    });

    // Not yet available: the 101st write must wait for the 60s window to roll.
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(true);
  });

  it("does not trip a 600-request device-udf-set burst (600 limit)", async () => {
    const limiter = new MultiWindowRateLimiter();

    let allResolved = false;
    const burst = (async () => {
      for (let i = 0; i < 600; i++) {
        await limiter.acquire({ kind: "write", opKey: "device-udf-set" });
      }
      allResolved = true;
    })();

    await vi.advanceTimersByTimeAsync(0);
    await burst;
    expect(allResolved).toBe(true);
  });

  it("counts reads and writes in separate windows", async () => {
    const limiter = new MultiWindowRateLimiter();

    // Exhaust the per-op alert-resolve window (100).
    for (let i = 0; i < 100; i++) {
      await limiter.acquire({ kind: "write", opKey: "alert-resolve" });
    }

    // A read immediately after must not be affected by the write window being full.
    let readResolved = false;
    void limiter.acquire({ kind: "read" }).then(() => {
      readResolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(readResolved).toBe(true);
  });

  it("falls back an unlisted write opKey to the default 100 ceiling", async () => {
    const limiter = new MultiWindowRateLimiter();

    for (let i = 0; i < 100; i++) {
      await limiter.acquire({ kind: "write", opKey: "some-future-write" });
    }

    let resolved = false;
    void limiter
      .acquire({ kind: "write", opKey: "some-future-write" })
      .then(() => {
        resolved = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(true);
  });

  it("enforces the aggregate write window (600) across distinct opKeys", async () => {
    const limiter = new MultiWindowRateLimiter();

    // 6 * 100 = 600, spread across six different 100-limited opKeys so no single per-op
    // window trips first — only the aggregate write window (600) should be exhausted.
    const opKeys = [
      "site-create",
      "alert-resolve",
      "alert-mute",
      "alert-unmute",
      "device-move",
      "device-job-create",
    ] as const;
    for (const opKey of opKeys) {
      for (let i = 0; i < 100; i++) {
        await limiter.acquire({ kind: "write", opKey });
      }
    }

    let resolved = false;
    void limiter
      .acquire({ kind: "write", opKey: "device-warranty-set" })
      .then(() => {
        resolved = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(true);
  });

  it("respects overridden readLimit/writeAggregateLimit/windowSeconds", async () => {
    const limiter = new MultiWindowRateLimiter({
      readLimit: 2,
      writeAggregateLimit: 2,
      windowSeconds: 1,
    });

    await limiter.acquire({ kind: "read" });
    await limiter.acquire({ kind: "read" });

    let resolved = false;
    void limiter.acquire({ kind: "read" }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBe(true);
  });
});
