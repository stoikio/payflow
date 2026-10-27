import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Columns added to existing tables, which `CREATE TABLE IF NOT EXISTS` leaves untouched. */
const ADDED_COLUMNS = [
  { table: 'webhook_attempts', column: 'url', definition: 'TEXT' },
  { table: 'webhook_attempts', column: 'signature', definition: 'TEXT' },
  { table: 'webhook_attempts', column: 'response_body', definition: 'TEXT' },
];

const addMissingColumns = (database: Database) => {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((existing) => existing.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
};

export const openDatabase = (path: string): Database => {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(SCHEMA);
  addMissingColumns(database);
  return database;
};
