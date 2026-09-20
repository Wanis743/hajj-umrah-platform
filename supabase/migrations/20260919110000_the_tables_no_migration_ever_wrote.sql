-- The tables no migration ever wrote.
--
-- Five tables exist in the live database and in no migration file:
-- bank_reconciliations, bank_statement_lines, hajj_timeline_events,
-- notification_preferences, support_tickets. They were created by hand at some
-- point and the source tree never learned about them.
--
-- This went unnoticed because nothing in the migrations referenced them as
-- relations. 20260919090000 named all five, but only inside string literals and
-- a pg_policies lookup, which the order-aware verifier does not resolve. The
-- follow-on that writes real policies on them does reference them, and
-- verify:migrations refused it with twenty "altered or referenced but no
-- migration ever creates it" errors. The verifier was right, and it was right
-- about a pre-existing hole rather than about the new file: a database rebuilt
-- from migrations alone has never had these tables, so every gate that replays
-- from scratch has been silently testing a smaller schema than production runs.
--
-- The definitions below are transcribed from the live catalog -- columns in
-- ordinal order with their real types, defaults and nullability; the primary
-- keys, foreign keys, check constraints and unique constraints as
-- pg_get_constraintdef prints them; the indexes as pg_indexes prints them; and
-- the grants as relacl holds them. Nothing here is designed. Where live looks
-- wrong it is transcribed wrong on purpose, because the job of this file is to
-- make source match production, not to change production:
--
--   * agency_id and branch_id on the three tenant tables carry NO foreign key to
--     agencies or branches, though every other table in this schema does. They
--     are bare uuids.
--   * notification_preferences.user_id has no foreign key to auth.users either,
--     so a deleted user leaves its preferences behind.
--   * support_tickets has no agency_id at all and its pilgrim_id is NULLABLE, so
--     a ticket can exist attached to no pilgrim and therefore to no tenant. That
--     is what forces the follow-on migration to scope it through a definer
--     helper and to answer false for a NULL pilgrim.
--   * support_tickets alone grants authenticated SELECT only, where the other
--     four grant the full arwdDxtm.
--
-- Each of those is worth fixing and none of them is fixed here. Adding a foreign
-- key to a live table takes a validating scan and can fail on existing data; all
-- five happen to be empty today, but that makes it a cheap change to schedule,
-- not a safe one to smuggle into a file whose stated purpose is transcription.
--
-- IF NOT EXISTS everywhere: against production every statement here is a no-op,
-- which is the point -- this file must be applicable to the database it was
-- copied from. That also means the CREATEs prove nothing when applied live, so
-- the gate at the bottom does the actual work. It reads the live catalog back
-- and asserts, column by column, that what this file declares is what is there.
-- Without it this migration would be a plausible-looking description that could
-- drift from reality without anything noticing -- which is precisely the state
-- it exists to end.

-- ---------------------------------------------------------------------------
-- 1. Finance: reconciliation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         uuid NOT NULL,
  branch_id         uuid,
  bank_account_id   uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  status            text NOT NULL DEFAULT 'OPEN'
                      CHECK (status = ANY (ARRAY['OPEN','IN_REVIEW','RECONCILED','LOCKED'])),
  book_balance      numeric(18,2) NOT NULL DEFAULT 0,
  statement_balance numeric(18,2) NOT NULL DEFAULT 0,
  difference        numeric(18,2) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reconciled_at     timestamptz,
  reconciled_by     uuid
);

