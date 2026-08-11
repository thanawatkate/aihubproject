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
): QuotaHoldEstimate {
  const safety = cfg.safetyMult;

  if (kind === 'image') {
    return {
      tokens: 0,
      cost: round8(cfg.maxCost * safety),
    };
  }

  const inputTokens = Math.ceil(Math.max(0, textChars) / 2);
  const rawTokens = Math.ceil((inputTokens + cfg.outputTokensDefault) * safety);
  const tokens = clamp(rawTokens, 256, cfg.maxTokens);

  const costFromTokens = (tokens / 1000) * cfg.usdPer1k * safety;
  const cost = round8(clamp(costFromTokens, 0.001, cfg.maxCost * safety));

  return { tokens, cost };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
