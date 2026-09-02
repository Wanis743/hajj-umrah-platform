-- ============================================================================
-- The controls register earns its table.
--
-- `public.financial_controls` shipped in 20260822000016 with a primary key, an
-- agency column, RLS, and nothing else: no way to write to it but a raw INSERT
-- no client is granted, no history, no grant at all. It is the clearest example
-- of the thing this platform was told to stop doing -- a table that exists so a
-- feature can be called implemented.
--
-- This migration finishes it, and finishing it means four things, not one:
--
--   1. The register describes a control: who owns it, how often it is tested,
--      and when it last was. A row that says only `FC-01` is a name, not a
--      control.
--   2. The tests are kept. The register carries the latest result because that
--      is what a person opens it to see; `financial_control_tests` carries every
--      result, because a control tested once in March and never since is a
--      different fact from a control tested monthly, and the register alone
--      cannot tell them apart.
--   3. The write path is three commands, not table privileges. Same reason as
--      everywhere else in this schema: the latest-result columns and the history
--      row have to move together or the register starts lying.
--   4. The table is granted. There is no GRANT anywhere in 20260822000016, and
--      the blanket `grant ... on public.%I` loops that cover the older tables all
--      ran in March against a list that did not include this one. A point-in-time
--      grant does not reach a table created five months later, so today every
--      PostgREST read of this table fails with permission denied -- which is why
--      the register has never been read by anything.
--
-- Idempotent throughout: every object is created `if not exists` or `or replace`,
-- and the one destructive step (dropping a wrong unique constraint) looks the
-- constraint up by shape rather than trusting a generated name.
-- ============================================================================

-- ============================================================================
-- A. The register itself.
--
--    A.1 The unique constraint is wrong and has to go.
--
--        `control_code TEXT NOT NULL UNIQUE` is unique across the whole table,
--        and the table is multi-tenant. Two agencies cannot both run a control
--        called `FC-01`, which every agency's first control is called. The second
--        agency to try gets a duplicate-key error naming a row it is not allowed
--        by RLS to see.
--
--        Replaced with `(agency_id, control_code)`. That is strictly weaker, so
--        it cannot reject a row the old constraint accepted -- the migration
--        cannot fail on existing data.
--
--        The constraint is found by shape, not by name. `financial_controls_
--        control_code_key` is what PostgreSQL would have generated, and a
--        database that has been through a restore or a rename may hold the same
--        constraint under a different one.
-- ============================================================================

do $fix_unique$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'financial_controls'
    and c.contype = 'u'
    and c.conkey = array[(
      select a.attnum from pg_attribute a
      where a.attrelid = t.oid and a.attname = 'control_code'
    )]::smallint[]
  limit 1;

  if v_name is not null then
    execute format('alter table public.financial_controls drop constraint %I', v_name);
    raise notice 'dropped single-column unique constraint % on financial_controls', v_name;
  end if;
end
$fix_unique$;

do $add_unique$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_controls'::regclass
      and conname = 'financial_controls_agency_code_key'
  ) then
    alter table public.financial_controls
      add constraint financial_controls_agency_code_key unique (agency_id, control_code);
  end if;
end
$add_unique$;

-- A.2 The columns that make a row a control.
--
--     `owner_role` is text and not a foreign key to a role table on purpose: it
--     is answering "whose job is this", and the honest answer is sometimes a
--     role this schema knows (`FINANCE`) and sometimes a person's title that it
--     does not. A null owner is allowed and means unassigned, which is a real
--     state a register has to be able to hold.
--
--     `frequency` defaults to monthly because that is what an untested control
--     most likely should be, and because a null frequency makes "overdue"
--     uncomputable.

alter table public.financial_controls add column if not exists owner_role      text;
alter table public.financial_controls add column if not exists frequency       text not null default 'monthly';
alter table public.financial_controls add column if not exists last_tested_at  timestamptz;
alter table public.financial_controls add column if not exists last_result     text;

-- A.3 The vocabularies.
--
--     Added `not valid` so the migration cannot fail on a row that predates the
--     rule, then validated separately: on a database where the existing rows do
--     conform, validation succeeds and the constraint is fully enforced; where
--     one does not, the constraint still governs every future write and the
--     validation failure is a notice rather than a broken replay.
--
--     `status` is left as the table shipped it -- default 'active', no NOT NULL --
--     and the check tolerates null for the same reason.

do $checks$
declare
  v_check record;
