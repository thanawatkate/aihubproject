import type { FastifyRequest, FastifyReply } from 'fastify';
import { hashApiKey } from '../utils/crypto.js';
import type { ProjectRepository } from '../domain/project/ProjectRepository.js';
import type { Project } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    project: Project;
  }
}

export function buildProjectAuthMiddleware(repo: ProjectRepository) {
  return async function projectAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'MISSING_API_KEY', message: 'Authorization header required' } });
    }

    const rawKey = authHeader.slice(7).trim();
    if (!rawKey) {
      return reply.code(401).send({ error: { code: 'MISSING_API_KEY', message: 'API key is empty' } });
    }

    const hash = hashApiKey(rawKey);
    const project = await repo.findByApiKeyHash(hash);
    if (!project) {
      return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: 'Invalid or inactive API key' } });
    }

    request.project = project;
  };
}
