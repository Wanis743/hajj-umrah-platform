-- ============================================================================
-- CRM lifecycle contracts.
--
--     node scripts/run-sql-gate.mjs supabase/tests/crm_lifecycle.sql
--     npm run verify:crm
--
-- Two halves, and they check different kinds of thing.
--
-- Part 1 reads the catalog. It is what stops a policy, a revoke, a pinned
-- search_path, a check constraint or a grant from disappearing in a later
-- migration -- the regressions that reopen a hole without changing any visible
-- behaviour. These evaluate on any database carrying the schema.
--
-- Part 2 drives the lifecycle for real inside `begin ... rollback`, so the
-- triggers, the generated column, the numeric rounding and the constraints are
-- exercised by actual rows and none of them survive the suite. It creates a
-- disposable auth.users row, a CRM staff profile and a JWT claim of its own, so
-- the commands are authorized the way a real session is authorized -- by RBAC
-- rows -- rather than by whatever the harness happens to be. It never asserts
-- anything about RLS, because the fresh-database harness is a superuser and row
-- security would be bypassed there. RLS is Part 1's job, from the catalog, where
-- the question can be answered honestly.
--
-- Part 3 runs after the rollback and checks that none of it survived.
--
-- Every check emits `check_name, pass`. run-sql-gate.mjs fails the process on a
-- false or NULL pass, and fails a suite that asserted nothing at all. Part 2
-- reports by raising instead: an exception under ON_ERROR_STOP=1 fails the gate
-- just as hard, and inside a PL/pgSQL block it can say which step broke.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Part 1a. The nine tables exist, carry RLS, and are forced through it.
-- ---------------------------------------------------------------------------
with expected(t) as (
  values ('crm_leads'),('crm_campaigns'),('crm_customers'),('crm_opportunities'),
         ('crm_stage_history'),('crm_quotes'),('crm_quote_lines'),('crm_activities'),
         ('crm_followups')
)
select 'crm_tables_exist' as check_name,
       count(*) = 9 as pass,
       count(*) as found
from expected e
join pg_class c on c.relname = e.t
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public';

with expected(t) as (
  values ('crm_leads'),('crm_campaigns'),('crm_customers'),('crm_opportunities'),
         ('crm_stage_history'),('crm_quotes'),('crm_quote_lines'),('crm_activities'),
         ('crm_followups')
)
select 'crm_rls_enabled_on_every_table' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(c.relname, ', '), '') as offenders
from expected e
join pg_class c on c.relname = e.t
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relrowsecurity = false;

-- ---------------------------------------------------------------------------
-- Part 1b. Anonymous callers have no privilege on any CRM table. Checked per
-- privilege rather than per table, so a stray `grant select` on one of them is
-- named in the failure instead of hiding inside a count.
-- ---------------------------------------------------------------------------
with tables(t) as (
  values ('crm_leads'),('crm_campaigns'),('crm_customers'),('crm_opportunities'),
         ('crm_stage_history'),('crm_quotes'),('crm_quote_lines'),('crm_activities'),
         ('crm_followups')
), privs(p) as (
  values ('select'),('insert'),('update'),('delete')
)
select 'crm_anon_has_no_table_privilege' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(t || '.' || p, ', '), '') as offenders
from tables cross join privs
where has_table_privilege('anon', 'public.' || t, p);

-- ---------------------------------------------------------------------------
-- Part 1c. Four policies per table, each scoped through row_in_staff_scope --
-- except crm_stage_history, which is an append-only ledger and must have no
-- update or delete path at all.
-- ---------------------------------------------------------------------------
with tables(t) as (
  values ('crm_campaigns'),('crm_customers'),('crm_opportunities'),
         ('crm_quotes'),('crm_quote_lines'),('crm_activities'),('crm_followups')
)
select 'crm_four_scoped_policies_per_table' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(t || '=' || n::text, ', '), '') as offenders
from (
  select t, (select count(*) from pg_policies p
              where p.schemaname = 'public' and p.tablename = t
                and (coalesce(p.qual,'') || coalesce(p.with_check,'')) like '%row_in_staff_scope%') as n
  from tables
) counted
where n <> 4;

select 'crm_stage_history_is_append_only' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(policyname || ':' || cmd, ', '), '') as offenders
from pg_policies
where schemaname = 'public' and tablename = 'crm_stage_history'
  and cmd in ('UPDATE','DELETE');

select 'crm_stage_history_no_write_grant' as check_name,
       not (has_table_privilege('authenticated','public.crm_stage_history','update')
         or has_table_privilege('authenticated','public.crm_stage_history','delete')
         or has_table_privilege('authenticated','public.crm_stage_history','truncate')) as pass;

-- ---------------------------------------------------------------------------
-- Part 1d. Every table stamps its own scope. Without this trigger a client
-- controls agency_id, and every policy above is decoration.
-- ---------------------------------------------------------------------------
with tables(t) as (
  values ('crm_campaigns'),('crm_customers'),('crm_opportunities'),('crm_stage_history'),
         ('crm_quotes'),('crm_quote_lines'),('crm_activities'),('crm_followups')
)
select 'crm_scope_stamp_trigger_present' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(t, ', '), '') as offenders
from tables
where not exists (
  select 1 from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_proc p on p.oid = tg.tgfoid
  where c.relname = t and p.proname = 'stamp_staff_scope' and not tg.tgisinternal
);

