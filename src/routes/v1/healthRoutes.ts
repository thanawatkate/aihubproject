import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AiProviderSettingsRepository } from '../../domain/ai/repository/AiProviderSettingsRepository.js';
import type { ProjectRepository } from '../../domain/project/ProjectRepository.js';
import { buildProjectAuthMiddleware } from '../../middleware/projectAuth.js';
import { safeEqual } from '../../utils/crypto.js';
import { env } from '../../config/env.js';

async function requireProjectOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  projectAuth: (req: FastifyRequest, rep: FastifyReply) => Promise<void>,
): Promise<void> {
  const authHeader = request.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authorization header required' } });
    return;
  }

  if (safeEqual(token, env.ADMIN_SECRET)) {
    return;
  }

  await projectAuth(request, reply);
  if (reply.sent) {
    return;
  }
}

export async function healthRoutes(
  fastify: FastifyInstance,
  opts: { settingsRepo: AiProviderSettingsRepository; projectRepo: ProjectRepository },
): Promise<void> {
  const projectAuth = buildProjectAuthMiddleware(opts.projectRepo);

  // Liveness probe — no auth, no provider details
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  fastify.get('/v1/health', {
    preHandler: [
      async (request, reply) => requireProjectOrAdmin(request, reply, projectAuth),
    ],
  }, async (_request, reply) => {
    const settings = await opts.settingsRepo.resolveUsage('text', 'text');
    const configured = Boolean(
      settings &&
      settings.baseUrl &&
      settings.model &&
      (settings.authConfig.type === 'none' || settings.apiKey),
    );

    reply.code(configured ? 200 : 503).send({
      status:     configured ? 'ok' : 'error',
      configured,
      provider:   settings?.provider   ?? null,
      providerId: settings?.providerId ?? null,
      model:      settings?.model      ?? null,
      timestamp:  new Date().toISOString(),
    });
  });
}
