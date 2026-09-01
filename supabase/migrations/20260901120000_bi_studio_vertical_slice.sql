-- 20260901120000_bi_studio_vertical_slice.sql
-- Gap-analysis item 3, and the BI half of item 10: a semantic layer that answers
-- questions, not four tables that describe one.
--
--   source registry -> dataset -> dimensions + metrics -> compiled query
--                   -> saved analysis -> report -> dashboard
--                   -> drill-down -> drill-through -> lineage -> query ledger
--
-- 20260822000011_bi_semantic_layer created bi_datasets, bi_metrics, bi_reports and
-- bi_visualizations and stopped. bi_metrics.formula is a TEXT column that nothing
-- reads; bi_datasets.schema_def is a JSONB column that nothing writes; no function
-- in the repository turns either into a number. A semantic layer whose formulas are
-- never evaluated is a table of strings, which is precisely the shape item 10 names.
--
-- So the load-bearing thing this file adds is a compiler: private.bi_compile_query
-- turns (dataset, dimensions, metrics, filters, grain) into one SQL statement and
-- private.bi_run_query executes it, times it, and writes what it ran into a ledger.
-- Everything else here exists to make that compiler safe to point at a live schema.
--
-- Five defects in the original four tables are closed on the way, each one a reason
-- the schema could not have been used as delivered:
--
--   1. agency_id is nullable with no default. current_staff_agency_id() is NULL for
--      a session with no active staff profile, so a row written from one is
--      invisible to every reader including its author -- `agency_id = f()` is NULL,
--      not true. Made NOT NULL, with the house default.
--
--   2. There is no branch_id anywhere, and the policies ask only
--      `agency_id = current_staff_agency_id()`. A branch-scoped clerk saw the whole
--      agency's datasets. Added, and the policies rewritten to
--      has_permission(resource, verb) and row_in_staff_scope(agency_id, branch_id).
--
--   3. Those policies are FOR ALL with USING and WITH CHECK on the same expression,
--      so any authenticated staff member could INSERT, UPDATE and DELETE every BI
--      object in the agency, and could rewrite agency_id to hand a row to another
--      tenant. Replaced verb by verb.
--
--   4. bi_metrics.status and bi_datasets.status are TEXT DEFAULT 'DRAFT' with no
--      check constraint and no transition anywhere, so 'DRAFT', 'draft', 'Draft'
--      and 'published-ish' are all legal and none of them mean anything. There is
--      now a three-state machine with a single private implementation.
--
--   5. bi_metrics.formula is unvalidated free text that a compiler would have to
--      interpolate into SQL. That is the whole subsystem's security boundary and it
--      was absent: any staff member holding bi_metrics.create could have written
--      a subquery against auth.users and had the server run it. Section E validates
--      every expression in a BEFORE trigger -- not in a command -- so no write path,
--      including a direct PostgREST UPDATE, can reach the compiler unchecked.
--
-- Conventions from 20260830120000_crm_vertical_slice (table + RLS + audit shape,
-- command naming) and 20260831120000_dms_vertical_slice (private implementation
-- with a thin public command, an append-only event ledger, replay-time assertions).

-- ============================================================================
-- A. Make the 20260822000011 tables usable: tenancy first, because
--    stamp_staff_scope() assigns new.branch_id unconditionally and attaching it to
--    a table without the column raises 42703 on every insert.
-- ============================================================================