-- ---------------------------------------------------------------------------
-- Part 1e. The private lifecycle bodies are reachable only through their public
-- wrappers. A direct grant on one of them would let a client skip the wrapper.
-- ---------------------------------------------------------------------------
with fns(sig) as (
  values ('private.convert_crm_lead(uuid,uuid,integer,numeric,date,text)'),
         ('private.move_crm_opportunity_stage(uuid,text,text,text)'),
         ('private.send_crm_quote(uuid,integer)'),
         ('private.decline_crm_quote(uuid,text)'),
         ('private.accept_crm_quote(uuid,numeric,numeric,text,uuid,text,text)')
), roles(r) as (values ('anon'),('authenticated'))
select 'crm_private_bodies_not_executable' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(r || ' -> ' || sig, ', '), '') as offenders
from fns cross join roles
where has_function_privilege(r, sig, 'execute');

-- ---------------------------------------------------------------------------
-- Part 1f. The public command and read surface: executable by a signed-in
-- staff session, never by anon.
-- ---------------------------------------------------------------------------
with fns(sig) as (
  values ('public.convert_crm_lead_command(uuid,uuid,integer,numeric,date,text)'),
         ('public.transition_crm_opportunity_stage(uuid,text,text,text)'),
         ('public.send_crm_quote_command(uuid,integer)'),
         ('public.decline_crm_quote_command(uuid,text)'),
         ('public.accept_crm_quote_command(uuid,numeric,numeric,text,uuid,text,text)'),
         ('public.set_crm_customer_tags_command(uuid,text[])'),
         ('public.complete_crm_followup_command(uuid,text)'),
         ('public.get_crm_pipeline_summary(date,date)'),
         ('public.get_crm_forecast(integer)'),
         ('public.get_crm_funnel(date,date)'),
         ('public.get_crm_customer_360(uuid)'),
         ('public.get_crm_customer_profitability(date,date,integer)'),
         ('public.get_crm_campaign_roi(date,date)'),
         ('public.get_crm_dashboard(integer)')
)
select 'crm_commands_granted_to_authenticated_only' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(sig || ' auth=' || a::text || ' anon=' || n::text, ', '), '') as offenders
from (
  select sig,
         has_function_privilege('authenticated', sig, 'execute') as a,
         has_function_privilege('anon', sig, 'execute') as n
  from fns
) g
where a = false or n = true;

-- ---------------------------------------------------------------------------
-- Part 1g. Every CRM function is SECURITY DEFINER with a pinned search_path. A
-- definer function without one resolves unqualified names through the caller's
-- search_path, which is a privilege-escalation primitive, not a style problem.
-- ---------------------------------------------------------------------------
select 'crm_functions_are_definer_with_pinned_search_path' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '') as offenders
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.proname like '%crm%'
  and p.prokind = 'f'
  and (p.prosecdef = false
       or not exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
         where cfg like 'search_path=%'));

-- ---------------------------------------------------------------------------
-- Part 1h. The authorization helpers are total.
--
-- staff_role() used to return NULL for a caller with no active staff_profiles
-- row, which made `not has_permission(...) and staff_role() <> 'ADMIN'` NULL --
-- and `if NULL then raise` does not raise. About thirty definer commands across
-- the schema, CRM's five among them, were guarded by that expression. This is
-- the check that keeps them armed; see 20260830140000.
-- ---------------------------------------------------------------------------
select 'authz_helpers_are_total' as check_name,
       public.staff_role() is not null
   and public.has_permission('crm_quotes','update') is not null
   and public.row_in_staff_scope(gen_random_uuid(), gen_random_uuid()) is not null as pass;

-- The guard expression itself, verbatim from the call sites. `is not null` is
-- the whole property: a three-valued guard cannot decide, and an undecided
-- `if` falls through to the body it was supposed to protect. True for any
-- session, so this does not go vacuous when the harness happens to be staff.
select 'authz_guard_expression_is_never_null' as check_name,
       ((not public.has_permission('crm_quotes','update'))
         and public.staff_role() <> 'ADMIN') is not null as pass,
       public.staff_role() as session_role;

-- And for a session with no profile -- which is what the harness is, and what
-- the hole was -- it must be true, i.e. the raise fires.
select 'authz_guard_fires_without_a_profile' as check_name,
       ((not public.has_permission('crm_quotes','update'))
         and public.staff_role() <> 'ADMIN') as pass
where public.staff_role() = 'NONE';

select 'authz_no_profile_holds_the_sentinel_role' as check_name,
       count(*) = 0 as pass
from public.staff_profiles where role = 'NONE';