begin
  for v_check in
    select * from (values
      ('financial_controls_status_chk',
       $c$status is null or status in ('active', 'retired')$c$),
      ('financial_controls_frequency_chk',
       $c$frequency in ('monthly', 'quarterly', 'annual', 'ad_hoc')$c$),
      ('financial_controls_last_result_chk',
       $c$last_result is null or last_result in ('passed', 'failed', 'partial')$c$)
    ) as t(name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.financial_controls'::regclass and conname = v_check.name
    ) then
      execute format('alter table public.financial_controls add constraint %I check (%s) not valid',
                     v_check.name, v_check.expr);
      begin
        execute format('alter table public.financial_controls validate constraint %I', v_check.name);
      exception when check_violation then
        raise notice 'constraint % holds for new rows; existing rows do not all satisfy it', v_check.name;
      end;
    end if;
  end loop;
end
$checks$;

create index if not exists idx_financial_controls_agency_status
  on public.financial_controls(agency_id, status);

-- ============================================================================
-- B. The history.
--
--    One row per test performed. This is the table that makes the register mean
--    something: `last_result = 'passed'` is worth nothing without the date beside
--    it and the eleven tests behind it.
--
--    `tested_by` and `tested_by_email` are both stored, the same pair
--    `audit_logs` keeps. The uid is what the scope check was made against; the
--    e-mail is what a reader recognises. Joining `auth.users` from the client is
--    not an option -- PostgREST cannot read that schema -- so the e-mail is
--    denormalised at write time or it is unavailable forever.
--
--    `population` and `exceptions` are text, and stay text. They are descriptions
--    of what was tested and what was wrong with it -- "all 412 entries in period
--    2026-08", "3 postings with no attachment" -- not counts. The dead
--    `src/platform/treasury/treasuryService.ts` types them `number`, which is one
--    of the three ways that file contradicts the DDL it claims to read.
-- ============================================================================

create table if not exists public.financial_control_tests (
  agency_id        uuid not null default public.current_staff_agency_id(),
  id               uuid primary key default gen_random_uuid(),
  control_id       uuid not null references public.financial_controls(id) on delete cascade,
  tested_at        timestamptz not null default now(),
  tested_by        uuid,
  tested_by_email  text,
  result           text not null,
  population       text,
  exceptions       text,
  note             text,
  created_at       timestamptz not null default now()
);

do $test_checks$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_control_tests'::regclass
      and conname = 'financial_control_tests_result_chk'
  ) then
    alter table public.financial_control_tests
      add constraint financial_control_tests_result_chk
      check (result in ('passed', 'failed', 'partial'));
  end if;
end
$test_checks$;

-- Newest first is the only order this table is ever read in.
create index if not exists idx_control_tests_control_at
  on public.financial_control_tests(control_id, tested_at desc);
create index if not exists idx_control_tests_agency
  on public.financial_control_tests(agency_id, tested_at desc);

alter table public.financial_control_tests enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'financial_control_tests' and p.polname = 'Zero ANY on financial_control_tests'
  ) then
    create policy "Zero ANY on financial_control_tests" on public.financial_control_tests
      for all using (agency_id = public.current_staff_agency_id())
      with check (agency_id = public.current_staff_agency_id());
  end if;
end
$policy$;

drop trigger if exists trg_audit_financial_control_tests on public.financial_control_tests;
create trigger trg_audit_financial_control_tests
  after insert or update or delete on public.financial_control_tests
  for each row execute function public.audit_financial_action();

-- ============================================================================
-- C. The grants.
--
--    Read to `authenticated`, filtered by the policies above. No insert, update
--    or delete: the three commands in section E are the only write path, and a
--    client that could UPDATE the register directly could move `last_result`
--    without leaving a test row behind, which is the one thing this design is
--    for.
--
--    `financial_controls` is granted here for the first time in its life.
-- ============================================================================

grant select on public.financial_controls to authenticated;
grant select on public.financial_control_tests to authenticated;

-- ============================================================================
-- D. The guard.
--
--    Modelled on `private.spine_guard_handoff`: one function that answers "may
--    this caller act on this row, and is the row in a state that accepts the
--    act", and returns the row so the caller does not select it twice.
--
--    It checks the agency directly rather than calling
--    `public.row_in_staff_scope(agency_id, branch_id)`, and that is deliberate.
--    That helper requires a branch, and `financial_controls` has no branch
--    column -- passing null would make the comparison null, which coalesces to
--    false, which would lock every non-ADMIN staff member out of a table their
--    own RLS policy lets them read. A control register is an agency-level
--    artefact; the guard scopes it the way the table's own policy does.
-- ============================================================================

