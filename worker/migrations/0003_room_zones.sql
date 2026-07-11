CREATE TABLE room_detection_zones (
  room_id TEXT PRIMARY KEY,
  x1_bps INTEGER NOT NULL CHECK (x1_bps >= 0 AND x1_bps <= 10000),
  y1_bps INTEGER NOT NULL CHECK (y1_bps >= 0 AND y1_bps <= 10000),
  x2_bps INTEGER NOT NULL CHECK (x2_bps >= 0 AND x2_bps <= 10000),
  y2_bps INTEGER NOT NULL CHECK (y2_bps >= 0 AND y2_bps <= 10000),
  counting_line_y_bps INTEGER NOT NULL CHECK (counting_line_y_bps >= 0 AND counting_line_y_bps <= 10000),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (x1_bps < x2_bps),
  CHECK (y1_bps < y2_bps),
  CHECK (counting_line_y_bps >= y1_bps AND counting_line_y_bps <= y2_bps)
);

-- Safe initial zones keep existing rooms operational. Every later mutation is
-- authenticated and restricted to the immutable platform admin in the Worker.
INSERT INTO room_detection_zones
  (room_id,x1_bps,y1_bps,x2_bps,y2_bps,counting_line_y_bps,version,updated_by,updated_at)
VALUES
  ('tokyo',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch()),
  ('sydney',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch()),
  ('sf',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch()),
  ('paris',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch()),
  ('nyc',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch()),
  ('london',0,2500,10000,10000,7500,1,'0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e',unixepoch());