-- ---------------------------------------------------------------------------
-- Part 1i. Named constraints. Each one encodes a rule the UI also states, and
-- the UI stating it is not enforcement.
-- ---------------------------------------------------------------------------
with expected(name) as (
  values ('crm_leads_score_range'),
         ('crm_leads_customer_fk'),('crm_leads_campaign_fk'),
         ('crm_campaigns_name_present'),('crm_campaigns_date_order'),
         ('crm_customers_name_present'),
         ('crm_opportunities_title_present'),('crm_opportunities_terminal_reason'),
         ('crm_quote_lines_description_present'),
         ('crm_activities_subject_present'),('crm_activities_target_present'),
         ('crm_followups_title_present'),('crm_followups_target_present'),
         ('crm_followups_done_has_time')
)
select 'crm_named_constraints_present' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(name, ', '), '') as missing
from expected e
where not exists (select 1 from pg_constraint c where c.conname = e.name);

with expected(name) as (
  values ('uq_crm_campaigns_agency_code'),('uq_crm_customers_agency_code'),
         ('uq_crm_opportunities_agency_ref'),('uq_crm_quotes_agency_number')
)
select 'crm_identifiers_unique_per_agency' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(e.name, ', '), '') as offenders
from expected e
where not exists (
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_index i on i.indexrelid = c.oid
  where c.relname = e.name and i.indisunique
);

-- line_total is GENERATED ALWAYS. If it ever becomes an ordinary column a
-- client can write a line total that does not match its own quantity and price.
select 'crm_quote_line_total_is_generated' as check_name,
       count(*) = 1 as pass
from information_schema.columns
where table_schema = 'public' and table_name = 'crm_quote_lines'
  and column_name = 'line_total' and is_generated = 'ALWAYS';

-- quote_number is assigned by a trigger, so a client cannot choose it.
select 'crm_quote_number_assigned_by_trigger' as check_name,
       count(*) = 1 as pass
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
join pg_proc p on p.oid = tg.tgfoid
where c.relname = 'crm_quotes' and p.proname = 'assign_crm_quote_number'
  and not tg.tgisinternal;

-- ---------------------------------------------------------------------------
-- Part 1j. RBAC. The CRM role owns the pipeline; closing a sale writes a booking
-- and takes money, so those two are checked explicitly. FINANCE and
-- OPERATIONS_MANAGER read; neither may write the pipeline. AGENT logs activity
-- and follow-ups and nothing else.
-- ---------------------------------------------------------------------------
with matrix(role, resource, action, allowed) as (
  values
    ('CRM','crm_customers','create',true),('CRM','crm_customers','update',true),
    ('CRM','crm_opportunities','update',true),('CRM','crm_quotes','update',true),
    ('CRM','crm_quote_lines','create',true),('CRM','crm_campaigns','update',true),
    ('CRM','bookings','create',true),('CRM','payments','create',true),
    ('CRM','crm_stage_history','read',true),
    ('CRM','crm_stage_history','update',false),('CRM','crm_campaigns','delete',false),
    ('CRM','journal_entries','read',false),('CRM','bank_accounts','read',false),
    ('OPERATIONS_MANAGER','crm_opportunities','read',true),
    ('OPERATIONS_MANAGER','crm_opportunities','update',false),
    ('OPERATIONS_MANAGER','crm_quotes','update',false),
    ('FINANCE','crm_quotes','read',true),('FINANCE','crm_customers','read',true),
    ('FINANCE','crm_opportunities','update',false),
    ('AGENT','crm_activities','create',true),('AGENT','crm_followups','update',true),
    ('AGENT','crm_customers','create',false),('AGENT','crm_quotes','read',false)
)
select 'crm_rbac_matrix' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(role || '.' || resource || '.' || action, ', '), '') as offenders
from (
  select m.*,
         exists (select 1 from public.staff_permissions sp
                  where sp.role = m.role and sp.resource = m.resource and sp.action = m.action) as configured
  from matrix m
) g
where allowed <> configured;

-- ===========================================================================
-- Part 2. The lifecycle, driven for real, then discarded.
--
-- Real rows through the real triggers: the code and reference defaults, the
-- scope stamp, the quote-number trigger, the GENERATED line total, the subtotal
-- roll-up, the discount arithmetic, and the opportunity state machine including
-- every transition it must refuse. `rollback` at the end, so the suite leaves
-- the database exactly as it found it.
--
-- The illegal transitions are checked by catching the errcode, not by trusting
-- the message: a message can be reworded, and a test that reads it fails for
-- the wrong reason. Each `exception when` also re-raises if nothing was caught,
-- because a transition that was supposed to be refused and was not is the
-- failure this suite exists to find.
-- ===========================================================================
begin;

do $$
declare
  v_campaign  uuid;
  v_customer  uuid;
  v_opp       uuid;
  v_quote     uuid;
  v_line      uuid;
  v_code      text;
  v_ref       text;
  v_number    text;
  v_agency    uuid;
  v_branch    uuid;
  v_sub       numeric(14,2);
  v_total     numeric(14,2);
  v_line_tot  numeric(14,2);
  v_stage     text;
  v_prob      integer;
  v_history   integer;
  v_caught    boolean;
