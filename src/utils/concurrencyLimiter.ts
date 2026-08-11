export class ConcurrencyLimitExceededError extends Error {
  readonly statusCode = 429;
  readonly code = 'CONCURRENCY_LIMIT';

  constructor(message = 'Too many concurrent requests for this project') {
    super(message);
    this.name = 'ConcurrencyLimitExceededError';
  }
}

/**
 * Simple in-process per-key concurrency gate.
 * Not shared across replicas — pair with DB quota reservation for multi-instance safety.
 */
export class ConcurrentRequestLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly maxPerKey: number) {
    if (maxPerKey < 1) {
      throw new Error('maxPerKey must be >= 1');
    }
  }

  acquire(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.maxPerKey) {
      throw new ConcurrencyLimitExceededError();
    }
    this.counts.set(key, current + 1);
  }

  release(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) {
      this.counts.delete(key);
      return;
    }
    this.counts.set(key, current - 1);
  }

  /** Test helper */
  current(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}
