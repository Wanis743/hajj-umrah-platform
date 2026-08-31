-- ============================================================================
-- DMS lifecycle contracts.
--
--     node scripts/run-sql-gate.mjs supabase/tests/dms_lifecycle.sql
--     npm run verify:dms
--
-- Three parts, checking three different kinds of thing.
--
-- Part 1 reads the catalog: the tables, the policies, the revokes, the pinned
-- search_paths, the named constraints, the unique indexes, the RBAC rows and the
-- storage policies. These are the regressions that reopen a hole without
-- changing any visible behaviour, and they evaluate on any database carrying the
-- schema.
--
-- Part 2 drives the lifecycle for real inside `begin ... rollback`: reserve,
-- finalize, submit, review, approve, expire, extract, link, relate, package,
-- seal, verify, drift, tamper, delete. It creates two disposable auth.users rows
-- -- an author and a reviewer -- because separation of duties cannot be tested
-- by one account, and a JWT claim of its own, so the commands are authorized the
-- way a real session is authorized: by RBAC rows rather than by whatever the
-- harness happens to be. It never asserts anything about row visibility, because
-- the fresh-database harness is a superuser and row security is bypassed there.
-- RLS is Part 1's job, from the catalog, where the question can be answered
-- honestly.
--
-- Part 3 runs after the rollback and checks that none of it survived.
--
-- Realtime publication membership is deliberately not asserted. Section T of the
-- migration swallows insufficient_privilege on `alter publication`, because
-- supabase_realtime is owned by supabase_admin and the migration runner is not
-- always that role -- so a table missing from the publication is a fact about the
-- deployment's permissions, not a defect in the slice, and failing on it would be
-- a red that tells nobody anything.
--
-- Every check emits `check_name, pass`. run-sql-gate.mjs fails the process on a
-- false or NULL pass, and fails a suite that asserted nothing at all. Part 2
-- reports by raising instead: an exception under ON_ERROR_STOP=1 fails the gate
-- just as hard, and inside a PL/pgSQL block it can say which step broke.
--
-- Refusals in Part 2 are matched on SQLSTATE, never on message text: a message
-- can be reworded and a test that reads it fails for the wrong reason. 22023 is
-- "the state machine says no", 42501 is "you are not the one who may do this",
-- and the difference between them is the whole design.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- Part 1a. The eleven tables exist and every one of them has row security on.
--
-- `bool_and` over the expected list rather than a count of what happens to be
-- there: a missing table and a table with RLS switched off are both failures, and
-- the detail column names which, so the red says what to fix.
-- ----------------------------------------------------------------------------
with expected(t) as (
  values ('dms_documents'), ('dms_document_versions'), ('dms_document_links'),
         ('dms_document_relations'), ('extraction_jobs'), ('dms_extracted_fields'),
         ('dms_document_events'), ('evidence_packages'), ('evidence_package_documents'),
         ('dms_document_sequences'), ('dms_storage_orphans')
)
select 'dms.tables_present_and_rls_enabled' as check_name,
       bool_and(c.relrowsecurity is true)   as pass,
       coalesce(string_agg(e.t, ' | ' order by e.t)
                filter (where c.relrowsecurity is not true), '') as detail
  from expected e
  left join pg_class c
    on c.relname = e.t
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r';

-- ----------------------------------------------------------------------------
-- Part 1b. `anon` reaches none of them. Not one table, not one verb.
--
-- The CASE is what makes an absent table a NULL rather than an error: NULL fails
-- the gate the same way false does, and the suite carries on to report the rest.
-- ----------------------------------------------------------------------------
with expected(t) as (
  values ('dms_documents'), ('dms_document_versions'), ('dms_document_links'),
         ('dms_document_relations'), ('extraction_jobs'), ('dms_extracted_fields'),
         ('dms_document_events'), ('evidence_packages'), ('evidence_package_documents'),
         ('dms_document_sequences'), ('dms_storage_orphans')
)
select 'dms.anon_holds_no_table_privilege' as check_name,
       bool_and(not p.granted)             as pass,
       coalesce(string_agg(e.t || '.' || p.priv, ' | ' order by e.t, p.priv)
                filter (where p.granted), '') as detail
  from expected e
  cross join lateral (
    select v.priv,
           case when to_regclass('public.' || e.t) is null then null
                else has_table_privilege('anon', 'public.' || e.t, v.priv) end as granted
      from (values ('select'), ('insert'), ('update'), ('delete')) as v(priv)
  ) p;
-- ----------------------------------------------------------------------------
-- Part 1c. The eight client tables each carry the four scope-checked policies.
--
-- Four, not "at least one": a table with a scoped SELECT and an unscoped INSERT
-- reads correctly and writes anywhere, and counting only the policies whose
-- expression mentions row_in_staff_scope is what distinguishes the two.
-- ----------------------------------------------------------------------------
with client_tables(t) as (
  values ('dms_documents'), ('dms_document_versions'), ('dms_document_links'),
         ('dms_document_relations'), ('extraction_jobs'), ('dms_extracted_fields'),
         ('evidence_packages'), ('evidence_package_documents')
)
select 'dms.four_scoped_policies_per_client_table' as check_name,
       bool_and(n.found = 4)                       as pass,
       coalesce(string_agg(c.t || '=' || n.found, ' | ' order by c.t)
                filter (where n.found <> 4), '') as detail
  from client_tables c
  cross join lateral (
    select count(*) as found
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.t
       and p.policyname in ('staff_select', 'staff_insert', 'staff_update', 'staff_delete')
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%row_in_staff_scope%'
  ) n;

-- ----------------------------------------------------------------------------
-- Part 1d. Every UPDATE policy has a WITH CHECK as well as a USING.
--
-- USING alone decides which rows may be updated; without WITH CHECK the update
-- may move a row out of the caller's scope, which is a write into somebody else's
-- agency dressed as an edit of your own.
-- ----------------------------------------------------------------------------
select 'dms.update_policies_carry_with_check' as check_name,
       count(*) = 0                           as pass,
       coalesce(string_agg(tablename || '.' || policyname, ' | ' order by tablename), '') as detail
  from pg_policies
 where schemaname = 'public'
   and tablename in ('dms_documents', 'dms_document_versions', 'dms_document_links',
                     'dms_document_relations', 'extraction_jobs', 'dms_extracted_fields',
                     'dms_document_events', 'evidence_packages', 'evidence_package_documents')
   and cmd = 'UPDATE'
   and with_check is null;

-- ----------------------------------------------------------------------------
-- Part 1e. The event ledger is append-only from every client.
--
-- One policy, for SELECT, and no write verb granted to `authenticated`. A
-- subsystem that can rewrite its own audit trail is not audited, so this is
-- asserted from both directions -- the missing policy and the missing grant.
-- ----------------------------------------------------------------------------
select 'dms.events_ledger_is_append_only' as check_name,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'dms_document_events') = 1
       and (select count(*) from pg_policies
             where schemaname = 'public' and tablename = 'dms_document_events'
               and cmd = 'SELECT') = 1
       and not has_table_privilege('authenticated', 'public.dms_document_events', 'insert')
       and not has_table_privilege('authenticated', 'public.dms_document_events', 'update')
       and not has_table_privilege('authenticated', 'public.dms_document_events', 'delete')
       as pass;
-- ----------------------------------------------------------------------------
-- Part 1f. The two internal tables have no client path at all.
--
-- dms_document_sequences hands out document numbers and dms_storage_orphans is
-- the deletion work queue. Both have RLS on and no policy, which alone would deny
-- everything -- but a future `grant` plus a future policy would open them, so the
-- privilege is asserted absent as well as the policy.
-- ----------------------------------------------------------------------------
with internal(t) as (values ('dms_document_sequences'), ('dms_storage_orphans')),
probe as (
  select i.t, r.role, v.priv,
         case when to_regclass('public.' || i.t) is null then null
              else has_table_privilege(r.role, 'public.' || i.t, v.priv) end as granted
    from internal i
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as v(priv)
)
select 'dms.internal_tables_have_no_client_path' as check_name,
       (select bool_and(not granted) from probe)
       and (select count(*) from pg_policies
             where schemaname = 'public'
               and tablename in ('dms_document_sequences', 'dms_storage_orphans')) = 0 as pass,
       coalesce((select string_agg(t || '.' || priv || '@' || role, ' | '
                                   order by t, role, priv)
                   from probe where granted), '') as detail;

-- ----------------------------------------------------------------------------
-- Part 1g. Every client table stamps agency and branch on insert.
--
-- row_in_staff_scope() is only a fence if the columns it reads are filled by the
-- database rather than by the caller. Without this trigger a client could insert a
-- row carrying somebody else's agency_id and the scoped policies would agree.
-- ----------------------------------------------------------------------------
with loop_tables(t) as (
  values ('dms_documents'), ('dms_document_versions'), ('dms_document_links'),
         ('dms_document_relations'), ('extraction_jobs'), ('dms_extracted_fields'),
         ('dms_document_events'), ('evidence_packages'), ('evidence_package_documents')
)
select 'dms.stamp_staff_scope_trigger_present' as check_name,
       bool_and(g.tgname is not null)          as pass,
       coalesce(string_agg(l.t, ' | ' order by l.t) filter (where g.tgname is null), '') as detail
  from loop_tables l
  left join pg_trigger g
    on g.tgrelid = to_regclass('public.' || l.t)
   and g.tgname = 'trg_stamp_staff_scope'
   and not g.tgisinternal;
-- ----------------------------------------------------------------------------
-- Part 1h. The updated_at triggers exist exactly where they should.
--
-- evidence_package_documents and dms_document_events have no updated_at column to
-- maintain -- a membership row and a ledger entry are written once -- so a trigger
-- there would be a runtime error on the first update, not a nicety.
-- ----------------------------------------------------------------------------
with expected(t, want) as (
  values ('dms_documents', true), ('dms_document_versions', true), ('dms_document_links', true),
         ('dms_document_relations', true), ('extraction_jobs', true), ('dms_extracted_fields', true),
         ('evidence_packages', true),
         ('evidence_package_documents', false), ('dms_document_events', false)
),
seen as (
  select e.t, e.want,
         exists (select 1 from pg_trigger g
                  where g.tgrelid = to_regclass('public.' || e.t)
                    and g.tgname = 'trg_' || e.t || '_updated_at'
                    and not g.tgisinternal) as has
    from expected e
)
select 'dms.updated_at_triggers_exactly_where_expected' as check_name,
       bool_and(has = want)                             as pass,
       coalesce(string_agg(t || ' want=' || want || ' has=' || has, ' | ' order by t)
                filter (where has <> want), '') as detail
  from seen;