begin
  -- ── Fixture: a campaign. code, agency_id and branch_id are all server-side.
  insert into public.crm_campaigns(name, channel, status, budget_dzd)
  values ('CRM suite fixture', 'MOSQUE', 'ACTIVE', 100000)
  returning id, code, agency_id, branch_id into v_campaign, v_code, v_agency, v_branch;

  if v_code !~ '^CMP-[0-9]{6}-[0-9A-F]{8}$' then
    raise exception 'campaign code default is not server-generated: %', v_code;
  end if;
  if v_agency is null or v_branch is null then
    raise exception 'stamp_staff_scope left the campaign unscoped (agency=%, branch=%)', v_agency, v_branch;
  end if;

  -- ── crm_campaigns_date_order: an end before a start is not a campaign.
  v_caught := false;
  begin
    insert into public.crm_campaigns(name, start_date, end_date)
    values ('CRM suite backwards', current_date, current_date - 1);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then
    raise exception 'crm_campaigns_date_order accepted an end_date before its start_date';
  end if;

  -- ── A whitespace-only name is not a name.
  v_caught := false;
  begin
    insert into public.crm_campaigns(name) values ('   ');
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then
    raise exception 'crm_campaigns_name_present accepted a blank name';
  end if;

  -- ── Fixture: a customer and an opportunity.
  insert into public.crm_customers(full_name, customer_type, phone, campaign_id)
  values ('CRM suite customer', 'FAMILY', '0550000000', v_campaign)
  returning id, code into v_customer, v_code;
  if v_code !~ '^CUS-[0-9]{6}-[0-9A-F]{8}$' then
    raise exception 'customer code default is not server-generated: %', v_code;
  end if;

  insert into public.crm_opportunities(customer_id, title, travelers, expected_value_dzd, campaign_id)
  values (v_customer, 'CRM suite opportunity', 3, 900000, v_campaign)
  returning id, reference, stage, probability into v_opp, v_ref, v_stage, v_prob;
  if v_ref !~ '^OPP-[0-9]{6}-[0-9A-F]{8}$' then
    raise exception 'opportunity reference default is not server-generated: %', v_ref;
  end if;
  if v_stage <> 'NEW' or v_prob <> 10 then
    raise exception 'a new opportunity did not open at NEW/10 (got %/%)', v_stage, v_prob;
  end if;

  -- ── LOST needs a reason, enforced by the constraint as well as the command.
  v_caught := false;
  begin
    update public.crm_opportunities set stage = 'LOST', lost_reason = null where id = v_opp;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then
    raise exception 'crm_opportunities_terminal_reason accepted a LOST row with no reason';
  end if;

  raise notice 'CRM suite: fixtures created (campaign %, customer %, opportunity %)',
    v_campaign, v_customer, v_opp;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2b. Become a CRM staff user, then drive the state machine through its
-- public command surface -- the same RPC the UI calls.
--
-- The commands are guarded by has_permission(), which is now total and answers
-- false for a session with no profile, so this cannot be skipped: without a real
-- profile every call below raises 42501 and the suite fails. That is the point
-- of Part 1h, exercised rather than asserted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user   uuid := gen_random_uuid();
  v_agency uuid;
  v_branch uuid;
