export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  id               BIGSERIAL PRIMARY KEY,
  order_no         TEXT NOT NULL UNIQUE,
  game_id          TEXT NOT NULL,
  player_id        TEXT NOT NULL,
  package_code     TEXT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status           TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  attempts         INT NOT NULL DEFAULT 0,
  idempotency_key  TEXT UNIQUE,
  request_hash     TEXT,
  payment_ref      TEXT,
  locked_by        TEXT,
  lease_expires_at TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS order_events (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events (order_id, id);

CREATE TABLE IF NOT EXISTS order_issues (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  category   TEXT,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'IDLE',
  current_order_id  BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'IDLE',
  current_order_id  BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'IDLE',
  current_order_id  BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'IDLE',
  current_order_id  BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'IDLE',
  current_order_id  BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
`;
