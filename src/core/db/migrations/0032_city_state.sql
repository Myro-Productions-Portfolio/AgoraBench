-- Capitol City effect layer (docs/specs/city-effect-layer.md, slice 2).
-- city_state: single current row (id always 1) — full gzip+base64 engine
-- snapshot for load-and-resume on the next tick.
-- city_snapshots: append-only per-tick history (timelapse); stats duplicated
-- as jsonb so stat queries never decompress the snapshot text.
-- Dark by default: rows only appear once RuntimeConfig.cityEnabled is true.
CREATE TABLE IF NOT EXISTS "city_state" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "tick_number" integer NOT NULL,
  "city_time_months" integer NOT NULL,
  "state" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "city_snapshots" (
  "id" serial PRIMARY KEY,
  "tick_number" integer NOT NULL,
  "city_time_months" integer NOT NULL,
  "stats" jsonb NOT NULL,
  "snapshot" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "city_snapshots_tick_number_idx" ON "city_snapshots" ("tick_number" DESC);
