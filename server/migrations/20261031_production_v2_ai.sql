-- Production-only Universal Layout v2 quota/idempotency storage.
-- This file is intentionally not executed by application startup or tests.
BEGIN;

CREATE TABLE demo_ai_quota (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  max_calls SMALLINT NOT NULL DEFAULT 30 CHECK (max_calls = 30),
  reserved_calls SMALLINT NOT NULL DEFAULT 0
    CHECK (reserved_calls >= 0 AND reserved_calls <= max_calls),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO demo_ai_quota (id, max_calls, reserved_calls)
VALUES (1, 30, 0);

CREATE TABLE demo_ai_idempotency (
  host_id TEXT NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL
    CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint CHAR(64) NOT NULL
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
  response_plan JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (host_id, idempotency_key_hash),
  CHECK (
    (status = 'succeeded' AND response_plan IS NOT NULL) OR
    (status <> 'succeeded' AND response_plan IS NULL)
  )
);

CREATE INDEX demo_ai_idempotency_expiry_idx
  ON demo_ai_idempotency (expires_at);

COMMIT;
