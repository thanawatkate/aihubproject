import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminAuth } from '../../middleware/adminAuth.js';
import type { AiProviderSettingsRepository } from '../../domain/ai/repository/AiProviderSettingsRepository.js';
import type { AiProviderHttpClient } from '../../domain/ai/provider/AiProviderHttpClient.js';
import type { AdminAuditService } from '../../domain/ai/service/AdminAuditService.js';
import { env } from '../../config/env.js';
import { assertSafeUrlFormat } from '../../utils/urlSafety.js';

const saveProviderSchema = z.object({
  id:                 z.string().min(1).max(80),
  provider:           z.string().min(1).max(80),
  name:               z.string().min(1).max(120),
  apiKey:             z.string().max(4096).optional(),
  baseUrl:            z.string().url().max(500).refine((u) => {
    try {
      assertSafeUrlFormat(u);
      return true;
    } catch {
      return false;
    }
  }, 'baseUrl must be https and not a private/reserved host'),
  textModel:          z.string().max(120).default(''),
  imageModel:         z.string().max(120).default(''),
  enabled:            z.boolean().default(true),
  capabilities:       z.array(z.string().max(40)).max(20).default(['text', 'image']),
  adapterType:        z.string().max(80).default('openai_chat'),
  authConfig:         z.record(z.unknown()).default({}),
  imageRequestConfig: z.record(z.unknown()).default({}),
  testRequestConfig:  z.record(z.unknown()).default({}),
});

const saveMappingSchema = z.array(z.object({
  usageKey:   z.string(),
  providerId: z.string(),
  modelType:  z.enum(['text', 'image']),
}));

function auditCtx(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

export async function providerRoutes(
  fastify: FastifyInstance,
  opts: {
    settingsRepo: AiProviderSettingsRepository;
    httpClient: AiProviderHttpClient;
    auditService: AdminAuditService;
  },
): Promise<void> {

  fastify.get('/admin/providers', { preHandler: [adminAuth] }, async (_req, reply) => {
    const providers = await opts.settingsRepo.listProviders();
    const mapping   = await opts.settingsRepo.getUsageMapping();
    return reply.send({
      providers: providers.map(p => ({ ...p, apiKey: p.apiKey ? '***' : '' })),
      usageMapping: mapping,
    });
  });

  fastify.put('/admin/providers', { preHandler: [adminAuth] }, async (request, reply) => {
    const parsed = saveProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }
    await opts.settingsRepo.saveProvider(parsed.data as unknown as Parameters<typeof opts.settingsRepo.saveProvider>[0]);
    await opts.auditService.record({
      action: 'provider.save',
      resourceType: 'provider',
      resourceId: parsed.data.id,
      ...auditCtx(request),
      meta: { provider: parsed.data.provider, enabled: parsed.data.enabled, apiKeyUpdated: Boolean(parsed.data.apiKey) },
    });
    return reply.code(200).send({ ok: true });
  });

  fastify.delete('/admin/providers/:id', { preHandler: [adminAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await opts.settingsRepo.deleteProvider(id);
    await opts.auditService.record({
      action: 'provider.delete',
      resourceType: 'provider',
      resourceId: id,
      ...auditCtx(request),
    });
    return reply.send({ ok: true });
  });

  fastify.put('/admin/providers/mapping', { preHandler: [adminAuth] }, async (request, reply) => {
    const parsed = saveMappingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }
    await opts.settingsRepo.saveUsageMapping(parsed.data);
    await opts.auditService.record({
      action: 'provider.mapping_save',
      resourceType: 'usage_mapping',
      resourceId: null,
      ...auditCtx(request),
      meta: { count: parsed.data.length },
    });
    return reply.send({ ok: true });
  });

  fastify.post('/admin/providers/test', { preHandler: [adminAuth] }, async (request, reply) => {
    const body = request.body as { providerId?: string };
    if (!body.providerId) {
      return reply.code(400).send({ error: { code: 'MISSING_PROVIDER_ID' } });
    }
    const provider = await opts.settingsRepo.findProvider(body.providerId);
    if (!provider) {
      return reply.code(404).send({ error: { code: 'PROVIDER_NOT_FOUND' } });
    }
    try {
      const testCfg    = provider.testRequestConfig as { method?: string; path?: string };
      const method     = (testCfg.method ?? 'GET').toUpperCase();
      const path       = (testCfg.path ?? '/models').replace('{{model}}', encodeURIComponent(provider.textModel || provider.imageModel));
      const url        = `${provider.baseUrl.replace(/\/$/, '')}${path}`;
      const { headers, queryParam } = opts.httpClient.buildAuthHeaders(
        { apiKey: provider.apiKey, authConfig: provider.authConfig },
        { Accept: 'application/json' },
      );
      const fullUrl    = queryParam ? `${url}${url.includes('?') ? '&' : '?'}${queryParam}` : url;
      await opts.httpClient.requestJson({ method, url: fullUrl, headers, timeoutMs: 15000 });
      await opts.auditService.record({
        action: 'provider.test',
        resourceType: 'provider',
        resourceId: provider.id,
        ...auditCtx(request),
        meta: { ok: true },
      });
      return reply.send({
        ok: true,
        data: {
          providerId: provider.id,
          provider: provider.provider,
          status: 'reachable',
        },
      });
    } catch (err) {
      await opts.auditService.record({
        action: 'provider.test',
        resourceType: 'provider',
        resourceId: provider.id,
        ...auditCtx(request),
        meta: { ok: false },
      });
      return reply.code(400).send({
        ok: false,
        error: { message: env.NODE_ENV === 'production' ? 'Provider connection test failed' : (err as Error).message },
      });
    }
  });
}