-- A NULL agency_id is unreachable through RLS, so a row holding one cannot be
-- repaired through the API either. Refuse rather than guess which agency it was.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['bi_datasets','bi_metrics','bi_reports','bi_visualizations'] loop
    execute format('select count(*) from public.%I where agency_id is null', t) into n;
    if n > 0 then
      raise exception 'public.% holds % row(s) with a null agency_id; assign an agency before replaying this migration', t, n
        using errcode = '22023';
    end if;
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['bi_datasets','bi_metrics','bi_reports','bi_visualizations'] loop
    execute format('alter table public.%I add column if not exists branch_id uuid references public.branches(id)', t);
    execute format($u$
      update public.%I x set branch_id = (
        select b.id from public.branches b
         where b.agency_id = x.agency_id
         order by (b.code = 'HQ') desc, b.created_at
         limit 1)
       where x.branch_id is null $u$, t);
    execute format('alter table public.%I alter column agency_id set not null', t);
    execute format('alter table public.%I alter column agency_id set default public.current_staff_agency_id()', t);
    execute format('alter table public.%I add column if not exists created_by uuid default auth.uid()', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
  end loop;
end $$;

-- The 20260822000011 triggers are replaced wholesale below by the house ones.
-- Leaving set_bi_updated_at attached would run alongside update_updated_at_column
-- for the same effect, and log_bi_audit writes a second audit_logs row per
-- statement with a different column set than write_audit_log -- two ledgers
-- disagreeing about the same event is worse than one.
drop trigger if exists set_bi_datasets_updated_at       on public.bi_datasets;
drop trigger if exists set_bi_metrics_updated_at        on public.bi_metrics;
drop trigger if exists set_bi_reports_updated_at        on public.bi_reports;
drop trigger if exists set_bi_visualizations_updated_at on public.bi_visualizations;
drop trigger if exists audit_bi_datasets       on public.bi_datasets;
drop trigger if exists audit_bi_metrics        on public.bi_metrics;
drop trigger if exists audit_bi_reports        on public.bi_reports;
drop trigger if exists audit_bi_visualizations on public.bi_visualizations;

-- And then the bodies, because a detached trigger function is not gone: it is dead
-- code with EXECUTE to PUBLIC that any later migration can re-attach in one line,
-- which is exactly how the second audit ledger would come back. No `cascade` --
-- the eight triggers above were the only dependents, so if a drop fails here it
-- means something still uses one of these and the migration should say so rather
-- than quietly deleting whatever that was.
drop function if exists public.set_bi_updated_at();
drop function if exists public.log_bi_audit();

-- ============================================================================
-- B. The source registry: the allowlist that makes a compiler safe.
--
--    A semantic layer is a machine that builds SQL from stored text. The only
--    question that matters about one is "what can that text reach", and the only
--    answer that survives review is "a relation someone put on a list, and no
--    other". So a dataset does not carry a relation name -- it carries a foreign
--    key to a row here, and there is no client write path to this table at all:
--    it is seeded in section C by a migration and refreshed only by an ADMIN.
--
--    bi_source_columns is the second half of the same answer. Expressions are
--    checked token by token against it in section E, so an expression can only
--    name a column that the catalog says exists. It is therefore *measured* from
--    information_schema rather than hand-listed -- a hand-listed registry drifts
--    the first time somebody renames a column, and a drifted allowlist either
--    blocks legal expressions or admits illegal ones.
-- ============================================================================

create table if not exists public.bi_sources (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique,
  relation_schema     text not null default 'public',
  relation_name       text not null,
  display_name        text not null,
  display_name_ar     text,
  description         text,
  -- The column the tenant predicate is built from. Not assumed: section C reads it
  -- out of information_schema and refuses to register a relation that has none.
  tenant_column       text not null default 'agency_id',
  -- NULL means "this relation is agency-scoped only". The compiler then satisfies
  -- the branch half of row_in_staff_scope by construction rather than by passing
  -- NULL, which would evaluate to false for every non-ADMIN caller and quietly
  -- return an empty result set instead of an error.
  branch_column       text,
  -- has_permission(<this>, 'read') is checked before any query compiled against
  -- this source runs. A dataset cannot widen access to its own source table.
  required_permission text not null,
  default_time_column text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bi_sources_relation_unique unique (relation_schema, relation_name),
  constraint bi_sources_key_shape check (key ~ '^[a-z][a-z0-9_]{1,60}$')
);

create table if not exists public.bi_source_columns (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references public.bi_sources(id) on delete cascade,
  column_name  text not null,
  data_type    text not null check (data_type in ('text','number','date','timestamp','boolean','uuid','json')),
  display_name text not null,
  is_dimension boolean not null default true,
  is_measure   boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint bi_source_columns_unique unique (source_id, column_name)
);

create index if not exists idx_bi_source_columns_source on public.bi_source_columns(source_id);

-- ============================================================================
-- C. Registering a source, and measuring its columns.
-- ============================================================================

create or replace function private.bi_sync_source_columns(p_source_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_schema   text;
  v_relation text;
  r          record;
  v_type     text;
  v_n        integer := 0;
begin
  select relation_schema, relation_name into v_schema, v_relation
    from public.bi_sources where id = p_source_id;
  if v_relation is null then
    raise exception 'No such BI source' using errcode = '22023';
  end if;

  for r in
    select column_name, udt_name
      from information_schema.columns
     where table_schema = v_schema and table_name = v_relation
     order by ordinal_position
  loop
    v_type := case
      when r.udt_name in ('int2','int4','int8','numeric','float4','float8','money') then 'number'
      when r.udt_name = 'date'                                                      then 'date'
      when r.udt_name in ('timestamp','timestamptz','time','timetz')                then 'timestamp'
      when r.udt_name = 'bool'                                                      then 'boolean'
      when r.udt_name = 'uuid'                                                      then 'uuid'
      when r.udt_name in ('json','jsonb')                                           then 'json'
      else 'text' end;

    insert into public.bi_source_columns(
      source_id, column_name, data_type, display_name, is_dimension, is_measure)
    values (
      p_source_id, r.column_name, v_type,
      initcap(replace(r.column_name, '_', ' ')),
      -- json is neither: it cannot be grouped by and it cannot be summed.
      v_type <> 'json',
      v_type = 'number')
    on conflict (source_id, column_name) do update
       set data_type    = excluded.data_type,
           is_dimension = excluded.is_dimension,
           is_measure   = excluded.is_measure;
    v_n := v_n + 1;
  end loop;

  -- A column that no longer exists must leave the allowlist, or an expression that
  -- names it passes the token check and then fails to plan -- a confusing error in
  -- place of a clear one.
  delete from public.bi_source_columns c
   where c.source_id = p_source_id
     and not exists (
       select 1 from information_schema.columns ic
        where ic.table_schema = v_schema and ic.table_name = v_relation
          and ic.column_name = c.column_name);

  return v_n;
end;
$fn$;

revoke all on function private.bi_sync_source_columns(uuid) from public, anon, authenticated;

-- Registration is measured, not asserted: the relation has to exist, it has to
-- have a tenant column, and its branch column is whatever information_schema says
-- rather than whatever this file hopes. A missing relation is a notice and a skip,
-- because this ledger is replayed against databases at different points in its own
-- history and a BI source list is not a reason to stop one.
create or replace function private.bi_register_source(
  p_key        text,
  p_relation   text,
  p_display    text,
  p_display_ar text,
  p_permission text,
  p_time_col   text default 'created_at'
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id     uuid;
  v_tenant text;
  v_branch text;
  v_time   text;
begin
  if to_regclass('public.' || p_relation) is null then
    raise notice 'bi source % skipped: public.% does not exist here', p_key, p_relation;
    return null;
  end if;

  select column_name into v_tenant from information_schema.columns
   where table_schema = 'public' and table_name = p_relation and column_name = 'agency_id';
  if v_tenant is null then
    raise notice 'bi source % skipped: public.% has no agency_id to scope it by', p_key, p_relation;
    return null;
  end if;

  select column_name into v_branch from information_schema.columns
   where table_schema = 'public' and table_name = p_relation and column_name = 'branch_id';
  select column_name into v_time from information_schema.columns
   where table_schema = 'public' and table_name = p_relation and column_name = p_time_col;

  insert into public.bi_sources(
    key, relation_schema, relation_name, display_name, display_name_ar,
    tenant_column, branch_column, required_permission, default_time_column)
  values (p_key, 'public', p_relation, p_display, p_display_ar,
          v_tenant, v_branch, p_permission, v_time)
  on conflict (key) do update
     set relation_name       = excluded.relation_name,
         display_name        = excluded.display_name,
         display_name_ar     = excluded.display_name_ar,
         tenant_column       = excluded.tenant_column,
         branch_column       = excluded.branch_column,
         required_permission = excluded.required_permission,
         default_time_column = excluded.default_time_column,
         is_active           = true,
         updated_at          = now()
  returning id into v_id;

  perform private.bi_sync_source_columns(v_id);
  return v_id;
end;
$fn$;

revoke all on function private.bi_register_source(text,text,text,text,text,text)
  from public, anon, authenticated;

-- The seed. Eleven relations across the four subsystems the integration chain in
-- gap-analysis item 7 runs through, each paired with the RBAC resource that already
-- guards it -- so a GUIDE who cannot read invoices cannot read an invoice dataset
-- either, however the dataset is written.
do $seed$
begin
  perform private.bi_register_source('bookings','bookings','Bookings','الحجوزات','bookings','created_at');
  perform private.bi_register_source('pilgrims','pilgrims','Pilgrims','الحجاج','pilgrims','created_at');
  perform private.bi_register_source('packages','packages','Packages','الباقات','packages','created_at');
  perform private.bi_register_source('invoices','invoices','Invoices','الفواتير','invoices','created_at');
  perform private.bi_register_source('payments','payments','Payments','المدفوعات','payments','created_at');
  perform private.bi_register_source('journal_entries','journal_entries','Journal entries','قيود اليومية','journal_entries','created_at');
  perform private.bi_register_source('crm_leads','crm_leads','CRM leads','العملاء المحتملون','crm_leads','created_at');
  perform private.bi_register_source('crm_opportunities','crm_opportunities','CRM opportunities','الفرص','crm_opportunities','created_at');
  perform private.bi_register_source('crm_quotes','crm_quotes','CRM quotes','عروض الأسعار','crm_quotes','created_at');
  perform private.bi_register_source('crm_customers','crm_customers','CRM customers','العملاء','crm_customers','created_at');
  perform private.bi_register_source('dms_documents','dms_documents','Documents','الوثائق','dms_documents','created_at');
end $seed$;

-- ============================================================================
-- D. bi_datasets: a governed contract over one registered source.
--
--    status is a real machine now (DRAFT -> PUBLISHED -> DEPRECATED, and back to
--    DRAFT from either), implemented once in section J. The rule that gives it
--    teeth: a PUBLISHED dataset's structural columns are frozen, so a dashboard
--    cannot change meaning under a reader who is looking at it.
-- ============================================================================

alter table public.bi_datasets
  add column if not exists key                 text,
  add column if not exists source_id           uuid references public.bi_sources(id),
  add column if not exists display_name_ar     text,
  add column if not exists row_filter_json     jsonb not null default '[]'::jsonb,
  add column if not exists default_time_column text,
  add column if not exists version             integer not null default 1,
  add column if not exists published_at        timestamptz,
  add column if not exists published_by        uuid,
  add column if not exists deprecated_at       timestamptz,
  add column if not exists deprecated_by       uuid,
  add column if not exists last_queried_at     timestamptz,
  add column if not exists query_count         bigint not null default 0;

-- key backfills from the name so the NOT NULL below can be added to a live table:
-- lowercase, non-alphanumerics collapsed to underscores, always prefixed so a name
-- beginning with a digit still satisfies bi_datasets_key_shape, and suffixed with
-- part of the id so two names that collapse to one slug stay distinct.
update public.bi_datasets d
   set key = 'ds_'
             || left(regexp_replace(lower(coalesce(nullif(trim(d.name),''), 'dataset')), '[^a-z0-9]+', '_', 'g'), 44)
             || '_' || left(replace(d.id::text, '-', ''), 6)
 where d.key is null;

alter table public.bi_datasets alter column key set not null;
alter table public.bi_datasets alter column status set default 'DRAFT';
update public.bi_datasets set status = 'DRAFT'
 where status is null or upper(status) not in ('DRAFT','PUBLISHED','DEPRECATED');
update public.bi_datasets set status = upper(status) where status <> upper(status);
alter table public.bi_datasets alter column status set not null;

do $$
begin
  alter table public.bi_datasets drop constraint if exists bi_datasets_key_unique;
  alter table public.bi_datasets add  constraint bi_datasets_key_unique unique (agency_id, key);
  alter table public.bi_datasets drop constraint if exists bi_datasets_status_check;
  alter table public.bi_datasets add  constraint bi_datasets_status_check
    check (status in ('DRAFT','PUBLISHED','DEPRECATED'));
  alter table public.bi_datasets drop constraint if exists bi_datasets_key_shape;
  alter table public.bi_datasets add  constraint bi_datasets_key_shape
    check (key ~ '^[a-z][a-z0-9_]{1,60}$');
  -- source_id stays nullable rather than being backfilled to an arbitrary source:
  -- binding a pre-existing dataset row to `bookings` because that happens to be
  -- first in the seed would change what it means without saying so. Instead a
  -- dataset with no source cannot leave DRAFT, so it cannot be queried or embedded.
  alter table public.bi_datasets drop constraint if exists bi_datasets_published_needs_source;
  alter table public.bi_datasets add  constraint bi_datasets_published_needs_source
    check (status = 'DRAFT' or source_id is not null);
  alter table public.bi_datasets drop constraint if exists bi_datasets_published_stamp;
  alter table public.bi_datasets add  constraint bi_datasets_published_stamp
    check ((status = 'PUBLISHED') = (published_at is not null));
end $$;

create index if not exists idx_bi_datasets_scope  on public.bi_datasets(agency_id, branch_id);
create index if not exists idx_bi_datasets_source on public.bi_datasets(source_id);
create index if not exists idx_bi_datasets_status on public.bi_datasets(status);

-- ============================================================================
-- E. Dimensions, and the expression check that is this file's security boundary.
--
--    A dimension is a governed grouping: a name, an expression over the dataset's
--    source, a type, and -- the part that makes drill-down real rather than a UI
--    affordance -- a pointer to the dimension one level down. drill_to_key names a
--    sibling in the same dataset, so a drill path is data, not a hard-coded chain
--    in a chart component.
--
--    drill_through_* is the other direction: from an aggregated cell to the rows
--    behind it. The expression yields a record id and the kind says which screen
--    can open it, so "show me the 34 bookings in this bar" is a query the server
--    can answer instead of a filter the client has to reconstruct.
-- ============================================================================

create table if not exists public.bi_dimensions (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null default public.current_staff_agency_id(),
  branch_id                uuid references public.branches(id),
  dataset_id               uuid not null references public.bi_datasets(id) on delete cascade,
  key                      text not null,
  display_name             text not null,
  display_name_ar          text,
  description              text,
  expression               text not null,
  data_type                text not null default 'text'
    check (data_type in ('text','number','date','timestamp','boolean','uuid')),
  sort_order               integer not null default 0,
  is_default               boolean not null default false,
  drill_to_key             text,
  drill_through_kind       text
    check (drill_through_kind is null or drill_through_kind in
      ('BOOKING','PILGRIM','PACKAGE','INVOICE','PAYMENT','JOURNAL_ENTRY',
       'CRM_LEAD','CRM_OPPORTUNITY','CRM_QUOTE','CRM_CUSTOMER','DOCUMENT')),
  drill_through_expression text,
  lineage                  jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid default auth.uid(),
  updated_by               uuid,
  constraint bi_dimensions_key_unique unique (dataset_id, key),
  constraint bi_dimensions_key_shape check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  -- A drill target with no expression opens a screen with no record to open.
  constraint bi_dimensions_drill_pair check (
    (drill_through_kind is null) = (drill_through_expression is null)),
  -- A dimension that drills to itself is an infinite path; the walk in section I
  -- guards depth as well, but refusing the one-step case here is cheaper.
  constraint bi_dimensions_no_self_drill check (drill_to_key is distinct from key)
);

create index if not exists idx_bi_dimensions_dataset on public.bi_dimensions(dataset_id, sort_order);
create index if not exists idx_bi_dimensions_scope   on public.bi_dimensions(agency_id, branch_id);

-- ============================================================================
-- F. bi_metrics: the registry, with an aggregate the compiler understands.
--
--    `formula` was and stays the expression column -- renaming it would strand
--    whatever wrote the rows already there -- but it is now the *inner* expression,
--    never an aggregate: `aggregate` says how to fold it. That split is what makes
--    a metric composable. A stored string reading 'sum(total_amount)' cannot be
--    reused under `filter (where ...)`, cannot become a ratio's numerator, and
--    cannot be validated, because a validator would have to know which parts of it
--    were aggregate and which were row-level.
--
--    RATIO is the one aggregate with no expression of its own: it names two sibling
--    metrics and the compiler emits sum(n) / nullif(sum(d), 0). A ratio of ratios is
--    refused -- averaging an average is the classic BI lie and the registry is the
--    right place to make it unsayable.
-- ============================================================================

alter table public.bi_metrics
  add column if not exists display_name_ar         text,
  add column if not exists description             text,
  add column if not exists aggregate               text not null default 'SUM',
  add column if not exists filter_json             jsonb not null default '[]'::jsonb,
  add column if not exists numerator_metric_key    text,
  add column if not exists denominator_metric_key  text,
  add column if not exists format                  text not null default 'NUMBER',
  add column if not exists unit                    text,
  add column if not exists decimals                integer not null default 2,
  add column if not exists is_additive             boolean not null default true,
  add column if not exists sort_order              integer not null default 0,
  add column if not exists published_at            timestamptz,
  add column if not exists published_by            uuid,
  add column if not exists deprecated_at           timestamptz,
  add column if not exists deprecated_by           uuid,
  add column if not exists lineage                 jsonb not null default '{}'::jsonb;

alter table public.bi_metrics alter column status set default 'DRAFT';
update public.bi_metrics set status = 'DRAFT'
 where status is null or upper(status) not in ('DRAFT','PUBLISHED','DEPRECATED');
update public.bi_metrics set status = upper(status) where status <> upper(status);
alter table public.bi_metrics alter column status set not null;

-- Existing keys are normalized before the shape check is added rather than after,
-- because `add constraint` validates the rows already in the table: a live database
-- carrying one metric named 'Gross Margin %' would otherwise turn this migration
-- into a failed replay, and the repair would have to be done by hand at 3am.
update public.bi_metrics m
   set key = 'm_' || left(regexp_replace(lower(m.key), '[^a-z0-9]+', '_', 'g'), 44)
 where m.key !~ '^[a-z][a-z0-9_]{1,60}$';

do $$
begin
  alter table public.bi_metrics drop constraint if exists bi_metrics_status_check;
  alter table public.bi_metrics add  constraint bi_metrics_status_check
    check (status in ('DRAFT','PUBLISHED','DEPRECATED'));
  alter table public.bi_metrics drop constraint if exists bi_metrics_aggregate_check;
  alter table public.bi_metrics add  constraint bi_metrics_aggregate_check
    check (aggregate in ('SUM','COUNT','COUNT_DISTINCT','AVG','MIN','MAX','RATIO'));
  alter table public.bi_metrics drop constraint if exists bi_metrics_format_check;
  alter table public.bi_metrics add  constraint bi_metrics_format_check
    check (format in ('NUMBER','INTEGER','CURRENCY','PERCENT','DURATION_HOURS'));
  alter table public.bi_metrics drop constraint if exists bi_metrics_decimals_check;
  alter table public.bi_metrics add  constraint bi_metrics_decimals_check
    check (decimals between 0 and 6);
  alter table public.bi_metrics drop constraint if exists bi_metrics_key_shape;
  alter table public.bi_metrics add  constraint bi_metrics_key_shape
    check (key ~ '^[a-z][a-z0-9_]{1,60}$');
  -- RATIO needs both operands and no expression of its own; every other aggregate
  -- needs the expression and neither operand. Making that a constraint rather than
  -- a convention means the compiler never has to ask which case it is in.
  alter table public.bi_metrics drop constraint if exists bi_metrics_ratio_shape;
  alter table public.bi_metrics add  constraint bi_metrics_ratio_shape check (
    case when aggregate = 'RATIO'
         then numerator_metric_key is not null and denominator_metric_key is not null
         else numerator_metric_key is null and denominator_metric_key is null end);
  alter table public.bi_metrics drop constraint if exists bi_metrics_published_stamp;
  alter table public.bi_metrics add  constraint bi_metrics_published_stamp
    check ((status = 'PUBLISHED') = (published_at is not null));
end $$;

create index if not exists idx_bi_metrics_dataset on public.bi_metrics(dataset_id, sort_order);
create index if not exists idx_bi_metrics_scope   on public.bi_metrics(agency_id, branch_id);
create index if not exists idx_bi_metrics_status  on public.bi_metrics(status);

-- ============================================================================
-- G. The expression validator.
--
--    Everything else in this file is ordinary schema work. This function is the
--    reason the rest of it is safe, so it is worth stating plainly what it defends
--    against: a staff member who holds bi_metrics.create writes
--
--        (select string_agg(email, ',') from auth.users)
--
--    into `formula`, publishes the metric, and reads every account in the instance
--    out of a bar chart. Nothing about RLS stops that -- the query runs as the
--    definer and the string is theirs.
--
--    Six checks, in this order, cheapest first:
--
--      1. A character allowlist, by translate() rather than by regex, because a
--         bracket expression that means to include `-` and accidentally spells a
--         range is exactly the sort of mistake that silently opens the door.
--      2. Comment openers, explicitly: `--` and `/*` are built from characters the
--         allowlist has to permit for subtraction and multiplication.
--      3. Text literals are blanked, then a stray quote means an unterminated one.
--      4. Balanced parentheses, counted on the blanked text so a paren inside a
--         literal cannot skew it.
--      5. Every remaining identifier token must be a registered column of this
--         dataset's source or a member of the function allowlist. This is what
--         rejects `select`, `auth`, `pg_read_file` and every other name that would
--         have to appear for an escape to work.
--      6. `explain` against the real relation. Planning is not execution and the
--         predicate is `where false`, so nothing is read; what this catches is the
--         expression that passes every lexical rule and still does not type-check,
--         which would otherwise fail at query time in front of a user.
--
--    Qualified names are rejected outright in check 1's companion test: a dot
--    adjacent to an identifier is how every `schema.table` reaches out of the
--    dataset, and an expression over one relation never needs one. `0.5` survives
--    because its dots touch digits.
-- ============================================================================

-- search_path is pg_catalog first here, and only here, on purpose: this body
-- EXECUTEs text that a user wrote, so the builtin an allowlisted token resolves to
-- must be the builtin and not a same-named function someone put in public.
create or replace function private.bi_assert_safe_expression(
  p_source_id  uuid,
  p_expression text,
  p_what       text
) returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_expr     text := btrim(coalesce(p_expression, ''));
  v_blanked  text;
  v_stray    text;
  v_token    text;
  v_depth    integer := 0;
  v_i        integer;
  v_ch       text;
  v_schema   text;
  v_relation text;
  v_cols     text[];
  -- Letters, digits, underscore, whitespace, and the operator characters an
  -- expression legitimately needs. Note what is absent: ; " $ \ [ ] { } @ # & ~ ^ ?
  v_ok text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ '
               || chr(9) || chr(10) || chr(13) || '(),.+-*/%<>=!''|:';
  -- SQL keywords and pg_catalog functions an analyst may use. `select`, `from`,
  -- `with`, `union` and every schema name are deliberately not here.
  v_allowed text[] := array[
    'case','when','then','else','end','and','or','not','null','is','in','between',
    'like','ilike','distinct','from','for','asc','desc','true','false','cast','as',
    'coalesce','nullif','greatest','least','abs','round','floor','ceil','ceiling',
    'sign','sqrt','power','mod','div','trunc','width_bucket',
    'length','char_length','lower','upper','initcap','trim','btrim','ltrim','rtrim',
    'lpad','rpad','substring','substr','left','right','strpos','position','replace',
    'split_part','concat','concat_ws','to_char','to_date','to_number','to_timestamp',
    'date_trunc','date_part','extract','age','now','current_date','current_timestamp',
    'localtimestamp','interval','epoch','year','month','week','day','dow','doy',
    'hour','minute','second','quarter','decade','century','millennium',
    'numeric','integer','int','int2','int4','int8','bigint','smallint','real',
    'double','precision','float','float4','float8','decimal','text','varchar','char',
    'character','varying','date','time','timestamp','timestamptz','boolean','bool',
    'uuid','json','jsonb','array','unknown'];
begin

  if v_expr = '' then
    raise exception '% cannot be blank', p_what using errcode = '22023';
  end if;
  if length(v_expr) > 500 then
    raise exception '% is % characters long; the limit is 500', p_what, length(v_expr)
      using errcode = '22023';
  end if;

  -- 1. Character allowlist.
  v_stray := translate(v_expr, v_ok, '');
  if v_stray <> '' then
    raise exception '% uses characters an expression may not contain: %', p_what, v_stray
      using errcode = '22023';
  end if;

  -- 2. Comment openers, and qualified names.
  if v_expr like '%--%' or v_expr like '%/*%' or v_expr like '%*/%' then
    raise exception '% contains a SQL comment', p_what using errcode = '22023';
  end if;
  if v_expr ~ '[A-Za-z_)][ ]*\.' or v_expr ~ '\.[ ]*[A-Za-z_(]' then
    raise exception '% uses a qualified name; an expression may only name columns of its own dataset source', p_what
      using errcode = '22023';
  end if;

  -- 3. Blank the text literals, then look for a survivor.
  v_blanked := regexp_replace(v_expr, '''([^'']|'''')*''', ' ', 'g');
  if position('''' in v_blanked) > 0 then
    raise exception '% has an unterminated text literal', p_what using errcode = '22023';
  end if;

  -- 4. Balanced parentheses.
  for v_i in 1 .. length(v_blanked) loop
    v_ch := substr(v_blanked, v_i, 1);
    if v_ch = '(' then v_depth := v_depth + 1;
    elsif v_ch = ')' then v_depth := v_depth - 1;
    end if;
    if v_depth < 0 then
      raise exception '% closes a parenthesis it never opened', p_what using errcode = '22023';
    end if;
  end loop;
  if v_depth <> 0 then
    raise exception '% leaves % parenthesis(es) open', p_what, v_depth using errcode = '22023';
  end if;

  -- 5. Token allowlist.
  select array_agg(lower(c.column_name)) into v_cols
    from public.bi_source_columns c where c.source_id = p_source_id;
  v_cols := coalesce(v_cols, '{}'::text[]);

  for v_token in
    select distinct lower(m[1])
      from regexp_matches(v_blanked, '([A-Za-z_][A-Za-z0-9_]*)', 'g') as m
  loop
    if not (v_token = any(v_allowed)) and not (v_token = any(v_cols)) then
      raise exception '% names "%", which is neither a column of this dataset''s source nor an allowed function', p_what, v_token
        using errcode = '22023';
    end if;
  end loop;

  -- 6. The planner's opinion, against the real relation.
  select s.relation_schema, s.relation_name into v_schema, v_relation
    from public.bi_sources s where s.id = p_source_id;
  if v_relation is null then
    raise exception '% belongs to a dataset with no registered source', p_what
      using errcode = '22023';
  end if;
  begin
    execute format('explain (costs off) select (%s) from %I.%I as src where false',
                   v_expr, v_schema, v_relation);
  exception
    when others then
      raise exception '% does not type-check against %.%: %',
        p_what, v_schema, v_relation, sqlerrm using errcode = '22023';
  end;

  return v_expr;
end;
$fn$;

revoke all on function private.bi_assert_safe_expression(uuid,text,text)
  from public, anon, authenticated;

-- ============================================================================
-- H. The validation triggers.
--
--    The check above lives in a BEFORE trigger, not in a command, and that
--    placement is the whole point. A command that validated would be bypassed by
--    the first PostgREST `PATCH /bi_metrics?id=eq.…` from any staff member holding
--    bi_metrics.update -- and holding update is normal, it is how a display name
--    gets fixed. In a trigger there is no write path left: not a command, not a
--    direct patch, not a later migration that forgets.
-- ============================================================================

-- The measured upstream of an expression: which registered columns it actually
-- names. This is what turns bi_metrics.lineage from a JSONB column nobody writes
-- into a fact, and it is derived from the same token scan the validator uses, so
-- lineage and safety can never disagree about what an expression reads.
create or replace function private.bi_expression_columns(p_source_id uuid, p_expression text)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(array_agg(distinct c.column_name order by c.column_name), '{}'::text[])
    from public.bi_source_columns c
   where c.source_id = p_source_id
     and exists (
       select 1
         from regexp_matches(
                regexp_replace(coalesce(p_expression, ''), '''([^'']|'''')*''', ' ', 'g'),
                '([A-Za-z_][A-Za-z0-9_]*)', 'g') as m
        where lower(m[1]) = lower(c.column_name));
$fn$;

revoke all on function private.bi_expression_columns(uuid,text) from public, anon, authenticated;

create or replace function private.bi_validate_dimension()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_source uuid;
  v_status text;
  v_key    text;
  v_seen   text[] := '{}';
  v_depth  integer := 0;
begin
  select d.source_id, d.status into v_source, v_status
    from public.bi_datasets d where d.id = new.dataset_id;
  if not found then
    raise exception 'That dataset does not exist' using errcode = '22023';
  end if;
  if v_source is null then
    raise exception 'Bind the dataset to a source before adding dimensions to it'
      using errcode = '22023';
  end if;

  new.expression := private.bi_assert_safe_expression(
    v_source, new.expression, format('The expression for dimension "%s"', new.key));

  if new.drill_through_expression is not null then
    new.drill_through_expression := private.bi_assert_safe_expression(
      v_source, new.drill_through_expression,
      format('The drill-through key for dimension "%s"', new.key));
  end if;

  -- Drill-down cycles. A forward reference is allowed -- a hierarchy is usually
  -- written top-down, so `region -> city` exists before `city` does -- and an
  -- unresolved link simply ends the path. What is refused is a chain that comes
  -- back to this row, because get_bi_drill_path walks it and a cycle there is an
  -- infinite loop inside a definer function.
  v_key := new.drill_to_key;
  while v_key is not null and v_depth < 32 loop
    if v_key = new.key or v_key = any(v_seen) then
      raise exception 'Dimension "%" would make the drill-down path circular at "%"',
        new.key, v_key using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    v_depth := v_depth + 1;
    select x.drill_to_key into v_key
      from public.bi_dimensions x
     where x.dataset_id = new.dataset_id and x.key = v_key;
    if not found then v_key := null; end if;
  end loop;

  new.lineage := jsonb_build_object(
    'source_columns', to_jsonb(private.bi_expression_columns(v_source, new.expression)),
    'drill_through_columns',
      to_jsonb(private.bi_expression_columns(v_source, new.drill_through_expression)),
    'measured_at', to_jsonb(now()));
  return new;
end;
$fn$;

revoke all on function private.bi_validate_dimension() from public, anon, authenticated;

-- How a metric folds. One function decides this, and both the validation trigger
-- and the compiler call it, so a metric can never be checked in one shape and run
-- in another. RATIO is absent on purpose: it has two operands and no expression of
-- its own, so the compiler composes it out of two calls to this.
create or replace function private.bi_fold_expression(
  p_aggregate text, p_expression text, p_filter_sql text default null)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_body   text;
  v_filter text := case when coalesce(p_filter_sql, '') = '' then ''
                        else format(' filter (where %s)', p_filter_sql) end;
begin
  v_body := case p_aggregate
    when 'SUM'            then format('sum((%s))', p_expression)
    when 'COUNT'          then format('count((%s))', p_expression)
    when 'COUNT_DISTINCT' then format('count(distinct (%s))', p_expression)
    when 'AVG'            then format('avg((%s))', p_expression)
    when 'MIN'            then format('min((%s))', p_expression)
    when 'MAX'            then format('max((%s))', p_expression)
    else null
  end;
  if v_body is null then
    raise exception 'Aggregate "%" cannot be folded on its own', p_aggregate
      using errcode = '22023';
  end if;
  return v_body || v_filter;
end;
$fn$;

revoke all on function private.bi_fold_expression(text,text,text) from public, anon, authenticated;

-- The folded form has to type-check too. `sum(passport_number)` passes every
-- lexical rule in bi_assert_safe_expression -- it names a real column and an
-- allowed function -- and then fails at query time in front of whoever opened the
-- dashboard, rather than at write time in front of whoever defined the metric.
-- `sum(text)` is not a function that exists, so the planner says so here.
create or replace function private.bi_assert_aggregate_types(
  p_source_id uuid, p_aggregate text, p_expression text, p_what text)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_schema   text;
  v_relation text;
begin
  select s.relation_schema, s.relation_name into v_schema, v_relation
    from public.bi_sources s where s.id = p_source_id;
  if not found then
    raise exception 'That data source is not registered' using errcode = '22023';
  end if;
  begin
    execute format('explain (costs off) select %s from %I.%I as src where false',
                   private.bi_fold_expression(p_aggregate, p_expression),
                   v_schema, v_relation);
  exception
    when others then
      raise exception '% cannot be aggregated with %: %', p_what, p_aggregate, sqlerrm
        using errcode = '22023';
  end;
end;
$fn$;

revoke all on function private.bi_assert_aggregate_types(uuid,text,text,text) from public, anon, authenticated;

create or replace function private.bi_validate_metric()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_source uuid;
  v_num    record;
  v_den    record;
begin
  select d.source_id into v_source
    from public.bi_datasets d where d.id = new.dataset_id;
  if not found then
    raise exception 'That dataset does not exist' using errcode = '22023';
  end if;
  if v_source is null then
    raise exception 'Bind the dataset to a source before adding metrics to it'
      using errcode = '22023';
  end if;

  if new.aggregate = 'RATIO' then
    -- A ratio owns no expression: it is two sibling metrics divided, and the
    -- division happens after each side is folded. Storing anything in `formula`
    -- here would be a value the compiler never reads, so it is cleared rather
    -- than kept and quietly ignored.
    new.formula := '';
    if new.numerator_metric_key = new.key or new.denominator_metric_key = new.key then
      raise exception 'Metric "%" cannot be a ratio of itself', new.key
        using errcode = '22023';
    end if;
    select m.key, m.aggregate into v_num from public.bi_metrics m
     where m.dataset_id = new.dataset_id and m.key = new.numerator_metric_key;
    if not found then
      raise exception 'The numerator "%" is not a metric of this dataset; define it first',
        new.numerator_metric_key using errcode = '22023';
    end if;
    select m.key, m.aggregate into v_den from public.bi_metrics m
     where m.dataset_id = new.dataset_id and m.key = new.denominator_metric_key;
    if not found then
      raise exception 'The denominator "%" is not a metric of this dataset; define it first',
        new.denominator_metric_key using errcode = '22023';
    end if;

    -- A ratio of ratios is refused. sum(a/b)/sum(c/d) is not the ratio anyone
    -- means by it, and an average of averages is the classic BI lie: it weights
    -- every group equally regardless of how many rows each holds. The registry is
    -- the right place to make it unsayable, because by the time it is a number on
    -- a dashboard nobody can tell it apart from the right one.
    if v_num.aggregate = 'RATIO' or v_den.aggregate = 'RATIO' then
      raise exception 'Metric "%" divides a ratio by a ratio; use the underlying additive metrics instead',
        new.key using errcode = '22023';
    end if;
    new.is_additive := false;
  else
    new.formula := private.bi_assert_safe_expression(
      v_source, new.formula, format('The formula for metric "%s"', new.key));
    perform private.bi_assert_aggregate_types(
      v_source, new.aggregate, new.formula, format('The formula for metric "%s"', new.key));
    -- Only a plain sum or count adds up across groups. AVG, MIN and MAX do not,
    -- and a subtotal that averages the averages of its children is wrong; the
    -- flag is measured here so no UI has to guess.
    new.is_additive := new.aggregate in ('SUM', 'COUNT');
  end if;

  if coalesce(new.filter_json, '[]'::jsonb) <> '[]'::jsonb then
    -- Compiling the filter is the validation: bi_compile_filters resolves every
    -- field against this dataset's dimensions and its source's columns, and
    -- quotes every literal, so a filter that cannot be compiled cannot be stored.
    perform private.bi_compile_filters(v_source, new.dataset_id, new.filter_json);
  end if;

  new.lineage := jsonb_build_object(
    'source_columns', to_jsonb(private.bi_expression_columns(v_source, new.formula)),
    'operands', case when new.aggregate = 'RATIO'
                     then to_jsonb(array[new.numerator_metric_key, new.denominator_metric_key])
                     else '[]'::jsonb end,
    'measured_at', to_jsonb(now()));
  return new;
end;
$fn$;

revoke all on function private.bi_validate_metric() from public, anon, authenticated;

create or replace function private.bi_validate_dataset()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ok boolean;
begin
  if new.source_id is null then
    if coalesce(new.row_filter_json, '[]'::jsonb) <> '[]'::jsonb then
      raise exception 'A row filter needs a source to filter; bind the dataset first'
        using errcode = '22023';
    end if;
    if new.default_time_column is not null then
      raise exception 'A default time column needs a source; bind the dataset first'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.default_time_column is not null then
    -- Measured against the registry, so a column that was dropped from the
    -- physical table stops being selectable here at the next sync rather than
    -- becoming a query-time error.
    select true into v_ok
      from public.bi_source_columns c
     where c.source_id = new.source_id
       and lower(c.column_name) = lower(new.default_time_column)
       and c.data_type in ('date', 'timestamp');
    if not found then
      raise exception '"%" is not a date or timestamp column of this dataset''s source',
        new.default_time_column using errcode = '22023';
    end if;
  end if;

  if coalesce(new.row_filter_json, '[]'::jsonb) <> '[]'::jsonb then
    -- Compiled with no dataset in scope, so its fields resolve against the
    -- source's registered columns rather than against dimensions. That is both
    -- what a row filter means -- it narrows the relation before anything is
    -- derived from it -- and the only thing that can work here, since this runs
    -- BEFORE INSERT and the dataset it belongs to does not exist yet.
    perform private.bi_compile_filters(new.source_id, null, new.row_filter_json);
  end if;
  return new;
end;
$fn$;

revoke all on function private.bi_validate_dataset() from public, anon, authenticated;

drop trigger if exists trg_bi_validate_dataset   on public.bi_datasets;
drop trigger if exists trg_bi_validate_dimension on public.bi_dimensions;
drop trigger if exists trg_bi_validate_metric    on public.bi_metrics;

create trigger trg_bi_validate_dataset
  before insert or update on public.bi_datasets
  for each row execute function private.bi_validate_dataset();

create trigger trg_bi_validate_dimension
  before insert or update on public.bi_dimensions
  for each row execute function private.bi_validate_dimension();

create trigger trg_bi_validate_metric
  before insert or update on public.bi_metrics
  for each row execute function private.bi_validate_metric();

-- ---------------------------------------------------------------------------
-- I. The compiler.
--
--    This is the section the whole item turns on. Everything above it exists so
--    that this can point at a live schema without being a hole in it.
--
--    Two functions, deliberately separate:
--
--      private.bi_compile_query  definitions -> one SQL string. Pure, and
--                                readable on its own, so what would run can be
--                                shown to the person who asked for it.
--      private.bi_run_query      authorization, execution, timing, ledger.
--
--    Splitting them is not tidiness. A compiler that also executes cannot be
--    tested without executing, and cannot be exposed as "explain this analysis
--    to me" without handing out a way to run arbitrary compiled text. Apart,
--    the compile step is a total function of rows the database already checked.
--
--    Every identifier the compiler emits is either generated by it (d0..dn,
--    m0..mk) or a name it read out of bi_source_columns, and every literal goes
--    through quote_literal. No string a user typed ever reaches an identifier
--    position, and `group by` is written by ordinal for the same reason.
-- ---------------------------------------------------------------------------

-- One literal, quoted and cast. The cast is not decoration: `where created_at >
-- '2026-13-45'` compiles fine as text and fails at run time, and a filter that is
-- wrong should be refused when it is written. Casting the value here in plpgsql
-- proves it converts before any of it reaches a query string.
create or replace function private.bi_literal(p_type text, p_value jsonb)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_text text := p_value #>> '{}';
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' or v_text is null then
    return 'null';
  end if;
  if jsonb_typeof(p_value) in ('object', 'array') then
    raise exception 'A filter value must be a single scalar, not %', jsonb_typeof(p_value)
      using errcode = '22023';
  end if;
  begin
    case p_type
      when 'number'    then perform v_text::numeric;
      when 'boolean'   then perform v_text::boolean;
      when 'date'      then perform v_text::date;
      when 'timestamp' then perform v_text::timestamptz;
      when 'uuid'      then perform v_text::uuid;
      else null;
    end case;
  exception
    when others then
      raise exception '"%" is not a valid % value', v_text, p_type using errcode = '22023';
  end;
  return case p_type
    when 'number'    then format('%L::numeric', v_text)
    when 'boolean'   then format('%L::boolean', v_text)
    when 'date'      then format('%L::date', v_text)
    when 'timestamp' then format('%L::timestamptz', v_text)
    when 'uuid'      then format('%L::uuid', v_text)
    else format('%L::text', v_text)
  end;
end;
$fn$;

revoke all on function private.bi_literal(text,jsonb) from public, anon, authenticated;

-- Filters. Shape: [{"field":"…","op":"EQ","value":…,"values":[…],"value2":…}].
--
-- `field` resolves first against the dataset's dimensions -- so a filter can be
-- written over `booking_month` rather than over date_trunc('month', created_at) --
-- and then against the source's registered columns. Both are allowlists the
-- database measured, so there is no third case: an unresolved field is refused,
-- never passed through.
create or replace function private.bi_compile_filters(
  p_source_id uuid, p_dataset_id uuid, p_filters jsonb, p_alias text default 'src')
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_entry jsonb;
  v_field text;
  v_op    text;
  v_left  text;
  v_type  text;
  v_raw   text;
  v_vals  text[];
  v_v     jsonb;
  v_parts text[] := '{}';
begin
  if p_filters is null or p_filters = '[]'::jsonb then return ''; end if;
  if jsonb_typeof(p_filters) <> 'array' then
    raise exception 'Filters must be a JSON array' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_filters) loop
    v_field := v_entry->>'field';
    v_op    := upper(coalesce(v_entry->>'op', 'EQ'));
    if coalesce(v_field, '') = '' then
      raise exception 'A filter is missing its field' using errcode = '22023';
    end if;

    v_left := null; v_type := null;
    if p_dataset_id is not null then
      select format('(%s)', d.expression), d.data_type into v_left, v_type
        from public.bi_dimensions d
       where d.dataset_id = p_dataset_id and d.key = v_field;
    end if;
    if v_left is null then
      select format('%I.%I', p_alias, c.column_name), c.data_type into v_left, v_type
        from public.bi_source_columns c
       where c.source_id = p_source_id and lower(c.column_name) = lower(v_field);
    end if;
    if v_left is null then
      raise exception 'Filter field "%" is neither a dimension of this dataset nor a column of its source',
        v_field using errcode = '22023';
    end if;

    if v_op in ('IS_NULL', 'IS_NOT_NULL') then
      v_parts := v_parts || format('%s is %s null', v_left,
                                   case when v_op = 'IS_NULL' then '' else 'not' end);

    elsif v_op in ('IN', 'NOT_IN') then
      if jsonb_typeof(coalesce(v_entry->'values', 'null'::jsonb)) <> 'array'
         or jsonb_array_length(v_entry->'values') = 0 then
        raise exception 'Filter on "%" with % needs a non-empty values array', v_field, v_op
          using errcode = '22023';
      end if;
      v_vals := '{}';
      for v_v in select value from jsonb_array_elements(v_entry->'values') loop
        v_vals := v_vals || private.bi_literal(v_type, v_v);
      end loop;
      v_parts := v_parts || format('%s %s (%s)', v_left,
                                   case when v_op = 'IN' then 'in' else 'not in' end,
                                   array_to_string(v_vals, ', '));

    elsif v_op = 'BETWEEN' then
      if v_entry->'value' is null or v_entry->'value2' is null then
        raise exception 'Filter on "%" with BETWEEN needs both value and value2', v_field
          using errcode = '22023';
      end if;
      v_parts := v_parts || format('%s between %s and %s', v_left,
                                   private.bi_literal(v_type, v_entry->'value'),
                                   private.bi_literal(v_type, v_entry->'value2'));

    elsif v_op in ('CONTAINS', 'STARTS_WITH') then
      v_raw := v_entry->'value' #>> '{}';
      if v_raw is null then
        raise exception 'Filter on "%" with % needs a value', v_field, v_op
          using errcode = '22023';
      end if;
      -- LIKE metacharacters in the search text are escaped, so looking for "50%"
      -- finds rows containing "50%" instead of matching every row there is.
      v_raw := replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_');
      v_parts := v_parts || format('(%s)::text ilike %L', v_left,
                                   case when v_op = 'CONTAINS' then '%' || v_raw || '%'
                                        else v_raw || '%' end);

    elsif v_op in ('EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE') then
      v_raw := private.bi_literal(v_type, v_entry->'value');
      if v_raw = 'null' then
        -- `= null` is never true, and a filter that silently matches nothing is
        -- worse than one that refuses. EQ and NE against a null value mean the
        -- null test; an ordering comparison against null means nothing at all.
        if v_op not in ('EQ', 'NE') then
          raise exception 'Filter on "%" compares % against no value', v_field, v_op
            using errcode = '22023';
        end if;
        v_parts := v_parts || format('%s is %s null', v_left,
                                     case when v_op = 'EQ' then '' else 'not' end);
      else
        v_parts := v_parts || format('%s %s %s', v_left,
          case v_op when 'EQ' then '=' when 'NE' then '<>' when 'GT' then '>'
                    when 'GTE' then '>=' when 'LT' then '<' else '<=' end,
          v_raw);
      end if;

    else
      raise exception 'Filter operator "%" is not one this compiler emits', v_op
        using errcode = '22023';
    end if;
  end loop;

  return array_to_string(v_parts, ' and ');
end;
$fn$;

revoke all on function private.bi_compile_filters(uuid,uuid,jsonb,text) from public, anon, authenticated;

-- The compiler proper. Definitions in, one statement out, plus the column
-- descriptions the caller needs to render it. Returning both together is what
-- keeps a result set and its headings from drifting apart: the aliases in the SQL
-- and the keys in `columns` are produced by the same loop.
create or replace function private.bi_compile_query(
  p_dataset_id  uuid,
  p_dimensions  text[]  default '{}',
  p_metrics     text[]  default '{}',
  p_filters     jsonb   default '[]'::jsonb,
  p_time_grain  text    default null,
  p_order_by    text    default null,
  p_order_desc  boolean default true,
  p_limit       integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ds       record;
  v_src      record;
  v_dim      record;
  v_met      record;
  v_num      record;
  v_den      record;
  v_key      text;
  v_grain    text;
  v_timecol  text;
  v_select   text[] := '{}';
  v_group    text[] := '{}';
  v_where    text[] := '{}';
  v_columns  jsonb  := '[]'::jsonb;
  v_filter   text;
  v_expr     text;
  v_ord      integer := 0;
  v_dims     integer := 0;
  v_mets     integer := 0;
  v_order    text;
  v_limit    integer;
  v_sql      text;
begin
  select d.id, d.agency_id, d.key, d.name, d.source_id, d.status,
         d.row_filter_json, d.default_time_column
    into v_ds
    from public.bi_datasets d where d.id = p_dataset_id;
  if not found then
    raise exception 'That dataset does not exist' using errcode = '22023';
  end if;
  if v_ds.source_id is null then
    raise exception 'Dataset "%" is not bound to a data source', v_ds.key
      using errcode = '22023';
  end if;

  select s.* into v_src from public.bi_sources s where s.id = v_ds.source_id;
  if not found or not v_src.is_active then
    raise exception 'The data source behind dataset "%" is not available', v_ds.key
      using errcode = '22023';
  end if;

  -- Tenancy, first and unconditionally.
  --
  -- When the source carries a branch column the full two-part scope check runs.
  -- When it does not, the predicate is agency-only rather than
  -- row_in_staff_scope(agency, null): that call is false for every non-ADMIN
  -- caller, so a branch-less source would return an empty result set and look
  -- like "no data" instead of like a bug. Agency-only is also the honest answer --
  -- a relation with no branch attribution has no branch to be scoped to, which is
  -- exactly what its own RLS policy says about it.
  if v_src.branch_column is null then
    v_where := v_where || format('src.%I = public.staff_agency_id()', v_src.tenant_column);
  else
    v_where := v_where || format('public.row_in_staff_scope(src.%I, src.%I)',
                                 v_src.tenant_column, v_src.branch_column);
  end if;

  -- The dataset's own row filter, compiled over source columns.
  v_filter := private.bi_compile_filters(v_ds.source_id, null, v_ds.row_filter_json);
  if v_filter <> '' then v_where := v_where || format('(%s)', v_filter); end if;

  -- Time grain. The grain is mapped through a closed set, so the string that
  -- reaches date_trunc is one of six the compiler owns, never one a caller typed.
  v_grain := upper(coalesce(p_time_grain, ''));
  if v_grain <> '' then
    if v_grain not in ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR') then
      raise exception 'Time grain "%" is not one of DAY, WEEK, MONTH, QUARTER, YEAR', v_grain
        using errcode = '22023';
    end if;
    v_timecol := coalesce(v_ds.default_time_column, v_src.default_time_column);
    if v_timecol is null then
      raise exception 'Dataset "%" has no time column, so it cannot be grouped by %',
        v_ds.key, v_grain using errcode = '22023';
    end if;
    if exists (select 1 from public.bi_dimensions x
                where x.dataset_id = p_dataset_id and x.key = 'bi_period') then
      raise exception 'Dataset "%" already defines a dimension named bi_period; rename it to use a time grain',
        v_ds.key using errcode = '22023';
    end if;
    v_ord    := v_ord + 1;
    v_dims   := v_dims + 1;
    v_select := v_select || format('date_trunc(%L, src.%I) as d%s',
                                   lower(v_grain), v_timecol, v_ord - 1);
    v_group  := v_group || v_ord::text;
    v_columns := v_columns || jsonb_build_object(
      'key', 'bi_period', 'alias', format('d%s', v_ord - 1), 'kind', 'DIMENSION',
      'label', initcap(lower(v_grain)), 'data_type', 'timestamp',
      'ordinal', v_ord, 'grain', v_grain);
  end if;

  -- Dimensions, in the order asked for. `d0..dn` are the compiler's own names, so
  -- nothing a caller typed lands in an identifier position, and the group-by is
  -- written by ordinal for the same reason.
  foreach v_key in array coalesce(p_dimensions, '{}'::text[]) loop
    select x.* into v_dim from public.bi_dimensions x
     where x.dataset_id = p_dataset_id and x.key = v_key;
    if not found then
      raise exception 'Dimension "%" is not defined on dataset "%"', v_key, v_ds.key
        using errcode = '22023';
    end if;
    v_ord  := v_ord + 1;
    v_dims := v_dims + 1;
    v_select := v_select || format('(%s) as d%s', v_dim.expression, v_dims - 1);
    v_group  := v_group || v_ord::text;
    v_columns := v_columns || jsonb_build_object(
      'key', v_dim.key, 'alias', format('d%s', v_dims - 1), 'kind', 'DIMENSION',
      'label', v_dim.display_name, 'label_ar', v_dim.display_name_ar,
      'data_type', v_dim.data_type, 'ordinal', v_ord,
      'drill_to_key', v_dim.drill_to_key,
      'drill_through_kind', v_dim.drill_through_kind);
  end loop;

  -- Metrics. RATIO is composed here out of two folds rather than stored folded,
  -- which is what lets the same numerator metric be reused on its own, inside a
  -- ratio, and under a filter, without three copies of one definition.
  foreach v_key in array coalesce(p_metrics, '{}'::text[]) loop
    select m.* into v_met from public.bi_metrics m
     where m.dataset_id = p_dataset_id and m.key = v_key;
    if not found then
      raise exception 'Metric "%" is not defined on dataset "%"', v_key, v_ds.key
        using errcode = '22023';
    end if;
    if v_met.status = 'DEPRECATED' then
      raise exception 'Metric "%" is deprecated; it cannot be added to a new analysis', v_key
        using errcode = '22023';
    end if;

    if v_met.aggregate = 'RATIO' then
      select n.* into v_num from public.bi_metrics n
       where n.dataset_id = p_dataset_id and n.key = v_met.numerator_metric_key;
      select n.* into v_den from public.bi_metrics n
       where n.dataset_id = p_dataset_id and n.key = v_met.denominator_metric_key;
      if v_num.key is null or v_den.key is null then
        raise exception 'Ratio metric "%" is missing an operand', v_key using errcode = '22023';
      end if;
      -- nullif on the denominator, so an empty group is null rather than a
      -- division-by-zero that takes the whole query down with it.
      v_expr := format('(%s) / nullif((%s), 0)',
        private.bi_fold_expression(v_num.aggregate, v_num.formula,
          private.bi_compile_filters(v_ds.source_id, p_dataset_id, v_num.filter_json)),
        private.bi_fold_expression(v_den.aggregate, v_den.formula,
          private.bi_compile_filters(v_ds.source_id, p_dataset_id, v_den.filter_json)));
    else
      v_expr := private.bi_fold_expression(v_met.aggregate, v_met.formula,
        private.bi_compile_filters(v_ds.source_id, p_dataset_id, v_met.filter_json));
    end if;

    v_ord  := v_ord + 1;
    v_mets := v_mets + 1;
    v_select := v_select || format('%s as m%s', v_expr, v_mets - 1);
    v_columns := v_columns || jsonb_build_object(
      'key', v_met.key, 'alias', format('m%s', v_mets - 1), 'kind', 'METRIC',
      'label', v_met.display_name, 'label_ar', v_met.display_name_ar,
      'data_type', 'number', 'ordinal', v_ord, 'aggregate', v_met.aggregate,
      'format', v_met.format, 'unit', v_met.unit, 'decimals', v_met.decimals,
      'is_additive', v_met.is_additive);
  end loop;

  if array_length(v_select, 1) is null then
    raise exception 'An analysis needs at least one dimension or metric'
      using errcode = '22023';
  end if;

  -- The caller's own filters, resolved against this dataset's dimensions first.
  v_filter := private.bi_compile_filters(v_ds.source_id, p_dataset_id, p_filters);
  if v_filter <> '' then v_where := v_where || format('(%s)', v_filter); end if;

  -- Ordering is by ordinal, resolved from the column list, so `order by` cannot
  -- carry a string either. Default: the first metric descending when there is one
  -- -- which is what "top by revenue" means -- and otherwise the first dimension.
  if coalesce(p_order_by, '') <> '' then
    select (c->>'ordinal') into v_order
      from jsonb_array_elements(v_columns) as c
     where c->>'key' = p_order_by;
    if v_order is null then
      raise exception 'Cannot order by "%": it is not one of the selected columns', p_order_by
        using errcode = '22023';
    end if;
  elsif v_mets > 0 then
    v_order := (v_dims + 1)::text;
  else
    v_order := '1';
  end if;

  -- Clamped, not trusted. 5000 rows is past what any of the chart types can draw
  -- and well inside what one request should be allowed to materialize.
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 5000);

  v_sql := format(
    'select %s from %I.%I as src where %s%s order by %s %s nulls last limit %s',
    array_to_string(v_select, ', '),
    v_src.relation_schema, v_src.relation_name,
    array_to_string(v_where, ' and '),
    case when v_dims > 0 then ' group by ' || array_to_string(v_group, ', ') else '' end,
    v_order,
    case when coalesce(p_order_desc, true) then 'desc' else 'asc' end,
    v_limit);

  return jsonb_build_object(
    'sql', v_sql,
    'dataset_id', p_dataset_id,
    'dataset_key', v_ds.key,
    'dataset_name', v_ds.name,
    'source_key', v_src.key,
    'source_relation', format('%s.%s', v_src.relation_schema, v_src.relation_name),
    'required_permission', v_src.required_permission,
    'columns', v_columns,
    'dimension_count', v_dims,
    'metric_count', v_mets,
    'time_grain', nullif(v_grain, ''),
    'row_limit', v_limit,
    'compiled_at', to_jsonb(now()));
end;
$fn$;

revoke all on function private.bi_compile_query(uuid,text[],text[],jsonb,text,text,boolean,integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- J. The two ledgers.
--
--    bi_query_log answers "what did this cost and who ran it" -- the question a
--    semantic layer starts getting asked the week after it works. It stores the
--    compiled SQL, not the request, because the request is not what ran.
--
--    bi_events is the append-only history of the definitions themselves: who
--    published a metric, who deprecated a dataset, what a formula was before it
--    was edited. Neither table has a client write path; both are written only by
--    private definer functions, and both refuse UPDATE and DELETE to everyone.
-- ---------------------------------------------------------------------------

create table if not exists public.bi_query_log (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id(),
  branch_id     uuid references public.branches(id),
  dataset_id    uuid references public.bi_datasets(id) on delete set null,
  visualization_id uuid,
  actor_id      uuid default auth.uid(),
  request       jsonb not null default '{}'::jsonb,
  compiled_sql  text not null default '',
  column_count  integer not null default 0,
  row_count     integer,
  duration_ms   integer,
  outcome       text not null default 'OK' check (outcome in ('OK', 'DENIED', 'ERROR')),
  error_code    text,
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_bi_query_log_scope   on public.bi_query_log (agency_id, branch_id);
create index if not exists idx_bi_query_log_dataset on public.bi_query_log (dataset_id, created_at desc);
create index if not exists idx_bi_query_log_actor   on public.bi_query_log (actor_id, created_at desc);

create table if not exists public.bi_events (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null default public.current_staff_agency_id(),
  branch_id    uuid references public.branches(id),
  entity_kind  text not null check (entity_kind in
    ('DATASET','DIMENSION','METRIC','REPORT','VISUALIZATION','DASHBOARD','SOURCE')),
  entity_id    uuid not null,
  event_type   text not null,
  actor_id     uuid default auth.uid(),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_bi_events_entity on public.bi_events (entity_kind, entity_id, created_at desc);
create index if not exists idx_bi_events_scope  on public.bi_events (agency_id, branch_id, created_at desc);

do $viz_fk$
begin
  alter table public.bi_query_log drop constraint if exists bi_query_log_visualization_fk;
  alter table public.bi_query_log add  constraint bi_query_log_visualization_fk
    foreign key (visualization_id) references public.bi_visualizations(id) on delete set null;
end;
$viz_fk$;

create or replace function private.bi_log_event(
  p_kind text, p_entity_id uuid, p_event_type text, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id uuid;
begin
  insert into public.bi_events (entity_kind, entity_id, event_type, payload)
  values (p_kind, p_entity_id, p_event_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function private.bi_log_event(text,uuid,text,jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- K. Running a compiled query.
--
--    Three authorization questions, in this order, and all three are necessary:
--
--      1. has_permission('bi_datasets','read')  -- may this caller use BI at all
--      2. has_permission(source.required_permission,'read')
--                                               -- may this caller read the thing
--                                                  the dataset is made of
--      3. row_in_staff_scope(...)                -- inside the compiled SQL, so it
--                                                  survives every code path here
--
--    Question 2 is the one a semantic layer usually gets wrong. Without it, BI is
--    a hole straight through RBAC: a GUIDE who cannot open an invoice reads the
--    entire receivables ledger as a bar chart, because the definer function that
--    runs the query has rights the caller does not. The dataset's source names the
--    RBAC resource that already guards the underlying table, so the answer is the
--    same one the rest of the platform would give.
-- ---------------------------------------------------------------------------

-- One deliberate departure from the rest of this repository, and the reason is
-- the ledger: this function reports failure as data instead of raising.
--
-- Every other command here signals refusal with `raise ... errcode = '42501'`,
-- which is right when nothing needs to be remembered about the attempt. A denied
-- BI query is exactly the attempt worth remembering -- someone asking a dataset
-- they may not read is the first line of an incident -- and an exception rolls its
-- own audit row back with it. There is no in-transaction way to raise and keep the
-- evidence, so the evidence wins: `ok:false` with the code and message, a row in
-- bi_query_log, and a service layer that turns the payload back into an error on
-- the screen. `outcome` therefore means something on every row rather than being a
-- column that can only ever say OK.
create or replace function private.bi_run_query(
  p_dataset_id       uuid,
  p_dimensions       text[]  default '{}',
  p_metrics          text[]  default '{}',
  p_filters          jsonb   default '[]'::jsonb,
  p_time_grain       text    default null,
  p_order_by         text    default null,
  p_order_desc       boolean default true,
  p_limit            integer default 500,
  p_visualization_id uuid    default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_plan    jsonb;
  v_rows    jsonb := '[]'::jsonb;
  v_ds      record;
  v_began   timestamptz := clock_timestamp();
  v_ms      integer;
  v_request jsonb;
  v_state   text;
  v_message text;
begin
  v_request := jsonb_build_object(
    'dataset_id', p_dataset_id, 'dimensions', to_jsonb(coalesce(p_dimensions, '{}'::text[])),
    'metrics', to_jsonb(coalesce(p_metrics, '{}'::text[])), 'filters', coalesce(p_filters, '[]'::jsonb),
    'time_grain', p_time_grain, 'order_by', p_order_by, 'order_desc', p_order_desc,
    'limit', p_limit, 'visualization_id', p_visualization_id);

  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Your role cannot read BI datasets' using errcode = '42501';
  end if;

  v_plan := private.bi_compile_query(p_dataset_id, p_dimensions, p_metrics, p_filters,
                                     p_time_grain, p_order_by, p_order_desc, p_limit);

  if not public.has_permission(v_plan->>'required_permission', 'read') then
    raise exception 'Your role cannot read %, which is what this dataset is built from',
      v_plan->>'required_permission' using errcode = '42501';
  end if;

  -- A DRAFT dataset is readable by the person building it and by ADMIN, and by
  -- nobody else. That is what makes DRAFT usable as a workspace: the definition
  -- can be wrong for a while without being wrong on someone else's dashboard.
  select d.status, d.owner, d.created_by into v_ds
    from public.bi_datasets d where d.id = p_dataset_id;
  if v_ds.status <> 'PUBLISHED'
     and public.staff_role() <> 'ADMIN'
     and auth.uid() is distinct from coalesce(v_ds.owner, v_ds.created_by) then
    raise exception 'Dataset is % and you do not own it', lower(v_ds.status)
      using errcode = '42501';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', v_plan->>'sql')
     into v_rows;
  v_ms := greatest(0, (extract(epoch from clock_timestamp() - v_began) * 1000)::integer);

  insert into public.bi_query_log
    (dataset_id, visualization_id, request, compiled_sql, column_count, row_count,
     duration_ms, outcome)
  values
    (p_dataset_id, p_visualization_id, v_request, v_plan->>'sql',
     jsonb_array_length(v_plan->'columns'), jsonb_array_length(v_rows), v_ms, 'OK');

  update public.bi_datasets
     set last_queried_at = now(), query_count = query_count + 1
   where id = p_dataset_id;

  return jsonb_build_object(
    'ok', true,
    'columns', v_plan->'columns',
    'rows', v_rows,
    'row_count', jsonb_array_length(v_rows),
    'row_limit', v_plan->'row_limit',
    'truncated', jsonb_array_length(v_rows) >= (v_plan->>'row_limit')::integer,
    'duration_ms', v_ms,
    'dataset_key', v_plan->'dataset_key',
    'time_grain', v_plan->'time_grain',
    'compiled_sql', v_plan->'sql');

exception
  when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    v_ms := greatest(0, (extract(epoch from clock_timestamp() - v_began) * 1000)::integer);
    insert into public.bi_query_log
      (dataset_id, visualization_id, request, compiled_sql, column_count,
       duration_ms, outcome, error_code, error_message)
    values
      -- The dataset id is written only when it still names a row. A request for a
      -- dataset that does not exist is precisely one of the failures this ledger is
      -- for, and the foreign key would turn recording it into a second, louder error
      -- that replaced the first -- the caller would get 23503 from the handler
      -- instead of the refusal the handler exists to return. The request payload
      -- carries the id either way, so nothing is lost by leaving the column null.
      (case when exists (select 1 from public.bi_datasets d where d.id = p_dataset_id)
            then p_dataset_id end,
       p_visualization_id, v_request, coalesce(v_plan->>'sql', ''),
       coalesce(jsonb_array_length(v_plan->'columns'), 0), v_ms,
       case when v_state = '42501' then 'DENIED' else 'ERROR' end, v_state, v_message);
    return jsonb_build_object(
      'ok', false, 'error_code', v_state, 'error_message', v_message,
      'columns', coalesce(v_plan->'columns', '[]'::jsonb), 'rows', '[]'::jsonb,
      'row_count', 0, 'duration_ms', v_ms);
end;
$fn$;

revoke all on function private.bi_run_query(uuid,text[],text[],jsonb,text,text,boolean,integer,uuid)
  from public, anon, authenticated;

-- Drill-through: from one cell of an aggregate to the records underneath it.
--
-- This is the part that makes a chart something you can act on rather than look
-- at. It returns identifiers, not rows -- the caller already has a screen that
-- knows how to open a booking or an invoice, and handing back whole records here
-- would be a second read path around the one that guards those tables.
create or replace function private.bi_drill_through(
  p_dataset_id    uuid,
  p_dimension_key text,
  p_value         jsonb   default 'null'::jsonb,
  p_filters       jsonb   default '[]'::jsonb,
  p_limit         integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ds     record;
  v_src    record;
  v_dim    record;
  v_where  text[] := '{}';
  v_filter text;
  v_lit    text;
  v_ids    jsonb := '[]'::jsonb;
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_sql    text;
  v_state  text;
  v_msg    text;
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Your role cannot read BI datasets' using errcode = '42501';
  end if;

  select d.id, d.key, d.source_id, d.status, d.owner, d.created_by, d.row_filter_json
    into v_ds from public.bi_datasets d where d.id = p_dataset_id;
  if not found or v_ds.source_id is null then
    raise exception 'That dataset is not bound to a data source' using errcode = '22023';
  end if;
  select s.* into v_src from public.bi_sources s where s.id = v_ds.source_id;
  if not public.has_permission(v_src.required_permission, 'read') then
    raise exception 'Your role cannot read %, which is what this dataset is built from',
      v_src.required_permission using errcode = '42501';
  end if;

  select x.* into v_dim from public.bi_dimensions x
   where x.dataset_id = p_dataset_id and x.key = p_dimension_key;
  if not found then
    raise exception 'Dimension "%" is not defined on dataset "%"', p_dimension_key, v_ds.key
      using errcode = '22023';
  end if;
  if v_dim.drill_through_expression is null then
    raise exception 'Dimension "%" has no drill-through target', p_dimension_key
      using errcode = '22023';
  end if;

  if v_ds.status <> 'PUBLISHED'
     and public.staff_role() <> 'ADMIN'
     and auth.uid() is distinct from coalesce(v_ds.owner, v_ds.created_by) then
    raise exception 'Dataset is % and you do not own it', lower(v_ds.status)
      using errcode = '42501';
  end if;

  if v_src.branch_column is null then
    v_where := v_where || format('src.%I = public.staff_agency_id()', v_src.tenant_column);
  else
    v_where := v_where || format('public.row_in_staff_scope(src.%I, src.%I)',
                                 v_src.tenant_column, v_src.branch_column);
  end if;
  v_filter := private.bi_compile_filters(v_ds.source_id, null, v_ds.row_filter_json);
  if v_filter <> '' then v_where := v_where || format('(%s)', v_filter); end if;
  v_filter := private.bi_compile_filters(v_ds.source_id, p_dataset_id, p_filters);
  if v_filter <> '' then v_where := v_where || format('(%s)', v_filter); end if;

  -- The cell itself. A null value drills into the null group, which is a real
  -- group -- "bookings with no assigned guide" is a question people ask -- so it
  -- is matched with `is null` rather than refused.
  v_lit := private.bi_literal(v_dim.data_type, p_value);
  v_where := v_where || case when v_lit = 'null'
                             then format('(%s) is null', v_dim.expression)
                             else format('(%s) = %s', v_dim.expression, v_lit) end;

  v_sql := format(
    'select coalesce(jsonb_agg(x.entity_id), ''[]''::jsonb) from ('
      || 'select distinct (%s)::text as entity_id from %I.%I as src where %s limit %s) x',
    v_dim.drill_through_expression, v_src.relation_schema, v_src.relation_name,
    array_to_string(v_where, ' and '), v_limit);
  execute v_sql into v_ids;

  insert into public.bi_query_log (dataset_id, request, compiled_sql, row_count, outcome)
  values (p_dataset_id,
          jsonb_build_object('drill_through', p_dimension_key, 'value', p_value,
                             'filters', coalesce(p_filters, '[]'::jsonb)),
          v_sql, jsonb_array_length(v_ids), 'OK');

  return jsonb_build_object(
    'ok', true, 'kind', v_dim.drill_through_kind, 'dimension_key', p_dimension_key,
    'value', p_value, 'entity_ids', v_ids, 'entity_count', jsonb_array_length(v_ids),
    'truncated', jsonb_array_length(v_ids) >= v_limit);

exception
  when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    insert into public.bi_query_log
      (dataset_id, request, compiled_sql, outcome, error_code, error_message)
    values (case when exists (select 1 from public.bi_datasets d where d.id = p_dataset_id)
                 then p_dataset_id end,
            jsonb_build_object('drill_through', p_dimension_key, 'value', p_value),
            coalesce(v_sql, ''),
            case when v_state = '42501' then 'DENIED' else 'ERROR' end, v_state, v_msg);
    return jsonb_build_object('ok', false, 'error_code', v_state, 'error_message', v_msg,
                              'entity_ids', '[]'::jsonb, 'entity_count', 0);
end;
$fn$;

revoke all on function private.bi_drill_through(uuid,text,jsonb,jsonb,integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- L. Saved analyses, reports and dashboards.
--
--    bi_visualizations was four columns of intent: a chart_type with no vocabulary
--    and two jsonb arrays nothing resolved. It becomes a saved analysis -- the
--    exact request bi_run_query takes -- so a chart is reproducible rather than
--    re-specified by whatever screen last drew it.
--
--    bi_dashboards and bi_dashboard_tiles are new, and the tile referencing a
--    visualization `on delete restrict` is the whole reason they are separate
--    tables: one analysis appears on several dashboards, and deleting one that is
--    in use is a refusal rather than a hole in someone's morning.
-- ---------------------------------------------------------------------------

alter table public.bi_reports
  add column if not exists key           text,
  add column if not exists title_ar      text,
  add column if not exists status        text not null default 'DRAFT',
  add column if not exists published_at  timestamptz,
  add column if not exists published_by  uuid,
  add column if not exists deprecated_at timestamptz,
  add column if not exists deprecated_by uuid,
  add column if not exists sort_order    integer not null default 0;

update public.bi_reports r
   set key = 'rp_' || left(regexp_replace(lower(coalesce(r.title, 'report')), '[^a-z0-9]+', '_', 'g'), 44)
             || '_' || left(replace(r.id::text, '-', ''), 6)
 where r.key is null;

do $reports$
begin
  alter table public.bi_reports alter column key set not null;
  alter table public.bi_reports drop constraint if exists bi_reports_key_unique;
  alter table public.bi_reports add  constraint bi_reports_key_unique unique (agency_id, key);
  alter table public.bi_reports drop constraint if exists bi_reports_key_shape;
  alter table public.bi_reports add  constraint bi_reports_key_shape
    check (key ~ '^[a-z][a-z0-9_]{1,60}$');
  alter table public.bi_reports drop constraint if exists bi_reports_status_check;
  alter table public.bi_reports add  constraint bi_reports_status_check
    check (status in ('DRAFT', 'PUBLISHED', 'DEPRECATED'));
  alter table public.bi_reports drop constraint if exists bi_reports_published_stamp;
  alter table public.bi_reports add  constraint bi_reports_published_stamp
    check ((status = 'PUBLISHED') = (published_at is not null));
end;
$reports$;

create index if not exists idx_bi_reports_scope  on public.bi_reports (agency_id, branch_id);
create index if not exists idx_bi_reports_status on public.bi_reports (status);

alter table public.bi_visualizations
  add column if not exists key         text,
  add column if not exists title       text,
  add column if not exists title_ar    text,
  add column if not exists description text,
  add column if not exists time_grain  text,
  add column if not exists order_by    text,
  add column if not exists order_desc  boolean not null default true,
  add column if not exists row_limit   integer not null default 500,
  add column if not exists options     jsonb not null default '{}'::jsonb,
  add column if not exists sort_order  integer not null default 0;

update public.bi_visualizations v
   set key = 'vz_' || left(replace(v.id::text, '-', ''), 12)
 where v.key is null;
update public.bi_visualizations v
   set title = coalesce(nullif(v.title, ''), 'Analysis ' || left(replace(v.id::text, '-', ''), 6))
 where coalesce(v.title, '') = '';

-- chart_type was `TEXT NOT NULL` with no vocabulary, so whatever a screen wrote is
-- what is in there. Normalized to the closed set below before the check exists,
-- and anything unrecognized becomes TABLE: a table renders every result correctly,
-- which makes it the only safe thing to guess.
update public.bi_visualizations v
   set chart_type = upper(regexp_replace(coalesce(v.chart_type, 'TABLE'), '[^A-Za-z0-9]+', '_', 'g'));
update public.bi_visualizations v
   set chart_type = 'TABLE'
 where v.chart_type not in (
   'TABLE','PIVOT','KPI','LINE','AREA','BAR','COLUMN','STACKED_BAR','STACKED_COLUMN',
   'PIE','DONUT','SCATTER','BUBBLE','WATERFALL','BRIDGE','BULLET','HISTOGRAM','BOX_PLOT',
   'HEATMAP','TREEMAP','DECOMPOSITION_TREE','SANKEY','FUNNEL','GANTT','CORRELATION_MATRIX',
   'PARETO','FORECAST_BAND','SENSITIVITY_MATRIX','DEPENDENCY_GRAPH','DRIVER_TREE',
   'RADAR','GAUGE','COMBO');

do $viz$
begin
  alter table public.bi_visualizations alter column key set not null;
  alter table public.bi_visualizations alter column title set not null;
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_key_unique;
  alter table public.bi_visualizations add  constraint bi_visualizations_key_unique
    unique (agency_id, key);
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_key_shape;
  alter table public.bi_visualizations add  constraint bi_visualizations_key_shape
    check (key ~ '^[a-z][a-z0-9_]{1,60}$');
  -- The vocabulary. Every one of these is a chart the front end has to be able to
  -- draw from a dimension/metric result set; naming them in a constraint is what
  -- keeps "we support 30 chart types" from meaning "the string column accepts 30
  -- more values than it did".
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_chart_type_check;
  alter table public.bi_visualizations add  constraint bi_visualizations_chart_type_check
    check (chart_type in (
      'TABLE','PIVOT','KPI','LINE','AREA','BAR','COLUMN','STACKED_BAR','STACKED_COLUMN',
      'PIE','DONUT','SCATTER','BUBBLE','WATERFALL','BRIDGE','BULLET','HISTOGRAM','BOX_PLOT',
      'HEATMAP','TREEMAP','DECOMPOSITION_TREE','SANKEY','FUNNEL','GANTT','CORRELATION_MATRIX',
      'PARETO','FORECAST_BAND','SENSITIVITY_MATRIX','DEPENDENCY_GRAPH','DRIVER_TREE',
      'RADAR','GAUGE','COMBO'));
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_grain_check;
  alter table public.bi_visualizations add  constraint bi_visualizations_grain_check
    check (time_grain is null or time_grain in ('DAY','WEEK','MONTH','QUARTER','YEAR'));
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_row_limit_check;
  alter table public.bi_visualizations add  constraint bi_visualizations_row_limit_check
    check (row_limit between 1 and 5000);
  alter table public.bi_visualizations drop constraint if exists bi_visualizations_shape_check;
  alter table public.bi_visualizations add  constraint bi_visualizations_shape_check
    check (jsonb_typeof(dimensions) = 'array' and jsonb_typeof(measures) = 'array'
           and jsonb_typeof(filters) = 'array' and jsonb_typeof(options) = 'object');
end;
$viz$;

create index if not exists idx_bi_visualizations_scope   on public.bi_visualizations (agency_id, branch_id);
create index if not exists idx_bi_visualizations_dataset on public.bi_visualizations (dataset_id);
create index if not exists idx_bi_visualizations_report  on public.bi_visualizations (report_id, sort_order);

create table if not exists public.bi_dashboards (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id(),
  branch_id     uuid references public.branches(id),
  key           text not null,
  title         text not null,
  title_ar      text,
  description   text,
  status        text not null default 'DRAFT'
    check (status in ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  layout        jsonb not null default '{}'::jsonb,
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  owner         uuid default auth.uid(),
  published_at  timestamptz,
  published_by  uuid,
  deprecated_at timestamptz,
  deprecated_by uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  constraint bi_dashboards_key_unique unique (agency_id, key),
  constraint bi_dashboards_key_shape check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  constraint bi_dashboards_published_stamp check ((status = 'PUBLISHED') = (published_at is not null))
);

create table if not exists public.bi_dashboard_tiles (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_staff_agency_id(),
  branch_id        uuid references public.branches(id),
  dashboard_id     uuid not null references public.bi_dashboards(id) on delete cascade,
  -- on delete restrict, and this is the point of the table: a saved analysis is
  -- shared, so removing one that a dashboard still shows has to be refused rather
  -- than silently leaving a gap where a number used to be.
  visualization_id uuid not null references public.bi_visualizations(id) on delete restrict,
  title_override   text,
  grid_x           integer not null default 0 check (grid_x between 0 and 11),
  grid_y           integer not null default 0 check (grid_y >= 0),
  grid_w           integer not null default 6 check (grid_w between 1 and 12),
  grid_h           integer not null default 4 check (grid_h between 1 and 24),
  options          jsonb not null default '{}'::jsonb,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  constraint bi_dashboard_tiles_fits check (grid_x + grid_w <= 12),
  constraint bi_dashboard_tiles_once unique (dashboard_id, visualization_id)
);

create index if not exists idx_bi_dashboards_scope    on public.bi_dashboards (agency_id, branch_id);
create index if not exists idx_bi_dashboards_status   on public.bi_dashboards (status);
create index if not exists idx_bi_tiles_dashboard     on public.bi_dashboard_tiles (dashboard_id, sort_order);
create index if not exists idx_bi_tiles_visualization on public.bi_dashboard_tiles (visualization_id);

-- A saved analysis is validated by compiling it. Not by re-checking each field --
-- that would be a second implementation of the compiler's rules, and the two would
-- drift -- but by asking the compiler itself whether this request is one it can
-- build. If it compiles it can run; if it cannot, it is refused at the write.
create or replace function private.bi_validate_visualization()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dims text[];
  v_mets text[];
begin
  if new.dataset_id is null then
    if coalesce(new.dimensions, '[]'::jsonb) <> '[]'::jsonb
       or coalesce(new.measures, '[]'::jsonb) <> '[]'::jsonb then
      raise exception 'This analysis names dimensions or measures but no dataset'
        using errcode = '22023';
    end if;
    return new;
  end if;

  select coalesce(array_agg(value #>> '{}' order by ordinality), '{}'::text[]) into v_dims
    from jsonb_array_elements(coalesce(new.dimensions, '[]'::jsonb)) with ordinality;
  select coalesce(array_agg(value #>> '{}' order by ordinality), '{}'::text[]) into v_mets
    from jsonb_array_elements(coalesce(new.measures, '[]'::jsonb)) with ordinality;

  perform private.bi_compile_query(new.dataset_id, v_dims, v_mets, new.filters,
                                   new.time_grain, new.order_by, new.order_desc,
                                   new.row_limit);
  return new;
end;
$fn$;

revoke all on function private.bi_validate_visualization() from public, anon, authenticated;

drop trigger if exists trg_bi_validate_visualization on public.bi_visualizations;
create trigger trg_bi_validate_visualization
  before insert or update on public.bi_visualizations
  for each row execute function private.bi_validate_visualization();

-- ---------------------------------------------------------------------------
-- M. Row security, in the shape the rest of the platform uses.
--
--    The four policies 20260822000011 installed were `for all using (agency_id =
--    current_staff_agency_id())`. Two things are wrong with that. It asks about the
--    agency and never about the branch, so every staff member of an agency sees
--    every branch's definitions; and `for all` with no separate WITH CHECK means
--    the same predicate governs reading and writing, so anyone who can read a
--    dataset can rewrite it. They are dropped by name and replaced with the
--    four-verb form used by every other table here, which asks has_permission the
--    verb-specific question and row_in_staff_scope the scope question.
-- ---------------------------------------------------------------------------

do $drop_old$
declare
  p record;
begin
  for p in
    select tablename as tbl, policyname as pol
      from pg_policies
     where schemaname = 'public'
       and tablename in ('bi_datasets','bi_metrics','bi_reports','bi_visualizations')
       and policyname in ('bi_datasets_isolation','bi_metrics_isolation',
                          'bi_reports_isolation','bi_visualizations_isolation')
  loop
    execute format('drop policy if exists %I on public.%I', p.pol, p.tbl);
  end loop;
end;
$drop_old$;

do $rls$
declare
  t         text;
  has_audit boolean;
  bi_tables text[] := array[
    'bi_datasets','bi_dimensions','bi_metrics','bi_reports','bi_visualizations',
    'bi_dashboards','bi_dashboard_tiles'
  ];
begin
  select exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = 'write_audit_log'
  ) into has_audit;

  foreach t in array bi_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);

    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);

    execute format('drop policy if exists staff_update on public.%I', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id)) with check (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id))', t, t, t);

    execute format('drop policy if exists staff_delete on public.%I', t);
    execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);

    execute format('revoke all on public.%I from anon', t);

    execute format('drop trigger if exists trg_stamp_staff_scope on public.%I', t);
    execute format('create trigger trg_stamp_staff_scope before insert on public.%I for each row execute function public.stamp_staff_scope()', t);

    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', 'trg_' || t || '_updated_at', t);

    if has_audit then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()', 'trg_audit_' || t, t);
    end if;
  end loop;
end;
$rls$;

-- The two ledgers get a read policy and nothing else. No insert, update or delete
-- policy exists for any role, and the write privileges are revoked outright, so the
-- only way a row arrives is through a private definer function -- which is what
-- makes "append-only" a property of the schema rather than a habit.
do $ledgers$
declare
  t text;
begin
  foreach t in array array['bi_query_log', 'bi_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists trg_stamp_staff_scope on public.%I', t);
    execute format('create trigger trg_stamp_staff_scope before insert on public.%I for each row execute function public.stamp_staff_scope()', t);
  end loop;
end;
$ledgers$;

-- The source registry is deliberately not agency-scoped: it describes the physical
-- schema, which is the same for every tenant, and it holds no tenant data. What it
-- does hold is the allowlist the compiler trusts, so no client may write to it at
-- all -- not even ADMIN through PostgREST. It changes when a migration says so.
do $registry$
declare
  t text;
begin
  foreach t in array array['bi_sources', 'bi_source_columns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(''bi_datasets'',''read''))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$registry$;

-- ---------------------------------------------------------------------------
-- N. The lifecycle.
--
--    DRAFT -> PUBLISHED -> DEPRECATED, with the dependency rules that make those
--    words mean something:
--
--      publishing a dataset   needs a source, one dimension and one metric --
--                             an empty dataset publishes nothing
--      publishing a metric    needs its dataset already PUBLISHED
--      deprecating a dataset  cascades to its metrics, and is refused while a
--                             PUBLISHED dashboard still shows it
--      publishing a report    or a dashboard needs something on it
--
--    And the freeze: while a definition is PUBLISHED its formula cannot change.
--    That is the difference between a metric and a variable. If gross margin has
--    to mean something else, it goes back to DRAFT -- which bumps its version and
--    is written to bi_events -- and every dashboard that showed the old number can
--    be traced to the definition that produced it.
-- ---------------------------------------------------------------------------

alter table public.bi_metrics    add column if not exists version integer not null default 1;
alter table public.bi_reports    add column if not exists version integer not null default 1;
alter table public.bi_dashboards add column if not exists version integer not null default 1;

create or replace function private.bi_freeze_published_metric()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if old.status = 'PUBLISHED' and new.status = 'PUBLISHED'
     and (new.formula                is distinct from old.formula
       or new.aggregate              is distinct from old.aggregate
       or new.filter_json            is distinct from old.filter_json
       or new.numerator_metric_key   is distinct from old.numerator_metric_key
       or new.denominator_metric_key is distinct from old.denominator_metric_key) then
    raise exception 'Metric "%" is published; return it to draft before changing what it measures',
      old.key using errcode = '22023';
  end if;
  -- Returning to draft is the versioning event. The number on last quarter's
  -- dashboard was produced by version %, and now there is a way to say which.
  if old.status = 'PUBLISHED' and new.status = 'DRAFT' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$fn$;

revoke all on function private.bi_freeze_published_metric() from public, anon, authenticated;

drop trigger if exists trg_bi_freeze_published_metric on public.bi_metrics;
create trigger trg_bi_freeze_published_metric
  before update on public.bi_metrics
  for each row execute function private.bi_freeze_published_metric();

-- One function owns every status transition in this subsystem. The alternative --
-- a publish command per table -- is four places for the dependency rules to be
-- forgotten in.
--
-- Note that a deprecated definition loses published_at: the *_published_stamp
-- constraints tie that column to the PUBLISHED state exactly. The history is not
-- lost, it moves -- bi_events holds every transition with its timestamp and actor,
-- which is where a question like "what was this showing in March" is answerable
-- anyway, and a single nullable column never could be.
create or replace function private.bi_set_status(
  p_kind text, p_id uuid, p_to_status text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ds     record;
  v_met    record;
  v_rep    record;
  v_dash   record;
  v_from   text;
  v_table  text;
  v_extra  jsonb := '{}'::jsonb;
begin
  if p_to_status not in ('DRAFT', 'PUBLISHED', 'DEPRECATED') then
    raise exception 'Status "%" is not one of DRAFT, PUBLISHED, DEPRECATED', p_to_status
      using errcode = '22023';
  end if;
  v_table := case p_kind
    when 'DATASET'   then 'bi_datasets'
    when 'METRIC'    then 'bi_metrics'
    when 'REPORT'    then 'bi_reports'
    when 'DASHBOARD' then 'bi_dashboards'
    else null end;
  if v_table is null then
    raise exception '"%" is not a publishable kind', p_kind using errcode = '22023';
  end if;
  -- Governance is one privilege, not three: the same role that may publish a
  -- definition is the one that may deprecate it or pull it back to draft. Splitting
  -- them would let someone unpublish what they could never have published.
  if not public.has_permission(v_table, 'publish') then
    raise exception 'Your role cannot change the published state of %', v_table
      using errcode = '42501';
  end if;

  if p_kind = 'DATASET' then
    select d.* into v_ds from public.bi_datasets d where d.id = p_id;
    if not found then raise exception 'That dataset does not exist' using errcode = '22023'; end if;
    if not public.row_in_staff_scope(v_ds.agency_id, v_ds.branch_id) then
      raise exception 'That dataset is outside your scope' using errcode = '42501';
    end if;
    v_from := v_ds.status;

    if p_to_status = 'PUBLISHED' then
      if v_ds.source_id is null then
        raise exception 'Dataset "%" has no data source to publish', v_ds.key using errcode = '22023';
      end if;
      if not exists (select 1 from public.bi_dimensions x where x.dataset_id = p_id) then
        raise exception 'Dataset "%" has no dimensions; publishing it would publish nothing to group by', v_ds.key
          using errcode = '22023';
      end if;
      if not exists (select 1 from public.bi_metrics m where m.dataset_id = p_id) then
        raise exception 'Dataset "%" has no metrics; publishing it would publish nothing to measure', v_ds.key
          using errcode = '22023';
      end if;
      update public.bi_datasets
         set status = 'PUBLISHED', published_at = now(), published_by = auth.uid(),
             deprecated_at = null, deprecated_by = null
       where id = p_id;

    elsif p_to_status = 'DEPRECATED' then
      if exists (
        select 1 from public.bi_dashboard_tiles t
          join public.bi_visualizations v on v.id = t.visualization_id
          join public.bi_dashboards dsh   on dsh.id = t.dashboard_id
         where v.dataset_id = p_id and dsh.status = 'PUBLISHED') then
        raise exception 'Dataset "%" is still on a published dashboard; remove it there first', v_ds.key
          using errcode = '22023';
      end if;
      update public.bi_datasets
         set status = 'DEPRECATED', published_at = null, published_by = null,
             deprecated_at = now(), deprecated_by = auth.uid()
       where id = p_id;
      -- A metric outlives its dataset in no useful sense: it compiles against that
      -- dataset's source and nothing else can run it.
      update public.bi_metrics
         set status = 'DEPRECATED', published_at = null, published_by = null,
             deprecated_at = now(), deprecated_by = auth.uid()
       where dataset_id = p_id and status <> 'DEPRECATED';
      v_extra := jsonb_build_object('metrics_deprecated',
        (select count(*) from public.bi_metrics m where m.dataset_id = p_id and m.status = 'DEPRECATED'));

    else
      update public.bi_datasets
         set status = 'DRAFT', published_at = null, published_by = null,
             deprecated_at = null, deprecated_by = null,
             version = version + case when v_from = 'PUBLISHED' then 1 else 0 end
       where id = p_id;
    end if;
    perform private.bi_log_event('DATASET', p_id, 'STATUS_' || p_to_status,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'note', p_note) || v_extra);

  elsif p_kind = 'METRIC' then
    select m.* into v_met from public.bi_metrics m where m.id = p_id;
    if not found then raise exception 'That metric does not exist' using errcode = '22023'; end if;
    if not public.row_in_staff_scope(v_met.agency_id, v_met.branch_id) then
      raise exception 'That metric is outside your scope' using errcode = '42501';
    end if;
    v_from := v_met.status;

    if p_to_status = 'PUBLISHED' then
      -- A published metric on a draft dataset is a number nobody else can compute:
      -- bi_run_query refuses the dataset, so the metric is unreachable.
      if (select d.status from public.bi_datasets d where d.id = v_met.dataset_id) <> 'PUBLISHED' then
        raise exception 'Publish the dataset behind metric "%" first', v_met.key
          using errcode = '22023';
      end if;
      update public.bi_metrics
         set status = 'PUBLISHED', published_at = now(), published_by = auth.uid(),
             deprecated_at = null, deprecated_by = null
       where id = p_id;
    elsif p_to_status = 'DEPRECATED' then
      if exists (
        select 1 from public.bi_dashboard_tiles t
          join public.bi_visualizations v on v.id = t.visualization_id
          join public.bi_dashboards dsh   on dsh.id = t.dashboard_id
         where v.dataset_id = v_met.dataset_id
           and v.measures ? v_met.key
           and dsh.status = 'PUBLISHED') then
        raise exception 'Metric "%" is still shown on a published dashboard; remove it there first', v_met.key
          using errcode = '22023';
      end if;
      if exists (select 1 from public.bi_metrics r
                  where r.dataset_id = v_met.dataset_id and r.aggregate = 'RATIO'
                    and r.status <> 'DEPRECATED'
                    and v_met.key in (r.numerator_metric_key, r.denominator_metric_key)) then
        raise exception 'Metric "%" is an operand of a live ratio metric; deprecate that one first', v_met.key
          using errcode = '22023';
      end if;
      update public.bi_metrics
         set status = 'DEPRECATED', published_at = null, published_by = null,
             deprecated_at = now(), deprecated_by = auth.uid()
       where id = p_id;
    else
      update public.bi_metrics
         set status = 'DRAFT', published_at = null, published_by = null,
             deprecated_at = null, deprecated_by = null
       where id = p_id;
    end if;
    perform private.bi_log_event('METRIC', p_id, 'STATUS_' || p_to_status,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'note', p_note,
                         'formula', v_met.formula, 'aggregate', v_met.aggregate));

  elsif p_kind = 'REPORT' then
    select r.* into v_rep from public.bi_reports r where r.id = p_id;
    if not found then raise exception 'That report does not exist' using errcode = '22023'; end if;
    if not public.row_in_staff_scope(v_rep.agency_id, v_rep.branch_id) then
      raise exception 'That report is outside your scope' using errcode = '42501';
    end if;
    v_from := v_rep.status;
    if p_to_status = 'PUBLISHED' then
      if not exists (select 1 from public.bi_visualizations v where v.report_id = p_id) then
        raise exception 'Report "%" has nothing on it to publish', v_rep.key using errcode = '22023';
      end if;
      update public.bi_reports
         set status = 'PUBLISHED', published_at = now(), published_by = auth.uid(),
             deprecated_at = null, deprecated_by = null
       where id = p_id;
    elsif p_to_status = 'DEPRECATED' then
      update public.bi_reports
         set status = 'DEPRECATED', published_at = null, published_by = null,
             deprecated_at = now(), deprecated_by = auth.uid()
       where id = p_id;
    else
      update public.bi_reports
         set status = 'DRAFT', published_at = null, published_by = null,
             deprecated_at = null, deprecated_by = null,
             version = version + case when v_from = 'PUBLISHED' then 1 else 0 end
       where id = p_id;
    end if;
    perform private.bi_log_event('REPORT', p_id, 'STATUS_' || p_to_status,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'note', p_note));

  else
    select b.* into v_dash from public.bi_dashboards b where b.id = p_id;
    if not found then raise exception 'That dashboard does not exist' using errcode = '22023'; end if;
    if not public.row_in_staff_scope(v_dash.agency_id, v_dash.branch_id) then
      raise exception 'That dashboard is outside your scope' using errcode = '42501';
    end if;
    v_from := v_dash.status;
    if p_to_status = 'PUBLISHED' then
      if not exists (select 1 from public.bi_dashboard_tiles t where t.dashboard_id = p_id) then
        raise exception 'Dashboard "%" has no tiles to publish', v_dash.key using errcode = '22023';
      end if;
      -- Publishing a dashboard is a promise that everything on it resolves. A tile
      -- pointing at a draft dataset would render an authorization error for every
      -- viewer who is not its author, which is a worse outcome than refusing here.
      if exists (
        select 1 from public.bi_dashboard_tiles t
          join public.bi_visualizations v on v.id = t.visualization_id
          left join public.bi_datasets d  on d.id = v.dataset_id
         where t.dashboard_id = p_id and coalesce(d.status, 'DRAFT') <> 'PUBLISHED') then
        raise exception 'Dashboard "%" has a tile on a dataset that is not published', v_dash.key
          using errcode = '22023';
      end if;
      update public.bi_dashboards
         set status = 'PUBLISHED', published_at = now(), published_by = auth.uid(),
             deprecated_at = null, deprecated_by = null
       where id = p_id;
    elsif p_to_status = 'DEPRECATED' then
      update public.bi_dashboards
         set status = 'DEPRECATED', published_at = null, published_by = null,
             deprecated_at = now(), deprecated_by = auth.uid()
       where id = p_id;
    else
      update public.bi_dashboards
         set status = 'DRAFT', published_at = null, published_by = null,
             deprecated_at = null, deprecated_by = null,
             version = version + case when v_from = 'PUBLISHED' then 1 else 0 end
       where id = p_id;
    end if;
    perform private.bi_log_event('DASHBOARD', p_id, 'STATUS_' || p_to_status,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'note', p_note));
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id,
                            'from', v_from, 'to', p_to_status);
end;
$fn$;

revoke all on function private.bi_set_status(text,uuid,text,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O. Who may do what.
--
--    Two deliberate holes in this table, both ADMIN-only by implication because
--    has_permission answers true for ADMIN unconditionally:
--
--      bi_datasets.publish, bi_metrics.publish   no role holds them
--      bi_datasets.delete,  bi_metrics.delete    no role holds them
--
--    Publishing a definition settles what a word means for everyone who reads a
--    dashboard afterwards, and deleting one destroys the only record of what a
--    published number was. Deprecation covers every legitimate case for both, and
--    it is reversible. Publishing a *dashboard* is a different act -- arranging
--    already-governed numbers on a page -- so operations and finance hold that.
--
--    GUIDE holds read on the catalog. That is not an oversight: the source-level
--    check in bi_run_query means a guide asking an invoice dataset is refused by
--    invoices' own RBAC resource, so catalog access costs nothing and refusing it
--    would only hide the pilgrim lists they are supposed to see.
-- ---------------------------------------------------------------------------

insert into public.staff_permissions(role, resource, action) values
  ('OPERATIONS_MANAGER','bi_datasets','read'),('OPERATIONS_MANAGER','bi_datasets','create'),
  ('OPERATIONS_MANAGER','bi_datasets','update'),
  ('OPERATIONS_MANAGER','bi_dimensions','read'),('OPERATIONS_MANAGER','bi_dimensions','create'),
  ('OPERATIONS_MANAGER','bi_dimensions','update'),('OPERATIONS_MANAGER','bi_dimensions','delete'),
  ('OPERATIONS_MANAGER','bi_metrics','read'),('OPERATIONS_MANAGER','bi_metrics','create'),
  ('OPERATIONS_MANAGER','bi_metrics','update'),
  ('OPERATIONS_MANAGER','bi_reports','read'),('OPERATIONS_MANAGER','bi_reports','create'),
  ('OPERATIONS_MANAGER','bi_reports','update'),('OPERATIONS_MANAGER','bi_reports','delete'),
  ('OPERATIONS_MANAGER','bi_reports','publish'),
  ('OPERATIONS_MANAGER','bi_visualizations','read'),('OPERATIONS_MANAGER','bi_visualizations','create'),
  ('OPERATIONS_MANAGER','bi_visualizations','update'),('OPERATIONS_MANAGER','bi_visualizations','delete'),
  ('OPERATIONS_MANAGER','bi_dashboards','read'),('OPERATIONS_MANAGER','bi_dashboards','create'),
  ('OPERATIONS_MANAGER','bi_dashboards','update'),('OPERATIONS_MANAGER','bi_dashboards','delete'),
  ('OPERATIONS_MANAGER','bi_dashboards','publish'),
  ('OPERATIONS_MANAGER','bi_dashboard_tiles','read'),('OPERATIONS_MANAGER','bi_dashboard_tiles','create'),
  ('OPERATIONS_MANAGER','bi_dashboard_tiles','update'),('OPERATIONS_MANAGER','bi_dashboard_tiles','delete'),
  ('OPERATIONS_MANAGER','bi_query_log','read'),('OPERATIONS_MANAGER','bi_events','read'),

  ('FINANCE','bi_datasets','read'),('FINANCE','bi_datasets','create'),('FINANCE','bi_datasets','update'),
  ('FINANCE','bi_dimensions','read'),('FINANCE','bi_dimensions','create'),
  ('FINANCE','bi_dimensions','update'),('FINANCE','bi_dimensions','delete'),
  ('FINANCE','bi_metrics','read'),('FINANCE','bi_metrics','create'),('FINANCE','bi_metrics','update'),
  ('FINANCE','bi_reports','read'),('FINANCE','bi_reports','create'),('FINANCE','bi_reports','update'),
  ('FINANCE','bi_reports','delete'),('FINANCE','bi_reports','publish'),
  ('FINANCE','bi_visualizations','read'),('FINANCE','bi_visualizations','create'),
  ('FINANCE','bi_visualizations','update'),('FINANCE','bi_visualizations','delete'),
  ('FINANCE','bi_dashboards','read'),('FINANCE','bi_dashboards','create'),
  ('FINANCE','bi_dashboards','update'),('FINANCE','bi_dashboards','delete'),
  ('FINANCE','bi_dashboards','publish'),
  ('FINANCE','bi_dashboard_tiles','read'),('FINANCE','bi_dashboard_tiles','create'),
  ('FINANCE','bi_dashboard_tiles','update'),('FINANCE','bi_dashboard_tiles','delete'),
  ('FINANCE','bi_query_log','read'),('FINANCE','bi_events','read'),

  ('CRM','bi_datasets','read'),('CRM','bi_dimensions','read'),('CRM','bi_metrics','read'),
  ('CRM','bi_reports','read'),('CRM','bi_reports','create'),('CRM','bi_reports','update'),
  ('CRM','bi_visualizations','read'),('CRM','bi_visualizations','create'),
  ('CRM','bi_visualizations','update'),('CRM','bi_visualizations','delete'),
  ('CRM','bi_dashboards','read'),('CRM','bi_dashboards','create'),('CRM','bi_dashboards','update'),
  ('CRM','bi_dashboard_tiles','read'),('CRM','bi_dashboard_tiles','create'),
  ('CRM','bi_dashboard_tiles','update'),('CRM','bi_dashboard_tiles','delete'),
  ('CRM','bi_events','read'),

  ('AGENT','bi_datasets','read'),('AGENT','bi_dimensions','read'),('AGENT','bi_metrics','read'),
  ('AGENT','bi_reports','read'),('AGENT','bi_visualizations','read'),
  ('AGENT','bi_dashboards','read'),('AGENT','bi_dashboard_tiles','read'),

  ('VISA_AGENT','bi_datasets','read'),('VISA_AGENT','bi_dimensions','read'),
  ('VISA_AGENT','bi_metrics','read'),('VISA_AGENT','bi_reports','read'),
  ('VISA_AGENT','bi_visualizations','read'),('VISA_AGENT','bi_dashboards','read'),
  ('VISA_AGENT','bi_dashboard_tiles','read'),

  ('GUIDE','bi_datasets','read'),('GUIDE','bi_dimensions','read'),('GUIDE','bi_metrics','read'),
  ('GUIDE','bi_visualizations','read'),('GUIDE','bi_dashboards','read'),
  ('GUIDE','bi_dashboard_tiles','read')
on conflict (role, resource, action) do nothing;

-- ---------------------------------------------------------------------------
-- P. The command surface.
--
--    Smaller than the CRM's and the DMS's on purpose, and the reason is section H.
--    Creating a dimension or editing a metric's display name is a row write whose
--    every rule is already expressed twice over: the four RLS policies answer who
--    and where, and the BEFORE triggers answer whether the definition is coherent.
--    A command wrapping that would add a third statement of the same rules and a
--    second path that could disagree with them, so writes go through the tables.
--
--    What is here is everything that is not a row write: the lifecycle machine, the
--    compiler, drill-through, and re-measuring the source registry. Those cannot be
--    a policy, so they are functions -- and being functions, they are the only way
--    to reach the compiler at all.
-- ---------------------------------------------------------------------------

create or replace function private.bi_run_visualization(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_viz  record;
  v_dims text[];
  v_mets text[];
begin
  select v.* into v_viz from public.bi_visualizations v where v.id = p_id;
  if not found then
    raise exception 'That saved analysis does not exist' using errcode = '22023';
  end if;
  if not public.row_in_staff_scope(v_viz.agency_id, v_viz.branch_id) then
    raise exception 'That saved analysis is outside your scope' using errcode = '42501';
  end if;
  if v_viz.dataset_id is null then
    raise exception 'Saved analysis "%" is not bound to a dataset', v_viz.key
      using errcode = '22023';
  end if;

  select coalesce(array_agg(value #>> '{}' order by ordinality), '{}'::text[]) into v_dims
    from jsonb_array_elements(v_viz.dimensions) with ordinality;
  select coalesce(array_agg(value #>> '{}' order by ordinality), '{}'::text[]) into v_mets
    from jsonb_array_elements(v_viz.measures) with ordinality;

  return private.bi_run_query(v_viz.dataset_id, v_dims, v_mets, v_viz.filters,
                              v_viz.time_grain, v_viz.order_by, v_viz.order_desc,
                              v_viz.row_limit, p_id)
         || jsonb_build_object('chart_type', v_viz.chart_type, 'title', v_viz.title,
                               'title_ar', v_viz.title_ar, 'options', v_viz.options,
                               'visualization_id', p_id, 'visualization_key', v_viz.key);
end;
$fn$;

revoke all on function private.bi_run_visualization(uuid) from public, anon, authenticated;

-- Re-measure the registry. Needed because the physical schema keeps moving: a later
-- migration adds branch_id to a source table, or drops a column a metric names. The
-- registry is only trustworthy if re-measuring it is a thing someone can do without
-- writing a migration, and if the answer comes from information_schema rather than
-- from whoever runs it.
create or replace function private.bi_sync_sources()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  s        record;
  v_cols   integer := 0;
  v_total  integer := 0;
  v_gone   integer := 0;
  v_branch text;
begin
  if public.staff_role() <> 'ADMIN' then
    raise exception 'Only an administrator may re-measure the BI source registry'
      using errcode = '42501';
  end if;

  for s in select * from public.bi_sources order by key loop
    if to_regclass(format('%I.%I', s.relation_schema, s.relation_name)) is null then
      -- The relation is gone. Deactivated rather than deleted: the datasets bound
      -- to it keep their definitions, and bi_compile_query refuses an inactive
      -- source with a sentence that says why instead of a missing-table error.
      update public.bi_sources set is_active = false, updated_at = now() where id = s.id;
      v_gone := v_gone + 1;
      continue;
    end if;
    select c.column_name into v_branch
      from information_schema.columns c
     where c.table_schema = s.relation_schema and c.table_name = s.relation_name
       and c.column_name = 'branch_id';
    update public.bi_sources
       set is_active = true, branch_column = v_branch, updated_at = now()
     where id = s.id;
    v_cols  := private.bi_sync_source_columns(s.id);
    v_total := v_total + v_cols;
  end loop;

  return jsonb_build_object('ok', true, 'columns_registered', v_total,
                            'sources_deactivated', v_gone);
end;
$fn$;

revoke all on function private.bi_sync_sources() from public, anon, authenticated;

create or replace function public.set_bi_status_command(
  p_kind text, p_id uuid, p_status text, p_note text default null)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$ select private.bi_set_status(p_kind, p_id, p_status, p_note); $w$;

create or replace function public.run_bi_query_command(
  p_dataset_id       uuid,
  p_dimensions       text[]  default '{}',
  p_metrics          text[]  default '{}',
  p_filters          jsonb   default '[]'::jsonb,
  p_time_grain       text    default null,
  p_order_by         text    default null,
  p_order_desc       boolean default true,
  p_limit            integer default 500,
  p_visualization_id uuid    default null)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$ select private.bi_run_query(p_dataset_id, p_dimensions, p_metrics, p_filters,
                                   p_time_grain, p_order_by, p_order_desc, p_limit,
                                   p_visualization_id); $w$;

create or replace function public.run_bi_visualization_command(p_visualization_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$ select private.bi_run_visualization(p_visualization_id); $w$;

create or replace function public.run_bi_drill_through_command(
  p_dataset_id uuid, p_dimension_key text, p_value jsonb default 'null'::jsonb,
  p_filters jsonb default '[]'::jsonb, p_limit integer default 200)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$ select private.bi_drill_through(p_dataset_id, p_dimension_key, p_value,
                                       p_filters, p_limit); $w$;

create or replace function public.sync_bi_sources_command()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$ select private.bi_sync_sources(); $w$;

-- ---------------------------------------------------------------------------
-- Q. The read models.
--
--    One RPC per screen, each returning the whole shape that screen needs, so the
--    front end never assembles a view out of six round trips whose rows were read
--    at six different moments.
-- ---------------------------------------------------------------------------

create or replace function public.get_bi_catalog()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_sources  jsonb;
  v_datasets jsonb;
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Not authorized to read the BI catalog' using errcode = '42501';
  end if;

  -- Only the sources this caller may actually read are listed. A catalog that
  -- advertises a dataset the viewer will be refused is a worse experience than one
  -- that shows them what they have.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'key', s.key, 'display_name', s.display_name,
           'display_name_ar', s.display_name_ar, 'relation', s.relation_name,
           'required_permission', s.required_permission,
           'default_time_column', s.default_time_column,
           'is_branch_scoped', s.branch_column is not null,
           'column_count', (select count(*) from public.bi_source_columns c where c.source_id = s.id))
         order by s.display_name), '[]'::jsonb) into v_sources
    from public.bi_sources s
   where s.is_active and public.has_permission(s.required_permission, 'read');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'key', d.key, 'name', d.name, 'name_ar', d.display_name_ar,
           'description', d.description, 'status', d.status, 'version', d.version,
           'source_key', s.key, 'source_display_name', s.display_name,
           'required_permission', s.required_permission,
           'readable_by_me', s.id is null or public.has_permission(s.required_permission, 'read'),
           'default_time_column', coalesce(d.default_time_column, s.default_time_column),
           'dimension_count', (select count(*) from public.bi_dimensions x where x.dataset_id = d.id),
           'metric_count', (select count(*) from public.bi_metrics m where m.dataset_id = d.id),
           'published_metric_count',
             (select count(*) from public.bi_metrics m where m.dataset_id = d.id and m.status = 'PUBLISHED'),
           'last_queried_at', d.last_queried_at, 'query_count', d.query_count,
           'published_at', d.published_at, 'updated_at', d.updated_at)
         order by d.status, d.name), '[]'::jsonb) into v_datasets
    from public.bi_datasets d
    left join public.bi_sources s on s.id = d.source_id
   where public.row_in_staff_scope(d.agency_id, d.branch_id);

  return jsonb_build_object('sources', v_sources, 'datasets', v_datasets,
                            'generated_at', now());
end;
$$;

create or replace function public.get_bi_dataset_detail(p_dataset_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  d          public.bi_datasets%rowtype;
  -- Typed rather than `record`: the dataset may have no source yet, and a
  -- no-rows SELECT INTO on a typed row variable leaves every field readable and
  -- null, which is what the `v_src.id is null` branch below relies on.
  v_src      public.bi_sources%rowtype;
  v_columns  jsonb;
  v_dims     jsonb;
  v_metrics  jsonb;
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Not authorized to read BI datasets' using errcode = '42501';
  end if;
  select * into d from public.bi_datasets where id = p_dataset_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Dataset not found in authorized scope' using errcode = '42501';
  end if;
  select * into v_src from public.bi_sources where id = d.source_id;

  -- The source's columns are what the expression editor offers, so it can only
  -- offer what the validator will accept.
  select coalesce(jsonb_agg(jsonb_build_object(
           'column_name', c.column_name, 'data_type', c.data_type,
           'display_name', c.display_name, 'is_dimension', c.is_dimension,
           'is_measure', c.is_measure) order by c.column_name), '[]'::jsonb) into v_columns
    from public.bi_source_columns c where c.source_id = d.source_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'key', x.key, 'display_name', x.display_name,
           'display_name_ar', x.display_name_ar, 'description', x.description,
           'expression', x.expression, 'data_type', x.data_type,
           'sort_order', x.sort_order, 'is_default', x.is_default,
           'drill_to_key', x.drill_to_key, 'drill_through_kind', x.drill_through_kind,
           'drill_through_expression', x.drill_through_expression,
           'lineage', x.lineage)
         order by x.sort_order, x.display_name), '[]'::jsonb) into v_dims
    from public.bi_dimensions x where x.dataset_id = p_dataset_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'key', m.key, 'display_name', m.display_name,
           'display_name_ar', m.display_name_ar, 'description', m.description,
           'formula', m.formula, 'aggregate', m.aggregate, 'filter_json', m.filter_json,
           'numerator_metric_key', m.numerator_metric_key,
           'denominator_metric_key', m.denominator_metric_key,
           'format', m.format, 'unit', m.unit, 'decimals', m.decimals,
           'is_additive', m.is_additive, 'status', m.status, 'version', m.version,
           'sort_order', m.sort_order, 'published_at', m.published_at, 'lineage', m.lineage)
         order by m.sort_order, m.display_name), '[]'::jsonb) into v_metrics
    from public.bi_metrics m where m.dataset_id = p_dataset_id;

  return jsonb_build_object(
    'dataset', jsonb_build_object(
      'id', d.id, 'key', d.key, 'name', d.name, 'name_ar', d.display_name_ar,
      'description', d.description, 'status', d.status, 'version', d.version,
      'row_filter_json', d.row_filter_json,
      'default_time_column', coalesce(d.default_time_column, v_src.default_time_column),
      'published_at', d.published_at, 'deprecated_at', d.deprecated_at,
      'last_queried_at', d.last_queried_at, 'query_count', d.query_count,
      'created_at', d.created_at, 'updated_at', d.updated_at),
    'source', case when v_src.id is null then null else jsonb_build_object(
      'id', v_src.id, 'key', v_src.key, 'display_name', v_src.display_name,
      'display_name_ar', v_src.display_name_ar, 'relation', v_src.relation_name,
      'required_permission', v_src.required_permission,
      'is_branch_scoped', v_src.branch_column is not null,
      'is_active', v_src.is_active,
      'readable_by_me', public.has_permission(v_src.required_permission, 'read')) end,
    'source_columns', v_columns,
    'dimensions', v_dims,
    'metrics', v_metrics,
    'can_publish', public.has_permission('bi_datasets', 'publish'),
    'generated_at', now());
end;
$$;

-- The drill-down path, in order, from a dimension down through drill_to_key. The
-- walk lives here rather than in the client because a hierarchy is a property of
-- the dataset, and because the depth guard has to be somewhere a UI cannot skip.
create or replace function public.get_bi_drill_path(p_dataset_id uuid, p_dimension_key text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  d      public.bi_datasets%rowtype;
  v_key  text := p_dimension_key;
  v_dim  record;
  v_path jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Not authorized to read BI datasets' using errcode = '42501';
  end if;
  select * into d from public.bi_datasets where id = p_dataset_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Dataset not found in authorized scope' using errcode = '42501';
  end if;

  while v_key is not null and not (v_key = any(v_seen)) and array_length(v_seen, 1) is distinct from 32 loop
    select x.* into v_dim from public.bi_dimensions x
     where x.dataset_id = p_dataset_id and x.key = v_key;
    exit when not found;
    v_seen := v_seen || v_key;
    v_path := v_path || jsonb_build_object(
      'key', v_dim.key, 'display_name', v_dim.display_name,
      'display_name_ar', v_dim.display_name_ar, 'data_type', v_dim.data_type,
      'drill_through_kind', v_dim.drill_through_kind,
      'has_drill_through', v_dim.drill_through_expression is not null,
      'depth', jsonb_array_length(v_path));
    v_key := v_dim.drill_to_key;
  end loop;

  return jsonb_build_object('dataset_id', p_dataset_id, 'root', p_dimension_key,
                            'path', v_path, 'depth', jsonb_array_length(v_path));
end;
$$;

-- Lineage, in both directions, for one definition.
--
--    Upstream answers "where does this number come from", and it stops at physical
--    columns rather than at the dataset, because "this metric reads bookings" is not
--    an answer anyone can act on -- "this metric reads bookings.total_amount and
--    bookings.status" is.
--
--    Downstream answers the question that actually stops people editing: "what
--    breaks if I change this". It walks to saved analyses and then to the dashboards
--    that show them, and it reports the published ones separately, because changing
--    a definition that only appears on a draft is a different act from changing one
--    that six published dashboards are built on.
--
--    The upstream half is read out of the stored `lineage` column rather than
--    recomputed here. That column is written by the same trigger that validated the
--    expression, from the same token scan, so it cannot describe a different set of
--    columns than the compiler will read.
create or replace function public.get_bi_lineage(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_kind        text := upper(coalesce(p_kind, ''));
  v_dataset_id  uuid;
  v_key         text;
  v_label       text;
  v_status      text;
  v_lineage     jsonb := '{}'::jsonb;
  v_src         public.bi_sources%rowtype;
  v_upstream    jsonb := '[]'::jsonb;
  v_analyses    jsonb := '[]'::jsonb;
  v_dashboards  jsonb := '[]'::jsonb;
  v_dependents  jsonb := '[]'::jsonb;
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Not authorized to read BI definitions' using errcode = '42501';
  end if;
  if v_kind not in ('DATASET', 'DIMENSION', 'METRIC') then
    raise exception 'Lineage is defined for DATASET, DIMENSION and METRIC, not "%"', p_kind
      using errcode = '22023';
  end if;

  if v_kind = 'DATASET' then
    select d.id, d.key, d.name, d.status, '{}'::jsonb
      into v_dataset_id, v_key, v_label, v_status, v_lineage
      from public.bi_datasets d
     where d.id = p_id and public.row_in_staff_scope(d.agency_id, d.branch_id);
  elsif v_kind = 'DIMENSION' then
    select x.dataset_id, x.key, x.display_name, 'N/A', x.lineage
      into v_dataset_id, v_key, v_label, v_status, v_lineage
      from public.bi_dimensions x
     where x.id = p_id and public.row_in_staff_scope(x.agency_id, x.branch_id);
  else
    select m.dataset_id, m.key, m.display_name, m.status, m.lineage
      into v_dataset_id, v_key, v_label, v_status, v_lineage
      from public.bi_metrics m
     where m.id = p_id and public.row_in_staff_scope(m.agency_id, m.branch_id);
  end if;
  if v_dataset_id is null then
    raise exception 'That definition was not found in your authorized scope'
      using errcode = '42501';
  end if;

  select s.* into v_src
    from public.bi_sources s
    join public.bi_datasets d on d.source_id = s.id
   where d.id = v_dataset_id;

  -- Upstream: the physical columns, each carrying whether the caller may read the
  -- relation it lives in, so a lineage view cannot become a way to learn what a
  -- table you have no rights to contains.
  if v_kind = 'DATASET' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'relation', v_src.relation_name, 'column_name', c.column_name,
             'data_type', c.data_type, 'display_name', c.display_name,
             'via', 'source') order by c.column_name), '[]'::jsonb) into v_upstream
      from public.bi_source_columns c where c.source_id = v_src.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'relation', v_src.relation_name, 'column_name', c.column_name,
             'data_type', c.data_type, 'display_name', c.display_name,
             'via', 'expression') order by c.column_name), '[]'::jsonb) into v_upstream
      from public.bi_source_columns c
     where c.source_id = v_src.id
       and c.column_name in (
         select jsonb_array_elements_text(coalesce(v_lineage -> 'source_columns', '[]'::jsonb))
         union
         select jsonb_array_elements_text(coalesce(v_lineage -> 'drill_through_columns', '[]'::jsonb)));
  end if;

  -- Downstream: the saved analyses that name this definition. Matching is on the
  -- key inside the stored jsonb array rather than on a foreign key, because a
  -- visualization stores which measures and dimensions it draws, by key -- the same
  -- way bi_set_status decides whether deprecating a metric would blank a dashboard.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'key', v.key, 'title', v.title, 'chart_type', v.chart_type,
           'report_id', v.report_id, 'report_title', r.title, 'report_status', r.status,
           'on_dashboards', (select count(*) from public.bi_dashboard_tiles t
                              where t.visualization_id = v.id))
         order by v.title), '[]'::jsonb) into v_analyses
    from public.bi_visualizations v
    left join public.bi_reports r on r.id = v.report_id
   where v.dataset_id = v_dataset_id
     and public.row_in_staff_scope(v.agency_id, v.branch_id)
     and (v_kind = 'DATASET'
          or (v_kind = 'METRIC'    and v.measures   ? v_key)
          or (v_kind = 'DIMENSION' and v.dimensions ? v_key));

  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', b.id, 'key', b.key, 'title', b.title, 'status', b.status,
           'is_default', b.is_default)), '[]'::jsonb) into v_dashboards
    from public.bi_dashboards b
    join public.bi_dashboard_tiles t on t.dashboard_id = b.id
    join public.bi_visualizations v on v.id = t.visualization_id
   where v.dataset_id = v_dataset_id
     and public.row_in_staff_scope(b.agency_id, b.branch_id)
     and (v_kind = 'DATASET'
          or (v_kind = 'METRIC'    and v.measures   ? v_key)
          or (v_kind = 'DIMENSION' and v.dimensions ? v_key));

  -- Definitions that depend on this one inside the semantic layer itself: ratios
  -- built on this metric, dimensions that drill into this dimension. These are the
  -- edges a UI cannot discover by reading the row it is showing.
  if v_kind = 'METRIC' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'METRIC', 'id', m.id, 'key', m.key, 'display_name', m.display_name,
             'status', m.status, 'relation',
             case when m.numerator_metric_key = v_key then 'numerator' else 'denominator' end)
           order by m.key), '[]'::jsonb) into v_dependents
      from public.bi_metrics m
     where m.dataset_id = v_dataset_id
       and m.aggregate = 'RATIO'
       and v_key in (m.numerator_metric_key, m.denominator_metric_key);
  elsif v_kind = 'DIMENSION' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'DIMENSION', 'id', x.id, 'key', x.key,
             'display_name', x.display_name, 'relation', 'drills_into')
           order by x.key), '[]'::jsonb) into v_dependents
      from public.bi_dimensions x
     where x.dataset_id = v_dataset_id and x.drill_to_key = v_key;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'id', p_id,
    'key', v_key,
    'label', v_label,
    'status', v_status,
    'dataset_id', v_dataset_id,
    'source', case when v_src.id is null then null else jsonb_build_object(
      'key', v_src.key, 'relation', v_src.relation_name,
      'display_name', v_src.display_name,
      'required_permission', v_src.required_permission,
      'readable_by_me', public.has_permission(v_src.required_permission, 'read')) end,
    'upstream_columns', v_upstream,
    'downstream_analyses', v_analyses,
    'downstream_dashboards', v_dashboards,
    'dependent_definitions', v_dependents,
    'measured_at', v_lineage -> 'measured_at',
    -- What a change to this definition would touch, in one number, so the editor can
    -- warn before the save rather than explain after it.
    'impact', jsonb_build_object(
      'analyses', jsonb_array_length(v_analyses),
      'dashboards', jsonb_array_length(v_dashboards),
      'published_dashboards', (
        select count(*) from jsonb_array_elements(v_dashboards) e
         where e ->> 'status' = 'PUBLISHED'),
      'dependent_definitions', jsonb_array_length(v_dependents)),
    'generated_at', now());
