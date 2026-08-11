import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAuth } from '../../middleware/adminAuth.js';
import type { AdminAuditService } from '../../domain/ai/service/AdminAuditService.js';
import { env } from '../../config/env.js';

export async function auditRoutes(
  fastify: FastifyInstance,
  opts: { auditService: AdminAuditService },
): Promise<void> {
  fastify.get('/admin/audit/logs', { preHandler: [adminAuth] }, async (request, reply) => {
    const q = request.query as { page?: string; limit?: string; action?: string };
    const result = await opts.auditService.list({
      page: Number(q.page ?? 1),
      limit: Number(q.limit ?? 50),
      action: q.action?.trim() || undefined,
    });
    return reply.send(result);
  });

  fastify.post('/admin/audit/purge', { preHandler: [adminAuth] }, async (request, reply) => {
    const parsed = z.object({
      olderThanDays: z.coerce.number().int().min(1).max(3650).default(env.ADMIN_AUDIT_RETENTION_DAYS),
    }).safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }

    const deleted = await opts.auditService.purgeOlderThanDays(parsed.data.olderThanDays);
    await opts.auditService.record({
      action: 'audit.purge',
      resourceType: 'admin_audit_log',
      resourceId: null,
      ip: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      meta: { olderThanDays: parsed.data.olderThanDays, deleted },
    });

    return reply.send({ ok: true, deleted, olderThanDays: parsed.data.olderThanDays });
  });
}
