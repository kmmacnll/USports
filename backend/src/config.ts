import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_JWKS_URL: z.url().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
  AUTH_DEV_HEADER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.AUTH_DEV_HEADER) {
    throw new Error('AUTH_DEV_HEADER must not be enabled in production');
  }
  if (!cfg.JWT_SECRET && !cfg.JWT_JWKS_URL && !cfg.AUTH_DEV_HEADER) {
    throw new Error('Configure JWT_SECRET or JWT_JWKS_URL (or AUTH_DEV_HEADER=true for local development)');
  }
  return cfg;
}