end;
$$;

-- The dashboard list. Deliberately not the tiles: this is the screen that chooses a
-- dashboard, and loading eleven dashboards' worth of tiles to draw eleven names is
-- how a list view becomes the slowest page in an application.
create or replace function public.get_bi_dashboards()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
begin
  if not public.has_permission('bi_dashboards', 'read') then
    raise exception 'Not authorized to read BI dashboards' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'key', b.key, 'title', b.title, 'title_ar', b.title_ar,
             'description', b.description, 'status', b.status, 'version', b.version,
             'is_default', b.is_default, 'sort_order', b.sort_order,
             'published_at', b.published_at, 'deprecated_at', b.deprecated_at,
             'updated_at', b.updated_at,
             'tile_count', (select count(*) from public.bi_dashboard_tiles t
                             where t.dashboard_id = b.id),
             -- Whether every dataset behind this dashboard is one the caller may
             -- read. A dashboard is all-or-nothing to a viewer: a grid where four
             -- tiles render and two say "denied" reads as a broken page, so the list
             -- says so up front instead.
             'fully_readable_by_me', not exists (
               select 1
                 from public.bi_dashboard_tiles t
                 join public.bi_visualizations v on v.id = t.visualization_id
                 join public.bi_datasets d on d.id = v.dataset_id
                 left join public.bi_sources s on s.id = d.source_id
                where t.dashboard_id = b.id
                  and (s.id is null
                       or not public.has_permission(s.required_permission, 'read'))))
           order by b.is_default desc, b.sort_order, b.title)
      from public.bi_dashboards b
     where public.row_in_staff_scope(b.agency_id, b.branch_id)), '[]'::jsonb);
