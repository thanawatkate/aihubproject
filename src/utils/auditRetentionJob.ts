import type { FastifyBaseLogger } from 'fastify';
import type { AdminAuditService } from '../domain/ai/service/AdminAuditService.js';
import { env } from '../config/env.js';

/**
 * Optionally purge old admin audit rows on startup and on an interval.
 * Returns a stop function for graceful shutdown.
 */
export function startAuditRetentionJob(
  auditService: AdminAuditService,
  log: FastifyBaseLogger,
): () => void {
  if (!env.ADMIN_AUDIT_AUTO_PURGE) {
    return () => undefined;
  }

  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const deleted = await auditService.purgeOlderThanDays(env.ADMIN_AUDIT_RETENTION_DAYS);
      if (deleted > 0) {
        log.info({ deleted, days: env.ADMIN_AUDIT_RETENTION_DAYS }, 'admin audit auto-purge');
      }
    } catch (err) {
      log.error({ err }, 'admin audit auto-purge failed');
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, env.ADMIN_AUDIT_PURGE_INTERVAL_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}
