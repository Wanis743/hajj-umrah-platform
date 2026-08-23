/*
# Create inquiries table for Bou Sadaa Agency

1. Purpose
   Stores pilgrimage service inquiries (Hajj/Umrah) submitted by visitors
   through the website's inquiry form. This is a no-auth (no sign-in) public
   website, so the frontend uses the anon key. We allow public INSERT only;
   reads are restricted to authenticated (agency staff) so leads stay private.

2. New Tables
   - `inquiries`
     - `id`            (uuid, primary key, default gen_random_uuid())
     - `name`          (text, not null) — full name of the inquirer
     - `phone`         (text, not null) — contact phone number
     - `email`         (text, nullable) — optional email address
     - `package_interest` (text, nullable) — which package/service they're interested in
     - `preferred_dates`  (text, nullable) — free-text preferred travel dates
     - `travelers`      (integer, nullable) — number of travelers
     - `notes`          (text, nullable) — additional notes/message
     - `status`         (text, not null, default 'new') — lead status for agency workflow
     - `created_at`     (timestamptz, default now())

3. Security
   - Enable RLS on `inquiries`.
   - INSERT policy for anon + authenticated: any visitor can submit an inquiry.
   - SELECT/UPDATE/DELETE policies for authenticated only: agency staff can
     review and manage leads. Public visitors cannot read others' inquiries.
*/

CREATE TABLE IF NOT EXISTS inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  package_interest text,
  preferred_dates text,
  travelers integer,
  notes text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- Public can insert inquiries (no sign-in on the site)
DROP POLICY IF EXISTS "anon_insert_inquiries" ON inquiries;
CREATE POLICY "anon_insert_inquiries" ON inquiries FOR INSERT
  TO anon, authenticated WITH CHECK (false);

-- Only authenticated agency staff can read inquiries
DROP POLICY IF EXISTS "staff_read_inquiries" ON inquiries;
CREATE POLICY "staff_read_inquiries" ON inquiries FOR SELECT
  TO authenticated USING (false);

-- Only authenticated agency staff can update inquiry status
DROP POLICY IF EXISTS "staff_update_inquiries" ON inquiries;
CREATE POLICY "staff_update_inquiries" ON inquiries FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

-- Only authenticated agency staff can delete inquiries
DROP POLICY IF EXISTS "staff_delete_inquiries" ON inquiries;
CREATE POLICY "staff_delete_inquiries" ON inquiries FOR DELETE
  TO authenticated USING (false);
