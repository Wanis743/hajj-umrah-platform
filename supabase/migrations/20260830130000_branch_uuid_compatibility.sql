-- ============================================================================
-- branch_uuid compatibility columns
--
-- Why this exists
-- ---------------
-- The scope columns added in 20260324000300 are named agency_id and branch_id on
-- every operational table. Only three tables ever received a column literally
-- named branch_uuid: staff_profiles (20260324000300), external_operations
-- (20260709003000) and external_references (20260805002500).
--
-- Several finance functions written later dereference `.branch_uuid` on rowtype
-- records of tables that never had the column:
--
--   private.post_payment_journal          p public.payments%rowtype   -> p.branch_uuid
--   public.post_payment_journal (older)   p public.payments%rowtype   -> p.branch_uuid
--   public.post_invoice_journal           i public.invoices%rowtype   -> i.branch_uuid
--   public.create_invoice_transaction     b public.bookings%rowtype   -> b.branch_uuid
--   public.create_invoice_transaction_v2  b public.bookings%rowtype   -> b.branch_uuid
--   public.reverse_payment_transaction    p public.payments%rowtype   -> p.branch_uuid
--   public.post_reversal_journal          r payment_reversals%rowtype -> r.branch_uuid
--
-- In PL/pgSQL a missing field on a rowtype record is not a parse error; it is a
-- runtime one: 42703 `record "p" has no field "branch_uuid"`. Every one of those
-- functions therefore fails on its first call. That is not a cosmetic defect --
-- it means no payment could post a journal entry and no invoice could be issued,
-- and it silently blocks the CRM money path (accept_crm_quote records the payment
-- and then calls private.post_payment_journal).
--
-- Two ways to fix it: edit ~37 call sites spread across eight historical
-- migrations, or give the tables the column those bodies expect. The second is
-- chosen here because it is one statement per table, it cannot miss a call site,
-- and it survives a later `create or replace` that reintroduces the old body from
-- an older file.
--
-- The column is GENERATED ALWAYS AS (branch_id) STORED, so:
--   * it can never disagree with branch_id -- `coalesce(x.branch_id, x.branch_uuid)`
--     is now exactly `x.branch_id`, which is what those functions meant;
--   * no write path has to know it exists. Both generic command helpers skip
--     generated columns (insert_scoped_command_row filters on attgenerated = '',
--     patch_scoped_command_row on is_generated = 'NEVER'), and a direct client
--     INSERT that named it would be refused by Postgres rather than accepted with
--     a wrong value.
--
-- payment_reversals is deliberately absent from the loop below: no migration in
-- this repository ever creates that table, so public.reverse_payment_transaction
-- and public.post_reversal_journal remain dead until it is built. Adding a column
-- to a table that does not exist would only hide that.
-- ============================================================================

do $$
declare
  tbl        text;
  v_relid    oid;
  v_branch   text;
begin
  foreach tbl in array array['payments','bookings','invoices','reservations'] loop
    v_relid := to_regclass('public.' || tbl);
    if v_relid is null then
      raise notice 'branch_uuid compatibility: table public.% is absent, skipped', tbl;
      continue;
    end if;

    -- Already present (staff_profiles-style real column, or a rerun of this
    -- migration): leave it exactly as it is.
    if exists (
      select 1 from pg_attribute
       where attrelid = v_relid and attname = 'branch_uuid' and attnum > 0 and not attisdropped
    ) then
      continue;
    end if;

    -- branch_id must exist and be uuid; mirroring a text column would produce a
    -- type the finance functions cannot pass to row_in_staff_scope(uuid, uuid).
    select format_type(atttypid, atttypmod) into v_branch
      from pg_attribute
     where attrelid = v_relid and attname = 'branch_id' and attnum > 0 and not attisdropped;

    if v_branch is null then
      raise notice 'branch_uuid compatibility: public.% has no branch_id, skipped', tbl;
      continue;
    end if;
    if v_branch <> 'uuid' then
      raise notice 'branch_uuid compatibility: public.%.branch_id is % (not uuid), skipped', tbl, v_branch;
      continue;
    end if;

    execute format(
      'alter table public.%I add column branch_uuid uuid generated always as (branch_id) stored',
      tbl);
    raise notice 'branch_uuid compatibility: added public.%.branch_uuid', tbl;
  end loop;
end $$;

-- No new index is created here. branch_uuid is a stored mirror of branch_id, and
-- every one of these tables already carries idx_<table>_agency_branch on
-- (agency_id, branch_id) from 20260324000300; a second index on the copy would
-- cost writes and answer nothing new. The guarded
-- `create index ... on public.reservations(branch_uuid)` blocks in
-- 20260331100100 and 20260406182200 ran before this migration and correctly did
-- nothing; they are left untouched rather than backfilled.