-- ----------------------------------------------------------------------------
-- Part 1i. 20260822000013's own updated_at triggers are gone.
--
-- It named them handle_updated_at_* on the same tables the loop above re-triggers.
-- Leaving both in place is not a correctness bug -- update_updated_at_column() is
-- idempotent -- but it runs twice per row forever, and a duplicate that harmless is
-- exactly the kind that survives review.
-- ----------------------------------------------------------------------------
select 'dms.legacy_updated_at_triggers_dropped' as check_name,
       count(*) = 0                             as pass,
       coalesce(string_agg(tgname, ' | ' order by tgname), '') as detail
  from pg_trigger
 where not tgisinternal
   and tgname in ('handle_updated_at_documents', 'handle_updated_at_evidence_packages',
                  'handle_updated_at_extraction_jobs');
-- ----------------------------------------------------------------------------
-- Part 1j. The twenty private bodies are unreachable from any client.
--
-- Checking `anon` covers a grant to PUBLIC as well: anon inherits it, so a body
-- left executable by PUBLIC shows up here as anon_ok. The count is asserted too --
-- a body deleted rather than locked down would otherwise pass silently.
-- ----------------------------------------------------------------------------
with priv as (
  select p.proname,
         has_function_privilege('anon', p.oid, 'execute')          as anon_ok,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'dms%'
)
select 'dms.private_bodies_are_unreachable' as check_name,
       (select count(*) from priv) = 20
       and not exists (select 1 from priv where anon_ok or auth_ok) as pass,
       'count=' || (select count(*) from priv)
       || ' reachable=' || coalesce((select string_agg(proname, ' ' order by proname)
                                      from priv where anon_ok or auth_ok), 'none') as detail;

-- ----------------------------------------------------------------------------
-- Part 1k. The public surface is exactly thirty-six functions, thirty-five of them
-- callable by `authenticated` and none by `anon`.
--
-- The thirty-sixth is dms_check_link_target, the link-target trigger function: it
-- is called by the trigger, never by a client, so it is revoked from everyone. Any
-- other name without an execute grant is a command the UI cannot call, which is a
-- silently dead feature rather than a visible error.
-- ----------------------------------------------------------------------------
with pub as (
  select p.proname,
         has_function_privilege('anon', p.oid, 'execute')          as anon_ok,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%dms%'
)
select 'dms.public_surface_is_authenticated_only' as check_name,
       (select count(*) from pub) = 36
       and (select count(*) from pub where auth_ok) = 35
       and not exists (select 1 from pub where anon_ok)
       and not exists (select 1 from pub
                        where not auth_ok and proname <> 'dms_check_link_target') as pass,
       'total=' || (select count(*) from pub)
       || ' authenticated=' || (select count(*) from pub where auth_ok)
       || ' anon=' || (select count(*) from pub where anon_ok) as detail;
-- ----------------------------------------------------------------------------
-- Part 1l. All fifty-six are SECURITY DEFINER with a pinned search_path.
--
-- DEFINER without a pinned search_path is the classic escalation: the caller
-- prepends a schema of their own, the body resolves an unqualified name to their
-- table, and the definer's privileges run the caller's code.
-- ----------------------------------------------------------------------------
with fns as (
  select n.nspname, p.proname, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ' '), '') as cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname like '%dms%'
)
select 'dms.functions_are_definer_with_pinned_search_path' as check_name,
       count(*) = 56
       and bool_and(prosecdef and cfg like '%search\_path=%')  as pass,
       'count=' || count(*)
       || ' offenders=' || coalesce(string_agg(nspname || '.' || proname, ' '
                                               order by nspname, proname)
                                    filter (where not prosecdef
                                               or cfg not like '%search\_path=%'), 'none') as detail
  from fns;

-- ----------------------------------------------------------------------------
-- Part 1m. The thirty-three named constraints are present.
--
-- Named rather than anonymous so that this list can exist: a CHECK dropped during
-- a later refactor is invisible in behaviour until the row it would have refused
-- arrives, and by then it is data, not a bug.
-- ----------------------------------------------------------------------------
with expected(c) as (
  values ('dms_documents_title_present'), ('dms_documents_review_status_check'),
         ('dms_documents_confidentiality_check'), ('dms_documents_approval_attributed'),
         ('dms_documents_rejection_explained'), ('dms_documents_expiry_after_issue'),
         ('dms_documents_notice_days_sane'), ('dms_documents_current_version_fk'),
         ('dms_document_versions_upload_state_check'), ('dms_document_versions_checksum_shape'),
         ('dms_document_versions_size_sane'), ('dms_document_versions_number_positive'),
         ('dms_document_versions_uploaded_is_measured'),
         ('dms_document_links_entity_type_check'), ('dms_document_links_relation_check'),
         ('dms_document_links_unique'),
         ('dms_document_relations_relation_check'), ('dms_document_relations_not_self'),
         ('dms_document_relations_unique'),
         ('extraction_jobs_engine_check'), ('extraction_jobs_review_state_check'),
         ('extraction_jobs_confidence_range'), ('extraction_jobs_attempts_sane'),
         ('extraction_jobs_failure_explained'),
         ('dms_extracted_fields_key_present'), ('dms_extracted_fields_state_check'),
         ('dms_extracted_fields_confidence_range'), ('dms_extracted_fields_reviewed_attributed'),
         ('dms_extracted_fields_unique'),
         ('dms_document_events_type_check'),
         ('evidence_packages_name_present'), ('evidence_packages_status_check'),
         ('evidence_packages_seal_complete')
)
select 'dms.named_constraints_present' as check_name,
       bool_and(k.conname is not null) as pass,
       coalesce(string_agg(e.c, ' | ' order by e.c) filter (where k.conname is null), '') as detail
  from expected e
  left join pg_constraint k
    on k.conname = e.c and k.connamespace = 'public'::regnamespace;
-- ----------------------------------------------------------------------------
-- Part 1n. The five unique indexes are present and actually unique.
--
-- indisunique is read rather than assumed: an index recreated without UNIQUE has
-- the same name, is used by the same queries, and enforces nothing. These five are
-- the ones that stop a second document claiming a number, a second version
-- claiming a checksum or a storage path, and a second package a reference.
-- ----------------------------------------------------------------------------
with expected(i) as (
  values ('uq_dms_documents_number'), ('uq_dms_document_versions_number'),
         ('uq_dms_document_versions_checksum'), ('uq_dms_document_versions_path'),
         ('uq_evidence_packages_reference')
),
have as (
  select c.relname, ix.indisunique
    from pg_class c
    join pg_index ix on ix.indexrelid = c.oid
   where c.relnamespace = 'public'::regnamespace
)
select 'dms.unique_indexes_present' as check_name,
       bool_and(h.indisunique is true) as pass,
       coalesce(string_agg(e.i, ' | ' order by e.i)
                filter (where h.indisunique is not true), '') as detail
  from expected e
  left join have h on h.relname = e.i;

-- ----------------------------------------------------------------------------
-- Part 1o. 'approve' and 'seal' are separate actions, held by different roles.
--
-- This is the separation the whole review half of the subsystem exists to enforce,
-- and it lives in rows rather than in code, so a row inserted by a later migration
-- can quietly grant it. FINANCE sealing an evidence package but not approving a
-- document, and OPERATIONS_MANAGER doing both, is the intended shape; GUIDE reading
-- two tables and writing none is the floor.
--
-- The last row uses '*' for the role, meaning "no role at all holds this". That is
-- how evidence_packages.delete is specified: a sealed package is part of the record
-- and the only account that can remove one is an ADMIN, implicitly, through
-- has_permission. Part 2h probes the same fact from the calling side, where it
-- surfaces as 42501 rather than as the sealed-status refusal a reader might expect.
-- ----------------------------------------------------------------------------
with expected(role, resource, action, want) as (
  values ('OPERATIONS_MANAGER', 'dms_documents',        'approve', true),
         ('FINANCE',            'dms_documents',        'approve', false),
         ('VISA_AGENT',         'dms_documents',        'approve', false),
         ('CRM',                'dms_documents',        'approve', false),
         ('AGENT',              'dms_documents',        'approve', false),
         ('GUIDE',              'dms_documents',        'approve', false),
         ('OPERATIONS_MANAGER', 'evidence_packages',    'seal',    true),
         ('FINANCE',            'evidence_packages',    'seal',    true),
         ('VISA_AGENT',         'evidence_packages',    'seal',    false),
         ('CRM',                'evidence_packages',    'seal',    false),
         ('AGENT',              'evidence_packages',    'seal',    false),
         ('GUIDE',              'dms_documents',        'read',    true),
         ('GUIDE',              'dms_document_versions','read',    true),
         ('GUIDE',              'dms_documents',        'create',  false),
         ('GUIDE',              'evidence_packages',    'read',    false),
         ('AGENT',              'dms_documents',        'update',  false),
         ('CRM',                'dms_documents',        'delete',  false),
         ('VISA_AGENT',         'dms_extracted_fields', 'update',  true),
         ('*',                  'evidence_packages',    'delete',  false)
),
seen as (
  select e.*,
         case when e.role = '*'
              then exists (select 1 from public.staff_permissions p
                            where p.resource = e.resource and p.action = e.action)
              else exists (select 1 from public.staff_permissions p
                            where p.role = e.role and p.resource = e.resource
                              and p.action = e.action) end as has
    from expected e
)
select 'dms.rbac_separates_approve_from_seal' as check_name,
       bool_and(has = want)                   as pass,
       coalesce(string_agg(role || '/' || resource || '/' || action
                           || ' want=' || want, ' | ' order by role, resource, action)
                filter (where has <> want), '') as detail
  from seen;
