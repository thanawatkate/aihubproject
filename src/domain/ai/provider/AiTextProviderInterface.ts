import type { AiMessage } from '../../../types/index.js';

export interface AiTextProviderInterface {
  supports(provider: string, adapterType: string): boolean;
  generate(settings: ResolvedSettings, messages: AiMessage[], options?: GenerationOptions): Promise<GenerationResult>;
}

export interface GenerationOptions {
  /** Upper bound on generated tokens; omitted = provider default */
  maxOutputTokens?: number;
}

export interface ResolvedSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  adapterType: string;
  authConfig: { type: string; header: string; queryKey: string };
  [key: string]: unknown;
}

export interface GenerationResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    source: 'provider' | 'estimated';
  };
}
