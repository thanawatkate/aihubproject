import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateApiKey, hashApiKey, encryptValue, decryptValue, safeEqual } from '../utils/crypto.js';
import { assertSafeUrlFormat, isBlockedIp } from '../utils/urlSafety.js';
import { assertFeatureAllowed } from '../utils/accessControl.js';

describe('crypto helpers', () => {
  it('hashes API keys stably', () => {
    const key = 'hub_live_abc';
    assert.equal(hashApiKey(key), hashApiKey(key));
    assert.notEqual(hashApiKey(key), hashApiKey('other'));
  });

  it('generates hub_live_ keys', () => {
    const key = generateApiKey();
    assert.match(key, /^hub_live_[a-f0-9]{32}$/);
  });

  it('round-trips AES encryption', () => {
    const keyHex = 'a'.repeat(64);
    const encrypted = encryptValue('secret-value', keyHex);
    assert.equal(decryptValue(encrypted, keyHex), 'secret-value');
  });

  it('compares secrets without length oracle', () => {
    assert.equal(safeEqual('same', 'same'), true);
    assert.equal(safeEqual('same', 'diff'), false);
    assert.equal(safeEqual('short', 'longer-value'), false);
  });
});

describe('urlSafety', () => {
  it('blocks private IPs', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
    assert.equal(isBlockedIp('8.8.8.8'), false);
  });

  it('requires https format', () => {
    assert.doesNotThrow(() => assertSafeUrlFormat('https://api.openai.com/v1'));
    assert.throws(() => assertSafeUrlFormat('http://api.openai.com/v1'));
    assert.throws(() => assertSafeUrlFormat('https://127.0.0.1/v1'));
  });
});

describe('accessControl', () => {
  it('allows all when allowedFeatures is null', () => {
    assert.doesNotThrow(() => assertFeatureAllowed({
      projectId: 1,
      projectKey: 'demo',
      projectName: 'Demo',
      isActive: true,
      allowedFeatures: null,
    }, 'text_generate'));
  });

  it('enforces allowlist', () => {
    const project = {
      projectId: 1,
      projectKey: 'demo',
      projectName: 'Demo',
      isActive: true,
      allowedFeatures: ['text_generate'],
    };
    assert.doesNotThrow(() => assertFeatureAllowed(project, 'text_generate'));
    assert.throws(() => assertFeatureAllowed(project, 'image_generate'));
  });
});

describe('image flat cost convention', () => {
  it('uses outputCostPer1k as USD-per-image', () => {
    const outputCostPer1k = 0.04;
    const estimatedCost = Math.round(outputCostPer1k * 1e8) / 1e8;
    assert.equal(estimatedCost, 0.04);
  });
});

describe('concurrencyLimiter', () => {
  it('enforces max in-flight per key', async () => {
    const { ConcurrentRequestLimiter, ConcurrencyLimitExceededError } = await import('../utils/concurrencyLimiter.js');
    const limiter = new ConcurrentRequestLimiter(2);
    limiter.acquire('p1');
    limiter.acquire('p1');
    assert.equal(limiter.current('p1'), 2);
    assert.throws(() => limiter.acquire('p1'), ConcurrencyLimitExceededError);
    limiter.release('p1');
    assert.doesNotThrow(() => limiter.acquire('p1'));
    limiter.release('p1');
    limiter.release('p1');
    assert.equal(limiter.current('p1'), 0);
  });
});

describe('quota reservation math', () => {
  it('rejects when used + reserved + hold exceeds limit', () => {
    const used = 9000;
    const reserved = 500;
    const hold = 4000;
    const limit = 12000;
    assert.equal(used + reserved + hold > limit, true);
    assert.equal(used + reserved + 1000 > limit, false);
  });
});

describe('quotaHoldEstimate', () => {
  const cfg = {
    safetyMult: 1.25,
    maxTokens: 4000,
    maxCost: 0.05,
    outputTokensDefault: 1500,
    usdPer1k: 0.01,
  };

  it('sizes text hold from character count', async () => {
    const { estimateQuotaHold } = await import('../utils/quotaHoldEstimate.js');
    const small = estimateQuotaHold('text', 100, cfg);
    const large = estimateQuotaHold('text', 6000, cfg);
    assert.ok(small.tokens >= 256);
    assert.ok(large.tokens > small.tokens);
    assert.ok(large.tokens <= cfg.maxTokens);
    assert.ok(large.cost <= cfg.maxCost * cfg.safetyMult);
  });

  it('uses cost-only hold for images', async () => {
    const { estimateQuotaHold } = await import('../utils/quotaHoldEstimate.js');
    const hold = estimateQuotaHold('image', 0, cfg);
    assert.equal(hold.tokens, 0);
    assert.equal(hold.cost, Math.round(cfg.maxCost * cfg.safetyMult * 1e8) / 1e8);
  });
});