-- ----------------------------------------------------------------------------
-- Part 1p. The storage bucket is private, capped and mime-restricted.
--
-- Read through a pg_temp helper and dynamic SQL rather than a plain select, because
-- a statement naming storage.buckets fails at parse time on a deployment without the
-- Supabase storage schema -- and section J of the migration skips itself there for
-- exactly that reason. On such a deployment this passes and the detail says so,
-- which is the truth: there is no bucket to get wrong.
-- ----------------------------------------------------------------------------
create or replace function pg_temp.dms_bucket_state() returns text
language plpgsql as $fn$
declare v_state text;
begin
  if to_regclass('storage.buckets') is null then return 'absent'; end if;
  execute $q$
    select coalesce((select case
             when b.public then 'public-bucket'
             when b.file_size_limit is distinct from 26214400 then 'wrong-cap:' || coalesce(b.file_size_limit::text,'null')
             when coalesce(array_length(b.allowed_mime_types, 1), 0) <> 11 then 'wrong-mime-count'
             else 'ok' end
             from storage.buckets b where b.id = 'dms'), 'no-row')
  $q$ into v_state;
  return v_state;
end $fn$;

select 'dms.storage_bucket_is_private_and_capped' as check_name,
       pg_temp.dms_bucket_state() in ('ok', 'absent') as pass,
       pg_temp.dms_bucket_state()                     as detail;

-- ----------------------------------------------------------------------------
-- Part 1q. The four object policies exist.
--
-- pg_policies is a view over the catalog, so it answers even where storage.objects
-- itself is absent -- it simply returns nothing, which is why the count is compared
-- against 4 only when the table is there.
-- ----------------------------------------------------------------------------
select 'dms.storage_object_policies_present' as check_name,
       case when to_regclass('storage.objects') is null then true
            else (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname in ('dms_objects_read', 'dms_objects_insert',
                                        'dms_objects_update', 'dms_objects_delete')) = 4
       end as pass,
       coalesce((select string_agg(policyname, ' ' order by policyname) from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname like 'dms\_objects\_%'), 'none') as detail;
-- ===========================================================================
-- Part 2. The lifecycle, driven for real, then discarded.
--
-- Real rows through the real triggers and the real public commands -- the same
-- RPC the workspace calls -- inside one transaction that is rolled back at the
-- end, so the suite leaves the database exactly as it found it.
--
-- Nothing here asserts RLS. This runs as the owner, where row security is
-- bypassed, so an RLS assertion would pass vacuously; that question belongs to
-- Part 1, which asks the catalog instead. What this half proves is the part a
-- catalog cannot answer: that the state machine refuses the moves it has no
-- edge for, that separation of duties holds against a real second account, and
-- that a seal recomputed on read still describes the bytes it was taken over.
-- ===========================================================================
begin;

-- Three helpers, created inside the transaction so they vanish with it.
--
-- dms_refuses is the whole refusal idiom in one place: run the statement, catch
-- whatever it raises, and fail unless the SQLSTATE is exactly the expected one.
-- Matching the code and never the message is deliberate -- a message can be
-- reworded and a test that reads it then fails for the wrong reason. "No error
-- at all" is reported as its own failure, because an operation that was meant
-- to be refused and was not is precisely what this suite exists to catch.
create or replace function pg_temp.dms_refuses(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
declare v_caught text;
begin
  begin
    execute p_sql;
  exception when others then v_caught := sqlstate;
  end;
  if v_caught is distinct from p_state then
    raise exception '% : expected SQLSTATE %, got %', p_what, p_state,
      coalesce(v_caught, 'no error at all');
  end if;
end $fn$;

-- Becoming a staff user. set_config with is_local = true keeps the claim inside
-- this transaction, so the rollback also ends the session.
create or replace function pg_temp.dms_become(p_email text)
returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'no suite account %', p_email; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  if auth.uid() <> v_id then
    raise exception 'the simulated session did not take: auth.uid() is %', auth.uid();
  end if;
  return v_id;
end $fn$;

-- The object behind a reserved path. storage.objects cannot be named in a plain
-- statement on a deployment without the storage schema -- that fails at parse
-- time, before any `if to_regclass(...)` could skip it -- so the insert is
-- dynamic. Returns false when there is no storage schema, which is exactly the
-- case where dms_finalize_upload skips its own byte-presence check too.
create or replace function pg_temp.dms_put_object(p_bucket text, p_path text, p_size bigint)
returns boolean language plpgsql as $fn$
begin
  if to_regclass('storage.objects') is null then return false; end if;
  execute 'insert into storage.objects(bucket_id, name, metadata)
           values ($1, $2, jsonb_build_object(''size'', $3))'
    using p_bucket, p_path, p_size;
  return true;
end $fn$;

-- ---------------------------------------------------------------------------
-- Part 2a. Every named constraint, probed by direct DML before any session.
--
-- stamp_staff_scope() stamps the DEFAULT agency's HQ branch when auth.uid() is
-- null, so these rows are scoped without a profile -- which is why the probes
-- run before the session work rather than after it. Part 1m asserts the
-- constraints are present; this is where each one is asked to refuse something.
-- A constraint dropped and recreated as a tautology passes Part 1m and fails
-- here, which is the only reason both checks exist.
--
-- dms_document_links_entity_type_check is not probed: trg_dms_check_link_target
-- is a BEFORE trigger, so it raises 22023 on an unknown type before the check
-- constraint is ever evaluated. The trigger is probed instead, which is the
-- refusal a caller actually meets.
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc     uuid;
  v_doc2    uuid;
  v_agency  uuid;
  v_branch  uuid;
  v_version uuid;
  v_job     uuid;
  v_pkg     uuid;
  v_sum     text := repeat('a', 64);
  v_path    text;
begin
  insert into public.dms_documents(title, document_type)
  values ('DMS suite fixture', 'PASSPORT')
  returning id, agency_id, branch_id into v_doc, v_agency, v_branch;
  if v_agency is null or v_branch is null then
    raise exception 'stamp_staff_scope left the document unscoped (agency=%, branch=%)',
      v_agency, v_branch;
  end if;
  insert into public.dms_documents(title, document_type)
  values ('DMS suite fixture two', 'VISA') returning id into v_doc2;
  v_path := 'suite/' || v_doc::text;

  -- dms_documents: the eight constraints section B declares.
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type) values ('   ', 'PASSPORT')$q$,
    '23514', 'dms_documents_title_present accepted a blank title');
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type, review_status)
       values ('DMS suite bad state', 'PASSPORT', 'MAYBE')$q$,
    '23514', 'dms_documents_review_status_check accepted MAYBE');
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type, confidentiality)
       values ('DMS suite bad conf', 'PASSPORT', 'SECRET')$q$,
    '23514', 'dms_documents_confidentiality_check accepted SECRET');
  perform pg_temp.dms_refuses(format(
    $q$update public.dms_documents set review_status = 'APPROVED' where id = %L$q$, v_doc),
    '23514', 'dms_documents_approval_attributed accepted an unattributed approval');
  perform pg_temp.dms_refuses(format(
    $q$update public.dms_documents set review_status = 'REJECTED' where id = %L$q$, v_doc),
    '23514', 'dms_documents_rejection_explained accepted a rejection with no reason');
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type, issued_on, expires_on)
       values ('DMS suite backwards', 'VISA', current_date, current_date - 1)$q$,
    '23514', 'dms_documents_expiry_after_issue accepted an expiry before the issue date');
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type, expiry_notice_days)
       values ('DMS suite loud', 'VISA', 400)$q$,
    '23514', 'dms_documents_notice_days_sane accepted 400 days of notice');
  perform pg_temp.dms_refuses(format(
    $q$update public.dms_documents set current_version_id = gen_random_uuid() where id = %L$q$,
    v_doc),
    '23503', 'dms_documents_current_version_fk accepted a version that does not exist');

  -- uq_dms_documents_number is partial on (agency_id, document_number).
  update public.dms_documents set document_number = 'DOC-SUITE-000001' where id = v_doc;
  perform pg_temp.dms_refuses(
    $q$insert into public.dms_documents(title, document_type, document_number)
       values ('DMS suite twin', 'PASSPORT', 'DOC-SUITE-000001')$q$,
    '23505', 'uq_dms_documents_number accepted a duplicate document number');

  -- dms_document_versions. Every probe that is not about upload_state pins
  -- upload_state to RESERVED, because the default is UPLOADED and
  -- uploaded_is_measured would then fire first -- the same SQLSTATE from the
  -- wrong constraint, which is a test that passes for the wrong reason.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state, checksum_sha256)
       values (%L, 1, 'suite/bad-checksum', 'RESERVED', 'ZZZ')$q$, v_doc),
    '23514', 'dms_document_versions_checksum_shape accepted ZZZ');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state, size_bytes)
       values (%L, 1, 'suite/bad-size', 'RESERVED', 0)$q$, v_doc),
    '23514', 'dms_document_versions_size_sane accepted a zero-byte object');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state)
       values (%L, 1, 'suite/unmeasured', 'UPLOADED')$q$, v_doc),
    '23514', 'dms_document_versions_uploaded_is_measured accepted unmeasured bytes');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state)
       values (%L, 0, 'suite/version-zero', 'RESERVED')$q$, v_doc),
    '23514', 'dms_document_versions_number_positive accepted version 0');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state)
       values (%L, 1, 'suite/bad-state', 'PENDING')$q$, v_doc),
    '23514', 'dms_document_versions_upload_state_check accepted PENDING');

  insert into public.dms_document_versions
    (document_id, version_number, storage_path, upload_state,
     checksum_sha256, size_bytes, mime_type)
  values (v_doc, 1, v_path, 'UPLOADED', v_sum, 2048, 'application/pdf')
  returning id into v_version;

  -- The three unique indexes on versions, each asked to refuse the exact
  -- duplication it exists to refuse -- and only that one, so the other two
  -- columns differ on every probe.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state, checksum_sha256)
       values (%L, 1, 'suite/second-v1', 'RESERVED', %L)$q$, v_doc, repeat('b', 64)),
    '23505', 'uq_dms_document_versions_number accepted a second version 1');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state, checksum_sha256)
       values (%L, 2, 'suite/same-bytes', 'RESERVED', %L)$q$, v_doc, v_sum),
    '23505', 'uq_dms_document_versions_checksum accepted the same bytes twice');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_versions
         (document_id, version_number, storage_path, upload_state, checksum_sha256)
       values (%L, 1, %L, 'RESERVED', %L)$q$, v_doc2, v_path, repeat('c', 64)),
    '23505', 'uq_dms_document_versions_path accepted two rows for one object');

  -- dms_document_links. The BEFORE trigger is the refusal a caller meets, so it
  -- is probed for both of its states: a type it cannot resolve to a table, and a
  -- type it can resolve to a table that holds no such row.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_links(document_id, entity_type, entity_id)
       values (%L, 'spaceship', gen_random_uuid())$q$, v_doc),
    '22023', 'trg_dms_check_link_target accepted entity_type spaceship');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_links(document_id, entity_type, entity_id)
       values (%L, 'staff_profile', gen_random_uuid())$q$, v_doc),
    '23503', 'trg_dms_check_link_target accepted a staff_profile that does not exist');

  -- dms_document_relations.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_relations(from_document_id, to_document_id, relation)
       values (%L, %L, 'RELATED')$q$, v_doc, v_doc),
    '23514', 'dms_document_relations_not_self accepted a document related to itself');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_relations(from_document_id, to_document_id, relation)
       values (%L, %L, 'GOSSIP')$q$, v_doc, v_doc2),
    '23514', 'dms_document_relations_relation_check accepted GOSSIP');

  insert into public.dms_document_relations(from_document_id, to_document_id, relation)
  values (v_doc, v_doc2, 'RELATED');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_relations(from_document_id, to_document_id, relation)
       values (%L, %L, 'RELATED')$q$, v_doc, v_doc2),
    '23505', 'dms_document_relations_unique accepted the same edge twice');
  delete from public.dms_document_relations
   where from_document_id = v_doc and to_document_id = v_doc2;

  -- dms_document_events. The vocabulary is closed; an event type nobody handles
  -- is a timeline entry the UI renders as a blank row.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_document_events(document_id, event_type)
       values (%L, 'GOSSIP')$q$, v_doc),
    '23514', 'dms_document_events_type_check accepted GOSSIP');

  -- extraction_jobs. status is the inherited enum, so a bad value is 22P02 from
  -- the type itself rather than 23514 from a check -- which is why review_state,
  -- engine, confidence, attempts and the failure text are the checks probed here.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.extraction_jobs(document_id, version_id, engine)
       values (%L, %L, 'PSYCHIC')$q$, v_doc, v_version),
    '23514', 'extraction_jobs_engine_check accepted PSYCHIC');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.extraction_jobs(document_id, version_id, review_state)
       values (%L, %L, 'MAYBE')$q$, v_doc, v_version),
    '23514', 'extraction_jobs_review_state_check accepted MAYBE');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.extraction_jobs(document_id, version_id, status)
       values (%L, %L, 'failed')$q$, v_doc, v_version),
    '23514', 'extraction_jobs_failure_explained accepted a failure with no error text');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.extraction_jobs(document_id, version_id, confidence)
       values (%L, %L, 150)$q$, v_doc, v_version),
    '23514', 'extraction_jobs_confidence_range accepted 150 percent confidence');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.extraction_jobs(document_id, version_id, attempts, max_attempts)
       values (%L, %L, 5, 3)$q$, v_doc, v_version),
    '23514', 'extraction_jobs_attempts_sane accepted attempt 5 of 3');

  insert into public.extraction_jobs(document_id, version_id, engine, status)
  values (v_doc, v_version, 'TESSERACT', 'completed')
  returning id into v_job;

  -- dms_extracted_fields.
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_extracted_fields(job_id, document_id, field_key)
       values (%L, %L, '  ')$q$, v_job, v_doc),
    '23514', 'dms_extracted_fields_key_present accepted a blank field key');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_extracted_fields(job_id, document_id, field_key, review_state)
       values (%L, %L, 'passport_number', 'MAYBE')$q$, v_job, v_doc),
    '23514', 'dms_extracted_fields_state_check accepted MAYBE');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_extracted_fields(job_id, document_id, field_key, review_state)
       values (%L, %L, 'passport_number', 'ACCEPTED')$q$, v_job, v_doc),
    '23514', 'dms_extracted_fields_reviewed_attributed accepted an unattributed acceptance');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_extracted_fields(job_id, document_id, field_key, confidence)
       values (%L, %L, 'passport_number', 150)$q$, v_job, v_doc),
    '23514', 'dms_extracted_fields_confidence_range accepted 150 percent confidence');

  insert into public.dms_extracted_fields(job_id, document_id, field_key)
  values (v_job, v_doc, 'passport_number');
  perform pg_temp.dms_refuses(format(
    $q$insert into public.dms_extracted_fields(job_id, document_id, field_key)
       values (%L, %L, 'passport_number')$q$, v_job, v_doc),
    '23505', 'dms_extracted_fields_unique accepted one field key twice on one job');

  -- evidence_packages. seal_complete is the one that matters most: it is what
  -- makes SEALED mean sealed rather than a status somebody typed.
  perform pg_temp.dms_refuses(
    $q$insert into public.evidence_packages(name) values ('   ')$q$,
    '23514', 'evidence_packages_name_present accepted a blank name');
  perform pg_temp.dms_refuses(
    $q$insert into public.evidence_packages(name, status)
       values ('DMS suite lowercase', 'open')$q$,
    '23514', 'evidence_packages_status_check accepted lowercase open');
  perform pg_temp.dms_refuses(
    $q$insert into public.evidence_packages(name, status)
       values ('DMS suite bare seal', 'SEALED')$q$,
    '23514', 'evidence_packages_seal_complete accepted SEALED with no digest');

  insert into public.evidence_packages(name, reference)
  values ('DMS suite reference holder', 'DMS-SUITE-REF-A') returning id into v_pkg;
  perform pg_temp.dms_refuses(
    $q$insert into public.evidence_packages(name, reference)
       values ('DMS suite reference twin', 'DMS-SUITE-REF-A')$q$,
    '23505', 'uq_evidence_packages_reference accepted a duplicate reference');

  raise notice '2a ok: every named constraint refused what it defends';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2b. Two disposable accounts, because separation of duties needs two.
