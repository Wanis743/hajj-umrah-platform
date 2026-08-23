/*
# Add settings table

1. Purpose
   Adds a single-row settings table to store the next departure date shown on
   the landing page countdown, editable only by authenticated staff.

2. New Tables
   - `settings`
     - `id` (int, primary key, default 1) — enforces single-row table
     - `next_departure_date` (date, nullable) — the next departure date
     - `updated_at` (timestamptz, default now())

3. Security
   - `settings` has RLS enabled.
   - SELECT: anon + authenticated can read (landing page countdown).
   - INSERT/UPDATE/DELETE: authenticated only (staff set the departure date).
*/

CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_departure_date date,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON settings FROM anon;
REVOKE ALL ON settings FROM authenticated;
GRANT SELECT ON settings TO anon;
GRANT SELECT, UPDATE ON settings TO authenticated;

INSERT INTO settings (id, next_departure_date)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_settings" ON settings;
CREATE POLICY "public_read_settings"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "staff_update_settings" ON settings;
CREATE POLICY "staff_update_settings"
  ON settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "staff_insert_settings" ON settings;
CREATE POLICY "staff_insert_settings"
  ON settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "staff_delete_settings" ON settings;
CREATE POLICY "staff_delete_settings"
  ON settings FOR DELETE
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settings_updated_at ON settings;
CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
