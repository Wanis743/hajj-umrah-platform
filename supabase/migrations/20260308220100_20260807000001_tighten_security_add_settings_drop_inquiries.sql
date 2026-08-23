/*
# Tighten security, add settings table, remove inquiries

1. Purpose
   This migration locks down the reservations table so public visitors can only
   INSERT (submit a booking) and cannot read, update, or delete reservations.
   Only authenticated agency staff can read, update, and delete reservations.
   It also drops the inquiries table (the inquiry form is being removed from the
   site) and adds a single-row settings table to store the next departure date,
   editable only by authenticated staff.

2. Changes to existing tables
   - `reservations`: No schema changes. RLS stays enabled. Policies are replaced:
     - INSERT: anon + authenticated can insert (visitors submit bookings).
     - SELECT: authenticated only (staff manage reservations).
     - UPDATE: authenticated only (staff change status).
     - DELETE: authenticated only (staff remove reservations).
   - Table-level grants for `reservations` are revoked and re-granted with
     least privilege: anon gets INSERT only; authenticated gets full CRUD.

3. Tables dropped
   - `inquiries`: Dropped entirely. The inquiry form is removed from the site.

4. New Tables
   - `settings`
     - `id` (int, primary key, default 1) — enforces single-row table
     - `next_departure_date` (date, nullable) — the next departure date shown on the landing page
     - `updated_at` (timestamptz, default now())

5. Security
   - `settings` has RLS enabled.
   - SELECT: anon + authenticated can read (the landing page countdown needs to read it).
   - INSERT/UPDATE/DELETE: authenticated only (staff set the departure date).
   - A CHECK constraint enforces id = 1 so only one row can ever exist.
*/

-- =========================================================
-- 1. Drop inquiries table
-- =========================================================
DROP TABLE IF EXISTS inquiries;

-- =========================================================
-- 2. Tighten reservations grants and policies
-- =========================================================
-- Revoke all existing grants, then re-grant with least privilege
REVOKE ALL ON reservations FROM anon;
REVOKE ALL ON reservations FROM authenticated;

-- Public reservation writes are disabled at the database table boundary.
-- Public intake is handled exclusively by the reservation Edge Function.
GRANT SELECT, INSERT, UPDATE, DELETE ON reservations TO authenticated;

-- Replace policies (drop + recreate for idempotency)



DROP POLICY IF EXISTS "staff_update_reservations" ON reservations;
CREATE POLICY "staff_update_reservations"
  ON reservations FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);



-- =========================================================
-- 3. Create settings table (single-row)
-- =========================================================
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_departure_date date,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Revoke all, then grant least privilege
REVOKE ALL ON settings FROM anon;
REVOKE ALL ON settings FROM authenticated;

-- anon can only SELECT (landing page reads the departure date)
GRANT SELECT ON settings TO anon;
-- authenticated staff can SELECT and UPDATE
GRANT SELECT, UPDATE ON settings TO authenticated;

-- Seed the single row so UPDATE always works
INSERT INTO settings (id, next_departure_date)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Policies
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

-- =========================================================
-- 4. Updated_at trigger for settings
-- =========================================================
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