--
-- The suite needs a second real account, not a second uuid:
-- private.dms_transition_review compares submitted_by against auth.uid(), so an
-- author and a reviewer that were the same person would make the refusal in 2d
-- unfalsifiable -- it would raise for every caller and prove nothing.
--
-- Both are OPERATIONS_MANAGER, the only non-ADMIN role that can both approve a
-- document and seal a package, so one role carries the whole lifecycle from 2c
-- to 2h. Which roles are denied approve and seal is a question about the matrix,
-- and Part 1o asks it of staff_permissions directly; here the point is only that
-- these two accounts can reach every step the rest of Part 2 walks.
--
-- The emails are fixed rather than random so Part 3 can assert, after the
-- rollback, that neither account survived.
-- ---------------------------------------------------------------------------
do $$
declare
  v_agency   uuid;
  v_branch   uuid;
  v_author   uuid;
  v_reviewer uuid;
begin
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT' limit 1;
  if v_agency is null then
    raise exception 'no DEFAULT/HQ agency: 20260324000300 seeds it, so the schema is incomplete';
  end if;

  v_author   := gen_random_uuid();
  v_reviewer := gen_random_uuid();
  insert into auth.users(id, email) values (v_author,   'dms-suite-author@invalid.test');
  insert into auth.users(id, email) values (v_reviewer, 'dms-suite-reviewer@invalid.test');
  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid, branch_id, is_active)
  values (v_author,   'OPERATIONS_MANAGER', v_agency, v_branch, v_branch::text, true),
         (v_reviewer, 'OPERATIONS_MANAGER', v_agency, v_branch, v_branch::text, true);

  perform pg_temp.dms_become('dms-suite-author@invalid.test');
  if public.staff_role() <> 'OPERATIONS_MANAGER' then
    raise exception 'the author session is not OPERATIONS_MANAGER: staff_role() is %',
      public.staff_role();
  end if;
  if not public.has_permission('dms_documents','approve') then
    raise exception 'OPERATIONS_MANAGER cannot approve documents, so 2d cannot prove anything';
  end if;
  if not public.has_permission('evidence_packages','seal') then
    raise exception 'OPERATIONS_MANAGER cannot seal packages, so 2g cannot prove anything';
  end if;
  raise notice '2b ok: author and reviewer are real OPERATIONS_MANAGER accounts';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2c. Reserve, then upload, then finalize -- in that order, because the
-- storage policy in section J only admits an object at a path a version row has
-- already claimed. This is the step the old schema had no equivalent of: a
-- storage_path was recorded and nothing ever confirmed bytes arrived at it.
--
-- The size/checksum probes are what make "verified" more than a column name, so
-- each one is asked for its own SQLSTATE rather than for any error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res     jsonb;
  v_fin     jsonb;
  v_doc     uuid;
  v_version uuid;
  v_path    text;
  v_sum     text := repeat('1', 64);
  v_state   text;
  v_n       integer;
  v_stored  boolean;
