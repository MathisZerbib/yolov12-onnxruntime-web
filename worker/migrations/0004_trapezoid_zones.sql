ALTER TABLE room_detection_zones ADD COLUMN top_left_x_bps INTEGER NOT NULL DEFAULT 0 CHECK (top_left_x_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN top_left_y_bps INTEGER NOT NULL DEFAULT 2500 CHECK (top_left_y_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN top_right_x_bps INTEGER NOT NULL DEFAULT 10000 CHECK (top_right_x_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN top_right_y_bps INTEGER NOT NULL DEFAULT 2500 CHECK (top_right_y_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN bottom_right_x_bps INTEGER NOT NULL DEFAULT 10000 CHECK (bottom_right_x_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN bottom_right_y_bps INTEGER NOT NULL DEFAULT 10000 CHECK (bottom_right_y_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN bottom_left_x_bps INTEGER NOT NULL DEFAULT 0 CHECK (bottom_left_x_bps BETWEEN 0 AND 10000);
ALTER TABLE room_detection_zones ADD COLUMN bottom_left_y_bps INTEGER NOT NULL DEFAULT 10000 CHECK (bottom_left_y_bps BETWEEN 0 AND 10000);

UPDATE room_detection_zones SET
  top_left_x_bps=x1_bps, top_left_y_bps=y1_bps,
  top_right_x_bps=x2_bps, top_right_y_bps=y1_bps,
  bottom_right_x_bps=x2_bps, bottom_right_y_bps=y2_bps,
  bottom_left_x_bps=x1_bps, bottom_left_y_bps=y2_bps;
