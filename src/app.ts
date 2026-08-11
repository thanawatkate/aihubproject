import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { pool } from './db/database.js';
import { hashApiKey } from './utils/crypto.js';
import { DbConcurrencyLimiter } from './utils/dbConcurrencyLimiter.js';

import { ProjectRepository } from './domain/project/ProjectRepository.js';
import { AiProviderSettingsRepository } from './domain/ai/repository/AiProviderSettingsRepository.js';
import { AiUsageRepository } from './domain/ai/repository/AiUsageRepository.js';

import { AiProviderHttpClient } from './domain/ai/provider/AiProviderHttpClient.js';
import { AiProviderResponseHelper } from './domain/ai/provider/AiProviderResponseHelper.js';
import { OpenAiChatTextProvider } from './domain/ai/provider/OpenAiChatTextProvider.js';
import { GeminiGenerateContentTextProvider } from './domain/ai/provider/GeminiGenerateContentTextProvider.js';
import { HttpJsonTextProvider } from './domain/ai/provider/HttpJsonTextProvider.js';

import { AiTextGenerationService } from './domain/ai/service/AiTextGenerationService.js';
import { AiModelPricingService } from './domain/ai/service/AiModelPricingService.js';
import { AiQuotaService } from './domain/ai/service/AiQuotaService.js';
import { AiUsageLoggerService } from './domain/ai/service/AiUsageLoggerService.js';
import { AiImageGenerationService } from './domain/ai/service/AiImageGenerationService.js';
import { AdminAuditService } from './domain/ai/service/AdminAuditService.js';

import { healthRoutes } from './routes/v1/healthRoutes.js';
import { textRoutes } from './routes/v1/textRoutes.js';
import { imageRoutes } from './routes/v1/imageRoutes.js';
import { providerRoutes } from './routes/admin/providerRoutes.js';
import { projectRoutes } from './routes/admin/projectRoutes.js';
import { billingRoutes } from './routes/admin/billingRoutes.js';
import { auditRoutes } from './routes/admin/auditRoutes.js';
import { startAuditRetentionJob } from './utils/auditRetentionJob.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: env.NODE_ENV !== 'test',
    bodyLimit: env.BODY_LIMIT_BYTES,
    trustProxy: env.TRUST_PROXY,
    requestIdHeader: 'x-request-id',
    requestTimeout: env.REQUEST_TIMEOUT_MS,
  });

  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW_MS,
    keyGenerator: (request) => {
      const auth = request.headers.authorization ?? '';
      if (auth.startsWith('Bearer ') && auth.length > 20) {
        // Hash so raw secrets are not retained as rate-limit map keys
        return `bearer:${hashApiKey(auth.slice(7).trim())}`;
      }
      return request.ip;
    },
  });

  const httpClient      = new AiProviderHttpClient();
  const responseHelper  = new AiProviderResponseHelper();
  const projectRepo     = new ProjectRepository(pool);
  const settingsRepo    = new AiProviderSettingsRepository(pool);
  const usageRepo       = new AiUsageRepository(pool);
  const auditService    = new AdminAuditService(pool);
  const concurrency     = new DbConcurrencyLimiter(
    pool,
    env.MAX_CONCURRENT_PER_PROJECT,
    env.CONCURRENCY_LEASE_TTL_SECONDS,
  );

  const textProviders = [
    new OpenAiChatTextProvider(httpClient, responseHelper),
    new GeminiGenerateContentTextProvider(httpClient, responseHelper),
    new HttpJsonTextProvider(httpClient, responseHelper),
  ];

  const pricingService  = new AiModelPricingService(usageRepo);
  const quotaService    = new AiQuotaService(usageRepo);
  const usageLogger     = new AiUsageLoggerService(usageRepo, quotaService);
  const textService     = new AiTextGenerationService(settingsRepo, textProviders);
  const imageService    = new AiImageGenerationService(settingsRepo, httpClient);

  await fastify.register(healthRoutes, { settingsRepo, projectRepo });
  await fastify.register(textRoutes,  { projectRepo, textService, quotaService, usageLogger, pricingService, concurrency });
  await fastify.register(imageRoutes, { projectRepo, imageService, quotaService, usageLogger, pricingService, concurrency });
  await fastify.register(providerRoutes, { settingsRepo, httpClient, auditService });
  await fastify.register(projectRoutes, { projectRepo, auditService });
  await fastify.register(billingRoutes, { quotaService, pricingService, usageRepo, projectRepo, auditService });
  await fastify.register(auditRoutes, { auditService });

  const stopAuditJob = startAuditRetentionJob(auditService, fastify.log);
  fastify.addHook('onClose', async () => {
    stopAuditJob();
  });

  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  fastify.setErrorHandler((err, _req, reply) => {
    fastify.log.error(err);
    const status = err.statusCode ?? 500;
    const errCode = (err as { code?: string }).code;
    const code = errCode === 'FST_ERR_CTP_BODY_TOO_LARGE'
      ? 'PAYLOAD_TOO_LARGE'
      : (errCode === 'FST_ERR_RATE_LIMIT' ? 'RATE_LIMITED' : 'INTERNAL_ERROR');
    reply.code(status).send({
      error: {
        code,
        message: env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
      },
    });
  });

  return fastify;
}