begin
  v_res := public.reserve_dms_upload_command(
    'DMS suite passport', 'PASSPORT', 'scan of a passport.PDF');
  v_doc     := (v_res->>'document_id')::uuid;
  v_version := (v_res->>'version_id')::uuid;
  v_path    := v_res->>'storage_path';

  if (v_res->>'document_number') !~ '^DOC-[0-9]{4}-[0-9]{6}$' then
    raise exception 'dms_next_document_number produced %, not DOC-YYYY-NNNNNN',
      v_res->>'document_number';
  end if;
  if (v_res->>'version_number')::int <> 1 or not (v_res->>'is_new_document')::boolean then
    raise exception 'the first reservation on a new document is not v1: %', v_res;
  end if;
  select upload_state into v_state from public.dms_document_versions where id = v_version;
  if v_state <> 'RESERVED' then
    raise exception 'a reservation is % rather than RESERVED', v_state;
  end if;
  select current_version_id is null, version_count into v_stored, v_n
    from public.dms_documents where id = v_doc;
  if not v_stored or v_n <> 0 then
    raise exception 'a reservation already counts as a version (current set=%, count=%)',
      not v_stored, v_n;
  end if;

  -- Nothing to review until bytes exist, and current_version_id is the only
  -- thing that says they do.
  perform pg_temp.dms_refuses(format(
    $q$select public.submit_dms_document_command(%L)$q$, v_doc),
    '22023', 'a document with no uploaded version was accepted for review');

  perform pg_temp.dms_refuses(format(
    $q$select public.finalize_dms_upload_command(%L, 2048, 'application/pdf', 'not-a-checksum')$q$,
    v_version),
    '22023', 'finalize accepted a checksum that is not 64 lowercase hex digits');
  perform pg_temp.dms_refuses(format(
    $q$select public.finalize_dms_upload_command(%L, 0, 'application/pdf', %L)$q$, v_version, v_sum),
    '22023', 'finalize accepted a zero-byte upload');
  perform pg_temp.dms_refuses(format(
    $q$select public.finalize_dms_upload_command(%L, 2048, '   ', %L)$q$, v_version, v_sum),
    '22023', 'finalize accepted a blank content type');

  -- The object-presence and size-agreement checks only exist where the storage
  -- schema does. On a deployment without it the two probes are skipped rather
  -- than faked, and the notice says so, because a skipped check reported as
  -- passed is worse than no check at all.
  if to_regclass('storage.objects') is not null then
    perform pg_temp.dms_refuses(format(
      $q$select public.finalize_dms_upload_command(%L, 2048, 'application/pdf', %L)$q$,
      v_version, v_sum),
      '22023', 'finalize accepted a version with no object at the reserved path');
    perform pg_temp.dms_put_object('dms', v_path, 2048);
    perform pg_temp.dms_refuses(format(
      $q$select public.finalize_dms_upload_command(%L, 4096, 'application/pdf', %L)$q$,
      v_version, v_sum),
      '22023', 'finalize accepted a size that disagrees with the stored object');
  else
    raise notice '2c: storage.objects is absent, so the object-presence checks are skipped';
  end if;

  v_fin := public.finalize_dms_upload_command(v_version, 2048, 'application/pdf', v_sum, 3);
  if (v_fin->>'version_count')::int <> 1 or (v_fin->>'review_status') <> 'DRAFT' then
    raise exception 'a finalized first version did not leave the document DRAFT with 1 version: %',
      v_fin;
  end if;
  if v_fin->>'extraction_job_id' is null then
    raise exception 'a PDF upload queued no extraction job';
  end if;

  select upload_state = 'UPLOADED' and uploaded_at is not null
           and size_bytes = 2048 and page_count = 3 and checksum_sha256 = v_sum
    into v_stored from public.dms_document_versions where id = v_version;
  if not v_stored then
    raise exception 'the finalized version did not record the bytes it was given';
  end if;
  select current_version_id = v_version, version_count
    into v_stored, v_n from public.dms_documents where id = v_doc;
  if not v_stored or v_n <> 1 then
    raise exception 'the document does not point at its finalized version (current=%, count=%)',
      v_stored, v_n;
  end if;

  select count(*) into v_n from public.extraction_jobs
   where version_id = v_version and status = 'pending';
  if v_n <> 1 then
    raise exception 'expected exactly one pending extraction job for the version, found %', v_n;
  end if;

  -- The timeline is the artefact that makes the lifecycle provable rather than
  -- asserted, so it is checked as a sequence and not as a set of four counts.
  if (select string_agg(event_type, '>' order by id) from public.dms_document_events
       where document_id = v_doc)
     <> 'CREATED>VERSION_RESERVED>VERSION_UPLOADED>EXTRACTION_QUEUED' then
    raise exception 'the upload timeline reads %', (select string_agg(event_type, '>' order by id)
      from public.dms_document_events where document_id = v_doc);
  end if;

  raise notice '2c ok: reserve, upload, finalize, and a timeline that says so';
end $$;

-- A document id, looked up by the title the suite gave it, so each block below
-- can stand alone instead of threading five uuids through eight DO blocks. It
-- refuses ambiguity rather than taking the first row: two rows here would mean
-- an earlier block ran twice, and every assertion after it would be about the
-- wrong document.
create or replace function pg_temp.dms_doc(p_title text)
returns uuid language plpgsql as $fn$
declare v_id uuid; v_n integer;
begin
  select count(*) into v_n from public.dms_documents where title = p_title;
  if v_n <> 1 then
    raise exception 'expected exactly one document titled %, found %', p_title, v_n;
  end if;
  select id into v_id from public.dms_documents where title = p_title;
  return v_id;
end $fn$;

-- ---------------------------------------------------------------------------
-- Part 2d. The review map: every edge walked, and the moves that are not edges
-- refused.
--
-- The order of the two guards inside private.dms_review_transition is load-
-- bearing and this block is what pins it down. The edge list is checked before
-- the permission, so DRAFT -> APPROVED is 22023 for every caller including an
-- ADMIN -- an impossible move is a fact about the document, not about the
-- account. Only once the move is possible does the permission decide, and only
-- inside the APPROVED branch does separation of duties get a say. That is why
-- the four refusals below all read 22023 and the one in the middle reads 42501:
-- if a future edit checked permissions first, this block would tell you.
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc      uuid := pg_temp.dms_doc('DMS suite passport');
  v_author   uuid;
  v_reviewer uuid;
  v_status   text;
  v_life     text;
  v_who      uuid;
  v_when     timestamptz;
begin
  select id into v_author   from auth.users where email = 'dms-suite-author@invalid.test';
  select id into v_reviewer from auth.users where email = 'dms-suite-reviewer@invalid.test';

  -- From DRAFT the only edge is PENDING_REVIEW. The other four targets are not
  -- reachable, and the author holds 'approve', so a 42501 here would mean the
  -- permission was consulted about a move that does not exist.
  perform pg_temp.dms_refuses(format($q$select public.approve_dms_document_command(%L)$q$, v_doc),
    '22023', 'a DRAFT document was approved without ever being reviewed');
  perform pg_temp.dms_refuses(format($q$select public.start_dms_review_command(%L)$q$, v_doc),
    '22023', 'a review started on a document nobody had submitted');
  perform pg_temp.dms_refuses(format(
    $q$select public.reject_dms_document_command(%L, 'no')$q$, v_doc),
    '22023', 'a DRAFT document was rejected before submission');
  perform pg_temp.dms_refuses(format(
    $q$select public.request_dms_changes_command(%L, 'redo it')$q$, v_doc),
    '22023', 'changes were requested on a document nobody had submitted');

  perform public.submit_dms_document_command(v_doc, 'Please review the passport scan');
  select review_status, submitted_by, submitted_at into v_status, v_who, v_when
    from public.dms_documents where id = v_doc;
  if v_status <> 'PENDING_REVIEW' or v_who <> v_author or v_when is null then
    raise exception 'submit left the document % submitted by % at %', v_status, v_who, v_when;
  end if;

  -- PENDING_REVIEW goes to UNDER_REVIEW or back to DRAFT. It does not go
  -- straight to a verdict: somebody has to pick the document up first.
  perform pg_temp.dms_refuses(format(
    $q$select public.reject_dms_document_command(%L, 'no')$q$, v_doc),
    '22023', 'a document was rejected without anyone starting the review');

  perform public.start_dms_review_command(v_doc);
  select review_status, reviewer_id, review_started_at into v_status, v_who, v_when
    from public.dms_documents where id = v_doc;
  if v_status <> 'UNDER_REVIEW' or v_who <> v_author or v_when is null then
    raise exception 'start review left the document % with reviewer % at %', v_status, v_who, v_when;
  end if;

  -- The refusal this whole slice exists for. The move is legal, the account holds
  -- 'approve', and it is still refused -- because it is the account that submitted.
  perform pg_temp.dms_refuses(format($q$select public.approve_dms_document_command(%L)$q$, v_doc),
    '42501', 'the account that submitted the document was allowed to approve it');

  perform pg_temp.dms_become('dms-suite-reviewer@invalid.test');
  perform public.approve_dms_document_command(v_doc, 'Scan is legible and matches the file');
  select review_status, approved_by, status::text into v_status, v_who, v_life
    from public.dms_documents where id = v_doc;
  if v_status <> 'APPROVED' or v_who <> v_reviewer then
    raise exception 'approval left the document % approved by %', v_status, v_who;
  end if;
  -- review_status and status are two columns and the UI reads both; an approval
  -- that moves one and not the other shows an active document as a draft.
  if v_life <> 'active' then
    raise exception 'an approved document has lifecycle status %', v_life;
  end if;

  -- APPROVED is terminal for the review map. There is no edge out of it except
  -- the expiry sweep in 2h and a new version in 2g.
  perform pg_temp.dms_refuses(format($q$select public.submit_dms_document_command(%L)$q$, v_doc),
    '22023', 'an approved document was submitted for review again');
  perform pg_temp.dms_refuses(format($q$select public.approve_dms_document_command(%L)$q$, v_doc),
    '22023', 'an approved document was approved twice');
  perform pg_temp.dms_refuses(format($q$select public.reopen_dms_document_command(%L)$q$, v_doc),
    '22023', 'an approved document was reopened as a draft');

  raise notice '2d ok: the map refuses its non-edges and separation of duties holds';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2e. The rest of the map, on a second document, submitted by the other
-- account.
--
-- 2d proved the author cannot approve what the author submitted. On its own that
-- is compatible with a rule hard-coded against one account, so here the reviewer
-- submits and the author approves. Separation of duties has to bind whoever
-- submitted, not a particular person.
--
-- The walk is deliberately the long way round. Nine edges exist and 2d used
-- four of them; this block closes the other five -- CHANGES_REQUESTED to
-- PENDING_REVIEW and to DRAFT, PENDING_REVIEW back to DRAFT, UNDER_REVIEW to
-- REJECTED and to CHANGES_REQUESTED -- so "every edge is walked" is a statement
-- about this file and not a hope.
--
-- The document is text/plain, which also settles the extraction allow-list: a
-- plain text file must not queue an OCR job.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res      jsonb;
  v_fin      jsonb;
  v_doc      uuid;
  v_ver      uuid;
  v_path     text;
  v_sum      text := repeat('2', 64);
  v_author   uuid;
  v_reviewer uuid;
  v_status   text;
  v_who      uuid;
  v_note     text;
