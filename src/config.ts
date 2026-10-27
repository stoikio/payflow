import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const Environment = z.object({
  PORT: z.coerce.number().int().default(4010),
  PUBLIC_URL: z.url().default('http://localhost:4010'),
  DATABASE_PATH: z.string().default(`${ROOT}data/payflow.db`),
  PAYFLOW_API_KEY: z.string().min(16).default('sk_sandbox_9f3c2e7a41b84d6f'),
  WEBHOOK_URL: z.url().optional(),
  WEBHOOK_BASE_URL: z.url().default('http://localhost:3000'),
  WEBHOOK_PATH: z.string().startsWith('/').default('/webhooks/payflow'),
  WEBHOOK_SECRET: z.string().min(16).default('whsec_sandbox_5d1e8b3a9c7f4026'),
  WEBHOOK_RETRY_SECONDS_PER_HOUR: z.coerce.number().positive().default(1),
  WEBHOOK_CHAOS: z.stringbool().default(false),
  SANDBOX_TRANSITION_SECONDS: z.coerce.number().positive().default(5),
  RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(100),
  MERCHANT_NAME: z.string().default('Sandbox merchant'),
});

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => {
  const env = Environment.parse(environment);

  return {
    port: env.PORT,
    publicUrl: env.PUBLIC_URL.replace(/\/$/, ''),
    databasePath: env.DATABASE_PATH,
    apiKey: env.PAYFLOW_API_KEY,
    webhookUrl:
      env.WEBHOOK_URL ?? `${env.WEBHOOK_BASE_URL.replace(/\/$/, '')}${env.WEBHOOK_PATH}`,
    webhookSecret: env.WEBHOOK_SECRET,
    webhookRetrySecondsPerHour: env.WEBHOOK_RETRY_SECONDS_PER_HOUR,
    webhookChaos: env.WEBHOOK_CHAOS,
    transitionSeconds: env.SANDBOX_TRANSITION_SECONDS,
    rateLimitPerSecond: env.RATE_LIMIT_PER_SECOND,
    merchantName: env.MERCHANT_NAME,
  };
};

export type Config = ReturnType<typeof loadConfig>;