-- Created here as well as in the spine migration that replays before this one:
-- a migration that assumes a schema another file happens to have made first is
-- a migration that cannot be replayed alone.
create schema if not exists private;

create or replace function private.controls_guard(
  p_control_id  uuid,
  p_action      text,
  p_require_live boolean default false
)
returns public.financial_controls
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_row    public.financial_controls;
  v_agency uuid := public.current_staff_agency_id();
begin
  if v_agency is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if public.staff_role() <> 'ADMIN' and not public.has_permission('financial_controls', p_action) then
    raise exception 'Your role cannot % financial controls', p_action using errcode = '42501';
  end if;

  select * into v_row from public.financial_controls
  where id = p_control_id and agency_id = v_agency;

  if not found then
    raise exception 'Control not found' using errcode = 'P0002';
  end if;
  -- A retired control is kept, not deleted, so its history stays readable. What
  -- it stops accepting is new work: testing something the agency has stood down
  -- records an assurance nobody asked for.
  if p_require_live and coalesce(v_row.status, 'active') <> 'active' then
    raise exception 'Control % is retired', v_row.control_code using errcode = '22023';
  end if;

  return v_row;
end
$fn$;

revoke all on function private.controls_guard(uuid, text, boolean) from public, anon, authenticated;

-- ============================================================================
-- E. The write path.
--
--    Three commands, each `security definer`, each returning `jsonb` the client
--    can read without a second round trip, each auditing what it did, and each
--    revoked from `public` and `anon` before being granted to `authenticated`.
--    The shape is `public.complete_close_task`'s, deliberately: a reader who has
--    followed one command in this schema has followed all of them.
--
--    The guard is `stable` and therefore cannot take a row lock, so each command
--    re-states its scope in the UPDATE's own WHERE. That is not belt-and-braces:
--    it is what makes the retire command's second call fail instead of quietly
--    succeeding, because the UPDATE re-evaluates `status` under its own lock
--    rather than trusting what the guard read a statement earlier.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- E.1 Create or amend a control.
--
--     One command for both because the client has one form. `p_id` null means
--     create; a `p_id` means amend, and amending goes through the guard so a
--     caller cannot edit another agency's control by guessing a uuid.
--
--     Creating cannot go through the guard -- there is no row yet to scope -- so
--     the create path repeats the two checks the guard would have made. Written
--     out rather than factored into a third helper: two checks inline are easier
--     to audit than a helper whose only caller is this branch.
--
--     `frequency` is validated here with a sentence rather than being left to the
--     CHECK constraint. `new row for relation "financial_controls" violates check
--     constraint "financial_controls_frequency_chk"` is a true statement that
--     tells the person typing into the form nothing they can act on.
-- ----------------------------------------------------------------------------

