CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  customer_reference TEXT NOT NULL,
  return_url TEXT NOT NULL,
  status TEXT NOT NULL,
  authorization_token TEXT NOT NULL UNIQUE,
  account_holder_name TEXT,
  iban TEXT,
  failure_code TEXT,
  cancellation_reason TEXT,
  metadata TEXT NOT NULL,
  plan TEXT NOT NULL,
  next_transition_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL REFERENCES mandates (id),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  charge_date TEXT NOT NULL,
  description TEXT,
  metadata TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_code TEXT,
  plan TEXT NOT NULL,
  next_transition_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS charges_mandate_id_idx ON charges (mandate_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id),
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_status_code INTEGER,
  last_error TEXT,
  first_attempt_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES webhook_deliveries (id),
  attempted_at TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
