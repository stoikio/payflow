import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '#src/store/database.ts';
import { Store } from '#src/store/store.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database', () => {
  it('adds the attempt columns to a database created before them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'payflow-'));
    directories.push(directory);
    const path = join(directory, 'payflow.db');
    const previous = new DatabaseSync(path);
    previous.exec(`CREATE TABLE webhook_attempts (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      status_code INTEGER,
      error TEXT,
      duration_ms INTEGER NOT NULL
    )`);
    previous
      .prepare(
        `INSERT INTO webhook_attempts (id, delivery_id, attempted_at, status_code, error, duration_ms)
         VALUES ('WAOLD', 'WDOLD', '2026-10-22T09:00:00.000Z', 500, 'HTTP 500', 3)`,
      )
      .run();
    previous.close();

    const database = openDatabase(path);
    const store = new Store(database);
    store.insertAttempt({
      id: 'WANEW',
      deliveryId: 'WDOLD',
      attemptedAt: '2026-10-22T09:00:01.000Z',
      url: 'http://receiver.test/webhooks',
      signature: 't=1,v1=00',
      statusCode: 200,
      error: null,
      durationMs: 4,
      responseBody: 'ok',
    });

    expect(store.listAttempts('WDOLD')).toEqual([
      expect.objectContaining({
        id: 'WAOLD',
        url: null,
        signature: null,
        responseBody: null,
      }),
      expect.objectContaining({
        id: 'WANEW',
        url: 'http://receiver.test/webhooks',
        responseBody: 'ok',
      }),
    ]);
    database.close();
  });
});
