import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminAuth } from '../../middleware/adminAuth.js';
import type { AiModelPricingService } from '../../domain/ai/service/AiModelPricingService.js';
import type { AiUsageRepository } from '../../domain/ai/repository/AiUsageRepository.js';
import type { AdminAuditService } from '../../domain/ai/service/AdminAuditService.js';

const packageSchema = z.object({
  packageName:          z.string().default('Global Default'),
  requestLimitMonthly:  z.number().nullable().default(null),
  tokenLimitMonthly:    z.number().nullable().default(null),
  costLimitMonthly:     z.number().nullable().default(null),
  currency:             z.string().default('USD'),
  alertThresholds:      z.array(z.number()).default([70, 90, 100]),
  hardLimitEnabled:     z.boolean().default(true),
});

function auditCtx(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

export async function billingRoutes(
  fastify: FastifyInstance,
  opts: {
    pricingService: AiModelPricingService;
    usageRepo:      AiUsageRepository;
    auditService:   AdminAuditService;
  },
): Promise<void> {
  // Admin — global billing package
  fastify.get('/admin/billing/package', { preHandler: [adminAuth] }, async (_req, reply) => {
    const pkg = await opts.usageRepo.getCurrentPackage();
    return reply.send(pkg);
  });

  fastify.put('/admin/billing/package', { preHandler: [adminAuth] }, async (request, reply) => {
    const parsed = packageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }
    const pkg = await opts.usageRepo.saveGlobalPackage(parsed.data);
    await opts.auditService.record({
      action: 'billing.package_save',
      resourceType: 'billing_package',
      resourceId: pkg.packageKey,
      ...auditCtx(request),
      meta: {
        requestLimitMonthly: parsed.data.requestLimitMonthly,
        tokenLimitMonthly: parsed.data.tokenLimitMonthly,
        costLimitMonthly: parsed.data.costLimitMonthly,
        hardLimitEnabled: parsed.data.hardLimitEnabled,
      },
    });
    return reply.send(pkg);
  });

  // Admin — model pricing
  fastify.get('/admin/model-pricing', { preHandler: [adminAuth] }, async (_req, reply) => {
    const rows = await opts.pricingService.listPricing();
    return reply.send({ items: rows });
  });

  fastify.put('/admin/model-pricing', { preHandler: [adminAuth] }, async (request, reply) => {
    const { items } = request.body as { items?: unknown[] };
    if (!Array.isArray(items)) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'items must be an array' } });
    }
    const rowSchema = z.object({
      provider:      z.string(),
      model:         z.string(),
      inputCost:     z.number(),
      outputCost:    z.number(),
      currency:      z.string().default('USD'),
      isActive:      z.boolean().default(true),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = z.array(rowSchema).safeParse(items);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }
    await opts.pricingService.savePricing(parsed.data);
    await opts.auditService.record({
      action: 'billing.pricing_save',
      resourceType: 'model_pricing',
      resourceId: null,
      ...auditCtx(request),
      meta: { count: parsed.data.length },
    });
    return reply.send({ ok: true });
  });
}
