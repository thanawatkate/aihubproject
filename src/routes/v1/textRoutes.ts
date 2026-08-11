import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import type { AiTextGenerationService } from '../../domain/ai/service/AiTextGenerationService.js';
import type { AiQuotaService, QuotaReservationHandle } from '../../domain/ai/service/AiQuotaService.js';
import { AiQuotaExceededException } from '../../domain/ai/service/AiQuotaService.js';
import type { AiUsageLoggerService } from '../../domain/ai/service/AiUsageLoggerService.js';
import type { AiModelPricingService } from '../../domain/ai/service/AiModelPricingService.js';
import { buildProjectAuthMiddleware } from '../../middleware/projectAuth.js';
import type { ProjectRepository } from '../../domain/project/ProjectRepository.js';
import { assertFeatureAllowed, publicErrorMessage } from '../../utils/accessControl.js';
import { ConcurrencyLimitExceededError } from '../../utils/concurrencyLimiter.js';
import type { DbConcurrencyLimiter } from '../../utils/dbConcurrencyLimiter.js';
import { env } from '../../config/env.js';

const assistSchema = z.object({
  action:       z.string().max(64).default('custom'),
  content:      z.string().max(12000).default(''),
  selectedText: z.string().max(6000).default(''),
  prompt:       z.string().max(2000).default(''),
  language:     z.string().max(16).default('en'),
  userId:       z.string().max(128).optional(),
  usageKey:     z.string().min(1).max(80).default('text'),
  feature:      z.string().min(1).max(80).default('text_generate'),
});

export async function textRoutes(
  fastify: FastifyInstance,
  opts: {
    projectRepo:   ProjectRepository;
    textService:   AiTextGenerationService;
    quotaService:  AiQuotaService;
    usageLogger:   AiUsageLoggerService;
    pricingService: AiModelPricingService;
    concurrency:   DbConcurrencyLimiter;
  },
): Promise<void> {
  const projectAuth = buildProjectAuthMiddleware(opts.projectRepo);

  fastify.post('/v1/text/assist', {
    preHandler: [projectAuth],
    config: {
      rateLimit: {
        max: env.RATE_LIMIT_GENERATE_MAX,
        timeWindow: env.RATE_LIMIT_TIME_WINDOW_MS,
      },
    },
  }, async (request, reply) => {
    const requestId  = crypto.randomBytes(16).toString('hex');
    const startedAt  = Date.now();
    const projectKey = request.project.projectKey;

    const parsed = assistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Invalid request body', details: parsed.error.flatten().fieldErrors } });
    }

    const { userId, feature, ...payload } = parsed.data;
    let reservation: QuotaReservationHandle | null = null;
    let leaseHeld = false;

    try {
      assertFeatureAllowed(request.project, feature);
      await opts.concurrency.acquire(projectKey, requestId);
      leaseHeld = true;

      reservation = await opts.quotaService.reserveRequest(projectKey, {
        kind: 'text',
        textChars: payload.content.length + payload.selectedText.length + payload.prompt.length,
      });

      const result = await opts.textService.assist(payload);
      const cost   = await opts.pricingService.estimateCost(
        result.provider,
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      );

      await opts.usageLogger.log({
        requestId,
        projectKey,
        userId,
        feature,
        action:        payload.action,
        provider:      result.provider,
        model:         result.model,
        inputTokens:   result.usage.inputTokens,
        outputTokens:  result.usage.outputTokens,
        totalTokens:   result.usage.totalTokens,
        estimatedCost: cost.estimatedCost,
        currency:      cost.currency,
        status:        'success',
        durationMs:    Date.now() - startedAt,
      });

      return reply.send({
        result:     result.text,
        action:     payload.action,
        provider:   result.provider,
        providerId: result.providerId,
        model:      result.model,
        usage: {
          inputTokens:   result.usage.inputTokens,
          outputTokens:  result.usage.outputTokens,
          totalTokens:   result.usage.totalTokens,
          estimatedCost: cost.estimatedCost,
          currency:      cost.currency,
          pricingFound:  cost.pricingFound,
          requestId,
          source:        result.usage.source,
        },
      });
    } catch (err) {
      const e = err as Error & { statusCode?: number; code?: string };
      const isQuota = e instanceof AiQuotaExceededException;
      const isConcurrency = e instanceof ConcurrencyLimitExceededError;
      const isForbidden = e.code === 'FEATURE_FORBIDDEN' || e.statusCode === 403;
      const code = isQuota
        ? 'QUOTA_EXCEEDED'
        : isConcurrency
          ? 'CONCURRENCY_LIMIT'
          : isForbidden
            ? 'FEATURE_FORBIDDEN'
            : 'AI_REQUEST_FAILED';
      const status = (isQuota || isConcurrency)
        ? 429
        : isForbidden
          ? 403
          : (e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500);

      await opts.usageLogger.log({
        requestId,
        projectKey,
        userId,
        feature,
        action:        payload.action,
        provider:      '',
        model:         '',
        inputTokens:   0,
        outputTokens:  0,
        totalTokens:   0,
        estimatedCost: 0,
        currency:      'USD',
        status:        isQuota ? 'quota_exceeded' : 'error',
        errorCode:     code,
        httpStatus:    status,
        durationMs:    Date.now() - startedAt,
      });

      return reply.code(status).send({
        error: {
          code,
          message: publicErrorMessage(
            e,
            isForbidden
              ? 'Feature not allowed'
              : isConcurrency
                ? 'Too many concurrent requests'
                : 'AI request failed',
          ),
        },
      });
    } finally {
      if (leaseHeld) await opts.concurrency.release(requestId);
      if (reservation) await opts.quotaService.releaseRequestReservation(projectKey, reservation);
    }
  });
}