begin
  select id into v_author   from auth.users where email = 'dms-suite-author@invalid.test';
  select id into v_reviewer from auth.users where email = 'dms-suite-reviewer@invalid.test';
  if auth.uid() <> v_reviewer then
    raise exception '2e expects the reviewer session 2d left behind, not %', auth.uid();
  end if;

  v_res  := public.reserve_dms_upload_command('DMS suite invoice', 'INVOICE', 'supplier bill.txt');
  v_doc  := (v_res->>'document_id')::uuid;
  v_ver  := (v_res->>'version_id')::uuid;
  v_path := v_res->>'storage_path';
  perform pg_temp.dms_put_object('dms', v_path, 512);
  v_fin  := public.finalize_dms_upload_command(v_ver, 512, 'text/plain', v_sum);
  if v_fin->>'extraction_job_id' is not null then
    raise exception 'a text/plain upload queued extraction; the mime allow-list does nothing';
  end if;

  perform public.submit_dms_document_command(v_doc);            -- DRAFT -> PENDING_REVIEW
  perform public.start_dms_review_command(v_doc);               -- PENDING_REVIEW -> UNDER_REVIEW

  -- A verdict of "change it" that does not say what to change is not a verdict.
  perform pg_temp.dms_refuses(format(
    $q$select public.request_dms_changes_command(%L, '   ')$q$, v_doc),
    '22023', 'changes were requested with no note');
  perform public.request_dms_changes_command(v_doc, 'The total does not match the line items');
  select review_status, review_notes into v_status, v_note
    from public.dms_documents where id = v_doc;
  if v_status <> 'CHANGES_REQUESTED' or v_note is null then
    raise exception 'request changes left the document % with note %', v_status, v_note;
  end if;

  perform public.submit_dms_document_command(v_doc);  -- CHANGES_REQUESTED -> PENDING_REVIEW
  perform public.reopen_dms_document_command(v_doc);  -- PENDING_REVIEW -> DRAFT
  select review_status, submitted_by into v_status, v_who
    from public.dms_documents where id = v_doc;
  if v_status <> 'DRAFT' or v_who is not null then
    raise exception 'reopening left the document % still submitted by %', v_status, v_who;
  end if;

  perform public.submit_dms_document_command(v_doc);
  perform public.start_dms_review_command(v_doc);
  perform public.request_dms_changes_command(v_doc, 'Attach the delivery note as well');
  perform public.reopen_dms_document_command(v_doc);  -- CHANGES_REQUESTED -> DRAFT

  perform public.submit_dms_document_command(v_doc);
  perform public.start_dms_review_command(v_doc);
  -- A rejection with no reason is a support ticket nobody can answer.
  perform pg_temp.dms_refuses(format(
    $q$select public.reject_dms_document_command(%L, '')$q$, v_doc),
    '22023', 'a document was rejected with no reason');
  perform public.reject_dms_document_command(v_doc, 'Wrong supplier on the header');
  select review_status, rejection_reason into v_status, v_note
    from public.dms_documents where id = v_doc;
  if v_status <> 'REJECTED' or v_note <> 'Wrong supplier on the header' then
    raise exception 'rejection left the document % because %', v_status, v_note;
  end if;

  perform public.reopen_dms_document_command(v_doc);  -- REJECTED -> DRAFT
  if (select rejection_reason from public.dms_documents where id = v_doc) is not null then
    raise exception 'a reopened document still carries the reason it was rejected for';
  end if;

  perform public.submit_dms_document_command(v_doc);
  perform public.start_dms_review_command(v_doc);

  -- The mirror of 2d: this time the reviewer is the one who submitted, so the
  -- reviewer is the one refused and the author is the one who can finish it.
  perform pg_temp.dms_refuses(format($q$select public.approve_dms_document_command(%L)$q$, v_doc),
    '42501', 'separation of duties is bound to one account rather than to the submitter');

  perform pg_temp.dms_become('dms-suite-author@invalid.test');
  perform public.approve_dms_document_command(v_doc, 'Corrected header checks out');
  select review_status, approved_by into v_status, v_who
    from public.dms_documents where id = v_doc;
  if v_status <> 'APPROVED' or v_who <> v_author then
    raise exception 'the second approval left the document % approved by %', v_status, v_who;
  end if;

  -- Every state the walk passed through has to be in the timeline, or the audit
  -- trail is a summary rather than a record.
  if (select count(distinct event_type) from public.dms_document_events
       where document_id = v_doc
         and event_type in ('SUBMITTED','REVIEW_STARTED','CHANGES_REQUESTED',
                            'REJECTED','RESTORED','APPROVED')) <> 6 then
    raise exception 'the review timeline is missing states the walk passed through: %',
      (select string_agg(distinct event_type, ',' order by event_type)
         from public.dms_document_events where document_id = v_doc);
  end if;

  raise notice '2e ok: all nine edges walked, and duties bind the submitter';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2f. Extraction, and the field-level review that makes it usable.
--
-- The inherited table held a JSONB blob and a status. A blob cannot be reviewed
-- one field at a time, cannot record who corrected what, and cannot be partially
-- accepted -- so "OCR -> review" was a step with nowhere to happen. These
-- assertions are about the rows the blob became: two fields, each with its own
-- state and its own reviewer, and a job state that is recomputed from them
-- rather than typed in.
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc   uuid := pg_temp.dms_doc('DMS suite passport');
  v_job   uuid;
  v_ver   uuid;
  v_field uuid;
  v_state text;
  v_val   text;
  v_who   uuid;
  v_n     integer;
begin

  select id, version_id into v_job, v_ver from public.extraction_jobs
   where document_id = v_doc and status = 'pending';
  if v_job is null then
    raise exception '2c left no pending extraction job to record a result against';
  end if;

  perform pg_temp.dms_refuses(format(
    $q$select public.record_dms_extraction_result_command(%L, 'psychic')$q$, v_job),
    '22023', 'a result was recorded with a status outside processing/completed/failed');
  perform pg_temp.dms_refuses(format(
    $q$select public.record_dms_extraction_result_command(%L, 'failed')$q$, v_job),
    '22023', 'a failed extraction was recorded with no error message');

  perform public.record_dms_extraction_result_command(v_job, 'completed',
    $j$[{"key":"passport_number","label":"Passport number","raw_value":"AB1234567",
         "confidence":91.5,"page_number":1},
        {"key":"expiry_date","label":"Expiry date","raw_value":"2031-04-30",
         "confidence":88.25,"page_number":1}]$j$::jsonb, 89.875);

  select count(*) into v_n from public.dms_extracted_fields
   where job_id = v_job and review_state = 'PENDING';
  if v_n <> 2 then
    raise exception 'the completed job produced % pending fields rather than 2', v_n;
  end if;
  select status::text, review_state, attempts into v_state, v_val, v_n
    from public.extraction_jobs where id = v_job;
  if v_state <> 'completed' or v_val <> 'NOT_REVIEWED' or v_n <> 1 then
    raise exception 'the completed job reads %/% on attempt %', v_state, v_val, v_n;
  end if;

  -- A machine result is not a fact until a person says so, and a job that can be
  -- overwritten after the fact is not a record of what the machine read.
  perform pg_temp.dms_refuses(format(
    $q$select public.record_dms_extraction_result_command(%L, 'completed')$q$, v_job),
    '22023', 'a completed extraction job was recorded over');

  select id into v_field from public.dms_extracted_fields
   where job_id = v_job and field_key = 'passport_number';
  perform pg_temp.dms_refuses(format(
    $q$select public.review_dms_extracted_field_command(%L, 'SHRUG')$q$, v_field),
    '22023', 'a field review action outside ACCEPT/CORRECT/REJECT was accepted');

  perform public.review_dms_extracted_field_command(v_field, 'ACCEPT');
  select review_state, value, reviewed_by into v_state, v_val, v_who
    from public.dms_extracted_fields where id = v_field;
  if v_state <> 'ACCEPTED' or v_val <> 'AB1234567' or v_who <> auth.uid() then
    raise exception 'accepting a field left it %/% reviewed by %', v_state, v_val, v_who;
  end if;
  if (select review_state from public.extraction_jobs where id = v_job)
       <> 'PARTIALLY_REVIEWED' then
    raise exception 'one of two fields reviewed did not make the job PARTIALLY_REVIEWED';
  end if;

  select id into v_field from public.dms_extracted_fields
   where job_id = v_job and field_key = 'expiry_date';
  perform pg_temp.dms_refuses(format(
    $q$select public.review_dms_extracted_field_command(%L, 'CORRECT', '')$q$, v_field),
    '22023', 'a correction was accepted with nothing to correct it to');
  perform public.review_dms_extracted_field_command(v_field, 'CORRECT', '2031-05-01');
  select review_state, value into v_state, v_val
    from public.dms_extracted_fields where id = v_field;
  if v_state <> 'CORRECTED' or v_val <> '2031-05-01' then
    raise exception 'correcting a field left it %/%', v_state, v_val;
  end if;
  select review_state, reviewed_by into v_state, v_who
    from public.extraction_jobs where id = v_job;
  if v_state <> 'REVIEWED' or v_who is null then
    raise exception 'both fields reviewed left the job % reviewed by %', v_state, v_who;
  end if;

  -- A finished job is not a reason to refuse a fresh one: the same version can be
  -- read again by a better engine. Two open jobs for one version is the thing
  -- that has to be refused, because two workers would then race on one row.
  perform public.queue_dms_extraction_command(v_doc, 'TESSERACT');
  perform pg_temp.dms_refuses(format(
    $q$select public.queue_dms_extraction_command(%L, 'TESSERACT')$q$, v_doc),
    '22023', 'a second extraction job was queued for a version that already has one open');

  select id into v_job from public.extraction_jobs
   where document_id = v_doc and status = 'pending';
  perform public.record_dms_extraction_result_command(v_job, 'failed', '[]'::jsonb, null,
    'The OCR engine timed out after 30s');
  select status::text, error_message into v_state, v_val
    from public.extraction_jobs where id = v_job;
  if v_state <> 'failed' or v_val is null then
    raise exception 'a failed job reads % with error %', v_state, v_val;
  end if;

  if (select count(distinct event_type) from public.dms_document_events
       where document_id = v_doc
         and event_type in ('EXTRACTION_COMPLETED','EXTRACTION_FAILED',
                            'FIELD_ACCEPTED','FIELD_CORRECTED')) <> 4 then
    raise exception 'the extraction timeline is missing steps the block just walked';
  end if;

  raise notice '2f ok: extraction recorded once, reviewed field by field, and retried';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2g. Links to business objects, and relations between documents.
--
-- The inherited table carried polymorphic_id / polymorphic_type: an untyped pair
-- pointing at nothing in particular, with no way to ask what a document is about
-- and no way to stop it pointing at a row that does not exist. What replaced it
-- is checked here through the commands rather than by direct DML, because the
-- interesting behaviour is not the constraint -- 2a already probed that -- but
-- what a caller gets back when the edge already exists.
--
-- Linking twice is not an error. The caller asked for an edge and the edge is
-- there; returning created:false says which of the two happened without making a
-- correct end state look like a failure. A unique violation here would be an
-- error report about a database that is in exactly the right state.
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc      uuid := pg_temp.dms_doc('DMS suite passport');
  v_doc2     uuid := pg_temp.dms_doc('DMS suite invoice');
  v_reviewer uuid;
  v_link     jsonb;
  v_rel      jsonb;
  v_n        integer;