end;
$$;

-- One dashboard, with its tiles and the definition behind each tile -- but not the
-- tiles' data. The grid is drawn from this one call, and then each tile fetches its
-- own numbers through run_bi_visualization_command, for two reasons: every tile is
-- separately authorized and separately logged, and a dashboard whose tiles arrive
-- one at a time is usable while it loads instead of blank until the slowest query
-- in it finishes.
create or replace function public.get_bi_dashboard(p_dashboard_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  b     public.bi_dashboards%rowtype;
  v_tiles jsonb;
begin
  if not public.has_permission('bi_dashboards', 'read') then
    raise exception 'Not authorized to read BI dashboards' using errcode = '42501';
  end if;
  select * into b from public.bi_dashboards where id = p_dashboard_id;
  if not found or not public.row_in_staff_scope(b.agency_id, b.branch_id) then
    raise exception 'Dashboard not found in authorized scope' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'title', coalesce(t.title_override, v.title),
           'title_ar', v.title_ar,
           'grid', jsonb_build_object('x', t.grid_x, 'y', t.grid_y,
                                      'w', t.grid_w, 'h', t.grid_h),
           'options', t.options || v.options,
           'sort_order', t.sort_order,
           'visualization', jsonb_build_object(
             'id', v.id, 'key', v.key, 'chart_type', v.chart_type,
             'dataset_id', v.dataset_id, 'dataset_key', d.key, 'dataset_name', d.name,
             'dataset_status', d.status,
             'dimensions', v.dimensions, 'measures', v.measures, 'filters', v.filters,
             'time_grain', v.time_grain, 'order_by', v.order_by,
             'order_desc', v.order_desc, 'row_limit', v.row_limit),
           -- Per tile, because a dashboard can legitimately mix a package-mix chart
           -- every role may see with a receivables chart only finance may. The tile
           -- renders a stated refusal rather than an error.
           'readable_by_me', s.id is not null
                             and public.has_permission(s.required_permission, 'read'))
         order by t.sort_order, t.grid_y, t.grid_x), '[]'::jsonb) into v_tiles
    from public.bi_dashboard_tiles t
    join public.bi_visualizations v on v.id = t.visualization_id
    join public.bi_datasets d on d.id = v.dataset_id
    left join public.bi_sources s on s.id = d.source_id
   where t.dashboard_id = p_dashboard_id;

  return jsonb_build_object(
    'dashboard', jsonb_build_object(
      'id', b.id, 'key', b.key, 'title', b.title, 'title_ar', b.title_ar,
      'description', b.description, 'status', b.status, 'version', b.version,
      'layout', b.layout, 'is_default', b.is_default, 'sort_order', b.sort_order,
      'published_at', b.published_at, 'deprecated_at', b.deprecated_at,
      'created_at', b.created_at, 'updated_at', b.updated_at),
    'tiles', v_tiles,
    'tile_count', jsonb_array_length(v_tiles),
    'can_edit', public.has_permission('bi_dashboards', 'update'),
    'can_publish', public.has_permission('bi_dashboards', 'publish'),
    'generated_at', now());
