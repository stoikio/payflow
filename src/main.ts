import { existsSync } from 'node:fs';

import { serve } from '@hono/node-server';

import { createApp } from '#src/app.ts';
import { loadConfig } from '#src/config.ts';
import { openDatabase } from '#src/store/database.ts';

const TICK_MS = 250;

// Variables already set in the environment win over the file.
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig();
const database = openDatabase(config.databasePath);
const { app, tick, store } = createApp({ database, config, logRequests: true });

store.requeueInFlightDeliveries(Date.now());

let running = false;
const timer = setInterval(() => {
  if (running) {
    return;
  }
  running = true;
  tick()
    .catch((error: unknown) => console.error('Tick failed', error))
    .finally(() => {
      running = false;
    });
}, TICK_MS);

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: '0.0.0.0' },
  (info) => {
    console.info(`PayFlow sandbox listening on http://localhost:${info.port}`);
    console.info(`Dashboard: ${config.publicUrl}/dashboard`);
    console.info(
      `Webhooks: ${config.webhookUrl}${config.webhookChaos ? ' (chaos mode)' : ''}`,
    );
    console.info(`Transitions every ${config.transitionSeconds}s`);
  },
);

const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    database.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
