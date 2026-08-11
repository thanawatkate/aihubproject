import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import type { AiImageGenerationService } from '../../domain/ai/service/AiImageGenerationService.js';
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

/** ~1.5MB decoded ≈ ~2MB base64 */
const MAX_REFERENCE_BASE64_CHARS = 2_000_000;

const imageSchema = z.object({
  prompt:                  z.string().min(1).max(2000),
  size:                    z.string().max(32).default('1024x1024'),
  quality:                 z.string().max(32).default('standard'),
  targetWidth:             z.coerce.number().int().min(0).max(4096).optional(),
  targetHeight:            z.coerce.number().int().min(0).max(4096).optional(),
  referenceImageBase64:    z.string().max(MAX_REFERENCE_BASE64_CHARS).optional(),
  referenceImageMimeType:  z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  usageKey:                z.string().min(1).max(80).default('image'),
  userId:                  z.string().max(128).optional(),
  feature:                 z.string().min(1).max(80).default('image_generate'),
});

export async function imageRoutes(
  fastify: FastifyInstance,
  opts: {
    projectRepo:    ProjectRepository;
    imageService:   AiImageGenerationService;
    quotaService:   AiQuotaService;
    usageLogger:    AiUsageLoggerService;
    pricingService: AiModelPricingService;
    concurrency:    DbConcurrencyLimiter;
  },
): Promise<void> {
  const projectAuth = buildProjectAuthMiddleware(opts.projectRepo);

  fastify.post('/v1/image/generate', {
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

    const parsed = imageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }

    const { userId, feature, ...params } = parsed.data;
    let reservation: QuotaReservationHandle | null = null;
    let leaseHeld = false;

    try {
      assertFeatureAllowed(request.project, feature);
      await opts.concurrency.acquire(projectKey, requestId);
      leaseHeld = true;

      reservation = await opts.quotaService.reserveRequest(projectKey, { kind: 'image' });

      const result = await opts.imageService.generate(params);

      const cost = await opts.pricingService.estimateImageCost(result.provider, result.model);

      await opts.usageLogger.log({
        requestId,
        projectKey,
        userId,
        feature,
        action:        params.usageKey,
        provider:      result.provider,
        model:         result.model,
        inputTokens:   0,
        outputTokens:  0,
        totalTokens:   0,
        estimatedCost: cost.estimatedCost,
        currency:      cost.currency,
        status:        'success',
        durationMs:    Date.now() - startedAt,
      });

      return reply.send({
        imageBase64: result.imageBase64,
        mimeType:    result.mimeType,
        provider:    result.provider,
        providerId:  result.providerId,
        model:       result.model,
        requestId,
        usage: {
          estimatedCost: cost.estimatedCost,
          currency:      cost.currency,
          pricingFound:  cost.pricingFound,
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
            : 'AI_IMAGE_GENERATION_FAILED';
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
        action:        params.usageKey,
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
                : 'AI image generation failed',
          ),
        },
      });
    } finally {
      if (leaseHeld) await opts.concurrency.release(requestId);
      if (reservation) await opts.quotaService.releaseRequestReservation(projectKey, reservation);
    }
  });
}
