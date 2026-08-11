import type { FastifyRequest, FastifyReply } from 'fastify';
import { safeEqual } from '../utils/crypto.js';
import { env } from '../config/env.js';

function adminIpAllowed(ip: string): boolean {
  const allow = env.ADMIN_IP_ALLOWLIST
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return true;
  return allow.includes(ip);
}

export async function adminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!adminIpAllowed(request.ip)) {
    request.log.warn({ ip: request.ip }, 'admin request blocked by IP allowlist');
    return reply.code(403).send({ error: { code: 'ADMIN_IP_FORBIDDEN', message: 'Admin access denied from this IP' } });
  }

  const authHeader = request.headers.authorization ?? '';
  const secret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!secret || !safeEqual(secret, env.ADMIN_SECRET)) {
    request.log.warn({ ip: request.ip }, 'admin auth failed');
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid admin credentials' } });
  }
}