begin
  select id into v_reviewer from auth.users where email = 'dms-suite-reviewer@invalid.test';

  v_link := public.link_dms_document_command(v_doc, 'staff_profile', v_reviewer, 'SIGNED_BY');
  if not (v_link->>'created')::boolean then
    raise exception 'the first link reported created:false';
  end if;
  v_link := public.link_dms_document_command(v_doc, 'staff_profile', v_reviewer, 'SIGNED_BY');
  if (v_link->>'created')::boolean then
    raise exception 'linking the same edge twice reported a second edge was created';
  end if;
  select count(*) into v_n from public.dms_document_links
   where document_id = v_doc and entity_type = 'staff_profile';
  if v_n <> 1 then
    raise exception 'two calls for one edge left % rows', v_n;
  end if;

  -- The target resolves and the row exists, so the relation vocabulary is the
  -- next thing in the way. This is the constraint the trigger in 2a shadowed.
  perform pg_temp.dms_refuses(format(
    $q$select public.link_dms_document_command(%L, 'staff_profile', %L, 'BEFRIENDS')$q$,
    v_doc, v_reviewer),
    '23514', 'dms_document_links_relation_check accepted BEFRIENDS');

  perform public.unlink_dms_document_command((v_link->>'link_id')::uuid);
  select count(*) into v_n from public.dms_document_links where document_id = v_doc;
  if v_n <> 0 then
    raise exception 'unlinking left % links behind', v_n;
  end if;
  if not exists (select 1 from public.dms_document_events
                  where document_id = v_doc and event_type = 'LINK_REMOVED') then
    raise exception 'removing a link left nothing in the timeline';
  end if;

  perform pg_temp.dms_refuses(format(
    $q$select public.relate_dms_documents_command(%L, %L, 'RELATED')$q$, v_doc, v_doc),
    '22023', 'a document was related to itself through the command');

  v_rel := public.relate_dms_documents_command(v_doc, v_doc2, 'RELATED');
  if not (v_rel->>'created')::boolean then
    raise exception 'the first relation reported created:false';
  end if;
  if (public.relate_dms_documents_command(v_doc, v_doc2, 'RELATED')->>'created')::boolean then
    raise exception 'relating the same pair twice reported a second edge was created';
  end if;
  perform public.unrelate_dms_documents_command((v_rel->>'relation_id')::uuid);
  if exists (select 1 from public.dms_document_relations
              where from_document_id = v_doc and to_document_id = v_doc2) then
    raise exception 'unrelating left the edge in place';
  end if;

  raise notice '2g ok: edges are idempotent, and removing one says so';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2h. Evidence packages: sealing, and what a seal is worth afterwards.
--
-- A status column spelled SEALED proves nothing -- 2a already showed the
-- constraint refuses one without a digest. What this block is about is the
-- property that makes the digest worth taking: it is recomputed on read, over the
-- exact version rows the members pointed at when the seal was taken.
--
-- So the interesting case is not "a new version breaks the seal". It must not:
-- the package sealed particular bytes and those bytes have not changed. A new
-- version is drift -- something a reader should be told about, and the verify
-- result reports it -- while matches stays true. The seal only breaks when the
-- membership itself is rewritten, which is the last probe here and the only
-- honest way to show the digest is not simply echoed back from its own column.
--
-- SUPERSEDES lands here rather than in 2g because its side effect is the fixture:
-- flipping an approved member to SUPERSEDED is how the "every member must be
-- approved" refusal gets something to refuse.
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc      uuid := pg_temp.dms_doc('DMS suite passport');
  v_doc2     uuid := pg_temp.dms_doc('DMS suite invoice');
  v_doc3     uuid;
  v_pkg      uuid;
  v_res      jsonb;
  v_ver      jsonb;
  v_seal     text;
  v_path     text;
  v_version  uuid;
begin
  perform pg_temp.dms_refuses(
    $q$select public.create_dms_evidence_package_command('   ')$q$,
    '22023', 'an evidence package was created with no name');
  v_pkg := (public.create_dms_evidence_package_command(
    'DMS suite evidence', 'Suite fixture', 'DMS-SUITE-PKG-1')->>'evidence_package_id')::uuid;

  perform pg_temp.dms_refuses(format(
    $q$select public.seal_dms_evidence_package_command(%L)$q$, v_pkg),
    '22023', 'an empty evidence package was sealed');

  -- A reservation with no finalized upload has no bytes to seal over, and
  -- current_version_id is the only thing that says so.
  v_res  := public.reserve_dms_upload_command('DMS suite unfinished', 'CONTRACT', 'draft.pdf');
  v_doc3 := (v_res->>'document_id')::uuid;
  perform pg_temp.dms_refuses(format(
    $q$select public.set_dms_package_document_command(%L, %L, true)$q$, v_pkg, v_doc3),
    '22023', 'a document with no uploaded version was added to a package');

  perform public.set_dms_package_document_command(v_pkg, v_doc, true, 'Identity');
  v_res := public.set_dms_package_document_command(v_pkg, v_doc2, true, 'Cost');
  if (v_res->>'document_count')::int <> 2 then
    raise exception 'the package holds % members rather than 2', v_res->>'document_count';
  end if;

  -- SUPERSEDES flips its approved target out of APPROVED, which is exactly the
  -- fixture the next refusal needs.
  perform public.relate_dms_documents_command(v_doc, v_doc2, 'SUPERSEDES',
    'The passport file replaces the invoice for this package');
  if (select review_status from public.dms_documents where id = v_doc2) <> 'SUPERSEDED' then
    raise exception 'SUPERSEDES left its approved target at %',
      (select review_status from public.dms_documents where id = v_doc2);
  end if;
  -- The reverse edge is the case worth probing rather than a longer chain: a
  -- freshly superseded document supersedes nothing, so its own outward walk ends
  -- immediately, and a cycle guard that walks from the wrong end reports no cycle
  -- here while refusing legal shortcuts elsewhere. 22023 is the whole assertion.
  perform pg_temp.dms_refuses(format(
    $q$select public.relate_dms_documents_command(%L, %L, 'SUPERSEDES')$q$, v_doc2, v_doc),
    '22023', 'a supersede cycle was accepted');

  -- The seal reads each member's state now, not the state it had when it was
  -- added. doc2 was approved when it joined and is SUPERSEDED a statement later,
  -- and that is the difference this refusal measures.
  perform pg_temp.dms_refuses(format(
    $q$select public.seal_dms_evidence_package_command(%L)$q$, v_pkg),
    '22023', 'a package holding a SUPERSEDED document was sealed');

  v_res := public.set_dms_package_document_command(v_pkg, v_doc2, false);
  if (v_res->>'document_count')::int <> 1 then
    raise exception 'removing a member left % members rather than 1', v_res->>'document_count';
  end if;

  v_res  := public.seal_dms_evidence_package_command(v_pkg, 'Suite seal');
  v_seal := v_res->>'seal_checksum';
  if v_seal !~ '^[0-9a-f]{64}$' then
    raise exception 'the seal checksum reads % rather than 64 hex characters', v_seal;
  end if;
  if (select status from public.evidence_packages where id = v_pkg) <> 'SEALED'
     or (select sealed_by from public.evidence_packages where id = v_pkg) is null
     or (select seal_checksum from public.evidence_packages where id = v_pkg) <> v_seal then
    raise exception 'sealing did not record status, sealed_by and the checksum together';
  end if;

  v_res := public.verify_dms_evidence_package_command(v_pkg);
  if (v_res->>'matches')::boolean is not true then
    raise exception 'a package verified false immediately after being sealed';
  end if;
  if v_res->>'recomputed_checksum' <> v_seal then
    raise exception 'the recomputed digest % differs from the stored seal %',
      v_res->>'recomputed_checksum', v_seal;
  end if;
  if jsonb_array_length(v_res->'drift') <> 0 then
    raise exception 'a freshly sealed package reports drift %', v_res->'drift';
  end if;

  -- A sealed package is closed to every kind of change, and each refusal below is
  -- a separate guard in a separate function. The two membership probes name doc2
  -- rather than the unfinished doc3 on purpose: doc3 would also be refused, but for
  -- having no version, and a probe with two possible reasons proves neither.
  perform pg_temp.dms_refuses(format(
    $q$select public.set_dms_package_document_command(%L, %L, true)$q$, v_pkg, v_doc2),
    '22023', 'a member was added to a sealed package');
  perform pg_temp.dms_refuses(format(
    $q$select public.set_dms_package_document_command(%L, %L, false)$q$, v_pkg, v_doc),
    '22023', 'a member was removed from a sealed package');
  perform pg_temp.dms_refuses(format(
    $q$select public.update_dms_evidence_package_command(%L, 'Renamed after sealing')$q$, v_pkg),
    '22023', 'a sealed package was renamed');
  perform pg_temp.dms_refuses(format(
    $q$select public.void_dms_evidence_package_command(%L, 'changed my mind')$q$, v_pkg),
    '22023', 'a sealed package was voided');

  -- Deletion is the exception, and 42501 rather than 22023 is the honest expectation:
  -- no role in the matrix holds evidence_packages.delete at all, so the permission
  -- gate answers before the sealed-status guard is ever reached and this account
  -- cannot distinguish a sealed package from an open one. Part 1o is where that
  -- absence is asserted as a fact about the matrix; here it is asserted as a fact
  -- about the call, and the two together are what make the claim falsifiable -- if
  -- someone grants the action later, this probe changes SQLSTATE and says so.
  perform pg_temp.dms_refuses(format(
    $q$select public.delete_dms_evidence_package_command(%L)$q$, v_pkg),
    '42501', 'an evidence package was deletable by a non-ADMIN account');

  -- Drift, which is the part most easily got wrong. The digest pins version_id,
  -- so a new version of a sealed member must NOT break the seal: the package
  -- sealed particular bytes and those bytes are untouched. What it must do is
  -- announce itself, so matches stays true while drift names the document.
  v_res     := public.reserve_dms_upload_command('DMS suite passport', 'PASSPORT', 'rescan.pdf', v_doc);
  v_version := (v_res->>'version_id')::uuid;
  v_path    := v_res->>'storage_path';
  perform pg_temp.dms_put_object('dms', v_path, 3072);
  v_ver := public.finalize_dms_upload_command(
    v_version, 3072, 'application/pdf', repeat('3', 64));
  if (v_ver->>'version_number')::int <> 2 then
    raise exception 'the rescan became version % rather than 2', v_ver->>'version_number';
  end if;

  v_res := public.verify_dms_evidence_package_command(v_pkg);
  if (v_res->>'matches')::boolean is not true then
    raise exception 'a new version of a member broke a seal it does not belong to';
  end if;
  if v_res->>'recomputed_checksum' <> v_seal then
    raise exception 'the digest moved when the sealed bytes did not: % vs %',
      v_res->>'recomputed_checksum', v_seal;
  end if;
  if jsonb_array_length(v_res->'drift') <> 1
     or (v_res->'drift'->0->>'document_id')::uuid <> v_doc then
    raise exception 'drift after a new version reads %', v_res->'drift';
  end if;

  -- The same two facts, through the read model the UI actually calls, because a
  -- correct digest that the list never surfaces tells a reader nothing.
  select x into v_ver
    from jsonb_array_elements(public.get_dms_evidence_packages(50)) as t(x)
   where (x->>'id')::uuid = v_pkg;
  if v_ver is null then
    raise exception 'the sealed package is missing from get_dms_evidence_packages';
  end if;
  if (v_ver->>'seal_matches')::boolean is not true
     or (v_ver->>'drifted_documents')::int <> 1 then
    raise exception 'the read model reports seal_matches=% drifted_documents=%',
      v_ver->>'seal_matches', v_ver->>'drifted_documents';
  end if;

  -- And now the only honest way to show the digest is recomputed rather than read
  -- back out of its own column: rewrite the membership underneath it by direct
  -- DML, which no command surface allows, and watch matches turn false.
  update public.evidence_package_documents
     set version_id = v_version
   where evidence_package_id = v_pkg and document_id = v_doc;
  v_res := public.verify_dms_evidence_package_command(v_pkg);
  if (v_res->>'matches')::boolean is not false then
    raise exception 'the seal still matched after its membership was repointed';
  end if;

  -- Deletion, refused for a reason the review status alone cannot explain. The
  -- rescan reset doc1 to DRAFT, so the "an approved document archives, it does not
  -- disappear" guard is not the one firing here -- membership of a sealed package
  -- is, and that guard sits after the status guard in the same function.
  if (select review_status from public.dms_documents where id = v_doc) <> 'DRAFT' then
    raise exception 'the rescan left the sealed member at % rather than DRAFT',
      (select review_status from public.dms_documents where id = v_doc);
  end if;
  perform pg_temp.dms_refuses(format(
    $q$select public.delete_dms_document_command(%L)$q$, v_doc),
    '22023', 'a document sealed into a package was deleted');

  raise notice '2h: seal, verify and drift hold -- a new version is announced, not fatal';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2i. Expiry and deletion: the two places where time and absence get a
