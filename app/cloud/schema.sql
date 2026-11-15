CREATE SCHEMA IF NOT EXISTS corilo_private;
REVOKE ALL ON SCHEMA corilo_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS corilo_private.accounts (
  id uuid PRIMARY KEY,
  subject text NOT NULL UNIQUE,
  email text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS corilo_private.vaults (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE REFERENCES corilo_private.accounts(id)
);
CREATE TABLE IF NOT EXISTS corilo_private.invitations (
  digest text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  redeemed_by uuid REFERENCES corilo_private.accounts(id)
);
CREATE TABLE IF NOT EXISTS corilo_private.sessions (
  digest text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES corilo_private.accounts(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON corilo_private.sessions(expires_at);

-- Agent execution metadata. These tables do not enable the cloud Agent endpoints.
CREATE UNIQUE INDEX IF NOT EXISTS vault_owner_identity ON corilo_private.vaults(id, owner_id);
CREATE TABLE IF NOT EXISTS corilo_private.conversations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES corilo_private.accounts(id),
  vault_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id, vault_id),
  FOREIGN KEY (vault_id, owner_id) REFERENCES corilo_private.vaults(id, owner_id)
);
CREATE TABLE IF NOT EXISTS corilo_private.runs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_digest text NOT NULL,
  prompt text NOT NULL CHECK (octet_length(prompt) BETWEEN 1 AND 65536),
  state text NOT NULL CHECK (state IN ('queued','running','stopping','stopped','completed','failed','interrupted')),
  lease_digest text,
  lease_until timestamptz,
  deadline_at timestamptz,
  worker_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (owner_id, conversation_id, request_key),
  FOREIGN KEY (conversation_id, owner_id, vault_id) REFERENCES corilo_private.conversations(id, owner_id, vault_id),
  CHECK ((state IN ('running','stopping')) = (lease_digest IS NOT NULL)),
  CHECK ((state IN ('stopped','completed','failed','interrupted')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_vault ON corilo_private.runs(vault_id)
  WHERE state IN ('queued','running','stopping');
CREATE INDEX IF NOT EXISTS queued_runs ON corilo_private.runs(created_at, id) WHERE state='queued';
CREATE TABLE IF NOT EXISTS corilo_private.run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES corilo_private.runs(id),
  state text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_for_run ON corilo_private.run_events(run_id,id);
