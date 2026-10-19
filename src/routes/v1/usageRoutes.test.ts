import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

process.env.DB_NAME ??= 'test';
process.env.DB_USER ??= 'test';
process.env.DB_PASSWORD ??= 'test';
process.env.ADMIN_SECRET ??= 'x'.repeat(40);
process.env.ENCRYPTION_KEY ??= 'ab'.repeat(32);

async function build() {
  const { usageRoutes } = await import('./usageRoutes.js');
  const { hashApiKey } = await import('../../utils/crypto.js');
  const goodHash = hashApiKey('good-key');
  const seen: any = {};
  const app = Fastify();
  await app.register(usageRoutes, {
    projectRepo: {
      findByApiKeyHash: async (h: string) => (h === goodHash ? { projectId: 1, projectKey: 'pk', isActive: true } : null),
    } as any,
    quotaService: { getStatus: async (k: string, m?: string) => { seen.status = [k, m]; return { ok: true }; } } as any,
    usageRepo: { getLogs: async (k: string, p: number, l: number) => { seen.logs = [k, p, l]; return { rows: [] }; } } as any,
  });
  return { app, seen };
}

describe('usageRoutes', () => {
  it('registers both paths and rejects without key', async () => {
    const { app } = await build();
    for (const url of ['/v1/usage/summary', '/v1/usage/logs']) {
      assert.equal((await app.inject({ url })).statusCode, 401);
      assert.equal((await app.inject({ url, headers: { authorization: 'Bearer bad' } })).statusCode, 401);
    }
  });

  it('serves with valid key', async () => {
    const { app, seen } = await build();
    const h = { authorization: 'Bearer good-key' };
    const s = await app.inject({ url: '/v1/usage/summary?month=2026-10', headers: h });
    assert.equal(s.statusCode, 200);
    assert.deepEqual(seen.status, ['pk', '2026-10']);
    const l = await app.inject({ url: '/v1/usage/logs?page=2&limit=500', headers: h });
    assert.equal(l.statusCode, 200);
    assert.deepEqual(seen.logs, ['pk', 2, 100]);
  });
});