end;
$$;

-- The report builder's screen: every report with the saved analyses inside it. A
-- report here is a document -- an ordered set of analyses with a title -- while a
-- dashboard is a grid. They are separate because they are edited by different people
-- for different reasons, and collapsing them would force one shape on both.
create or replace function public.get_bi_reports()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
begin
  if not public.has_permission('bi_reports', 'read') then
    raise exception 'Not authorized to read BI reports' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'key', r.key, 'title', r.title, 'title_ar', r.title_ar,
             'description', r.description, 'status', r.status, 'version', r.version,
             'layout', r.layout, 'sort_order', r.sort_order,
             'published_at', r.published_at, 'deprecated_at', r.deprecated_at,
             'updated_at', r.updated_at,
             'visualizations', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', v.id, 'key', v.key, 'title', v.title,
                        'title_ar', v.title_ar, 'chart_type', v.chart_type,
                        'dataset_id', v.dataset_id, 'dataset_key', d.key,
                        'dataset_name', d.name, 'dataset_status', d.status,
                        'dimensions', v.dimensions, 'measures', v.measures,
                        'filters', v.filters, 'time_grain', v.time_grain,
                        'order_by', v.order_by, 'order_desc', v.order_desc,
                        'row_limit', v.row_limit, 'options', v.options,
                        'sort_order', v.sort_order,
                        'readable_by_me', s.id is not null
                                          and public.has_permission(s.required_permission, 'read'))
                      order by v.sort_order, v.title)
                 from public.bi_visualizations v
                 join public.bi_datasets d on d.id = v.dataset_id
                 left join public.bi_sources s on s.id = d.source_id
                where v.report_id = r.id), '[]'::jsonb))
           order by r.sort_order, r.title)
      from public.bi_reports r
     where public.row_in_staff_scope(r.agency_id, r.branch_id)), '[]'::jsonb);
