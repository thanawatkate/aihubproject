import type { FastifyInstance } from 'fastify';
import { buildProjectAuthMiddleware } from '../../middleware/projectAuth.js';
import type { AiQuotaService } from '../../domain/ai/service/AiQuotaService.js';
import type { AiUsageRepository } from '../../domain/ai/repository/AiUsageRepository.js';
import type { ProjectRepository } from '../../domain/project/ProjectRepository.js';

export async function usageRoutes(
  fastify: FastifyInstance,
  opts: {
    quotaService: AiQuotaService;
    usageRepo:    AiUsageRepository;
    projectRepo:  ProjectRepository;
  },
): Promise<void> {
  const projectAuth = buildProjectAuthMiddleware(opts.projectRepo);

  // Project-scoped usage summary
  fastify.get('/v1/usage/summary', { preHandler: [projectAuth] }, async (request, reply) => {
    const month = (request.query as { month?: string }).month;
    const status = await opts.quotaService.getStatus(request.project.projectKey, month);
    return reply.send(status);
  });

  // Project-scoped usage logs
  fastify.get('/v1/usage/logs', { preHandler: [projectAuth] }, async (request, reply) => {
    const q      = request.query as { page?: string; limit?: string };
    const page   = Math.max(1, Number(q.page ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(q.limit ?? 20)));
    const result = await opts.usageRepo.getLogs(request.project.projectKey, page, limit);
    return reply.send({ ...result, page, limit });
  });
}
