-- =============================================================
-- Realistic default prices for seeded models (USD per 1k tokens)
-- Source: list prices as known on 2026-10-19 (from memory, NOT re-checked against
-- vendor pages), converted from USD per 1M tokens.
-- Verify against the vendor pages and override via PUT /admin/model-pricing.
--   gpt-4.1-mini      in 0.40 / out 1.60 per 1M
--   gpt-4o            in 2.50 / out 10.00 per 1M
--   gemini-2.5-flash  in 0.30 / out 2.50 per 1M
--   gemini-2.5-pro    in 1.25 / out 10.00 per 1M (prompts up to 200k tokens)
-- Only active, non-deleted rows still at 0/0 are updated, so admin-edited prices are kept.
-- Note: migrate re-runs this file; a price an admin deliberately sets to 0/0 will be refilled.
-- Wildcard rows (openai_compatible, custom) stay 0 because the real model is unknown.
-- =============================================================

UPDATE `ai_model_pricing` SET `input_cost_per_1k_tokens` = 0.00040000, `output_cost_per_1k_tokens` = 0.00160000
  WHERE `provider` = 'openai' AND `model` = 'gpt-4.1-mini'
    AND `input_cost_per_1k_tokens` = 0 AND `output_cost_per_1k_tokens` = 0
    AND `is_active` = 1 AND `deleted_at` IS NULL;

UPDATE `ai_model_pricing` SET `input_cost_per_1k_tokens` = 0.00250000, `output_cost_per_1k_tokens` = 0.01000000
  WHERE `provider` = 'openai' AND `model` = 'gpt-4o'
    AND `input_cost_per_1k_tokens` = 0 AND `output_cost_per_1k_tokens` = 0
    AND `is_active` = 1 AND `deleted_at` IS NULL;

UPDATE `ai_model_pricing` SET `input_cost_per_1k_tokens` = 0.00030000, `output_cost_per_1k_tokens` = 0.00250000
  WHERE `provider` = 'gemini' AND `model` = 'gemini-2.5-flash'
    AND `input_cost_per_1k_tokens` = 0 AND `output_cost_per_1k_tokens` = 0
    AND `is_active` = 1 AND `deleted_at` IS NULL;

UPDATE `ai_model_pricing` SET `input_cost_per_1k_tokens` = 0.00125000, `output_cost_per_1k_tokens` = 0.01000000
  WHERE `provider` = 'gemini' AND `model` = 'gemini-2.5-pro'
    AND `input_cost_per_1k_tokens` = 0 AND `output_cost_per_1k_tokens` = 0
    AND `is_active` = 1 AND `deleted_at` IS NULL;