-- Live spells this index singular ("reconciliation") while the table is plural.
-- Transcribed as found: renaming it here would drop and recreate an index in a
-- file that is supposed to change nothing.
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_status
  ON public.bank_reconciliations USING btree (bank_account_id, status, period_end);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id          uuid NOT NULL,
  branch_id          uuid,
  bank_account_id    uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  statement_date     date NOT NULL,
  reference          text,
  description        text,
  amount             numeric(18,2) NOT NULL,
  currency_code      text NOT NULL REFERENCES public.currencies(code),
  matched            boolean NOT NULL DEFAULT false,
  matched_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_currency
  ON public.bank_statement_lines USING btree (currency_code);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_matched_payment
  ON public.bank_statement_lines USING btree (matched_payment_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_unmatched
  ON public.bank_statement_lines USING btree (bank_account_id, matched, statement_date);

-- ---------------------------------------------------------------------------
-- 2. Operations: the Hajj timeline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hajj_timeline_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id        uuid NOT NULL,
  branch_id        uuid,
  group_id         uuid REFERENCES public.groups(id) ON DELETE RESTRICT,
  stage            text NOT NULL,
  planned_at       timestamptz,
  actual_at        timestamptz,
  responsible_user uuid,
  status           text NOT NULL DEFAULT 'PLANNED'
                     CHECK (status = ANY (ARRAY['PLANNED','ACTIVE','COMPLETED','DELAYED','CANCELLED'])),
  dependencies     jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hajj_timeline_group_time
  ON public.hajj_timeline_events USING btree (group_id, planned_at);

-- ---------------------------------------------------------------------------
-- 3. Per-user notification settings. No tenant column, by design: these belong
--    to a person, not an agency.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  channel    text NOT NULL,
  event_type text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, channel, event_type)
);

-- ---------------------------------------------------------------------------
-- 4. Support tickets. Note what is missing: no agency_id, no branch_id, and a
--    nullable pilgrim_id -- the only link to a tenant is optional.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilgrim_id  uuid REFERENCES public.pilgrims(id),
  category    text NOT NULL,
  priority    text DEFAULT 'NORMAL',
  status      text DEFAULT 'OPEN',
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_pilgrim_id
  ON public.support_tickets USING btree (pilgrim_id);

-- ---------------------------------------------------------------------------
-- 5. RLS and grants. Both are idempotent, and both matter on a fresh replay:
--    a table created without them would be either wide open or unreachable,
--    and the policy migration that follows assumes exactly these grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_reconciliations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hajj_timeline_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets          ENABLE ROW LEVEL SECURITY;

-- anon is named in no grant below, and holds nothing on these five live. That is
-- stated rather than assumed because the default ACL on this database has handed
-- anon arwdDxtm before (20260906 closed that), and because RLS does not stop
-- TRUNCATE -- a table grant is the only thing that does.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.bank_reconciliations, public.bank_statement_lines,
     public.hajj_timeline_events, public.notification_preferences
  TO authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.bank_reconciliations, public.bank_statement_lines,
     public.hajj_timeline_events, public.notification_preferences,
     public.support_tickets
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The gate. Against production the statements above changed nothing, so this
--    is the only part of the file that can fail, and it is what makes the file
--    a claim about reality rather than a description of it.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
  -- table | column | udt | nullable, in ordinal order, read from the live
  -- catalog while writing this file.
  v_expected text[] := ARRAY[
    'bank_reconciliations|id|uuid|NO',
    'bank_reconciliations|agency_id|uuid|NO',
    'bank_reconciliations|branch_id|uuid|YES',
    'bank_reconciliations|bank_account_id|uuid|NO',
    'bank_reconciliations|period_start|date|NO',
    'bank_reconciliations|period_end|date|NO',
    'bank_reconciliations|status|text|NO',
    'bank_reconciliations|book_balance|numeric|NO',
    'bank_reconciliations|statement_balance|numeric|NO',
    'bank_reconciliations|difference|numeric|NO',
    'bank_reconciliations|created_at|timestamptz|NO',
    'bank_reconciliations|reconciled_at|timestamptz|YES',
    'bank_reconciliations|reconciled_by|uuid|YES',
    'bank_statement_lines|id|uuid|NO',
    'bank_statement_lines|agency_id|uuid|NO',
    'bank_statement_lines|branch_id|uuid|YES',
    'bank_statement_lines|bank_account_id|uuid|NO',
    'bank_statement_lines|statement_date|date|NO',
    'bank_statement_lines|reference|text|YES',
    'bank_statement_lines|description|text|YES',
    'bank_statement_lines|amount|numeric|NO',
    'bank_statement_lines|currency_code|text|NO',
    'bank_statement_lines|matched|bool|NO',
    'bank_statement_lines|matched_payment_id|uuid|YES',
    'bank_statement_lines|created_at|timestamptz|NO',
    'hajj_timeline_events|id|uuid|NO',
    'hajj_timeline_events|agency_id|uuid|NO',
    'hajj_timeline_events|branch_id|uuid|YES',
    'hajj_timeline_events|group_id|uuid|YES',
    'hajj_timeline_events|stage|text|NO',
    'hajj_timeline_events|planned_at|timestamptz|YES',
    'hajj_timeline_events|actual_at|timestamptz|YES',
    'hajj_timeline_events|responsible_user|uuid|YES',
    'hajj_timeline_events|status|text|NO',
    'hajj_timeline_events|dependencies|jsonb|NO',
    'hajj_timeline_events|notes|text|YES',
    'hajj_timeline_events|created_at|timestamptz|NO',
    'notification_preferences|id|uuid|NO',
    'notification_preferences|user_id|uuid|NO',
    'notification_preferences|channel|text|NO',
    'notification_preferences|event_type|text|NO',
    'notification_preferences|enabled|bool|NO',
    'support_tickets|id|uuid|NO',
    'support_tickets|pilgrim_id|uuid|YES',
    'support_tickets|category|text|NO',
    'support_tickets|priority|text|YES',
    'support_tickets|status|text|YES',
    'support_tickets|description|text|YES',
    'support_tickets|created_at|timestamptz|YES'
  ];
  v_tables text[] := ARRAY['bank_reconciliations','bank_statement_lines',
                           'hajj_timeline_events','notification_preferences','support_tickets'];
  v_actual text[];
  v_missing text; v_extra text; v_t text; v_n int;
