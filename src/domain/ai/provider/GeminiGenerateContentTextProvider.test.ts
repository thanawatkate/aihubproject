import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_NAME ??= 'test';
process.env.DB_USER ??= 'test';
process.env.DB_PASSWORD ??= 'test';
process.env.ADMIN_SECRET ??= 'x'.repeat(40);
process.env.ENCRYPTION_KEY ??= 'ab'.repeat(32);

const settings = (model: string) => ({
  provider: 'gemini', model, apiKey: 'k', baseUrl: 'https://example.com/v1beta',
  adapterType: 'gemini_generate_content', authConfig: { type: 'query', header: '', queryKey: 'key' },
}) as any;

const okResponse = {
  candidates: [{ content: { parts: [{ text: 'hi' }] } }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
};

async function build(responses: Array<unknown | Error>) {
  const { GeminiGenerateContentTextProvider } = await import('./GeminiGenerateContentTextProvider.js');
  const { AiProviderHttpClient } = await import('./AiProviderHttpClient.js');
  const { AiProviderResponseHelper } = await import('./AiProviderResponseHelper.js');
  const bodies: any[] = [];
  const client = new AiProviderHttpClient();
  (client as any).requestJson = async (o: any) => {
    bodies.push(o.body);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { provider: new GeminiGenerateContentTextProvider(client, new AiProviderResponseHelper()), bodies };
}

describe('thinkingConfigFor', () => {
  it('maps models', async () => {
    const { thinkingConfigFor } = await import('./GeminiGenerateContentTextProvider.js');
    assert.deepEqual(thinkingConfigFor('gemini-2.5-flash'), { thinkingBudget: 0 });
    assert.deepEqual(thinkingConfigFor('gemini-2.5-flash-lite'), { thinkingBudget: 0 });
    assert.deepEqual(thinkingConfigFor('models/Gemini-2.5-Pro'), { thinkingBudget: 128 });
    assert.equal(thinkingConfigFor('gemini-2.0-flash'), null);
    assert.equal(thinkingConfigFor('gpt-4o'), null);
  });
});

describe('Gemini provider thinking retry', () => {
  it('sends thinkingConfig for 2.5-flash', async () => {
    const { provider, bodies } = await build([okResponse]);
    await provider.generate(settings('gemini-2.5-flash'), [{ role: 'user', content: 'x' }]);
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });

  it('retries once without thinkingConfig on thinking error', async () => {
    const { provider, bodies } = await build([new Error('Invalid argument: thinkingBudget unsupported'), okResponse]);
    const r = await provider.generate(settings('gemini-2.5-pro'), [{ role: 'user', content: 'x' }]);
    assert.equal(r.text, 'hi');
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].generationConfig.thinkingConfig);
    assert.equal('thinkingConfig' in bodies[1].generationConfig, false);
  });

  it('does not retry on unrelated error', async () => {
    const { provider, bodies } = await build([new Error('quota exhausted')]);
    await assert.rejects(provider.generate(settings('gemini-2.5-flash'), [{ role: 'user', content: 'x' }]), /quota/);
    assert.equal(bodies.length, 1);
  });

  it('does not retry on a generic invalid-argument error', async () => {
    const { provider, bodies } = await build([new Error('400 INVALID_ARGUMENT: API key not valid')]);
    await assert.rejects(provider.generate(settings('gemini-2.5-flash'), [{ role: 'user', content: 'x' }]));
    assert.equal(bodies.length, 1);
  });

  it('does not retry (or send thinkingConfig) for other models', async () => {
    const { provider, bodies } = await build([new Error('invalid argument')]);
    await assert.rejects(provider.generate(settings('gemini-2.0-flash'), [{ role: 'user', content: 'x' }]));
    assert.equal(bodies.length, 1);
    assert.equal('thinkingConfig' in bodies[0].generationConfig, false);
  });
});
