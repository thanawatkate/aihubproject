import type { AiTextProviderInterface, ResolvedSettings, GenerationResult, GenerationOptions } from './AiTextProviderInterface.js';
import { AiProviderHttpClient } from './AiProviderHttpClient.js';
import { AiProviderResponseHelper } from './AiProviderResponseHelper.js';
import type { AiMessage } from '../../../types/index.js';
import { env } from '../../../config/env.js';

/**
 * Thinking tokens count against maxOutputTokens and can truncate JSON output.
 * 2.5-flash / flash-lite accept thinkingBudget=0 (off). 2.5-pro cannot disable thinking
 * (min 128), so use a small budget. Other models get no thinkingConfig.
 */
export function thinkingConfigFor(model: string): { thinkingBudget: number } | null {
  const m = model.toLowerCase();
  if (/gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 };
  if (/gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  return null;
}

function isThinkingRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /thinking/i.test(msg);
}

export class GeminiGenerateContentTextProvider implements AiTextProviderInterface {
  constructor(
    private readonly client: AiProviderHttpClient,
    private readonly helper: AiProviderResponseHelper,
  ) {}

  supports(provider: string, adapterType: string): boolean {
    return provider === 'gemini' || adapterType === 'gemini_generate_content';
  }

  async generate(settings: ResolvedSettings, messages: AiMessage[], options?: GenerationOptions): Promise<GenerationResult> {
    const baseUrl = settings.baseUrl.replace(/\/$/, '');
    const model   = encodeURIComponent(settings.model).replace(/%2F/gi, '/');

    const { headers, queryParam } = this.client.buildAuthHeaders(
      { apiKey: settings.apiKey, authConfig: settings.authConfig as ResolvedSettings['authConfig'] },
      { 'Content-Type': 'application/json', Accept: 'application/json' },
    );

    const parts: string[] = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`);
    const url = `${baseUrl}/models/${model}:generateContent${queryParam ? `?${queryParam}` : ''}`;
    const generationConfig: Record<string, unknown> = { temperature: 0.4 };
    if (options?.maxOutputTokens) generationConfig['maxOutputTokens'] = options.maxOutputTokens;
    const contents = [{ role: 'user', parts: [{ text: parts.join('\n\n') }] }];
    const send = (cfg: Record<string, unknown>) => this.client.requestJson({
      method:    'POST',
      url,
      body:      { contents, generationConfig: cfg },
      headers,
      timeoutMs: env.AI_PROVIDER_TIMEOUT_SECONDS * 1000,
    }) as Promise<Record<string, unknown>>;

    const thinking = thinkingConfigFor(settings.model);
    let data: Record<string, unknown>;
    if (thinking) {
      try {
        data = await send({ ...generationConfig, thinkingConfig: thinking });
      } catch (err) {
        if (!isThinkingRejected(err)) throw err;
        data = await send(generationConfig);
      }
    } else {
      data = await send(generationConfig);
    }

    const responseParts = (
      ((data['candidates'] as unknown[])?.[0] as Record<string, unknown>)?.['content'] as Record<string, unknown>
    )?.['parts'] as Array<Record<string, unknown>> ?? [];

    const content = responseParts
      .filter(p => typeof p['text'] === 'string')
      .map(p => p['text'] as string)
      .join('');

    return {
      text:  this.helper.normalizeResult(content),
      usage: this.helper.normalizeGeminiUsage(
        data['usageMetadata'] as Record<string, number>,
        messages,
        content,
      ),
    };
  }
}
