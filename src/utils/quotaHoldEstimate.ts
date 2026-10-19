export type QuotaHoldKind = 'text' | 'image';

export interface QuotaHoldEstimate {
  tokens: number;
  cost: number;
}

export interface QuotaHoldConfig {
  safetyMult: number;
  maxTokens: number;
  maxCost: number;
  outputTokensDefault: number;
  usdPer1k: number;
}

/**
 * Estimate in-flight quota holds from request shape.
 * Caps at maxima; applies safety multiplier to shrink post-generation overshoot.
 */
export function estimateQuotaHold(
  kind: QuotaHoldKind,
  textChars: number,
  cfg: QuotaHoldConfig,
  /** Caller-requested output cap; replaces the default output-token guess */
  maxOutputTokens?: number,
): QuotaHoldEstimate {
  const safety = cfg.safetyMult;

  if (kind === 'image') {
    return {
      tokens: 0,
      cost: round8(cfg.maxCost * safety),
    };
  }

  const inputTokens = Math.ceil(Math.max(0, textChars) / 2);
  const explicitOut = maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : 0;
  const rawTokens = Math.ceil((inputTokens + (explicitOut || cfg.outputTokensDefault)) * safety);
  // Default guess is capped at maxTokens. An explicit caller output cap is never held below
  // what was requested (otherwise large requests under-reserve and overshoot quota).
  const tokenCap = explicitOut ? Math.max(cfg.maxTokens, rawTokens) : cfg.maxTokens;
  const tokens = clamp(rawTokens, 256, tokenCap);

  const costFromTokens = (tokens / 1000) * cfg.usdPer1k * safety;
  const costCap = cfg.maxCost * safety * (tokens > cfg.maxTokens && cfg.maxTokens > 0 ? tokens / cfg.maxTokens : 1);
  const cost = round8(clamp(costFromTokens, 0.001, costCap));

  return { tokens, cost };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