begin
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT' limit 1;
  if v_agency is null then
    raise exception 'no DEFAULT/HQ agency: 20260324000300 seeds it, so the schema is incomplete';
  end if;

  insert into auth.users(id, email) values (v_user, 'crm-suite-' || v_user || '@invalid.test');
  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid, branch_id, is_active)
  values (v_user, 'CRM', v_agency, v_branch, v_branch::text, true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  if auth.uid() <> v_user then
    raise exception 'the simulated session did not take: auth.uid() is %', auth.uid();
  end if;
  if public.staff_role() <> 'CRM' then
    raise exception 'the simulated session is not CRM staff: staff_role() is %', public.staff_role();
  end if;
  if not public.has_permission('crm_opportunities','update') then
    raise exception 'the CRM role lacks crm_opportunities.update, so section I never applied';
  end if;
  if not public.row_in_staff_scope(v_agency, v_branch) then
    raise exception 'the CRM session cannot see its own agency and branch';
  end if;
end $$;
-- ---------------------------------------------------------------------------
-- Part 2c. The opportunity state machine, every arrow and every refusal.
--
-- Driven through public.transition_crm_opportunity_stage -- the RPC the UI calls
-- -- so the permission guard, the scope guard, the ladder, the history ledger and
-- the activity trail are all in the path. Refusals are matched on SQLSTATE, and
-- each one re-raises when nothing was caught: a transition that was supposed to
-- be refused and was not is precisely the bug this suite exists to find.
-- ---------------------------------------------------------------------------
do $$
declare
  v_opp     uuid;
  v_stage   text;
  v_prob    integer;
  v_history integer;
  v_caught  text;
  v_bad     text;
begin
  -- 22023 is invalid_parameter_value, which is what the command raises for a
  -- stage it will not take. 42501 must not appear anywhere in this block: this
  -- session is authorized, so an authorization error here would mean the RBAC
  -- rows or the scope stamp are wrong, not that the state machine works.
  select id, stage into v_opp, v_stage
    from public.crm_opportunities where title = 'CRM suite opportunity';
  if v_opp is null then
    raise exception 'Part 2a fixture is missing; the suite cannot continue';
  end if;
  if v_stage <> 'NEW' then
    raise exception 'the fixture opportunity is at %, not NEW', v_stage;
  end if;

  -- ── Refusals from NEW.
  v_caught := null;
  begin
    perform public.transition_crm_opportunity_stage(v_opp, 'ARCHIVED');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'an unknown stage was not refused with 22023 (got %)', coalesce(v_caught,'success');
  end if;

  -- NEW itself (already there), WON (reachable only by accepting a quote), and
  -- NEGOTIATION (not adjacent to NEW) must all be refused.
  foreach v_bad in array array['NEW','WON','NEGOTIATION'] loop
    v_caught := null;
    begin
      perform public.transition_crm_opportunity_stage(v_opp, v_bad);
    exception when others then v_caught := sqlstate;
    end;
    if v_caught is distinct from '22023' then
      raise exception 'NEW -> % was not refused with 22023 (got %)',
        v_bad, coalesce(v_caught, 'success');
    end if;
  end loop;

  -- LOST is a legal arrow from NEW, but not without a reason.
  v_caught := null;
  begin
    perform public.transition_crm_opportunity_stage(v_opp, 'LOST');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'LOST with no reason was not refused with 22023 (got %)',
      coalesce(v_caught, 'success');
  end if;

  -- ── The legal path, with the probability ladder asserted at every step.
  -- NEW 10, QUALIFYING 25, PROPOSAL 50, NEGOTIATION 75, LOST 0.
  perform public.transition_crm_opportunity_stage(v_opp, 'QUALIFYING', 'suite: qualified');
  select stage, probability into v_stage, v_prob
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'QUALIFYING' or v_prob <> 25 then
    raise exception 'NEW -> QUALIFYING landed at %/% instead of QUALIFYING/25', v_stage, v_prob;
  end if;

  -- QUALIFYING reaches only PROPOSAL and LOST; NEGOTIATION is still not adjacent.
  v_caught := null;
  begin
    perform public.transition_crm_opportunity_stage(v_opp, 'NEGOTIATION');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'QUALIFYING -> NEGOTIATION was not refused with 22023 (got %)',
      coalesce(v_caught, 'success');
  end if;
  perform public.transition_crm_opportunity_stage(v_opp, 'PROPOSAL', 'suite: proposal out');
  select stage, probability into v_stage, v_prob
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'PROPOSAL' or v_prob <> 50 then
    raise exception 'QUALIFYING -> PROPOSAL landed at %/% instead of PROPOSAL/50', v_stage, v_prob;
  end if;

  perform public.transition_crm_opportunity_stage(v_opp, 'NEGOTIATION', 'suite: negotiating');
  select stage, probability into v_stage, v_prob
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'NEGOTIATION' or v_prob <> 75 then
    raise exception 'PROPOSAL -> NEGOTIATION landed at %/% instead of NEGOTIATION/75', v_stage, v_prob;
  end if;

  -- NEGOTIATION goes back to PROPOSAL or to LOST, and nowhere else. QUALIFYING
  -- is two steps back and must be refused rather than quietly allowed.
  v_caught := null;
  begin
    perform public.transition_crm_opportunity_stage(v_opp, 'QUALIFYING');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'NEGOTIATION -> QUALIFYING was not refused with 22023 (got %)',
      coalesce(v_caught, 'success');
  end if;

  -- Back to PROPOSAL: the ladder must fall as well as climb, or a deal that
  -- slipped keeps a 75% weight it no longer has in the forecast.
  perform public.transition_crm_opportunity_stage(v_opp, 'PROPOSAL', 'suite: slipped back');
  select stage, probability into v_stage, v_prob
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'PROPOSAL' or v_prob <> 50 then
    raise exception 'NEGOTIATION -> PROPOSAL landed at %/% instead of PROPOSAL/50', v_stage, v_prob;
  end if;

  -- Four accepted moves, four ledger rows, and the last one records where it
  -- came from. The ledger is the audit trail for a forecast, so an accepted move
  -- that leaves no row is a silent hole in it.
  select count(*) into v_history from public.crm_stage_history where opportunity_id = v_opp;
  if v_history <> 4 then
    raise exception 'crm_stage_history holds % rows after 4 accepted moves', v_history;
  end if;
  if not exists (
    select 1 from public.crm_stage_history
     where opportunity_id = v_opp
       and from_stage = 'NEGOTIATION' and to_stage = 'PROPOSAL' and probability = 50
  ) then
    raise exception 'the NEGOTIATION -> PROPOSAL move left no matching history row';
  end if;
  -- Every move also writes an activity, so Customer 360 shows the deal moving
  -- without having to read the history table separately.
  select count(*) into v_history
    from public.crm_activities
   where opportunity_id = v_opp and activity_type = 'SYSTEM';
  if v_history <> 4 then
    raise exception '% SYSTEM activities after 4 accepted moves', v_history;
  end if;

  raise notice 'CRM suite: state machine held (4 accepted moves, 7 refusals, ledger and trail intact)';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2d. A quote's arithmetic is the server's.
--
-- quote_number is assigned by trigger and a client value is discarded.
-- line_total is GENERATED, so it cannot be written at all. subtotal is rolled up
-- from the lines, total_amount is subtotal - discount, and both are rounded to
-- two places by the trigger rather than by whatever the caller sent. The numbers
-- below are chosen so the rounding is visible: 2.50 x 100000.51 is 250001.275,
-- which must be stored as 250001.28 and not truncated to .27.
-- ---------------------------------------------------------------------------
do $$
declare
  v_opp      uuid;
  v_customer uuid;
  v_quote    uuid;
  v_quote2   uuid;
  v_number   text;
  v_sub      numeric(14,2);
  v_total    numeric(14,2);
  v_line_tot numeric(14,2);
  v_status   text;
  v_until    date;
  v_stage    text;
  v_caught   text;
begin
  select id, customer_id into v_opp, v_customer
    from public.crm_opportunities where title = 'CRM suite opportunity';

  insert into public.crm_quotes(quote_number, opportunity_id, customer_id, travelers, currency_code)
  values ('CLIENT-SUPPLIED-0001', v_opp, v_customer, 3, 'DZD')
  returning id, quote_number, subtotal, total_amount into v_quote, v_number, v_sub, v_total;

  if v_number = 'CLIENT-SUPPLIED-0001' then
    raise exception 'the client supplied quote number survived the insert';
  end if;
  if v_number !~ '^QT-[0-9]{6}-[0-9A-F]{8}$' then
    raise exception 'quote number is not the trigger format: %', v_number;
  end if;
  if v_sub <> 0 or v_total <> 0 then
    raise exception 'a quote with no lines opened at subtotal %, total %', v_sub, v_total;
  end if;

  -- ── line_total is GENERATED ALWAYS: writing it is an error, not a silent win.
  v_caught := null;
  begin
    insert into public.crm_quote_lines(quote_id, description, quantity, unit_price, line_total)
    values (v_quote, 'forged total', 1, 1, 999999.99);
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is null then
    raise exception 'a client wrote crm_quote_lines.line_total directly';
  end if;

  -- ── The rounding case, and the roll-up it feeds.
  insert into public.crm_quote_lines(quote_id, description, quantity, unit_price, sort_order)
  values (v_quote, 'Package share, 2.5 traveller equivalents', 2.50, 100000.51, 1)
  returning line_total into v_line_tot;
  if v_line_tot <> 250001.28 then
    raise exception 'round(2.50 * 100000.51, 2) stored as % instead of 250001.28', v_line_tot;
  end if;

  select subtotal, total_amount into v_sub, v_total
    from public.crm_quotes where id = v_quote;
  if v_sub <> 250001.28 or v_total <> 250001.28 then
    raise exception 'one line of 250001.28 rolled up to subtotal %, total %', v_sub, v_total;
  end if;

  insert into public.crm_quote_lines(quote_id, description, quantity, unit_price, sort_order)
  values (v_quote, 'Visa and transfer', 1, 49998.72, 2);

  select subtotal, total_amount into v_sub, v_total
    from public.crm_quotes where id = v_quote;
  if v_sub <> 300000.00 or v_total <> 300000.00 then
    raise exception 'two lines rolled up to subtotal %, total % instead of 300000.00', v_sub, v_total;
  end if;

  -- ── A discount is subtracted by the trigger, not accepted from the caller.
  -- total_amount is deliberately set to a lie here; the trigger must overwrite it.
  update public.crm_quotes
     set discount_amount = 25000, total_amount = 1
   where id = v_quote;
  select subtotal, discount_amount, total_amount into v_sub, v_line_tot, v_total
    from public.crm_quotes where id = v_quote;
  if v_total <> 275000.00 then
    raise exception 'subtotal % minus discount % was stored as total %', v_sub, v_line_tot, v_total;
  end if;

  -- ── A discount larger than the subtotal is not a negative price.
  v_caught := null;
  begin
    update public.crm_quotes set discount_amount = 400000 where id = v_quote;
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a discount above subtotal was not refused with 22023 (got %)',
      coalesce(v_caught, 'success');
  end if;

  -- ── A line with no description is not a line item on a priced offer.
  v_caught := null;
  begin
    insert into public.crm_quote_lines(quote_id, description, quantity, unit_price)
    values (v_quote, '   ', 1, 100);
  exception when check_violation then v_caught := sqlstate;
  end;
  if v_caught is null then
    raise exception 'crm_quote_lines_description_present accepted a blank description';
  end if;

  -- ── Send it. The opportunity is already at PROPOSAL, so sending must not move
  -- the stage again -- that auto-advance is only for NEW and QUALIFYING.
  perform public.send_crm_quote_command(v_quote, 14);
  select q.status, q.valid_until, o.stage into v_status, v_until, v_stage
    from public.crm_quotes q
    join public.crm_opportunities o on o.id = q.opportunity_id
   where q.id = v_quote;
  if v_status <> 'SENT' then
    raise exception 'a sent quote is at status %', v_status;
  end if;
  if v_until <> current_date + 14 then
    raise exception 'valid_until is % instead of current_date + 14', v_until;
  end if;
  if v_stage <> 'PROPOSAL' then
    raise exception 'sending a quote moved the opportunity to % from PROPOSAL', v_stage;
  end if;

  -- ── Once sent, the priced offer is frozen. A line added now would change the
  -- total under a customer who has already seen it.
  v_caught := null;
  begin
    insert into public.crm_quote_lines(quote_id, description, quantity, unit_price)
    values (v_quote, 'quietly added after sending', 1, 50000);
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a line was added to a SENT quote (sqlstate %)', coalesce(v_caught, 'success');
  end if;
  v_caught := null;
  begin
    delete from public.crm_quote_lines where quote_id = v_quote and sort_order = 2;
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a line was deleted from a SENT quote (sqlstate %)', coalesce(v_caught, 'success');
  end if;

  -- ── A second quote, to reach the acceptance guard. Accepting is the only path
  -- to WON, and it refuses a quote with no package because the booking it would
  -- create has nothing to book. That refusal is asserted here; the money path
  -- past it -- pilgrim, booking, payment, journal entry -- needs an ACTIVE
  -- package and a chart of accounts, and is covered by the accounting suites.
  insert into public.crm_quotes(quote_number, opportunity_id, customer_id, travelers)
  values ('IGNORED', v_opp, v_customer, 3)
  returning id into v_quote2;
  insert into public.crm_quote_lines(quote_id, description, quantity, unit_price)
  values (v_quote2, 'Package share', 3, 100000);
  perform public.send_crm_quote_command(v_quote2, 30);

  v_caught := null;
  begin
    perform public.accept_crm_quote_command(v_quote2, 0, 0, 'Cash');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a quote with no package was accepted (sqlstate %)',
      coalesce(v_caught, 'success');
  end if;

  -- And the refusal left nothing behind: no WON stage, no booking.
  select stage into v_stage from public.crm_opportunities where id = v_opp;
  if v_stage <> 'PROPOSAL' then
    raise exception 'a refused acceptance moved the opportunity to %', v_stage;
  end if;
  if exists (select 1 from public.crm_quotes where id = v_quote2 and booking_id is not null) then
    raise exception 'a refused acceptance still attached a booking to the quote';
  end if;

  -- ── Declining. A decline without a reason is not a decline.
  v_caught := null;
  begin
    perform public.decline_crm_quote_command(v_quote, '  ');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a quote was declined with a blank reason (sqlstate %)',
      coalesce(v_caught, 'success');
  end if;

  perform public.decline_crm_quote_command(v_quote, 'Customer chose another operator');
  select status into v_status from public.crm_quotes where id = v_quote;
  if v_status <> 'DECLINED' then
    raise exception 'a declined quote is at status %', v_status;
  end if;

  -- ── A closed quote is closed in both directions: it cannot be accepted and it
  -- cannot be re-sent.
  v_caught := null;
  begin
    perform public.accept_crm_quote_command(v_quote, 0, 0, 'Cash');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a DECLINED quote was accepted (sqlstate %)', coalesce(v_caught, 'success');
  end if;
  v_caught := null;
  begin
    perform public.send_crm_quote_command(v_quote, 14);
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'a DECLINED quote was re-sent (sqlstate %)', coalesce(v_caught, 'success');
  end if;

  raise notice 'CRM suite: quote arithmetic and lifecycle held (quote %, second %)', v_quote, v_quote2;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2e. Losing a deal, and the cascade that has to come with it.
--
-- A deal marked LOST while its follow-ups stay OPEN and its quote stays SENT is
-- the failure mode this cascade exists to prevent: the pipeline says closed and
-- the work queue says call them tomorrow. So the cascade is asserted, not
-- assumed -- and so is the recovery, because LOST -> QUALIFYING must also clear
-- lost_at and lost_reason or a reopened deal carries a closing date.
-- ---------------------------------------------------------------------------
do $$
declare
  v_opp      uuid;
  v_customer uuid;
  v_quote2   uuid;
  v_open     uuid;
  v_done     uuid;
  v_stage    text;
  v_prob     integer;
  v_reason   text;
  v_lost_at  timestamptz;
  v_history  integer;
  v_caught   text;
begin
  select id, customer_id into v_opp, v_customer
    from public.crm_opportunities where title = 'CRM suite opportunity';
  select id into v_quote2 from public.crm_quotes
   where opportunity_id = v_opp and status = 'SENT';
  if v_quote2 is null then
    raise exception 'Part 2d left no SENT quote for the cascade to expire';
  end if;

  insert into public.crm_followups(customer_id, opportunity_id, title, due_at, priority)
  values (v_customer, v_opp, 'Call back about the offer', now() + interval '2 days', 'HIGH')
  returning id into v_open;
  insert into public.crm_followups(customer_id, opportunity_id, title, due_at)
  values (v_customer, v_opp, 'Already handled', now() + interval '1 day')
  returning id into v_done;

  -- DONE without a completion time is not DONE.
  v_caught := null;
  begin
    update public.crm_followups set status = 'DONE', completed_at = null where id = v_done;
  exception when check_violation then v_caught := sqlstate;
  end;
  if v_caught is null then
    raise exception 'crm_followups_done_has_time accepted DONE with no completed_at';
  end if;

  -- The command is the way to close one, and it supplies the time itself.
  perform public.complete_crm_followup_command(v_done, 'suite: handled on the call');
  if not exists (
    select 1 from public.crm_followups
     where id = v_done and status = 'DONE' and completed_at is not null
  ) then
    raise exception 'complete_crm_followup_command left the follow-up unclosed or untimed';
  end if;

  -- ── Lose it. The reason is passed with padding, and must be stored trimmed.
  perform public.transition_crm_opportunity_stage(
    v_opp, 'LOST', 'suite: closing out', '  Budget moved to next season  ');

  select stage, probability, lost_reason, lost_at
    into v_stage, v_prob, v_reason, v_lost_at
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'LOST' or v_prob <> 0 then
    raise exception 'LOST landed at %/% instead of LOST/0', v_stage, v_prob;
  end if;
  if v_reason <> 'Budget moved to next season' then
    raise exception 'lost_reason was stored untrimmed: [%]', v_reason;
  end if;
  if v_lost_at is null then
    raise exception 'a LOST opportunity has no lost_at';
  end if;

  -- The cascade: open work cancelled, closed work untouched, the live quote
  -- expired, and the already-declined quote left as the customer left it.
  if not exists (select 1 from public.crm_followups where id = v_open and status = 'CANCELLED') then
    raise exception 'losing the deal left its OPEN follow-up open';
  end if;
  if not exists (select 1 from public.crm_followups where id = v_done and status = 'DONE') then
    raise exception 'losing the deal rewrote an already-completed follow-up';
  end if;
  if not exists (select 1 from public.crm_quotes where id = v_quote2 and status = 'EXPIRED') then
    raise exception 'losing the deal left its SENT quote live';
  end if;
  if not exists (
    select 1 from public.crm_quotes
     where opportunity_id = v_opp and status = 'DECLINED'
  ) then
    raise exception 'the cascade overwrote a DECLINED quote';
  end if;

  -- ── From LOST, the only way back is QUALIFYING. PROPOSAL would skip the
  -- re-qualification that justified reopening it.
  v_caught := null;
  begin
    perform public.transition_crm_opportunity_stage(v_opp, 'PROPOSAL');
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from '22023' then
    raise exception 'LOST -> PROPOSAL was not refused with 22023 (got %)',
      coalesce(v_caught, 'success');
  end if;

  perform public.transition_crm_opportunity_stage(v_opp, 'QUALIFYING', 'suite: customer came back');
  select stage, probability, lost_reason, lost_at
    into v_stage, v_prob, v_reason, v_lost_at
    from public.crm_opportunities where id = v_opp;
  if v_stage <> 'QUALIFYING' or v_prob <> 25 then
    raise exception 'LOST -> QUALIFYING landed at %/% instead of QUALIFYING/25', v_stage, v_prob;
  end if;
  if v_reason is not null or v_lost_at is not null then
    raise exception 'a reopened opportunity still carries lost_reason [%] / lost_at [%]',
      v_reason, v_lost_at;
  end if;

  -- Six accepted moves, six ledger rows. The refusals in between wrote none.
  select count(*) into v_history from public.crm_stage_history where opportunity_id = v_opp;
  if v_history <> 6 then
    raise exception 'crm_stage_history holds % rows after 6 accepted moves', v_history;
  end if;

  raise notice 'CRM suite: loss cascade and recovery held';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Part 3. The suite left nothing behind.
--
-- Everything above ran inside the transaction that has now been rolled back --
-- including the disposable auth.users row and the staff profile, which would
-- otherwise be a real, permanent, writable account created by a test. This is
-- the check that proves it, and it runs outside the transaction where the answer
-- means something.
-- ---------------------------------------------------------------------------
select 'crm_suite_left_no_residue' as check_name,
       not exists (select 1 from public.crm_campaigns where name like 'CRM suite%')
   and not exists (select 1 from public.crm_customers where full_name = 'CRM suite customer')
   and not exists (select 1 from public.crm_opportunities where title = 'CRM suite opportunity')
   -- Not the quote number: the trigger replaces whatever the insert supplied, so
   -- looking for the client value would pass whether the rollback worked or not.
   -- The follow-up titles are stored verbatim, so they are a real signal.
   and not exists (select 1 from public.crm_followups
                    where title in ('Call back about the offer', 'Already handled'))
   -- crm_activities and crm_stage_history are not listed: both cascade from the
   -- customer and the opportunity, so if those two are gone the trail is too.
   and not exists (select 1 from auth.users where email like 'crm-suite-%@invalid.test') as pass,
       public.staff_role() as session_role_after_rollback;

