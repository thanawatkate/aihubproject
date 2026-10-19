import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

process.env.DB_NAME ??= 'test';
process.env.DB_USER ??= 'test';
process.env.DB_PASSWORD ??= 'test';
process.env.ADMIN_SECRET ??= 'x'.repeat(40);
process.env.ENCRYPTION_KEY ??= 'ab'.repeat(32);

type Json = Record<string, any>;

async function build(opts: { allowedFeatures?: string[] | null; quotaError?: boolean } = {}) {
  const { textRoutes } = await import('./textRoutes.js');
  const { AiTextGenerationService } = await import('../../domain/ai/service/AiTextGenerationService.js');
  const { AiQuotaExceededException } = await import('../../domain/ai/service/AiQuotaService.js');

  const seen = { messages: [] as any[], options: undefined as any, reserve: undefined as any, logs: [] as any[] };
  const provider = {
    supports: () => true,
    generate: async (_s: unknown, messages: any[], options?: any) => {
      seen.messages = messages;
      seen.options = options;
      return { text: 'hello', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, source: 'provider' as const } };
    },
  };
  const settingsRepo = {
    resolveUsage: async () => ({
      provider: 'openai', providerId: 'p1', model: 'm1', apiKey: 'k', baseUrl: 'http://x',
      adapterType: 'openai_chat', authConfig: { type: 'bearer', header: '', queryKey: '' },
    }),
  };
  const app = Fastify();
  await app.register(textRoutes, {
    projectRepo: {
      findByApiKeyHash: async () => ({
        projectId: 1, projectKey: 'pk', projectName: 'p', isActive: true,
        allowedFeatures: opts.allowedFeatures ?? null,
      }),
    } as any,
    textService: new AiTextGenerationService(settingsRepo as any, [provider as any]),
    quotaService: {
      reserveRequest: async (_k: string, o: unknown) => {
        if (opts.quotaError) throw new AiQuotaExceededException('over');
        seen.reserve = o;
        return { reserved: false };
      },
      releaseRequestReservation: async () => {},
    } as any,
    usageLogger: { log: async (e: unknown) => { seen.logs.push(e); } } as any,
    pricingService: { estimateCost: async () => ({ estimatedCost: 0.01, currency: 'USD', pricingFound: true }) } as any,
    concurrency: { acquire: async () => {}, release: async () => {} } as any,
  });
  return { app, seen };
}

const auth = { authorization: 'Bearer test-key' };

describe('POST /v1/text/generate', () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  before(async () => { ctx = await build(); });

  it('requires project auth', async () => {
    // fake repo accepts any key; missing header must still be rejected
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/text/generate', payload: { prompt: 'hi' } });
    assert.equal(res.statusCode, 401);
  });

  it('passes system, raw prompt and maxOutputTokens through; returns assist-shaped body', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/v1/text/generate', headers: auth,
      payload: { prompt: 'raw prompt', system: 'be JSON', usageKey: 'k1', feature: 'f1', maxOutputTokens: 2048 },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;
    assert.equal(body.result, 'hello');
    assert.equal(body.provider, 'openai');
    assert.equal(body.providerId, 'p1');
    assert.equal(body.model, 'm1');
    assert.equal(body.usage.totalTokens, 5);
    assert.equal(body.usage.estimatedCost, 0.01);
    assert.equal(body.usage.source, 'provider');
    assert.ok(body.usage.requestId);
    assert.deepEqual(ctx.seen.messages, [
      { role: 'system', content: 'be JSON' },
      { role: 'user', content: 'raw prompt' },
    ]);
    assert.deepEqual(ctx.seen.options, { maxOutputTokens: 2048 });
    assert.equal(ctx.seen.reserve.maxOutputTokens, 2048);
    assert.equal(ctx.seen.reserve.textChars, 'raw prompt'.length + 'be JSON'.length);
    assert.equal(ctx.seen.logs.at(-1).status, 'success');
    assert.equal(ctx.seen.logs.at(-1).feature, 'f1');
  });

  it('omits system message when not provided', async () => {
    await ctx.app.inject({ method: 'POST', url: '/v1/text/generate', headers: auth, payload: { prompt: 'only' } });
    assert.deepEqual(ctx.seen.messages, [{ role: 'user', content: 'only' }]);
  });

  it('accepts a 50k-char prompt untruncated', async () => {
    const prompt = 'a'.repeat(50000);
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/text/generate', headers: auth, payload: { prompt } });
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.seen.messages.at(-1).content.length, 50000);
  });

  it('rejects over-limit input with 400', async () => {
    const bad: Json[] = [
      { prompt: 'x'.repeat(60001) },
      { prompt: '' },
      { prompt: 'x', system: 'y'.repeat(8001) },
      { prompt: 'x', maxOutputTokens: 16385 },
      { prompt: 'x', maxOutputTokens: 0 },
      { prompt: 'x', maxOutputTokens: 1.5 },
    ];
    for (const payload of bad) {
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/text/generate', headers: auth, payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 60));
      assert.equal((res.json() as Json).error.code, 'INVALID_INPUT');
    }
  });

  it('enforces allowedFeatures (403)', async () => {
    const { app } = await build({ allowedFeatures: ['other'] });
    const res = await app.inject({ method: 'POST', url: '/v1/text/generate', headers: auth, payload: { prompt: 'x' } });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as Json).error.code, 'FEATURE_FORBIDDEN');
  });

  it('maps quota errors to 429', async () => {
    const { app, seen } = await build({ quotaError: true });
    const res = await app.inject({ method: 'POST', url: '/v1/text/generate', headers: auth, payload: { prompt: 'x' } });
    assert.equal(res.statusCode, 429);
    assert.equal((res.json() as Json).error.code, 'QUOTA_EXCEEDED');
    assert.equal(seen.logs.at(-1).status, 'quota_exceeded');
  });
});

describe('POST /v1/text/assist (unchanged)', () => {
  it('still uses the CMS system prompt and no maxOutputTokens', async () => {
    const { app, seen } = await build();
    const res = await app.inject({
      method: 'POST', url: '/v1/text/assist', headers: auth,
      payload: { action: 'summarize', content: 'some body', language: 'en' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as Json).action, 'summarize');
    assert.equal(seen.messages[0].role, 'system');
    assert.match(seen.messages[0].content, /CMS rich text editor/);
    assert.equal(seen.options, undefined);
    assert.equal(seen.reserve.maxOutputTokens, undefined);
  });
});

describe('estimateQuotaHold with maxOutputTokens', () => {
  const cfg = { safetyMult: 1, maxTokens: 100000, maxCost: 1, outputTokensDefault: 1500, usdPer1k: 0.01 };
  it('scales hold by prompt length and requested output cap', async () => {
    const { estimateQuotaHold } = await import('../../utils/quotaHoldEstimate.js');
    const base = estimateQuotaHold('text', 1000, cfg);
    const bigOut = estimateQuotaHold('text', 1000, cfg, 8000);
    const bigIn = estimateQuotaHold('text', 40000, cfg, 8000);
    assert.equal(base.tokens, 500 + 1500);
    assert.equal(bigOut.tokens, 500 + 8000);
    assert.ok(bigIn.tokens > bigOut.tokens);
  });
});
