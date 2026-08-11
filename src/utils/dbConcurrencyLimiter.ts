import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ConcurrencyLimitExceededError } from './concurrencyLimiter.js';

/**
 * Replica-safe concurrency gate using short-lived DB leases.
 * Expired leases are purged on acquire so crashed workers do not permanently block capacity.
 */
export class DbConcurrencyLimiter {
  constructor(
    private readonly db: Pool,
    private readonly maxPerKey: number,
    private readonly leaseTtlSeconds: number,
  ) {
    if (maxPerKey < 1) throw new Error('maxPerKey must be >= 1');
    if (leaseTtlSeconds < 5) throw new Error('leaseTtlSeconds must be >= 5');
  }

  async acquire(scopeId: string, requestId: string, scopeType = 'project'): Promise<void> {
    const conn = await this.db.getConnection();
    const lockName = `aihub:inflight:${scopeType}:${scopeId}`.slice(0, 64);
    try {
      const [lockRows] = await conn.execute<RowDataPacket[]>(
        'SELECT GET_LOCK(?, 5) AS got',
        [lockName],
      );
      if (Number(lockRows[0]?.['got']) !== 1) {
        throw new ConcurrencyLimitExceededError('Could not acquire concurrency lock');
      }

      await conn.execute(
        `DELETE FROM ai_inflight_leases
         WHERE scope_type = ? AND scope_id = ? AND expires_at < UTC_TIMESTAMP()`,
        [scopeType, scopeId],
      );

      const [countRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM ai_inflight_leases
         WHERE scope_type = ? AND scope_id = ? AND expires_at >= UTC_TIMESTAMP()`,
        [scopeType, scopeId],
      );
      const count = Number(countRows[0]?.['c'] ?? 0);
      if (count >= this.maxPerKey) {
        throw new ConcurrencyLimitExceededError();
      }

      await conn.execute(
        `INSERT INTO ai_inflight_leases (scope_type, scope_id, request_id, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
        [scopeType, scopeId, requestId, this.leaseTtlSeconds],
      );
    } finally {
      try {
        await conn.execute('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch {
        /* ignore */
      }
      conn.release();
    }
  }

  async release(requestId: string): Promise<void> {
    try {
      await this.db.execute(
        'DELETE FROM ai_inflight_leases WHERE request_id = ?',
        [requestId],
      );
    } catch (err) {
      console.error('[DbConcurrencyLimiter] release failed:', (err as Error).message);
    }
  }
}
