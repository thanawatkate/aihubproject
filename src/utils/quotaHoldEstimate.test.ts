import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateQuotaHold, type QuotaHoldConfig } from './quotaHoldEstimate.js';

const cfg: QuotaHoldConfig = { safetyMult: 1.25, maxTokens: 4000, maxCost: 0.05, outputTokensDefault: 1500, usdPer1k: 0.01 };

describe('estimateQuotaHold', () => {
  it('explicit maxOutputTokens is not capped below requested', () => {
    const r = estimateQuotaHold('text', 2000, cfg, 20000);
    assert.equal(r.tokens, Math.ceil((1000 + 20000) * 1.25));
    assert.ok(r.tokens > cfg.maxTokens);
  });

  it('without maxOutputTokens, cap applies', () => {
    const r = estimateQuotaHold('text', 100000, cfg);
    assert.equal(r.tokens, cfg.maxTokens);
    assert.ok(r.cost <= cfg.maxCost * cfg.safetyMult);
  });

  it('cost cap scales with tokens above maxTokens', () => {
    const big = estimateQuotaHold('text', 0, { ...cfg, usdPer1k: 100 }, 20000);
    const cap = cfg.maxCost * cfg.safetyMult * (big.tokens / cfg.maxTokens);
    assert.ok(Math.abs(big.cost - cap) < 1e-6);
    assert.ok(big.cost > cfg.maxCost * cfg.safetyMult);
  });

  it('small explicit cap stays small', () => {
    assert.equal(estimateQuotaHold('text', 0, cfg, 100).tokens, 256);
  });
});
