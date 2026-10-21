-- Internal model outlet authorization. Never expose these tables to workers.
CREATE TABLE IF NOT EXISTS corilo_private.model_grants (
  run_id uuid PRIMARY KEY REFERENCES corilo_private.runs(id),
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  max_requests integer NOT NULL CHECK (max_requests BETWEEN 1 AND 10000),
  max_output_tokens bigint NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 1000000000),
  max_tokens_per_request integer NOT NULL CHECK (max_tokens_per_request BETWEEN 1 AND 1000000),
  reserved_requests integer NOT NULL DEFAULT 0 CHECK (reserved_requests >= 0 AND reserved_requests <= max_requests),
  reserved_output_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_output_tokens >= 0 AND reserved_output_tokens <= max_output_tokens),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_tokens_per_request <= max_output_tokens)
);
CREATE TABLE IF NOT EXISTS corilo_private.model_reservations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES corilo_private.model_grants(run_id),
  max_tokens integer NOT NULL CHECK (max_tokens > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_reservations_for_run ON corilo_private.model_reservations(run_id);
