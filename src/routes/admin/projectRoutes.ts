import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminAuth } from '../../middleware/adminAuth.js';
import { generateApiKey, hashApiKey } from '../../utils/crypto.js';
import type { ProjectRepository } from '../../domain/project/ProjectRepository.js';
import type { AdminAuditService } from '../../domain/ai/service/AdminAuditService.js';

const createProjectSchema = z.object({
  projectKey:      z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/),
  projectName:     z.string().min(1).max(100),
  allowedFeatures: z.array(z.string()).nullable().default(null),
});

function auditCtx(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

export async function projectRoutes(
  fastify: FastifyInstance,
  opts: { projectRepo: ProjectRepository; auditService: AdminAuditService },
): Promise<void> {

  fastify.get('/admin/projects', { preHandler: [adminAuth] }, async (_req, reply) => {
    const projects = await opts.projectRepo.listAll();
    return reply.send({ projects });
  });

  fastify.post('/admin/projects', { preHandler: [adminAuth] }, async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', details: parsed.error.flatten().fieldErrors } });
    }

    const rawKey   = generateApiKey();
    const prefix   = rawKey.slice(0, 16);
    const keyHash  = hashApiKey(rawKey);

    await opts.projectRepo.create({
      projectKey:      parsed.data.projectKey,
      projectName:     parsed.data.projectName,
      apiKeyHash:      keyHash,
      apiKeyPrefix:    prefix,
      allowedFeatures: parsed.data.allowedFeatures,
    });

    const ctx = auditCtx(request);
    await opts.auditService.record({
      action: 'project.create',
      resourceType: 'project',
      resourceId: parsed.data.projectKey,
      ...ctx,
      meta: { apiKeyPrefix: prefix },
    });

    // Return the raw key ONCE — not stored in DB
    return reply.code(201).send({
      projectKey: parsed.data.projectKey,
      apiKey:     rawKey,
      prefix,
      warning:    'Save this API key now — it will not be shown again.',
    });
  });

  fastify.post('/admin/projects/:key/rotate', { preHandler: [adminAuth] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const rawKey  = generateApiKey();
    const prefix  = rawKey.slice(0, 16);
    await opts.projectRepo.rotateApiKey(key, hashApiKey(rawKey), prefix);

    const ctx = auditCtx(request);
    await opts.auditService.record({
      action: 'project.rotate_key',
      resourceType: 'project',
      resourceId: key,
      ...ctx,
      meta: { apiKeyPrefix: prefix },
    });

    return reply.send({
      projectKey: key,
      apiKey:     rawKey,
      prefix,
      warning:    'Save this API key now — it will not be shown again.',
    });
  });

  fastify.delete('/admin/projects/:key', { preHandler: [adminAuth] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    await opts.projectRepo.setActive(key, false);

    const ctx = auditCtx(request);
    await opts.auditService.record({
      action: 'project.deactivate',
      resourceType: 'project',
      resourceId: key,
      ...ctx,
    });

    return reply.send({ ok: true });
  });
}