create or replace function public.upsert_financial_control_command(
  p_id           uuid    default null,
  p_control_code text    default null,
  p_description  text    default null,
  p_owner_role   text    default null,
  p_frequency    text    default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_agency    uuid := public.current_staff_agency_id();
  v_code      text := btrim(coalesce(p_control_code, ''));
  v_freq      text := lower(btrim(coalesce(p_frequency, 'monthly')));
  v_owner     text := nullif(btrim(coalesce(p_owner_role, '')), '');
  v_desc      text := nullif(btrim(coalesce(p_description, '')), '');
  v_row       public.financial_controls;
  v_created   boolean := p_id is null;
begin
  if v_agency is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if v_code = '' then
    raise exception 'A control needs a code' using errcode = '22023';
  end if;
  if v_freq not in ('monthly', 'quarterly', 'annual', 'ad_hoc') then
    raise exception 'Unknown test frequency: % (expected monthly, quarterly, annual or ad_hoc)', p_frequency
      using errcode = '22023';
  end if;

  if v_created then
    if public.staff_role() <> 'ADMIN' and not public.has_permission('financial_controls', 'create') then
      raise exception 'Your role cannot create financial controls' using errcode = '42501';
    end if;
    insert into public.financial_controls (agency_id, control_code, description, owner_role, frequency, status)
    values (v_agency, v_code, v_desc, v_owner, v_freq, 'active')
    returning * into v_row;
  else
    -- Discards the returned row on purpose: the UPDATE below re-reads it under a
    -- lock and returns the amended version, which is what the caller wants back.
    perform private.controls_guard(p_id, 'update');
    update public.financial_controls
       set control_code = v_code,
           description  = v_desc,
           owner_role   = v_owner,
           frequency    = v_freq
     where id = p_id and agency_id = v_agency
    returning * into v_row;
    if not found then
      raise exception 'Control not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_logs
    (action, resource, resource_id, user_email, details, actor_id, actor_role, agency_id, branch_id)
  values
    (case when v_created then 'CONTROL_CREATE' else 'CONTROL_AMEND' end,
     'financial_controls', v_row.id::text, auth.email(),
     jsonb_build_object('control_code', v_row.control_code, 'frequency', v_row.frequency,
                        'owner_role', v_row.owner_role),
     auth.uid(), public.staff_role(), v_agency, public.staff_branch_id());

  return jsonb_build_object(
    'success', true,
    'created', v_created,
    'id', v_row.id,
    'control_code', v_row.control_code,
    'frequency', v_row.frequency,
    'owner_role', v_row.owner_role,
    'status', coalesce(v_row.status, 'active')
  );
end
$fn$;

revoke all on function public.upsert_financial_control_command(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.upsert_financial_control_command(uuid, text, text, text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- E.2 Record a test.
--
--     The one command that justifies the whole design. It writes the history row
--     and moves the register's four latest-result columns in a single statement
--     pair inside one transaction, which is why the client is granted no UPDATE
--     on either table: a client that could write one without the other could
--     leave `last_result = 'passed'` above a history that says otherwise, and a
--     register that disagrees with its own evidence is worse than no register.
--
--     A `failed` result with nothing in `p_exceptions` is refused. "It failed"
--     with no statement of what failed is not a test result, it is a shrug, and
--     the person who reads this register in six months cannot act on a shrug.
--     `passed` and `partial` do not carry that rule -- a clean test genuinely has
--     nothing to say, and `partial` states its own caveat in the note.
--
--     The permission verb is `update`, not `create`. The history row is new, but
--     what the act does is move the register's assessment of a control, and that
--     is the thing being authorised. Seeding a separate verb per table would let
--     a role write history it cannot reflect in the register.
-- ----------------------------------------------------------------------------

create or replace function public.record_control_test_command(
  p_control_id  uuid,
  p_result      text,
  p_population  text default null,
  p_exceptions  text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_agency uuid := public.current_staff_agency_id();
  v_result text := lower(btrim(coalesce(p_result, '')));
  v_pop    text := nullif(btrim(coalesce(p_population, '')), '');
  v_exc    text := nullif(btrim(coalesce(p_exceptions, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_control public.financial_controls;
  v_test   public.financial_control_tests;
begin
  if v_result not in ('passed', 'failed', 'partial') then
    raise exception 'Unknown test result: % (expected passed, failed or partial)', p_result
      using errcode = '22023';
  end if;
  if v_result = 'failed' and v_exc is null then
    raise exception 'A failed test has to say what failed' using errcode = '22023';
  end if;

  -- Raises 42501 without the permission, P0002 for a control this agency has no
  -- row for, and 22023 for a retired one. `true` is the require-live flag.
  v_control := private.controls_guard(p_control_id, 'update', true);

  insert into public.financial_control_tests
    (agency_id, control_id, tested_by, tested_by_email, result, population, exceptions, note)
  values
    (v_control.agency_id, v_control.id, auth.uid(), nullif(auth.email(), ''),
     v_result, v_pop, v_exc, v_note)
  returning * into v_test;

  -- `test_population` and `exceptions` on the register are the shipped columns
  -- and are kept as the latest test's, so a reader of the register alone still
  -- sees what was last tested and what was last wrong with it.
  update public.financial_controls
     set last_tested_at  = v_test.tested_at,
         last_result     = v_test.result,
         test_population = v_test.population,
         exceptions      = v_test.exceptions
   where id = v_control.id and agency_id = v_agency
  returning * into v_control;
  if not found then
    raise exception 'Control not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs
    (action, resource, resource_id, user_email, details, actor_id, actor_role, agency_id, branch_id)
  values
    ('CONTROL_TEST', 'financial_controls', v_control.id::text, auth.email(),
     jsonb_build_object('control_code', v_control.control_code, 'result', v_test.result,
                        'test_id', v_test.id, 'exceptions', v_test.exceptions),
     auth.uid(), public.staff_role(), v_agency, public.staff_branch_id());

  return jsonb_build_object(
    'success', true,
    'id', v_test.id,
    'control_id', v_control.id,
    'control_code', v_control.control_code,
    'result', v_test.result,
    'tested_at', v_test.tested_at,
    'last_result', v_control.last_result
  );
end
$fn$;

revoke all on function public.record_control_test_command(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.record_control_test_command(uuid, text, text, text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- E.3 Retire a control.
--
--     Retiring is not deleting. The row stays, its history stays readable, and
--     what changes is that it stops accepting tests -- which is exactly what the
--     guard's require-live flag enforces for E.2.
--
--     The reason is mandatory and goes into the audit trail rather than into a
--     column on the register. A register lists the controls an agency runs; why
--     it stopped running one is a fact about a decision, and decisions live in
--     `audit_logs` throughout this schema.
--
--     `coalesce(status, 'active') = 'active'` in the UPDATE's own WHERE is what
--     makes a second retire raise instead of silently rewriting the same value:
--     the guard's read is `stable` and unlocked, so two concurrent calls can both
--     pass it, and only the UPDATE sees the other one's commit.
-- ----------------------------------------------------------------------------

create or replace function public.retire_financial_control_command(
  p_control_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_agency  uuid := public.current_staff_agency_id();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_control public.financial_controls;
begin
  if v_reason is null then
    raise exception 'Retiring a control needs a reason' using errcode = '22023';
  end if;

  v_control := private.controls_guard(p_control_id, 'update', true);

  update public.financial_controls
     set status = 'retired'
   where id = v_control.id
     and agency_id = v_agency
     and coalesce(status, 'active') = 'active'
  returning * into v_control;
  if not found then
    raise exception 'Control % is already retired', p_control_id using errcode = '22023';
  end if;

  insert into public.audit_logs
    (action, resource, resource_id, user_email, details, actor_id, actor_role, agency_id, branch_id)
  values
    ('CONTROL_RETIRE', 'financial_controls', v_control.id::text, auth.email(),
     jsonb_build_object('control_code', v_control.control_code, 'reason', v_reason,
                        'last_result', v_control.last_result,
                        'last_tested_at', v_control.last_tested_at),
     auth.uid(), public.staff_role(), v_agency, public.staff_branch_id());

  return jsonb_build_object(
    'success', true,
    'id', v_control.id,
    'control_code', v_control.control_code,
    'status', v_control.status
  );
end
$fn$;

revoke all on function public.retire_financial_control_command(uuid, text) from public, anon;
grant execute on function public.retire_financial_control_command(uuid, text) to authenticated;

-- ============================================================================
-- F. The permissions.
--
--    `public.has_permission` is ADMIN-true and otherwise a lookup in
--    `public.staff_permissions (role, resource, action)`, so a verb nobody has
--    been seeded for is ADMIN-only. That default is used deliberately twice here,
--    and both silences are written down so neither reads as an omission.
--
--    Read goes to all six non-ADMIN roles. A control register is a statement of
--    how an agency checks its own money, and an OPERATIONS_MANAGER who cannot see
--    that the bank reconciliation control has not been tested since March is the
--    person the register exists to inform. Nothing in it is a secret from staff.
--
--    Create and update go to FINANCE alone. Recording that a control passed is
--    signing an assurance; the finance desk owns that signature, and a GUIDE or a
--    VISA_AGENT recording one is not a workflow anybody asked for. ADMIN keeps
--    both verbs through the ADMIN-true branch, which is what makes the register
--    usable on day one, before an agency has staffed a finance role.
--
--    Delete is unseeded and therefore ADMIN-only, and there is no command for it
--    at all. Retiring is the intended end of a control's life: it keeps the row
--    and its history readable. Deleting one takes every test ever performed
--    against it with it, through `on delete cascade`, and destroys the evidence
--    the register was built to hold.
-- ============================================================================

do $seed$
declare
  v_role   text;
  v_target text;
  v_action text;
begin
  if to_regclass('public.staff_permissions') is null then
    raise notice 'staff_permissions is absent; controls-register permissions were not seeded';
    return;
  end if;

  foreach v_target in array array['financial_controls', 'financial_control_tests'] loop
    foreach v_role in array array['FINANCE', 'OPERATIONS_MANAGER', 'CRM', 'AGENT', 'VISA_AGENT', 'GUIDE'] loop
      insert into public.staff_permissions (role, resource, action)
      values (v_role, v_target, 'read')
      on conflict (role, resource, action) do nothing;
    end loop;

    foreach v_action in array array['create', 'update'] loop
      insert into public.staff_permissions (role, resource, action)
      values ('FINANCE', v_target, v_action)
      on conflict (role, resource, action) do nothing;
    end loop;
  end loop;
end
$seed$;
