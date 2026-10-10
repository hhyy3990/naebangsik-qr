CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  schema_version SMALLINT NOT NULL DEFAULT 2 CHECK (schema_version IN (1, 2)),
  preferences JSONB NOT NULL,
  token_hash TEXT UNIQUE,
  management_key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  is_test BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS profiles_active_token_idx
  ON profiles (token_hash)
  WHERE token_hash IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON profiles (created_at DESC);