BEGIN
  SELECT array_agg(c.table_name || '|' || c.column_name || '|' || c.udt_name || '|' || c.is_nullable
                   ORDER BY c.table_name, c.ordinal_position)
    INTO v_actual
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = ANY(v_tables);

  -- A. Set equality both ways, reported separately: "declared but absent" and
  --    "present but undeclared" are different bugs and a count would hide which.
  SELECT string_agg(e, ', ') INTO v_missing
    FROM unnest(v_expected) e WHERE e <> ALL(v_actual);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'gate A: this file declares columns the database does not have: %', v_missing;
  END IF;
  SELECT string_agg(a, ', ') INTO v_extra
    FROM unnest(v_actual) a WHERE a <> ALL(v_expected);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'gate A: the database has columns this file does not declare: % -- '
                    'the transcription is stale, update it rather than widening this gate', v_extra;
  END IF;

  -- B. Ordinal order too. Set equality would accept a table whose columns are
  --    the same but arranged differently, and a fresh replay would then build a
  --    subtly different table from the one production runs.
  IF v_actual IS DISTINCT FROM (SELECT array_agg(e ORDER BY ord)
                                  FROM unnest(v_expected) WITH ORDINALITY AS t(e, ord)) THEN
    RAISE EXCEPTION 'gate B: the columns match as a set but not in order';
  END IF;

  -- C. RLS on. Deliberately NOT "and has a policy": on a fresh replay these
  --    tables are created here and their policies arrive in the next migration,
  --    so between the two files they legitimately deny everything. Asserting a
  --    policy here would fail the very rebuild this file exists to make possible.
  --    The next migration's gate B is where coverage is actually proven; if that
  --    file is ever removed, these five tables go dark and nothing here notices.
  FOREACH v_t IN ARRAY v_tables LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = v_t) THEN
      RAISE EXCEPTION 'gate C: RLS is not enabled on %', v_t;
    END IF;
  END LOOP;

  -- D. The grants the next migration's policies depend on, and the one that must
  --    NOT appear. A policy cannot stop a role that was never meant to hold the
  --    table, and anon holding these would not be visible in any policy listing.
  FOREACH v_t IN ARRAY v_tables LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION 'gate D: authenticated cannot SELECT % -- its policies would be dead letters', v_t;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'gate D: anon holds a grant on % -- RLS does not stop TRUNCATE', v_t;
    END IF;
  END LOOP;

  RAISE NOTICE 'gates A-D passed: 5 tables transcribed, % columns matched in order, '
               'RLS on, authenticated granted, anon absent', array_length(v_expected, 1);
END;
$gate$;