end;
$$;

-- The studio's landing screen. Counts, and then the three things that tell whoever
-- owns the semantic layer whether it is healthy:
--
--   unpublished definitions   work in progress, or work abandoned
--   never-queried datasets    a definition nobody uses is a definition nobody
--                             maintains, and it will be wrong before it is noticed
--   denied and failed queries measured from the ledger, not guessed -- a rising
--                             DENIED count usually means a dashboard was shared with
--                             people whose role cannot read what it draws
create or replace function public.get_bi_studio_overview()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_counts jsonb;
  v_health jsonb;
  v_recent jsonb;
  v_top    jsonb;
begin
  if not public.has_permission('bi_datasets', 'read') then
    raise exception 'Not authorized to read the BI studio' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'sources', (select count(*) from public.bi_sources where is_active),
           'datasets', count(*),
           'datasets_published', count(*) filter (where d.status = 'PUBLISHED'),
           'datasets_draft', count(*) filter (where d.status = 'DRAFT'),
           'datasets_deprecated', count(*) filter (where d.status = 'DEPRECATED'),
           'dimensions', (select count(*) from public.bi_dimensions x
                           where public.row_in_staff_scope(x.agency_id, x.branch_id)),
           'metrics', (select count(*) from public.bi_metrics m
                        where public.row_in_staff_scope(m.agency_id, m.branch_id)),
           'metrics_published', (select count(*) from public.bi_metrics m
                                  where m.status = 'PUBLISHED'
                                    and public.row_in_staff_scope(m.agency_id, m.branch_id)),
           'reports', (select count(*) from public.bi_reports r
                        where public.row_in_staff_scope(r.agency_id, r.branch_id)),
           'visualizations', (select count(*) from public.bi_visualizations v
                               where public.row_in_staff_scope(v.agency_id, v.branch_id)),
           'dashboards', (select count(*) from public.bi_dashboards b
                           where public.row_in_staff_scope(b.agency_id, b.branch_id)),
           'dashboards_published', (select count(*) from public.bi_dashboards b
                                     where b.status = 'PUBLISHED'
                                       and public.row_in_staff_scope(b.agency_id, b.branch_id)))
    into v_counts
    from public.bi_datasets d
   where public.row_in_staff_scope(d.agency_id, d.branch_id);

  select jsonb_build_object(
           'datasets_without_source', count(*) filter (where d.source_id is null),
           'datasets_without_metric', count(*) filter (
             where not exists (select 1 from public.bi_metrics m where m.dataset_id = d.id)),
           'datasets_never_queried', count(*) filter (where d.last_queried_at is null),
           'datasets_stale_30d', count(*) filter (
             where d.status = 'PUBLISHED' and d.last_queried_at < now() - interval '30 days'),
           'orphan_visualizations', (
             select count(*) from public.bi_visualizations v
              where public.row_in_staff_scope(v.agency_id, v.branch_id)
                and v.report_id is null
                and not exists (select 1 from public.bi_dashboard_tiles t
                                 where t.visualization_id = v.id)),
           -- A published dashboard drawing a deprecated definition is the one state
           -- bi_set_status cannot prevent on its own: the dashboard can be published
           -- after the deprecation. It is listed, not blocked, because the fix is a
           -- human decision about which number belongs there now.
           'published_on_deprecated', (
             select count(distinct b.id)
               from public.bi_dashboards b
               join public.bi_dashboard_tiles t on t.dashboard_id = b.id
               join public.bi_visualizations v on v.id = t.visualization_id
               join public.bi_datasets dd on dd.id = v.dataset_id
              where b.status = 'PUBLISHED' and dd.status = 'DEPRECATED'
                and public.row_in_staff_scope(b.agency_id, b.branch_id)))
    into v_health
    from public.bi_datasets d
   where public.row_in_staff_scope(d.agency_id, d.branch_id);

  -- The ledger halves are gated separately: query timings and denials are an audit
  -- surface, and a role that may read a dashboard is not thereby entitled to see who
  -- else was refused one.
  if public.has_permission('bi_query_log', 'read') then
    select jsonb_build_object(
             'visible', true,
             'queries_7d', count(*),
             'denied_7d', count(*) filter (where outcome = 'DENIED'),
             'errors_7d', count(*) filter (where outcome = 'ERROR'),
             'p95_duration_ms', coalesce(
               percentile_disc(0.95) within group (order by duration_ms)
                 filter (where outcome = 'OK'), 0),
             'slowest_ms', coalesce(max(duration_ms) filter (where outcome = 'OK'), 0),
             -- The request stores the limit the caller asked for, which may be null
             -- or out of range; the compiler clamps it the same way, so the clamp is
             -- repeated here rather than comparing against a number that was never
             -- the one in force.
             'truncated_7d', count(*) filter (
               where outcome = 'OK'
                 and row_count >= least(greatest(coalesce((request ->> 'limit')::integer, 500), 1), 5000)))
      into v_recent
      from public.bi_query_log
     where created_at >= now() - interval '7 days'
       and public.row_in_staff_scope(agency_id, branch_id);
  end if;

  -- The limit is inside the subquery on purpose: `limit` outside an aggregate applies
  -- to the single aggregated row and would quietly fold every dataset into the list.
  select coalesce(jsonb_agg(jsonb_build_object(
           'dataset_id', t.id, 'dataset_key', t.key, 'name', t.name,
           'status', t.status, 'query_count', t.query_count,
           'last_queried_at', t.last_queried_at)), '[]'::jsonb) into v_top
    from (select d.id, d.key, d.name, d.status, d.query_count, d.last_queried_at
            from public.bi_datasets d
           where public.row_in_staff_scope(d.agency_id, d.branch_id)
             and d.query_count > 0
           order by d.query_count desc, d.name
           limit 10) t;

  return jsonb_build_object(
    'counts', v_counts,
    'health', v_health,
    'usage_7d', coalesce(v_recent, jsonb_build_object('visible', false)),
    'most_queried', v_top,
    'capabilities', jsonb_build_object(
      'can_define', public.has_permission('bi_datasets', 'create'),
      'can_publish_definitions', public.has_permission('bi_datasets', 'publish'),
      -- Saving an analysis is its own grant, not a corollary of building dashboards.
      -- The seed happens to give both to the same three roles, which is exactly why
      -- this has to be asked separately: a screen that gated Save on the dashboard
      -- permission would be right by coincidence and wrong the day a role changes.
      'can_save_analysis', public.has_permission('bi_visualizations', 'create'),
      'can_build_dashboards', public.has_permission('bi_dashboards', 'create'),
      'can_publish_dashboards', public.has_permission('bi_dashboards', 'publish'),
      'can_read_query_log', public.has_permission('bi_query_log', 'read'),
      'can_sync_sources', public.staff_role() = 'ADMIN'),
    'generated_at', now());
