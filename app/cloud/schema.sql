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
