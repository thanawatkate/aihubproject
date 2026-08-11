import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const WEAK_ENCRYPTION_KEYS = new Set([
  '0'.repeat(64),
  '0000000000000000000000000000000000000000000000000000000000000000',
]);

const schema = z.object({
  NODE_ENV:                     z.enum(['development', 'production', 'test']).default('development'),
  PORT:                         z.coerce.number().default(3400),
  HOST:                         z.string().default('0.0.0.0'),
  DB_HOST:                      z.string().default('localhost'),
  DB_PORT:                      z.coerce.number().default(3306),
  DB_NAME:                      z.string(),
  DB_USER:                      z.string(),
  DB_PASSWORD:                  z.string(),
  ADMIN_SECRET:                 z.string().min(32, 'ADMIN_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY:               z.string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  AI_PROVIDER_TIMEOUT_SECONDS:  z.coerce.number().default(60),
  AI_PROVIDER_RETRY_ATTEMPTS:   z.coerce.number().default(1),
  AI_PROVIDER_RETRY_DELAY_MS:   z.coerce.number().default(250),
  CORS_ORIGINS:                 z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX:               z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_GENERATE_MAX:      z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_TIME_WINDOW_MS:    z.coerce.number().int().min(1000).default(60_000),
  BODY_LIMIT_BYTES:             z.coerce.number().int().min(1024).default(2_500_000),
  MAX_CONCURRENT_PER_PROJECT:   z.coerce.number().int().min(1).default(5),
  CONCURRENCY_LEASE_TTL_SECONDS: z.coerce.number().int().min(30).default(180),
  QUOTA_RESERVE_TOKENS_PER_REQUEST: z.coerce.number().int().min(0).default(4000),
  QUOTA_RESERVE_COST_PER_REQUEST:   z.coerce.number().min(0).default(0.05),
  QUOTA_RESERVE_OUTPUT_TOKENS_DEFAULT: z.coerce.number().int().min(0).default(1500),
  QUOTA_RESERVE_USD_PER_1K_TOKENS:  z.coerce.number().min(0).default(0.01),
  QUOTA_RESERVE_SAFETY_MULT:        z.coerce.number().min(1).max(3).default(1.25),
  ADMIN_AUDIT_RETENTION_DAYS:   z.coerce.number().int().min(1).default(90),
  ADMIN_AUDIT_AUTO_PURGE:       z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ADMIN_AUDIT_PURGE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60 * 1000),
  ADMIN_IP_ALLOWLIST:           z.string().default(''),
  REQUEST_TIMEOUT_MS:           z.coerce.number().int().min(1000).default(120_000),
  TRUST_PROXY:                  z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && WEAK_ENCRYPTION_KEYS.has(parsed.data.ENCRYPTION_KEY.toLowerCase())) {
  console.error('[config] ENCRYPTION_KEY is a known weak/default value — refuse to start in production');
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === 'production'
  && /change_me|your_long_admin|example/i.test(parsed.data.ADMIN_SECRET)
) {
  console.error('[config] ADMIN_SECRET looks like a placeholder — refuse to start in production');
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
