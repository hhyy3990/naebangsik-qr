-- Dedicated shared rate-limit storage for /api/recommendations.
-- Does not alter profiles or the Universal Layout v2 quota/idempotency tables.
-- This migration is never run by application startup.
BEGIN;

CREATE TABLE ai_recommendation_rate_limits (
  client_hash CHAR(64) PRIMARY KEY
    CHECK (client_hash ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count SMALLINT NOT NULL
    CHECK (request_count BETWEEN 1 AND 5)
);

CREATE INDEX ai_recommendation_rate_limits_window_idx
  ON ai_recommendation_rate_limits (window_started_at);

COMMIT;
