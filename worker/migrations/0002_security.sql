CREATE TABLE auth_rate_limits (
  client_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (client_key, window_start)
);
CREATE INDEX auth_rate_limits_window ON auth_rate_limits(window_start);
