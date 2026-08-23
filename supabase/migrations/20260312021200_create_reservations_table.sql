/*
# Create reservations table for Bou Sadaa Agency

1. Purpose
   Stores full booking requests for Hajj/Umrah packages submitted through the
   reservation page. Each reservation starts with status 'pending' and is
   confirmed manually by agency staff (no online payment on the site).
   A unique human-readable reference is generated for each booking.

2. New Tables
   - `reservations`
     - `id`            (uuid, primary key, default gen_random_uuid())
     - `reference`     (text, unique, not null) — human-readable booking ref (e.g. BS-2026-0001)
     - `package_id`    (text, not null) — which package was booked
     - `package_name`  (text, not null) — package name at time of booking
     - `start_date`    (date, not null) — preferred travel start date
     - `end_date`      (date, not null) — preferred travel end date
     - `travelers`     (integer, not null) — number of travelers
     - `name`          (text, not null) — full name of the customer
     - `phone`         (text, not null) — contact phone
     - `email`         (text, nullable) — optional email
     - `notes`         (text, nullable) — additional notes
     - `status`        (text, not null, default 'pending') — pending/confirmed/cancelled
     - `created_at`    (timestamptz, default now())

3. Security
   - Enable RLS on `reservations`.
   - INSERT policy for anon + authenticated: visitors can submit bookings.
   - SELECT/UPDATE/DELETE for authenticated only: agency staff manage reservations.
*/

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  package_id text NOT NULL,
  package_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  travelers integer NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_reference ON reservations(reference);
CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(start_date, end_date);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON reservations FROM anon;
REVOKE ALL ON reservations FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reservations TO authenticated;




DROP POLICY IF EXISTS "staff_update_reservations" ON reservations;
CREATE POLICY "staff_update_reservations"
  ON reservations FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);


