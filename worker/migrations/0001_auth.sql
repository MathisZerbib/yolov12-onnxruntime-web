CREATE TABLE auth_nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX auth_nonces_expiry ON auth_nonces(expires_at);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE inference_manifests (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  room_id TEXT NOT NULL,
  model_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