end;
$$;

-- The query ledger. compiled_sql is returned, and that is the point of keeping it:
-- "why did this chart show that number" is answerable only by the text that ran.
--
-- An actor is reported as its uuid and current role. staff_profiles carries no name
-- column in this schema, and inventing a join to one that does not exist would be a
-- worse answer than the honest one.
create or replace function public.get_bi_query_log(p_limit integer default 100,
                                                   p_outcome text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
begin
  if not public.has_permission('bi_query_log', 'read') then
    raise exception 'Not authorized to read the BI query log' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'created_at', l.created_at, 'dataset_id', l.dataset_id,
             'dataset_key', d.key, 'dataset_name', d.name,
             'visualization_id', l.visualization_id, 'visualization_title', v.title,
             'actor_id', l.actor_id, 'actor_role', sp.role,
             'is_mine', l.actor_id = auth.uid(),
             'request', l.request, 'compiled_sql', l.compiled_sql,
             'column_count', l.column_count, 'row_count', l.row_count,
             'duration_ms', l.duration_ms, 'outcome', l.outcome,
             'error_code', l.error_code, 'error_message', l.error_message)
           order by l.created_at desc)
      from (select *
              from public.bi_query_log
             where public.row_in_staff_scope(agency_id, branch_id)
               and (p_outcome is null or outcome = upper(p_outcome))
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 1000)) l
      left join public.bi_datasets d on d.id = l.dataset_id
      left join public.bi_visualizations v on v.id = l.visualization_id
      left join public.staff_profiles sp on sp.user_id = l.actor_id), '[]'::jsonb);