-- vote. The sweep is agency-scoped and hits every approved row in scope, not
-- only the two this suite planted, so every count below is asserted as ">= 1".
-- An equality there would be a test that fails the first time someone adds a
-- fixture elsewhere -- which teaches the next reader to widen assertions rather
-- than trust them.
--
-- There is deliberately no expire_dms_document_command: expiry is something a
-- date does, not something a person asserts, so the only way in is the sweep.
-- Deletion closes the section because it is the one operation the events ledger
-- cannot reconstruct -- and the storage row it leaves behind is the reason
-- dms_storage_orphans has no foreign key to the document it names.
-- ---------------------------------------------------------------------------
do $$
declare
  v_expired  uuid;
  v_expiring uuid;
  v_doc3     uuid := pg_temp.dms_doc('DMS suite unfinished');
  v_res      jsonb;
  v_path     text;
  v_n        integer;
begin
  perform pg_temp.dms_become('dms-suite-author@invalid.test');

  -- Two documents: one already past its date, one inside its notice window.
  -- text/plain keeps extraction out of this block -- that is 2f's subject, and a
  -- queued job here would only add noise to the event timelines asserted below.
  v_res := public.reserve_dms_upload_command('DMS suite expired', 'VISA', 'lapsed.txt',
             p_expires_on => current_date - 10);
  v_expired := (v_res->>'document_id')::uuid;
  perform pg_temp.dms_put_object('dms', v_res->>'storage_path', 1024);
  perform public.finalize_dms_upload_command(
    (v_res->>'version_id')::uuid, 1024, 'text/plain', repeat('4', 64));
  perform public.submit_dms_document_command(v_expired, 'Ready for review');

  v_res := public.reserve_dms_upload_command('DMS suite expiring', 'VISA', 'soon.txt',
             p_expires_on => current_date + 5);
  v_expiring := (v_res->>'document_id')::uuid;
  perform pg_temp.dms_put_object('dms', v_res->>'storage_path', 1024);
  perform public.finalize_dms_upload_command(
    (v_res->>'version_id')::uuid, 1024, 'text/plain', repeat('5', 64));
  perform public.submit_dms_document_command(v_expiring, 'Ready for review');

  -- The reviewer approves both, because separation of duties would refuse the
  -- author -- 2d and 2e prove that; here it is simply the shape of a fixture that
  -- has to reach APPROVED to be sweepable at all.
  perform pg_temp.dms_become('dms-suite-reviewer@invalid.test');
  perform public.start_dms_review_command(v_expired);
  perform public.approve_dms_document_command(v_expired, 'Approved so the sweep has something to find');
  perform public.start_dms_review_command(v_expiring);
  perform public.approve_dms_document_command(v_expiring, 'Approved inside its notice window');

  -- One sweep, then both documents are asked what happened to them.
  v_res := public.run_dms_expiry_sweep_command();
  if (v_res->>'expired')::int < 1 or (v_res->>'notified')::int < 1 then
    raise exception 'the sweep reported expired=% notified=%',
      v_res->>'expired', v_res->>'notified';
  end if;

  if (select review_status from public.dms_documents where id = v_expired) <> 'EXPIRED' then
    raise exception 'a document ten days past its date is still %',
      (select review_status from public.dms_documents where id = v_expired);
  end if;
  if not exists (select 1 from public.dms_document_events
                  where document_id = v_expired and event_type = 'EXPIRED') then
    raise exception 'expiry moved the status without leaving an EXPIRED event';
  end if;

  -- A notice is not a state change. The document inside its window must still be
  -- APPROVED afterwards, or the sweep has quietly retired a valid document.
  if (select expiry_notified_at from public.dms_documents where id = v_expiring) is null
     or (select review_status from public.dms_documents where id = v_expiring) <> 'APPROVED' then
    raise exception 'the document inside its notice window reads status=% notified=%',
      (select review_status from public.dms_documents where id = v_expiring),
      (select expiry_notified_at from public.dms_documents where id = v_expiring);
  end if;
  if not exists (select 1 from public.dms_document_events
                  where document_id = v_expiring and event_type = 'EXPIRY_NOTICE') then
    raise exception 'a notice was stamped on the row with no EXPIRY_NOTICE event';
  end if;

  -- Running it twice is the interesting part: a warning sent every night is a
  -- warning nobody reads. expiry_notified_at is the filter that makes the sweep
  -- idempotent, so the second run must notify nothing at all -- and that is an
  -- equality rather than a ">= 1" precisely because the first run drained the set.
  v_res := public.run_dms_expiry_sweep_command();
  if (v_res->>'notified')::int <> 0 or (v_res->>'expired')::int <> 0 then
    raise exception 'a second sweep moved expired=% notified=%',
      v_res->>'expired', v_res->>'notified';
  end if;

  -- Deletion refused for the archive reasons, then allowed for the one case that
  -- is genuinely a mistake rather than a record: a reservation nobody uploaded to.
  perform pg_temp.dms_refuses(format(
    $q$select public.delete_dms_document_command(%L)$q$, v_expired),
    '22023', 'an EXPIRED document was deleted rather than archived');

  select storage_path into v_path from public.dms_document_versions where document_id = v_doc3;
  if v_path is null then
    raise exception 'the unfinished document lost its reserved version before deletion';
  end if;
  v_res := public.delete_dms_document_command(v_doc3);
  if (v_res->>'orphaned_objects')::int <> 1 then
    raise exception 'deleting a one-version document orphaned % objects',
      v_res->>'orphaned_objects';
  end if;
  if exists (select 1 from public.dms_documents where id = v_doc3) then
    raise exception 'the document survived its own deletion';
  end if;
  if exists (select 1 from public.dms_document_versions where document_id = v_doc3) then
    raise exception 'a version row outlived the document it belongs to';
  end if;

  -- The row that is supposed to outlive it. dms_storage_orphans.document_id carries
  -- no foreign key on purpose: a cascade there would delete the only record of
  -- which bytes still need removing, which is how a storage leak becomes permanent.
  select count(*) into v_n from public.dms_storage_orphans
   where document_id = v_doc3 and storage_path = v_path and purged_at is null;
  if v_n <> 1 then
    raise exception 'the delete left % pending orphan rows for the reserved path', v_n;
  end if;

  raise notice '2i: expiry fires once, notices do not repeat, and a deleted document leaves its bytes on the ledger';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Part 3. The residue check, which is the only reason Part 2 was allowed to
-- write at all. Everything above ran inside one transaction and the rollback
-- undid it; this asks the database to agree rather than assuming it.
--
-- There is no clause here for the dms_storage_orphans row that 2i created, and
-- that is deliberate rather than an omission: it was written inside the same
-- transaction as the accounts and the documents, and Postgres does not roll back
-- part of one. A clause that tried to name it would have to guess at a generated
-- storage path, and a residue check that can be wrong is worse than one clause
-- shorter. The rows below are the ones with names the suite chose itself.
--
-- The trailing column reports the role the session holds now. set_config with
-- is_local = true is transaction-local, so this must read as the runner's own
-- role: a suite that leaked a simulated identity into the connection would leave
-- every later gate in the chain quietly asking its questions as somebody else.
-- ---------------------------------------------------------------------------
select 'dms_suite_left_no_residue' as check_name,
       not exists (select 1 from public.dms_documents where title like 'DMS suite%')
   and not exists (select 1 from public.evidence_packages where name like 'DMS suite%')
   and not exists (select 1 from public.dms_document_versions where storage_path like 'suite/%')
   and not exists (select 1 from auth.users where email like 'dms-suite-%@invalid.test') as pass,
       coalesce(public.staff_role(), 'no staff profile') as session_role_after_rollback;

