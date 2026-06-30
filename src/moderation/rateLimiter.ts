interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly perMin: number;
  private readonly refillIntervalMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(perMin: number) {
    this.perMin = perMin;
    // tempo (ms) para recarregar um unico token
    this.refillIntervalMs = perMin > 0 ? 60_000 / perMin : Infinity;
  }

  allow(userId: string, nowMs: number): boolean {
    if (this.perMin <= 0) {
      return false;
    }

    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = { tokens: this.perMin, lastRefillMs: nowMs };
      this.buckets.set(userId, bucket);
    }

    // recarrega tokens proporcionalmente ao tempo decorrido
    const elapsed = nowMs - bucket.lastRefillMs;
    if (elapsed > 0) {
      const refilled = elapsed / this.refillIntervalMs;
      if (refilled > 0) {
        bucket.tokens = Math.min(this.perMin, bucket.tokens + refilled);
        bucket.lastRefillMs = nowMs;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }
}