end;
$$;

-- The definition ledger: every status transition, with who and when. This is where
-- the published_at a deprecation cleared still lives.
create or replace function public.get_bi_events(p_entity_kind text default null,
                                                p_entity_id uuid default null,
                                                p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
begin
  if not public.has_permission('bi_events', 'read') then
    raise exception 'Not authorized to read BI definition history' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'created_at', e.created_at, 'entity_kind', e.entity_kind,
             'entity_id', e.entity_id, 'event_type', e.event_type,
             'actor_id', e.actor_id, 'actor_role', sp.role, 'payload', e.payload)
           order by e.created_at desc)
      from (select *
              from public.bi_events
             where public.row_in_staff_scope(agency_id, branch_id)
               and (p_entity_kind is null or entity_kind = upper(p_entity_kind))
               and (p_entity_id is null or entity_id = p_entity_id)
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 1000)) e
      left join public.staff_profiles sp on sp.user_id = e.actor_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- R. Grants.
--
--    Every function above is SECURITY DEFINER, so who may call it is the whole
--    access-control story for the RPC surface. `revoke ... from public, anon` first,
--    and only then `grant execute ... to authenticated`: a definer function left
--    executable by anon is an unauthenticated read of the entire warehouse, and the
--    default on a newly created function is EXECUTE to PUBLIC.
-- ---------------------------------------------------------------------------

do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.set_bi_status_command(text,uuid,text,text)',
    'public.run_bi_query_command(uuid,text[],text[],jsonb,text,text,boolean,integer,uuid)',
    'public.run_bi_visualization_command(uuid)',
    'public.run_bi_drill_through_command(uuid,text,jsonb,jsonb,integer)',
    'public.sync_bi_sources_command()',
    'public.get_bi_catalog()',
    'public.get_bi_dataset_detail(uuid)',
    'public.get_bi_drill_path(uuid,text)',
    'public.get_bi_lineage(text,uuid)',
    'public.get_bi_dashboards()',
    'public.get_bi_dashboard(uuid)',
    'public.get_bi_reports()',
    'public.get_bi_studio_overview()',
    'public.get_bi_query_log(integer,text)',
    'public.get_bi_events(text,uuid,integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$grants$;

-- The private bodies get the opposite treatment: revoked from everyone, granted to
-- nobody. `grant usage on schema private to authenticated` was settled back in
-- 20260520002500, so schema-level unreachability is not the boundary it looks like --
-- what keeps private.bi_run_query out of a client's hands is the function ACL, and the
-- default on a new function is EXECUTE to PUBLIC. Revoking is done by oid rather than
-- by writing twenty signatures, because bi_run_query's own argument list is nine types
-- long and a signature copied wrongly revokes nothing while looking exactly right.
--
-- The five trigger functions are revoked with the rest. A trigger's EXECUTE privilege is
-- checked when the trigger is created, not when it fires, so a locked-down body still
-- runs on every insert -- which is the same treatment dms_check_link_target gets.
do $private_grants$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname like 'bi\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end;
$private_grants$;

-- ---------------------------------------------------------------------------
-- S. Realtime.
--
--    The definition tables and the two ledgers, so a studio open in two browsers
--    does not show two different versions of what a metric means, and so a running
--    query's outcome reaches the screen that asked for it.
--
--    Every failure mode here is swallowed deliberately. duplicate_object means a
--    previous run already added the table; undefined_object means this database has
--    no supabase_realtime publication at all (a plain Postgres used for replay
--    testing); insufficient_privilege means the migration is running as a role that
--    cannot alter the publication. None of the three is a reason to fail a schema
--    migration -- realtime is a delivery mechanism, not a correctness property.
-- ---------------------------------------------------------------------------

do $realtime$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bi_datasets', 'bi_dimensions', 'bi_metrics', 'bi_reports', 'bi_visualizations',
    'bi_dashboards', 'bi_dashboard_tiles', 'bi_query_log', 'bi_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception
      when duplicate_object or undefined_object or insufficient_privilege then null;
    end;
  end loop;
end;
$realtime$;

-- ---------------------------------------------------------------------------
-- T. What this file promised, checked at replay time.
--
--    Not a test -- a test needs a session and data. This is the weaker claim that
--    still catches the failure that matters: a migration that ran to completion
--    without leaving behind the surface the application calls. Every function name
--    below appears in src/services/biAnalytics.ts or domainCommands.ts, so a rename
--    on one side that is not made on the other stops the replay instead of stopping
--    a screen.
-- ---------------------------------------------------------------------------

do $assert$
declare
  v_missing text[] := '{}';
  v_name    text;
  v_tables  text[] := array[
    'bi_sources','bi_source_columns','bi_datasets','bi_dimensions','bi_metrics',
    'bi_reports','bi_visualizations','bi_dashboards','bi_dashboard_tiles',
    'bi_query_log','bi_events'];
  v_funcs   text[] := array[
    'set_bi_status_command','run_bi_query_command','run_bi_visualization_command',
    'run_bi_drill_through_command','sync_bi_sources_command',
    'get_bi_catalog','get_bi_dataset_detail','get_bi_drill_path','get_bi_lineage',
    'get_bi_dashboards','get_bi_dashboard','get_bi_reports','get_bi_studio_overview',
    'get_bi_query_log','get_bi_events'];
  v_private text[] := array[
    'bi_assert_safe_expression','bi_expression_columns','bi_fold_expression',
    'bi_assert_aggregate_types','bi_literal','bi_compile_filters','bi_compile_query',
    'bi_run_query','bi_drill_through','bi_run_visualization','bi_set_status',
    'bi_log_event','bi_sync_sources','bi_sync_source_columns','bi_register_source'];
begin
  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is null then
      v_missing := v_missing || ('table ' || v_name);
    elsif not exists (select 1 from pg_class where oid = ('public.' || v_name)::regclass
                       and relrowsecurity) then
      v_missing := v_missing || ('RLS off on ' || v_name);
    end if;
  end loop;

  foreach v_name in array v_funcs loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_name) then
      v_missing := v_missing || ('function public.' || v_name);
    end if;
  end loop;

  foreach v_name in array v_private loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'private' and p.proname = v_name) then
      v_missing := v_missing || ('function private.' || v_name);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'BI studio slice incomplete: %', array_to_string(v_missing, ', ');
  end if;
end $assert$;

-- The tenancy precondition, asserted rather than assumed: trg_stamp_staff_scope
-- raises 42703 on any table it fires for that has no branch_id, and a nullable
-- agency_id admits a row no reader can ever see again.
--
-- bi_sources and bi_source_columns are deliberately absent from this list. They
-- describe the physical schema, which is the same schema for every agency.
do $assert$
declare
  t text;
  v_nullable boolean;
begin
  foreach t in array array[
    'bi_datasets','bi_dimensions','bi_metrics','bi_reports','bi_visualizations',
    'bi_dashboards','bi_dashboard_tiles','bi_query_log','bi_events'
  ] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'branch_id') then
      raise exception 'public.% has no branch_id; trg_stamp_staff_scope would fail on every insert', t;
    end if;
    select is_nullable = 'YES' into v_nullable from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name = 'agency_id';
    if v_nullable is null then
      raise exception 'public.% has no agency_id', t;
    end if;
    if v_nullable then
      raise exception 'public.%.agency_id is still nullable; a null-agency row is invisible to every reader', t;
    end if;
  end loop;
end $assert$;

-- The security boundary itself. Everything in section G is reachable only through
-- these triggers: drop one and a PATCH straight at PostgREST writes an expression
-- nothing ever validated, into a table a definer function will interpolate into SQL.
-- So their presence is asserted by name, and so is the absence of a client write
-- path to the source allowlist those validators trust.
do $assert$
declare
  v_expected text[] := array[
    'trg_bi_validate_dataset','trg_bi_validate_dimension','trg_bi_validate_metric',
    'trg_bi_validate_visualization','trg_bi_freeze_published_metric'];
  v_name  text;
  v_write text;
begin
  foreach v_name in array v_expected loop
    if not exists (select 1 from pg_trigger where tgname = v_name and not tgisinternal) then
      raise exception 'Validation trigger % is missing; BI expressions would reach the compiler unchecked', v_name;
    end if;
  end loop;

  select string_agg(polname, ', ') into v_write
    from pg_policy
   where polrelid in ('public.bi_sources'::regclass, 'public.bi_source_columns'::regclass)
     and polcmd <> 'r';
  if v_write is not null then
    raise exception 'The BI source allowlist has a client write path (%); the compiler''s allowlist must not be writable through PostgREST', v_write;
  end if;
end $assert$;

select 'bi studio vertical slice installed' as status;

