-- ============================================================================
-- Finance modelling: a schema a model can actually live in.
--
-- src/apps/modeling/engine is eleven files that turn a ModelSpec into numbers --
-- parse, evaluate, order, resolve, run, sweep, simulate, attribute, optimise,
-- version, certify. All eleven are pure and all eleven are useless without
-- somewhere to keep the spec, and the tables that were supposed to keep it --
-- 20260822000014_fpa_modeling -- cannot. Not "are missing columns": cannot.
--
--   fpa_formulas has no key. A formula is stored as `expression TEXT` against a
--   model_id and nothing else, so no formula can be named, and therefore no
--   formula can be referenced by another. `revenue - cost` is unwritable when
--   revenue and cost have no names. That single omission is the whole subsystem.
--
--   fpa_formulas.dependencies UUID[] is derived state, stored. It can disagree
--   with the expression beside it, and when it does the graph is a lie. The
--   engine derives references from the AST (referencesOf), which is the only
--   construction in which they cannot disagree. So there is no dependencies
--   column here, and section D explains what replaced it: nothing.
--
--   fpa_models.model_type CHECK (in ('variable','constant')) and
--   fpa_models.data_type TEXT NOT NULL describe a *field*. A model is not
--   variable or constant and has no data type.
--
--   There is no assumptions table at all, though an assumptions registry is the
--   thing every scenario, every sweep, every tornado and every simulation reads
--   its inputs and its ranges from.
--
--   fpa_scenarios has no model_id and no override values, so its
--   base_version_id offers inheritance of nothing from nothing.
--
--   Nowhere is there a horizon. A period is not mentioned in the file.
--
-- And `grep -rn "fpa_" src/` returns no matches, which is the honest summary:
-- four tables, no reader, no writer, counted as a delivered feature.
--
-- This migration does two things, in this order:
--
--   A. Repairs the four fpa_* tables in place -- tenancy columns, four-verb
--      policies, house triggers -- and leaves them standing. They are not
--      dropped. Dropping is destructive DDL against a database this session
--      cannot inspect, and "nothing in src/ references them" is evidence about
--      this repository, not about every deployment of it. Whether they go is a
--      decision with a person's name on it, not a side effect of adding a
--      schema next to them.
--
--   B..H. Adds the schema the engine's ModelSpec actually maps onto, one table
--      per interface, and makes the engine's own refusals unreachable as stored
--      states wherever a constraint can do it: DUPLICATE_KEY by a cross-table
--      guard, NO_BASE and UNDECLARED by composite foreign keys, CHAIN_CYCLE by
--      a walk on write, NO_PERIODS by a cardinality check.
--
-- Two type choices are load-bearing and both are arguable, so they are argued:
--
--   Every quantity is DOUBLE PRECISION, not NUMERIC. evaluate.ts is IEEE-754
--   double arithmetic from end to end -- that is what its no-NaN, no-Infinity
--   post-condition is a post-condition about. Storing NUMERIC would advertise a
--   precision the arithmetic does not have and would round-trip through JSON as
--   a string on the way to a float anyway. The storage should say what the
--   computation is.
--
--   periods is TEXT[] on the model, and its length is the horizon. ModelSpec has
--   no period count either, for the same reason: a horizon column and an array
--   of period labels are two facts that can disagree, and when they disagree
--   every row in the model is the wrong length.
--
-- Conventions from 20260830120000_crm_vertical_slice, 20260831120000_dms_
-- vertical_slice and 20260901120000_bi_studio_vertical_slice: house tenancy
-- columns, four-verb RLS through has_permission + row_in_staff_scope, private
-- implementation behind a thin public command, validation in a BEFORE trigger
-- rather than in a command so no PostgREST write path bypasses it, and an
-- append-only ledger no client may write to.
-- ============================================================================

-- ============================================================================
-- A. The fpa_* repair.
--
--    Four things are wrong with their security shape, and none of them is about
--    the columns:
--
--      1. `FOR ALL TO authenticated USING (agency_id = current_staff_agency_id())`
--         is one predicate governing reading and writing. Anyone who can read a
--         model can rewrite it, and no permission is consulted -- membership of
--         the agency is the entire test. The rest of the platform asks
--         has_permission the verb-specific question.
--      2. The predicate asks about the agency and never the branch, and the
--         tables have no branch_id to ask about.
--      3. `CREATE OR REPLACE FUNCTION update_updated_at_column()` -- unqualified.
--         That is the platform's shared updated_at trigger function, attached to
--         dozens of tables, and 20260822000014 redefines its body with no
--         `set search_path` on a replay. Section A.3 re-asserts the hardened
--         definition rather than leaving whichever version replayed last.
--      4. No audit trigger, so a change to a model that drives a budget leaves
--         no trace.
-- ============================================================================

-- A.1  A NULL agency_id is unreachable through RLS, so a row holding one cannot
--      be repaired through the API either. Refuse rather than guess.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['fpa_models','fpa_formulas','fpa_scenarios','fpa_planning_cycles'] loop
    if to_regclass('public.' || t) is null then continue; end if;
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
  foreach t in array array['fpa_models','fpa_formulas','fpa_scenarios','fpa_planning_cycles'] loop
    if to_regclass('public.' || t) is null then continue; end if;
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

-- A.2  The blanket policies, by name.
do $$
declare
  p record;
begin
  for p in
    select tablename as tbl, policyname as pol
      from pg_policies
     where schemaname = 'public'
       and tablename in ('fpa_models','fpa_formulas','fpa_scenarios','fpa_planning_cycles')
  loop
    execute format('drop policy if exists %I on public.%I', p.pol, p.tbl);
  end loop;
end $$;

-- A.3  The shared updated_at function, hardened in place.
--
--      The body is right -- a timestamp assignment is a timestamp assignment --
--      so this is not a rewrite, it is the same body with the two properties
--      20260822000014 dropped. `set search_path` makes now() resolve to
--      pg_catalog's regardless of the caller's path, which matters because a
--      trigger function runs with whatever search_path the writing session has.
--      The revoke is hygiene rather than enforcement: PostgreSQL does not
--      consult EXECUTE when firing a trigger, so removing it costs the triggers
--      nothing and removes a callable public entry point.
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

revoke all on function public.update_updated_at_column() from public, anon;

-- A.4  Four-verb policies, house triggers, and an audit trail.
do $$
declare
  t         text;
  has_audit boolean;
begin
  select exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = 'write_audit_log'
  ) into has_audit;

  foreach t in array array['fpa_models','fpa_formulas','fpa_scenarios','fpa_planning_cycles'] loop
    if to_regclass('public.' || t) is null then continue; end if;

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

    if has_audit then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()', 'trg_audit_' || t, t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- B. The model header.
--
--    ModelSpec is { periods, rows, assumptions, scenarios }. Four fields, four
--    tables plus this header, and the header carries the one field that is not a
--    collection: periods.
--
--    The status machine is three states and the transition that matters is
--    PUBLISHED, which records the content hash version.ts computed for the model
--    at the moment it was published. That hash is a client attestation, not a
--    server measurement -- FNV-1a over a canonicalised spec is not something a
--    CHECK constraint can recompute -- and the column is named for what it is.
--    Its value is that it is *falsifiable*: certifies() re-derives the hash from
--    the spec it is holding and compares, so "the plan of record is no longer
--    this model" becomes a fact anybody can check rather than a suspicion.
-- ============================================================================

-- The one rule both key columns share, in one place because two copies of a
-- regex drift. IMMUTABLE because a CHECK constraint may only call functions
-- that are, and it genuinely is: same text in, same verdict out, forever.
--
-- The character class is expression.ts's isValidKey exactly -- /^[A-Za-z_][A-Za-z0-9_]*$/
-- -- and the second half is the part isValidKey cannot express. The lexer claims
-- nineteen words: thirteen function names, three series forms that take a key
-- rather than a value, and the three word operators. A row keyed `min` passes
-- isValidKey and is still unreferenceable, because `min + 1` lexes as a call to
-- min with no arguments. A key that no formula can name is not a key, so it is
-- refused where it is written rather than discovered later as a parse error in
-- somebody else's row.
create or replace function private.modeling_key_ok(p_key text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $fn$
  select p_key is not null
     and length(p_key) between 1 and 60
     and p_key ~ '^[A-Za-z_][A-Za-z0-9_]*$'
     and lower(p_key) <> all (array[
           'min','max','avg','abs','floor','ceil','sqrt','round','pow','clamp',
           'if','growth','pmt','prior','sum','npv','and','or','not']);
$fn$;

revoke all on function private.modeling_key_ok(text) from public, anon, authenticated;

create table if not exists public.modeling_models (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null default public.current_staff_agency_id(),
  branch_id         uuid references public.branches(id),
  key               text not null,
  name              text not null,
  name_ar           text,
  description       text,
  -- The horizon. Length is the horizon; there is no count column beside it to
  -- disagree with it, exactly as in ModelSpec.
  periods           text[] not null,
  status            text not null default 'DRAFT',
  version           integer not null default 1,
  -- Set on publish from ModelVersion.fullHash. A claim the client made, which
  -- certifies() can refute; never a server-side measurement.
  published_hash    text,
  published_at      timestamptz,
  published_by      uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  constraint modeling_models_key_unique  unique (agency_id, key),
  constraint modeling_models_key_shape   check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  constraint modeling_models_status_check
    check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- NO_PERIODS is a SpecIssue the engine raises at compile time. A model with an
  -- empty horizon cannot be run, so it should not be storable. The upper bound is
  -- not arithmetic timidity: every sweep, tornado and simulation is O(periods),
  -- and a ten-thousand-period model is a mistake rather than a long plan.
  constraint modeling_models_periods_check
    check (cardinality(periods) between 1 and 600),
  -- Period labels are read by humans and hashed by fullHash, and both break on a
  -- NULL or empty element -- one is unprintable, the other is indistinguishable
  -- from its neighbour. A CHECK may not hold a subquery, so this is array_position
  -- and ANY rather than the unnest it would like to be.
  constraint modeling_models_periods_named
    check (array_position(periods, null) is null and not ('' = any (periods))),
  constraint modeling_models_published_stamp
    check (status <> 'PUBLISHED'
           or (published_hash is not null and published_at is not null))
);

-- ============================================================================
-- C. The assumptions registry.
--
--    Item 4 asks for one by name, and every other file in the engine reads it:
--    scenario.ts resolves overrides against it, sensitivity.ts takes low..high
--    from it rather than inventing a plus-or-minus, monte.ts draws from the same
--    two numbers, optimize.ts bounds its search by them, certify.ts measures
--    whether they exist at all.
--
--    low and high are nullable together and independently, because "we know this
--    is 1200 and we have no view on the range" is a real state and the engine
--    reports it (certify's UNMEASURED, sensitivity's refusal to sweep) rather
--    than filling in a default band. A stored default band would be indis-
--    tinguishable from a considered one.
--
--    note is not a comment. It is provenance -- where 1200 came from -- and it
--    lives on the row because provenance kept anywhere else is provenance that
--    goes stale silently.
-- ============================================================================

-- Finiteness, twice, because a CHECK cannot unnest an array and an IMMUTABLE
-- function can.
--
-- The NaN test is the one place PostgreSQL and IEEE-754 disagree and the
-- disagreement matters. IEEE says NaN = NaN is false, so `x = x` is the classic
-- NaN test; PostgreSQL deliberately breaks that so float8 can be indexed and
-- sorted, and defines NaN as equal to itself and greater than everything else.
-- `value = value` would therefore have let every NaN through. Comparing against
-- the literal is what works here, and it works *because* of the same rule:
-- NaN <> 'NaN' is false, and for any real number it is true.
create or replace function private.modeling_finite(p_value double precision)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $fn$
  select p_value is null
      or (p_value <> 'NaN'::double precision
          and p_value <> 'Infinity'::double precision
          and p_value <> '-Infinity'::double precision);
$fn$;

create or replace function private.modeling_finite_series(p_values double precision[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $fn$
  select p_values is null
      or not exists (
           select 1 from unnest(p_values) v
            where v is null or not private.modeling_finite(v));
$fn$;

revoke all on function private.modeling_finite(double precision) from public, anon, authenticated;
revoke all on function private.modeling_finite_series(double precision[]) from public, anon, authenticated;

create table if not exists public.modeling_assumptions (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null default public.current_staff_agency_id(),
  branch_id   uuid references public.branches(id),
  model_id    uuid not null references public.modeling_models(id) on delete cascade,
  key         text not null,
  label       text not null,
  label_ar    text,
  unit        text not null,
  value       double precision not null,
  low         double precision,
  high        double precision,
  note        text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  constraint modeling_assumptions_unique unique (model_id, key),
  -- The same predicate the rows use. An assumption and a row live in one
  -- namespace as far as a formula is concerned, so they answer to one rule.
  constraint modeling_assumptions_key_shape check (private.modeling_key_ok(key)),
  constraint modeling_assumptions_label_present check (btrim(label) <> ''),
  constraint modeling_assumptions_unit_check
    check (unit in ('CURRENCY', 'RATE', 'COUNT', 'DAYS', 'FACTOR')),
  -- rangeOf() in optimize.ts orders a backwards pair rather than refusing it,
  -- because an in-memory spec can be assembled by anything. A stored one is
  -- written by this schema's own commands, so the typo is refused at the door
  -- and the engine's tolerance stays a tolerance rather than a load-bearing fix.
  constraint modeling_assumptions_range_order
    check (low is null or high is null or low <= high),
  -- Every quantity the engine touches has to be finite: evaluate.ts guarantees
  -- no NaN and no Infinity escapes it, and an input that is already one of them
  -- would make that guarantee a statement about arithmetic it never performed.
  -- All three columns, not just value: a sweep runs the model at low and at high.
  constraint modeling_assumptions_finite
    check (private.modeling_finite(value)
           and private.modeling_finite(low)
           and private.modeling_finite(high))
);

create index if not exists idx_modeling_assumptions_model
  on public.modeling_assumptions(model_id, sort_order, key);

-- ============================================================================
-- D. The rows.
--
--    ModelRow is { key, label, unit, formula, given }, and the two ways a row
--    gets its numbers are exclusive: a formula computes it, or a given series
--    tells it. model.ts refuses a row holding both -- an author who changed
--    their mind and left the old answer behind -- so the CHECK refuses it too.
--
--    given is shorter than the horizon on purpose sometimes: model.ts holds the
--    last value flat and reports which rows it did that to in ModelRun.held. So
--    there is no constraint tying its length to cardinality(periods); a short
--    series is a fact about the data. One *longer* than the horizon is a real
--    error, and it is not a CHECK: a table constraint cannot see the parent's
--    periods array. It is enforced in the validation trigger in section G, where
--    a lookup is allowed.
--
--    And the column that is not here: dependencies. fpa_formulas stored a
--    UUID[] beside the expression. Two representations of one fact, one of them
--    a copy, and the copy is what the graph would be built from. referencesOf
--    reads the AST that parseFormula produced from this exact text, so the
--    dependency set cannot be stale, cannot be partial, and cannot name a key
--    the formula does not mention.
-- ============================================================================

create table if not exists public.modeling_rows (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null default public.current_staff_agency_id(),
  branch_id   uuid references public.branches(id),
  model_id    uuid not null references public.modeling_models(id) on delete cascade,
  key         text not null,
  label       text not null,
  label_ar    text,
  unit        text not null,
  formula     text,
  given       double precision[] not null default '{}',
  -- Same column as on the assumptions and the scenarios, and for the same reason:
  -- a formula is not self-documenting and the place to say why a row is computed
  -- the way it is has to travel with the row. NOT NULL with an empty default, so
  -- "no note" is one value rather than two.
  note        text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  constraint modeling_rows_unique unique (model_id, key),
  constraint modeling_rows_key_shape check (private.modeling_key_ok(key)),
  constraint modeling_rows_label_present check (btrim(label) <> ''),
  constraint modeling_rows_unit_check
    check (unit in ('CURRENCY', 'RATE', 'COUNT', 'DAYS', 'FACTOR')),
  constraint modeling_rows_told_or_computed
    check (formula is null or cardinality(given) = 0),
  constraint modeling_rows_formula_not_blank
    check (formula is null or btrim(formula) <> ''),
  -- A told row whose series holds a NaN would put one into the model without any
  -- arithmetic having produced it, which is the one way evaluate.ts's guarantee
  -- can be broken from outside.
  constraint modeling_rows_given_finite check (private.modeling_finite_series(given)),
  -- 600 is the horizon ceiling from section B. A series can be shorter than its
  -- model's horizon; it can never be longer than any horizon.
  constraint modeling_rows_given_bounded check (cardinality(given) <= 600)
);

create index if not exists idx_modeling_rows_model
  on public.modeling_rows(model_id, sort_order, key);

-- ============================================================================
-- E. The scenarios.
--
--    Scenario is { id, name, baseId, overrides }, and baseId is the whole design:
--    a scenario inherits its parent's overrides and adds its own, so "downside,
--    but with the visa fee we actually got quoted" is two rows rather than a
--    second copy of every assumption. scenario.ts walks the chain to a root.
--
--    Its four failure modes are NO_SCENARIO, NO_BASE, CHAIN_CYCLE and UNDECLARED.
--    Two of them are made unstorable here, one in section F, and only one needs a
--    trigger:
--
--      NO_BASE     a composite foreign key. base_key must name a scenario of the
--                  same model, so a dangling base cannot be written at all.
--      UNDECLARED  section F's foreign key to the assumptions table.
--      CHAIN_CYCLE a self-reference is a CHECK; a longer ring needs a walk, and
--                  that is in section G.
--      NO_SCENARIO not an error about storage. It is scenario.ts being asked to
--                  resolve an id that no longer exists, which is a question, not
--                  a row.
--
--    The FK is ON DELETE NO ACTION rather than RESTRICT, and the difference is
--    load-bearing. RESTRICT refuses even when the referencing row is being
--    deleted in the same statement, so deleting a model -- which cascades to
--    every scenario at once -- would fail on any chain deeper than one. NO ACTION
--    defers its check to the end of the statement, by which time both rows are
--    gone and there is nothing to complain about. Deleting a base out from under
--    a child is still refused, which is the case the constraint is for.
-- ============================================================================

create table if not exists public.modeling_scenarios (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null default public.current_staff_agency_id(),
  branch_id   uuid references public.branches(id),
  model_id    uuid not null references public.modeling_models(id) on delete cascade,
  key         text not null,
  -- The engine calls this `name`, not `label`, and the column follows the type
  -- rather than the neighbouring tables. A field renamed on the way into storage
  -- is a field somebody has to translate on the way back out.
  name        text not null,
  name_ar     text,
  base_key    text,
  note        text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  constraint modeling_scenarios_unique unique (model_id, key),
  constraint modeling_scenarios_key_shape check (private.modeling_key_ok(key)),
  constraint modeling_scenarios_name_present check (btrim(name) <> ''),
  constraint modeling_scenarios_base_shape
    check (base_key is null or private.modeling_key_ok(base_key)),
  constraint modeling_scenarios_base_not_self check (base_key is distinct from key),
  constraint modeling_scenarios_base_fk
    foreign key (model_id, base_key)
    references public.modeling_scenarios(model_id, key)
    on update cascade
    on delete no action
);

create index if not exists idx_modeling_scenarios_model
  on public.modeling_scenarios(model_id, sort_order, key);

-- The FK reads (model_id, base_key), and without this index every insert into a
-- child scenario and every delete of a parent scans the table.
create index if not exists idx_modeling_scenarios_base
  on public.modeling_scenarios(model_id, base_key)
  where base_key is not null;

-- ============================================================================
-- F. The overrides.
--
--    This is Scenario.overrides -- ReadonlyMap<string, number> -- as rows, one
--    per assumption a scenario moves. A jsonb column would have been fewer
--    tables and would have made UNDECLARED unpreventable: nothing constrains a
--    key inside a jsonb object, so a scenario could override `visa_fee` in a
--    model that has no such assumption and the mistake would only surface when
--    scenario.ts refused to resolve it.
--
--    As a row with a foreign key to the assumptions registry, that state cannot
--    be written. The engine's UNDECLARED issue stays in the engine, where it
--    guards specs assembled in memory; it never fires on a spec loaded from here.
-- ============================================================================

create table if not exists public.modeling_overrides (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_staff_agency_id(),
  branch_id      uuid references public.branches(id),
  model_id       uuid not null references public.modeling_models(id) on delete cascade,
  scenario_key   text not null,
  assumption_key text not null,
  value          double precision not null,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  constraint modeling_overrides_unique unique (model_id, scenario_key, assumption_key),
  constraint modeling_overrides_finite check (private.modeling_finite(value)),
  constraint modeling_overrides_scenario_fk
    foreign key (model_id, scenario_key)
    references public.modeling_scenarios(model_id, key)
    on update cascade
    on delete cascade,
  constraint modeling_overrides_assumption_fk
    foreign key (model_id, assumption_key)
    references public.modeling_assumptions(model_id, key)
    on update cascade
    on delete cascade
);

create index if not exists idx_modeling_overrides_scenario
  on public.modeling_overrides(model_id, scenario_key);

create index if not exists idx_modeling_overrides_assumption
  on public.modeling_overrides(model_id, assumption_key);

-- ============================================================================
-- G. The guards a CHECK cannot express.
--
--    Four rules that need to read another row, so they are triggers rather than
--    constraints. All four are BEFORE INSERT OR UPDATE, which is the point: they
--    run on every write path including a direct PostgREST call, so the commands
--    in section K are a convenience rather than the enforcement. A rule that only
--    holds when you use the front door is not a rule.
--
--    And one rule that is deliberately absent: nothing here parses a formula.
--    expression.ts is a hand-written lexer and Pratt parser with nineteen
--    reserved identifiers, three of them series forms, and a ParseError carrying a
--    character position; a second implementation in plpgsql would be a second
--    grammar, and two grammars for one language disagree eventually. That is the
--    fpa_formulas.dependencies mistake wearing a different hat -- derived state,
--    stored, free to drift. The database refuses a blank formula and an absurdly
--    long one, and compileModel() is what decides whether text is a formula. Its
--    verdict arrives as a FormulaIssue naming the row and the position, which is
--    more than a CHECK could have said anyway.
-- ============================================================================

-- G.1  Rows and assumptions share one namespace.
--
--      A formula says `revenue`, and the resolver looks for a row called revenue
--      and an assumption called revenue. If both exist, one of them is silently
--      unreachable -- model.ts reports DUPLICATE_KEY and refuses to compile, so a
--      stored model in that state is a model that cannot be run. Each table's
--      UNIQUE constraint can only see its own rows, so the cross-check is here.
--
--      Scenarios are not in this namespace: no formula can reference a scenario,
--      so a scenario called `revenue` collides with nothing.
create or replace function private.modeling_guard_namespace()
returns trigger
language plpgsql
volatile
set search_path = public, pg_catalog
as $fn$
declare
  v_other text;
  v_taken boolean;
begin
  v_other := case tg_table_name
               when 'modeling_rows'        then 'modeling_assumptions'
               when 'modeling_assumptions' then 'modeling_rows'
             end;

  execute format(
    'select exists (select 1 from public.%I where model_id = $1 and key = $2)', v_other)
    into v_taken
    using new.model_id, new.key;

  if v_taken then
    raise exception
      'key % is already used by public.% in this model; a formula referencing it could not say which one it meant',
      new.key, v_other
      using errcode = '23505';
  end if;

  return new;
end;
$fn$;

revoke all on function private.modeling_guard_namespace() from public, anon, authenticated;

drop trigger if exists trg_modeling_rows_namespace on public.modeling_rows;
create trigger trg_modeling_rows_namespace
  before insert or update of key, model_id on public.modeling_rows
  for each row execute function private.modeling_guard_namespace();

drop trigger if exists trg_modeling_assumptions_namespace on public.modeling_assumptions;
create trigger trg_modeling_assumptions_namespace
  before insert or update of key, model_id on public.modeling_assumptions
  for each row execute function private.modeling_guard_namespace();

-- G.2  A given series may be shorter than the horizon. Never longer.
--
--      model.ts holds the last value flat across the remaining periods and names
--      the rows it did that to in ModelRun.held, so a short series is a decision.
--      A long one is data the model will silently ignore -- the run reads
--      periods.length values and stops -- which is the worst kind of wrong number:
--      one that is present, stored, and never used.
create or replace function private.modeling_guard_series()
returns trigger
language plpgsql
volatile
set search_path = public, pg_catalog
as $fn$
declare
  v_horizon integer;
begin
  if cardinality(new.given) = 0 then
    return new;
  end if;

  select cardinality(m.periods) into v_horizon
    from public.modeling_models m
   where m.id = new.model_id;

  if v_horizon is not null and cardinality(new.given) > v_horizon then
    raise exception
      'row % holds % given values for a % period horizon; the extra values would never be read',
      new.key, cardinality(new.given), v_horizon
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

revoke all on function private.modeling_guard_series() from public, anon, authenticated;

drop trigger if exists trg_modeling_rows_series on public.modeling_rows;
create trigger trg_modeling_rows_series
  before insert or update of given, model_id on public.modeling_rows
  for each row execute function private.modeling_guard_series();

-- G.3  The horizon cannot be shortened out from under the data.
--
--      G.2 checks the series against the horizon at the moment the series is
--      written. The same invariant breaks from the other direction -- edit the
--      model down from twelve periods to six and every twelve-value series is
--      now four values too long -- and nothing would have fired. This is the
--      other half of the same rule, and it names the row that blocks the edit so
--      the answer is "shorten that series first" rather than "no".
create or replace function private.modeling_guard_horizon()
returns trigger
language plpgsql
volatile
set search_path = public, pg_catalog
as $fn$
declare
  v_key     text;
  v_longest integer;
begin
  if cardinality(new.periods) >= cardinality(old.periods) then
    return new;
  end if;

  select r.key, cardinality(r.given) into v_key, v_longest
    from public.modeling_rows r
   where r.model_id = new.id
   order by cardinality(r.given) desc, r.key
   limit 1;

  if v_longest is not null and v_longest > cardinality(new.periods) then
    raise exception
      'row % holds % given values; shorten it before reducing the horizon to % periods',
      v_key, v_longest, cardinality(new.periods)
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

revoke all on function private.modeling_guard_horizon() from public, anon, authenticated;

drop trigger if exists trg_modeling_models_horizon on public.modeling_models;
create trigger trg_modeling_models_horizon
  before update of periods on public.modeling_models
  for each row execute function private.modeling_guard_horizon();

-- G.4  Inheritance is a chain, not a ring.
--
--      The composite FK in section E makes NO_BASE unstorable and the CHECK makes
--      a one-step self-reference unstorable, but a -> b -> a satisfies both: each
--      row names a real scenario of the same model, and neither names itself.
--      scenario.ts detects it, reports CHAIN_CYCLE, and refuses to resolve -- so
--      again, a model that stores it is a model that cannot be run.
--
--      The walk is bounded twice: by having seen a key before, which is the actual
--      cycle test, and by a hard depth cap, which catches the case the first test
--      cannot -- a chain long enough that walking it is itself the problem. Both
--      report the same refusal, because from the author's side "your inheritance
--      is circular" and "your inheritance is 500 deep" are the same mistake.
create or replace function private.modeling_guard_chain()
returns trigger
language plpgsql
volatile
set search_path = public, pg_catalog
as $fn$
declare
  v_seen  text[] := array[new.key];
  v_at    text   := new.base_key;
  v_depth integer := 0;
begin
  while v_at is not null loop
    if v_at = any (v_seen) then
      raise exception
        'scenario % inherits from itself through %; inheritance has to reach a root',
        new.key, array_to_string(v_seen, ' -> ')
        using errcode = '23514';
    end if;

    v_seen  := v_seen || v_at;
    v_depth := v_depth + 1;

    if v_depth > 64 then
      raise exception
        'scenario % sits more than 64 levels deep; that is a cycle or a mistake either way',
        new.key
        using errcode = '23514';
    end if;

    select s.base_key into v_at
      from public.modeling_scenarios s
     where s.model_id = new.model_id
       and s.key = v_at;
  end loop;

  return new;
end;
$fn$;

revoke all on function private.modeling_guard_chain() from public, anon, authenticated;

drop trigger if exists trg_modeling_scenarios_chain on public.modeling_scenarios;
create trigger trg_modeling_scenarios_chain
  before insert or update of key, base_key, model_id on public.modeling_scenarios
  for each row execute function private.modeling_guard_chain();

-- G.5  A formula has a length, even if it has no parser here.
do $$
begin
  alter table public.modeling_rows drop constraint if exists modeling_rows_formula_bounded;
  alter table public.modeling_rows add  constraint modeling_rows_formula_bounded
    check (formula is null or length(formula) <= 4000);
end $$;

-- ============================================================================
-- H. The certificate ledger.
--
--    certify.ts measures ten things about a model and returns a Certificate: a
--    grade, the two content hashes, the target it measured, every check with what
--    it counted and what it compared against, the method's standing limitations,
--    and the four outcome counts. This table is that, append-only.
--
--    Append-only in the schema's sense, not as a habit: section I gives it a
--    SELECT policy and nothing else, revokes INSERT, UPDATE and DELETE from every
--    role, and the only way a row arrives is the definer function in section K.
--    A measurement that can be edited afterwards is not a measurement.
--
--    There is no separate modeling_events table beside it. A certificate is
--    already an immutable record of what was true at a moment, and a second ledger
--    describing the same events is a second ledger to disagree with the first.
--
--    Two things it does *not* store, both on purpose:
--
--      An approval. A certificate says the model was measured and how it scored.
--      Whether that is good enough to plan on is a person's decision, it belongs
--      to the approval subsystem, and a signature column here would quietly turn
--      a measurement into a sign-off.
--
--      A grade anybody chose. grade is a CHECK away from the counts, using
--      certify.ts's own rule -- any FAIL is UNCERTIFIED, any WARN or UNMEASURED
--      caps at PROVISIONAL, and CERTIFIED needs a clean sweep. "Derived, never
--      assigned" is a claim the engine makes about its own code; here it is a
--      constraint, so a client that computes its own generous grade is refused by
--      the database rather than believed by the screen.
--
--    The rows go when the model goes. That looks like a hole in append-only and
--    is the opposite: the whole worth of a certificate is that resultsHash can be
--    checked against the model it names, so a certificate whose model no longer
--    exists is an assertion nobody can refute. Keeping those is how a ledger
--    starts flattering itself.
-- ============================================================================

create table if not exists public.modeling_certificates (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_staff_agency_id(),
  branch_id      uuid references public.branches(id),
  model_id       uuid not null references public.modeling_models(id) on delete cascade,
  -- Which scenario was measured. Text rather than an FK: the scenario may later
  -- be renamed or deleted, and the certificate must keep saying what it measured.
  scenario_key   text not null,
  -- The Target, spread into its three fields rather than kept as jsonb, because
  -- every one of them is queried: "show me every certificate for gross_margin".
  target_key     text not null,
  target_kind    text not null,
  target_period  integer not null default 0,
  grade          text not null,
  results_hash   text not null,
  full_hash      text not null,
  passed         integer not null,
  warned         integer not null,
  failed         integer not null,
  unmeasured     integer not null,
  -- Check[] verbatim: kind, outcome, measured, threshold, detail, where. Stored
  -- whole rather than normalised into a child table because a check is never
  -- queried apart from its certificate, and because CheckKind gaining a member
  -- must not need a migration to record one.
  checks         jsonb not null,
  -- The method's limitations as they were worded when this was measured. They are
  -- the same on every certificate the same engine issues, which is an argument for
  -- a constant and against one: when the engine's disclosures change, an old
  -- certificate has to keep disclosing what it actually disclosed.
  limitations    text[] not null default '{}',
  -- No certified_at beside created_at, and no certified_by beside created_by. A
  -- certificate cannot be issued at a time other than the moment it is written --
  -- the row *is* the issuing -- so a second pair of columns would be two facts
  -- that must always agree, which is the flaw this migration was written to fix.
  -- No updated_at either: nothing updates.
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  constraint modeling_certificates_grade_check
    check (grade in ('CERTIFIED', 'PROVISIONAL', 'UNCERTIFIED')),
  constraint modeling_certificates_target_kind_check
    check (target_kind in ('AT', 'TOTAL', 'FINAL')),
  constraint modeling_certificates_period_check check (target_period >= 0),
  constraint modeling_certificates_counts_check
    check (passed >= 0 and warned >= 0 and failed >= 0 and unmeasured >= 0),
  constraint modeling_certificates_checks_shape
    check (jsonb_typeof(checks) = 'array'),
  -- The counts have to be the counts of the checks stored beside them.
  constraint modeling_certificates_counts_total
    check (passed + warned + failed + unmeasured = jsonb_array_length(checks)),
  -- certify.ts's grading rule, as a constraint.
  constraint modeling_certificates_grade_derived
    check (grade = case
                     when failed > 0                      then 'UNCERTIFIED'
                     when warned > 0 or unmeasured > 0     then 'PROVISIONAL'
                     else 'CERTIFIED'
                   end),
  constraint modeling_certificates_hash_shape
    check (results_hash ~ '^[0-9a-f]{16}$' and full_hash ~ '^[0-9a-f]{16}$')
);

create index if not exists idx_modeling_certificates_model
  on public.modeling_certificates(model_id, created_at desc);

-- "Is this certificate still about the model in front of me" is the question the
-- whole table exists to answer, and it is asked by hash.
create index if not exists idx_modeling_certificates_hash
  on public.modeling_certificates(model_id, results_hash);

-- ============================================================================
-- I. Row level security, in four verbs.
--
--    Five tables get read, create, update and delete as separate policies, each
--    asking two questions: does this role hold this permission on this resource,
--    and is this row inside the caller's agency *and* branch. The ledger gets the
--    first policy and none of the others.
--
--    Not `for all`. A single FOR ALL policy answers reading and writing with one
--    predicate, so anybody who can open a model can rewrite it, and there is no
--    place to say that OPERATIONS_MANAGER may build a plan and may not delete one.
--    That distinction is the entire access design for this subsystem, and it only
--    exists if the verbs are separate.
--
--    row_in_staff_scope takes both dimensions. The fpa_* policies asked about the
--    agency alone, which means every branch's financial model was visible to every
--    branch -- section A fixed that for them and this is the same rule stated once
--    for everything new.
-- ============================================================================

do $rls$
declare
  t          text;
  has_audit  boolean;
  modeling_tables text[] := array[
    'modeling_models','modeling_assumptions','modeling_rows',
    'modeling_scenarios','modeling_overrides'
  ];
begin
  select exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = 'write_audit_log'
  ) into has_audit;

  foreach t in array modeling_tables loop
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

-- The ledger reads and does not write. No insert, update or delete policy exists
-- for any role, and the write privileges are revoked outright, so section K's
-- definer function is not the easiest way in -- it is the only one.
--
-- It reads under the models' permission rather than its own. A certificate is a
-- statement about a model, and a role that cannot open the model has no use for a
-- grade about it; giving the ledger a separate read permission would have created
-- a way to see how a model scored without being allowed to see the model.
do $ledger$
begin
  alter table public.modeling_certificates enable row level security;

  drop policy if exists staff_select on public.modeling_certificates;
  create policy staff_select on public.modeling_certificates
    for select to authenticated
    using (public.has_permission('modeling_models', 'read')
           and public.row_in_staff_scope(agency_id, branch_id));

  revoke all on public.modeling_certificates from anon, authenticated;
  grant select on public.modeling_certificates to authenticated;

  drop trigger if exists trg_stamp_staff_scope on public.modeling_certificates;
  create trigger trg_stamp_staff_scope before insert on public.modeling_certificates
    for each row execute function public.stamp_staff_scope();
end;
$ledger$;

-- ============================================================================
-- J. Permissions, seeded.
--
--    has_permission() returns true for ADMIN and otherwise looks the role up in
--    staff_permissions. A resource nobody has seeded is therefore ADMIN-only --
--    silently, and with policies that all look correct. Every table above would
--    have been invisible to FINANCE without this block.
--
--    The grants are deliberately narrower than the BI slice's. A dashboard shows
--    what happened; a model states what the business believes will happen, with
--    covenant thresholds and margin assumptions inside it, and it is the thing a
--    plan gets approved against. So:
--
--      FINANCE              all four verbs. This is their subsystem.
--      OPERATIONS_MANAGER   read, create, update -- they build operational plans
--                           and revise them; deleting one is not their call.
--      CRM, AGENT,
--      VISA_AGENT, GUIDE    nothing. Not a smaller model, not a read-only one.
--                           A sales agent has no question that a covenant test
--                           answers, and read access that exists "just in case"
--                           is how a margin assumption reaches a customer.
--
--    ADMIN is absent from the insert because has_permission() short-circuits on it;
--    seeding ADMIN rows would suggest the grant came from here and could be
--    revoked here, which is not true.
-- ============================================================================

do $seed$
declare
  r       text;
  t       text;
  a       text;
  full_roles  text[] := array['FINANCE'];
  build_roles text[] := array['OPERATIONS_MANAGER'];
  targets     text[] := array[
    'modeling_models','modeling_assumptions','modeling_rows',
    'modeling_scenarios','modeling_overrides'
  ];
begin
  if to_regclass('public.staff_permissions') is null then
    raise notice 'public.staff_permissions is absent; modeling stays ADMIN-only until it is seeded';
    return;
  end if;

  foreach r in array full_roles loop
    foreach t in array targets loop
      foreach a in array array['read','create','update','delete'] loop
        insert into public.staff_permissions(role, resource, action)
        values (r, t, a)
        on conflict (role, resource, action) do nothing;
      end loop;
    end loop;
  end loop;

  foreach r in array build_roles loop
    foreach t in array targets loop
      foreach a in array array['read','create','update'] loop
        insert into public.staff_permissions(role, resource, action)
        values (r, t, a)
        on conflict (role, resource, action) do nothing;
      end loop;
    end loop;
  end loop;
end;
$seed$;

-- ============================================================================
-- K. The commands.
--
--    Same shape as every other subsystem here: the work lives in private, each
--    body is revoked from every role, and the public surface is a one-line
--    SECURITY DEFINER wrapper returning jsonb. The wrappers exist so that the RPC
--    names a screen calls are a stable, documented list rather than whatever
--    PostgREST happens to expose.
--
--    Definer means RLS does not run, so every guard the policies would have
--    applied is applied here by hand -- permission, then scope, then state. That
--    is what K.1 is for: eight functions asking the same three questions is eight
--    chances to ask two of them.
--
--    The state question is the one that is not obvious. A model whose status is
--    PUBLISHED cannot be edited. Not because editing is dangerous, but because
--    published_hash is a claim about a specific set of formulas and assumptions,
--    and a plan of record that changes underneath its own hash is worse than no
--    hash at all -- every certificate against it silently becomes a certificate
--    about something else. So publishing freezes, and revise_modeling_model_command
--    is the way back to DRAFT: an explicit act, by somebody with the permission,
--    that clears the attestation it invalidates.
-- ============================================================================

-- K.1  Permission, scope, state -- in that order, once.
--
--      The order matters for what a caller learns from a refusal. Permission
--      first, so a role with no business here is told that and nothing else; it
--      never finds out whether a given model id exists. Then existence and scope,
--      which is the same refusal for "no such model" and "not yours" -- 42501
--      either way, because distinguishing them turns this function into a way to
--      enumerate other agencies' model ids.
create or replace function private.modeling_guard(
  p_model_id      uuid,
  p_resource      text,
  p_action        text,
  p_require_draft boolean default true)
returns public.modeling_models
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
begin
  if not public.has_permission(p_resource, p_action) then
    raise exception 'Your role cannot % %', p_action, p_resource using errcode = '42501';
  end if;

  select m.* into v_model from public.modeling_models m where m.id = p_model_id;

  if not found or not public.row_in_staff_scope(v_model.agency_id, v_model.branch_id) then
    raise exception 'That model is not available to you' using errcode = '42501';
  end if;

  if p_require_draft and v_model.status <> 'DRAFT' then
    raise exception
      'Model "%" is %; revise it back to draft before editing, which clears the published hash',
      v_model.key, lower(v_model.status)
      using errcode = '22023';
  end if;

  return v_model;
end;
$fn$;

revoke all on function private.modeling_guard(uuid, text, text, boolean)
  from public, anon, authenticated;

-- K.2  The model itself.

create or replace function private.modeling_create_model(
  p_key         text,
  p_name        text,
  p_periods     text[],
  p_name_ar     text default null,
  p_description text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id uuid;
begin
  if not public.has_permission('modeling_models', 'create') then
    raise exception 'Your role cannot create models' using errcode = '42501';
  end if;

  insert into public.modeling_models(key, name, name_ar, description, periods)
  values (lower(btrim(p_key)), btrim(p_name), p_name_ar, p_description, p_periods)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'periods', cardinality(p_periods));
end;
$fn$;

revoke all on function private.modeling_create_model(text, text, text[], text, text)
  from public, anon, authenticated;

create or replace function private.modeling_update_model(
  p_model_id    uuid,
  p_name        text,
  p_periods     text[],
  p_name_ar     text default null,
  p_description text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
begin
  v_model := private.modeling_guard(p_model_id, 'modeling_models', 'update');

  update public.modeling_models
     set name        = btrim(p_name),
         name_ar     = p_name_ar,
         description = p_description,
         periods     = p_periods,
         updated_by  = auth.uid()
   where id = p_model_id;

  return jsonb_build_object('ok', true, 'id', p_model_id);
end;
$fn$;

revoke all on function private.modeling_update_model(uuid, text, text[], text, text)
  from public, anon, authenticated;

-- Publishing is the one command that takes a hash as an argument, and the argument
-- is the point. The server cannot compute FNV-1a over a canonicalised spec, so it
-- records what the client says the model hashed to and lets certify() be the one to
-- disagree. What it *can* check is that the thing being published is runnable at all:
-- a model with no rows is not a plan, and a model with one scenario has nothing to
-- compare against -- which is certify.ts's SCENARIO_COUNT, refused here rather than
-- warned about later.
create or replace function private.modeling_publish_model(
  p_model_id  uuid,
  p_full_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model    public.modeling_models;
  v_rows     bigint;
  v_scen     bigint;
  v_version  integer;
begin
  v_model := private.modeling_guard(p_model_id, 'modeling_models', 'update');

  if p_full_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'A published hash is sixteen lowercase hex characters; "%" is not', p_full_hash
      using errcode = '22023';
  end if;

  select count(*) into v_rows from public.modeling_rows  r where r.model_id = p_model_id;
  select count(*) into v_scen from public.modeling_scenarios s where s.model_id = p_model_id;

  if v_rows = 0 then
    raise exception 'Model "%" has no rows; publishing it would publish nothing', v_model.key
      using errcode = '22023';
  end if;
  if v_scen < 2 then
    raise exception
      'Model "%" has % scenario(s); a plan of record needs something to compare against',
      v_model.key, v_scen
      using errcode = '22023';
  end if;

  update public.modeling_models
     set status         = 'PUBLISHED',
         published_hash = p_full_hash,
         published_at   = now(),
         published_by   = auth.uid(),
         version        = version + 1,
         updated_by     = auth.uid()
   where id = p_model_id
  returning version into v_version;

  return jsonb_build_object('ok', true, 'id', p_model_id,
                            'version', v_version, 'publishedHash', p_full_hash);
end;
$fn$;

revoke all on function private.modeling_publish_model(uuid, text)
  from public, anon, authenticated;

-- The way back. It clears published_hash rather than keeping it "for reference",
-- because a hash that no longer describes the model in front of you is not a
-- reference, it is a wrong answer waiting to be read. What the model was when it
-- was published survives in the certificates, which is where it belongs.
create or replace function private.modeling_revise_model(p_model_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
begin
  v_model := private.modeling_guard(p_model_id, 'modeling_models', 'update', false);

  if v_model.status = 'DRAFT' then
    return jsonb_build_object('ok', true, 'id', p_model_id, 'status', 'DRAFT', 'changed', false);
  end if;

  update public.modeling_models
     set status         = 'DRAFT',
         published_hash = null,
         published_at   = null,
         published_by   = null,
         updated_by     = auth.uid()
   where id = p_model_id;

  return jsonb_build_object('ok', true, 'id', p_model_id, 'status', 'DRAFT', 'changed', true);
end;
$fn$;

revoke all on function private.modeling_revise_model(uuid) from public, anon, authenticated;

create or replace function private.modeling_set_archived(p_model_id uuid, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
  v_to    text;
begin
  v_model := private.modeling_guard(p_model_id, 'modeling_models', 'update', false);
  v_to := case when p_archived then 'ARCHIVED' else 'DRAFT' end;

  if v_model.status = 'PUBLISHED' and p_archived then
    raise exception 'Model "%" is published; revise it back to draft before archiving', v_model.key
      using errcode = '22023';
  end if;

  update public.modeling_models
     set status = v_to, updated_by = auth.uid()
   where id = p_model_id;

  return jsonb_build_object('ok', true, 'id', p_model_id, 'status', v_to);
end;
$fn$;

revoke all on function private.modeling_set_archived(uuid, boolean) from public, anon, authenticated;

-- K.3  Assumptions.
--
--      Upsert rather than separate insert and update, because the client that has
--      an assumption in front of it knows the key and does not reliably know
--      whether the row exists -- and a screen that has to ask before it can save is
--      a screen with a race in it. What it does *not* do is collapse the two
--      permissions: existence is checked first and the verb demanded matches what
--      is about to happen, so a role that may add an assumption and not revise one
--      cannot revise one by saving over it.
create or replace function private.modeling_upsert_assumption(
  p_model_id uuid,
  p_key      text,
  p_label    text,
  p_unit     text,
  p_value    double precision,
  p_low      double precision default null,
  p_high     double precision default null,
  p_label_ar text default null,
  p_note     text default '',
  p_sort     integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key   text := btrim(p_key);
  v_exists boolean;
begin
  select exists (select 1 from public.modeling_assumptions a
                  where a.model_id = p_model_id and a.key = v_key)
    into v_exists;

  perform private.modeling_guard(
    p_model_id, 'modeling_assumptions', case when v_exists then 'update' else 'create' end);

  insert into public.modeling_assumptions(
    model_id, key, label, label_ar, unit, value, low, high, note, sort_order)
  values (p_model_id, v_key, btrim(p_label), p_label_ar, p_unit,
          p_value, p_low, p_high, coalesce(p_note, ''), coalesce(p_sort, 0))
  on conflict (model_id, key) do update
     set label      = excluded.label,
         label_ar   = excluded.label_ar,
         unit       = excluded.unit,
         value      = excluded.value,
         low        = excluded.low,
         high       = excluded.high,
         note       = excluded.note,
         sort_order = excluded.sort_order,
         updated_by = auth.uid();

  return jsonb_build_object('ok', true, 'key', v_key, 'created', not v_exists);
end;
$fn$;

revoke all on function private.modeling_upsert_assumption(
  uuid, text, text, text, double precision, double precision, double precision,
  text, text, integer) from public, anon, authenticated;

-- Deleting an assumption a formula still names would leave the model unrunnable in
-- a way the model cannot see: the engine reports MISSING at compile time, from the
-- row, and by then the assumption is gone and nobody knows what it was called. So
-- the reference is looked for first. This is a string search, not parsing -- it is
-- allowed to be wrong in the direction of refusing a delete that would have been
-- fine, and is not allowed to be wrong in the other direction, which is why the
-- word boundary is checked rather than a bare position().
create or replace function private.modeling_delete_assumption(p_model_id uuid, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key   text := btrim(p_key);
  v_row   text;
  v_gone  integer;
begin
  perform private.modeling_guard(p_model_id, 'modeling_assumptions', 'delete');

  select r.key into v_row
    from public.modeling_rows r
   where r.model_id = p_model_id
     and r.formula is not null
     and r.formula ~ ('(^|[^A-Za-z0-9_])' || v_key || '([^A-Za-z0-9_]|$)')
   order by r.key
   limit 1;

  if v_row is not null then
    raise exception
      'Assumption "%" is used by row "%"; change that formula first', v_key, v_row
      using errcode = '23503';
  end if;

  delete from public.modeling_assumptions a
   where a.model_id = p_model_id and a.key = v_key;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'key', v_key, 'deleted', v_gone);
end;
$fn$;

revoke all on function private.modeling_delete_assumption(uuid, text)
  from public, anon, authenticated;

-- K.4  Rows.
--
--      `given` arrives as an array and `formula` as text, and exactly one of them
--      may be present -- which the table already refuses and this does not repeat.
--      What it does add is the empty-array normalisation: a client sending null for
--      "no series" and a client sending '{}' both mean the same thing, and the
--      told-or-computed CHECK reads cardinality, which is null for a null array and
--      therefore fails the constraint for a reason nobody would guess from the
--      message. Normalising here is cheaper than explaining that.
create or replace function private.modeling_upsert_row(
  p_model_id uuid,
  p_key      text,
  p_label    text,
  p_unit     text,
  p_formula  text default null,
  p_given    double precision[] default null,
  p_label_ar text default null,
  p_note     text default '',
  p_sort     integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key     text := btrim(p_key);
  v_formula text := nullif(btrim(coalesce(p_formula, '')), '');
  v_given   double precision[] := coalesce(p_given, '{}'::double precision[]);
  v_exists  boolean;
begin
  select exists (select 1 from public.modeling_rows r
                  where r.model_id = p_model_id and r.key = v_key)
    into v_exists;

  perform private.modeling_guard(
    p_model_id, 'modeling_rows', case when v_exists then 'update' else 'create' end);

  if v_formula is null and cardinality(v_given) = 0 then
    raise exception
      'Row "%" is neither told nor computed; give it a formula or a series', v_key
      using errcode = '22023';
  end if;

  insert into public.modeling_rows(
    model_id, key, label, label_ar, unit, formula, given, note, sort_order)
  values (p_model_id, v_key, btrim(p_label), p_label_ar, p_unit,
          v_formula, v_given, coalesce(p_note, ''), coalesce(p_sort, 0))
  on conflict (model_id, key) do update
     set label      = excluded.label,
         label_ar   = excluded.label_ar,
         unit       = excluded.unit,
         formula    = excluded.formula,
         given      = excluded.given,
         note       = excluded.note,
         sort_order = excluded.sort_order,
         updated_by = auth.uid();

  return jsonb_build_object('ok', true, 'key', v_key, 'created', not v_exists,
                            'computed', v_formula is not null);
end;
$fn$;

revoke all on function private.modeling_upsert_row(
  uuid, text, text, text, text, double precision[], text, text, integer)
  from public, anon, authenticated;

create or replace function private.modeling_delete_row(p_model_id uuid, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key  text := btrim(p_key);
  v_dep  text;
  v_gone integer;
begin
  perform private.modeling_guard(p_model_id, 'modeling_rows', 'delete');

  select r.key into v_dep
    from public.modeling_rows r
   where r.model_id = p_model_id
     and r.key <> v_key
     and r.formula is not null
     and r.formula ~ ('(^|[^A-Za-z0-9_])' || v_key || '([^A-Za-z0-9_]|$)')
   order by r.key
   limit 1;

  if v_dep is not null then
    raise exception 'Row "%" is used by row "%"; change that formula first', v_key, v_dep
      using errcode = '23503';
  end if;

  delete from public.modeling_rows r
   where r.model_id = p_model_id and r.key = v_key;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'key', v_key, 'deleted', v_gone);
end;
$fn$;

revoke all on function private.modeling_delete_row(uuid, text)
  from public, anon, authenticated;

-- K.5  Scenarios.
--
--      base_key is passed straight through to the composite foreign key, so a base
--      that does not exist is refused by the constraint and a ring is refused by the
--      G.4 walk. Neither is re-checked here. The one thing this adds is the
--      dependent-scenario message on delete: NO ACTION already refuses to orphan a
--      chain, but it refuses with the constraint name, and "which scenario" is the
--      only question the person deleting actually has.
create or replace function private.modeling_upsert_scenario(
  p_model_id uuid,
  p_key      text,
  p_name     text,
  p_base_key text default null,
  p_name_ar  text default null,
  p_note     text default '',
  p_sort     integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key    text := btrim(p_key);
  v_base   text := nullif(btrim(coalesce(p_base_key, '')), '');
  v_exists boolean;
begin
  select exists (select 1 from public.modeling_scenarios s
                  where s.model_id = p_model_id and s.key = v_key)
    into v_exists;

  perform private.modeling_guard(
    p_model_id, 'modeling_scenarios', case when v_exists then 'update' else 'create' end);

  insert into public.modeling_scenarios(
    model_id, key, name, name_ar, base_key, note, sort_order)
  values (p_model_id, v_key, btrim(p_name), p_name_ar, v_base,
          coalesce(p_note, ''), coalesce(p_sort, 0))
  on conflict (model_id, key) do update
     set name       = excluded.name,
         name_ar    = excluded.name_ar,
         base_key   = excluded.base_key,
         note       = excluded.note,
         sort_order = excluded.sort_order,
         updated_by = auth.uid();

  return jsonb_build_object('ok', true, 'key', v_key, 'created', not v_exists,
                            'base', v_base);
end;
$fn$;

revoke all on function private.modeling_upsert_scenario(
  uuid, text, text, text, text, text, integer) from public, anon, authenticated;

create or replace function private.modeling_delete_scenario(p_model_id uuid, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_key  text := btrim(p_key);
  v_dep  text;
  v_gone integer;
begin
  perform private.modeling_guard(p_model_id, 'modeling_scenarios', 'delete');

  select s.key into v_dep
    from public.modeling_scenarios s
   where s.model_id = p_model_id and s.base_key = v_key
   order by s.key
   limit 1;

  if v_dep is not null then
    raise exception
      'Scenario "%" is the base of "%"; repoint or delete that one first', v_key, v_dep
      using errcode = '23503';
  end if;

  delete from public.modeling_scenarios s
   where s.model_id = p_model_id and s.key = v_key;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'key', v_key, 'deleted', v_gone);
end;
$fn$;

revoke all on function private.modeling_delete_scenario(uuid, text)
  from public, anon, authenticated;

-- K.6  Overrides.
--
--      One value at a time, keyed by scenario and assumption, with both foreign keys
--      doing the work. Clearing is a delete rather than a write of null, because an
--      override whose value is null is not an override -- it is a row that has to be
--      skipped by every reader, and the readers that forget are how a scenario ends
--      up inheriting something it was supposed to have set.
create or replace function private.modeling_set_override(
  p_model_id       uuid,
  p_scenario_key   text,
  p_assumption_key text,
  p_value          double precision,
  p_note           text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_scen text := btrim(p_scenario_key);
  v_asm  text := btrim(p_assumption_key);
  v_new  boolean;
begin
  select not exists (select 1 from public.modeling_overrides o
                      where o.model_id = p_model_id
                        and o.scenario_key = v_scen
                        and o.assumption_key = v_asm)
    into v_new;

  perform private.modeling_guard(
    p_model_id, 'modeling_overrides', case when v_new then 'create' else 'update' end);

  insert into public.modeling_overrides(
    model_id, scenario_key, assumption_key, value, note)
  values (p_model_id, v_scen, v_asm, p_value, coalesce(p_note, ''))
  on conflict (model_id, scenario_key, assumption_key) do update
     set value      = excluded.value,
         note       = excluded.note,
         updated_by = auth.uid();

  return jsonb_build_object('ok', true, 'scenario', v_scen,
                            'assumption', v_asm, 'created', v_new);
end;
$fn$;

revoke all on function private.modeling_set_override(
  uuid, text, text, double precision, text) from public, anon, authenticated;

create or replace function private.modeling_clear_override(
  p_model_id       uuid,
  p_scenario_key   text,
  p_assumption_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gone integer;
begin
  perform private.modeling_guard(p_model_id, 'modeling_overrides', 'delete');

  delete from public.modeling_overrides o
   where o.model_id = p_model_id
     and o.scenario_key = btrim(p_scenario_key)
     and o.assumption_key = btrim(p_assumption_key);
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_gone);
end;
$fn$;

revoke all on function private.modeling_clear_override(uuid, text, text)
  from public, anon, authenticated;

-- K.7  The certificate, recorded.
--
--      The ledger's only door, and the reason section I revoked insert from
--      authenticated outright.
--
--      It takes the grade rather than deriving it. That looks like the weaker of the
--      two choices and is the stronger one: the table's grade CHECK is what refuses a
--      client whose grade logic has drifted from certify.ts, and a command that
--      computed the grade itself would make that constraint trivially true and
--      therefore worthless. The constraint is only a test of anything if somebody is
--      allowed to fail it.
--
--      The permission asked for is update on the model, not create on a resource of
--      its own. Issuing the certificate of record for a model is an act on that
--      model's standing, and giving certificates a separate permission would have
--      created a role that may declare a model certified without being allowed to
--      change anything in it.
--
--      The model is *not* required to be in DRAFT. Certifying a published plan is the
--      normal case -- it is what the published hash is for.
create or replace function private.modeling_record_certificate(
  p_model_id      uuid,
  p_scenario_key  text,
  p_target_key    text,
  p_target_kind   text,
  p_target_period integer,
  p_grade         text,
  p_results_hash  text,
  p_full_hash     text,
  p_passed        integer,
  p_warned        integer,
  p_failed        integer,
  p_unmeasured    integer,
  p_checks        jsonb,
  p_limitations   text[] default '{}')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
  v_scen  text := btrim(p_scenario_key);
  v_id    uuid;
begin
  v_model := private.modeling_guard(p_model_id, 'modeling_models', 'update', false);

  if not exists (select 1 from public.modeling_scenarios s
                  where s.model_id = p_model_id and s.key = v_scen) then
    raise exception 'Model "%" has no scenario "%"', v_model.key, v_scen
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.modeling_rows r
                  where r.model_id = p_model_id and r.key = btrim(p_target_key)) then
    raise exception 'Model "%" has no row "%" to certify', v_model.key, p_target_key
      using errcode = '22023';
  end if;

  insert into public.modeling_certificates(
    model_id, scenario_key, target_key, target_kind, target_period,
    grade, results_hash, full_hash,
    passed, warned, failed, unmeasured, checks, limitations)
  values (p_model_id, v_scen, btrim(p_target_key), p_target_kind,
          coalesce(p_target_period, 0),
          p_grade, p_results_hash, p_full_hash,
          p_passed, p_warned, p_failed, p_unmeasured,
          coalesce(p_checks, '[]'::jsonb), coalesce(p_limitations, '{}'::text[]))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'grade', p_grade,
                            'stale', v_model.published_hash is not null
                                     and v_model.published_hash <> p_full_hash);
end;
$fn$;

revoke all on function private.modeling_record_certificate(
  uuid, text, text, text, integer, text, text, text,
  integer, integer, integer, integer, jsonb, text[])
  from public, anon, authenticated;

-- ============================================================================
-- K.8  The read models.
--
--      get_modeling_spec returns the whole spec in one object, and that is the
--      entire reason it exists. Four separate reads -- periods, rows, assumptions,
--      scenarios -- are four moments, and a model assembled across four moments can
--      contain a formula from after an assumption was renamed. The engine would then
--      report MISSING on a spec that was never actually in that state, which is the
--      worst class of bug to be handed: a correct diagnosis of something that is not
--      true.
--
--      The keys are camelCase and the scenario's key is emitted as `id`, because the
--      consumer is ModelSpec and not this schema. Scenario.baseId names another
--      scenario's id, which here is another scenario's key, so base_key maps to
--      baseId and the engine's resolveScenario walks the chain without knowing that
--      the identifiers it is following are user-typed keys. overrides is emitted as a
--      jsonb object; ReadonlyMap is built from it on the client, which is the only
--      shape JSON has for a map.
-- ============================================================================

create or replace function public.get_modeling_spec(p_model_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
  v_out   jsonb;
begin
  if not public.has_permission('modeling_models', 'read') then
    raise exception 'Your role cannot read models' using errcode = '42501';
  end if;

  select m.* into v_model from public.modeling_models m where m.id = p_model_id;

  if not found or not public.row_in_staff_scope(v_model.agency_id, v_model.branch_id) then
    raise exception 'That model is not available to you' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'model', jsonb_build_object(
      'id',            v_model.id,
      'key',           v_model.key,
      'name',          v_model.name,
      'nameAr',        v_model.name_ar,
      'description',   v_model.description,
      'status',        v_model.status,
      'version',       v_model.version,
      'publishedHash', v_model.published_hash,
      'publishedAt',   v_model.published_at,
      'updatedAt',     v_model.updated_at),
    'periods', to_jsonb(v_model.periods),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',     r.key,
               'label',   r.label,
               'labelAr', r.label_ar,
               'unit',    r.unit,
               'formula', r.formula,
               'given',   to_jsonb(r.given),
               'note',    r.note)
             order by r.sort_order, r.key)
        from public.modeling_rows r where r.model_id = p_model_id), '[]'::jsonb),
    'assumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',     a.key,
               'label',   a.label,
               'labelAr', a.label_ar,
               'unit',    a.unit,
               'value',   a.value,
               'low',     a.low,
               'high',    a.high,
               'note',    a.note)
             order by a.sort_order, a.key)
        from public.modeling_assumptions a where a.model_id = p_model_id), '[]'::jsonb),
    'scenarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        s.key,
               'name',      s.name,
               'nameAr',    s.name_ar,
               'baseId',    s.base_key,
               'note',      s.note,
               'overrides', coalesce((
                 select jsonb_object_agg(o.assumption_key, o.value)
                   from public.modeling_overrides o
                  where o.model_id = p_model_id
                    and o.scenario_key = s.key), '{}'::jsonb))
             order by s.sort_order, s.key)
        from public.modeling_scenarios s where s.model_id = p_model_id), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;

-- The list. Counts rather than contents, plus the standing of the most recent
-- certificate and whether it still describes the model -- which is a comparison of
-- two stored hashes and not a re-measurement, so it is honest about being a
-- shortcut: `certificateStale` says the certificate was issued against a different
-- version, and says nothing about whether the current one would pass.
create or replace function public.get_modeling_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_out jsonb;
begin
  if not public.has_permission('modeling_models', 'read') then
    raise exception 'Your role cannot read models' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x_updated desc), '[]'::jsonb)
    into v_out
    from (
      select jsonb_build_object(
               'id',               m.id,
               'key',              m.key,
               'name',             m.name,
               'nameAr',           m.name_ar,
               'status',           m.status,
               'version',          m.version,
               'periods',          cardinality(m.periods),
               'firstPeriod',      m.periods[1],
               'lastPeriod',       m.periods[cardinality(m.periods)],
               'rows',             (select count(*) from public.modeling_rows r
                                     where r.model_id = m.id),
               'computedRows',     (select count(*) from public.modeling_rows r
                                     where r.model_id = m.id and r.formula is not null),
               'assumptions',      (select count(*) from public.modeling_assumptions a
                                     where a.model_id = m.id),
               'rangedAssumptions',(select count(*) from public.modeling_assumptions a
                                     where a.model_id = m.id
                                       and a.low is not null and a.high is not null),
               'scenarios',        (select count(*) from public.modeling_scenarios s
                                     where s.model_id = m.id),
               'overrides',        (select count(*) from public.modeling_overrides o
                                     where o.model_id = m.id),
               'publishedHash',    m.published_hash,
               'publishedAt',      m.published_at,
               'updatedAt',        m.updated_at,
               'certificateGrade', c.grade,
               'certificateAt',    c.created_at,
               'certificateStale', c.full_hash is not null
                                   and c.full_hash <> coalesce(m.published_hash, c.full_hash)
             ) as x,
             m.updated_at as x_updated
        from public.modeling_models m
        left join lateral (
               select cc.grade, cc.created_at, cc.full_hash
                 from public.modeling_certificates cc
                where cc.model_id = m.id
                order by cc.created_at desc
                limit 1) c on true
       where public.row_in_staff_scope(m.agency_id, m.branch_id)) t;

  return v_out;
end;
$fn$;

-- The ledger, read newest first. checks comes back whole because a certificate with
-- its checks removed is a grade with nothing behind it, which is the thing this
-- subsystem exists to not produce.
create or replace function public.get_modeling_certificates(
  p_model_id uuid,
  p_limit    integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_model public.modeling_models;
  v_out   jsonb;
begin
  if not public.has_permission('modeling_models', 'read') then
    raise exception 'Your role cannot read models' using errcode = '42501';
  end if;

  select m.* into v_model from public.modeling_models m where m.id = p_model_id;

  if not found or not public.row_in_staff_scope(v_model.agency_id, v_model.branch_id) then
    raise exception 'That model is not available to you' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          c.id,
           'grade',       c.grade,
           'scenario',    c.scenario_key,
           'target',      jsonb_build_object('key',    c.target_key,
                                             'kind',   c.target_kind,
                                             'period', c.target_period),
           'resultsHash', c.results_hash,
           'fullHash',    c.full_hash,
           'passed',      c.passed,
           'warned',      c.warned,
           'failed',      c.failed,
           'unmeasured',  c.unmeasured,
           'checks',      c.checks,
           'limitations', to_jsonb(c.limitations),
           'createdAt',   c.created_at,
           'describesCurrent', c.full_hash = coalesce(v_model.published_hash, '')
         ) order by c.created_at desc), '[]'::jsonb)
    into v_out
    from (select * from public.modeling_certificates cc
           where cc.model_id = p_model_id
           order by cc.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 500))) c;

  return v_out;
end;
$fn$;

-- ============================================================================
-- K.9  The public surface.
--
--      One line each, over the private bodies above. The wrappers carry the argument
--      names and defaults a client sees, so PostgREST's payload shape is decided here
--      rather than by whichever private signature happens to be current -- a private
--      body can gain a parameter without every caller's JSON changing shape.
-- ============================================================================

create or replace function public.create_modeling_model_command(
  p_key text, p_name text, p_periods text[],
  p_name_ar text default null, p_description text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_create_model(p_key, p_name, p_periods, p_name_ar, p_description); $w$;

create or replace function public.update_modeling_model_command(
  p_model_id uuid, p_name text, p_periods text[],
  p_name_ar text default null, p_description text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_update_model(p_model_id, p_name, p_periods, p_name_ar, p_description); $w$;

create or replace function public.publish_modeling_model_command(
  p_model_id uuid, p_full_hash text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_publish_model(p_model_id, p_full_hash); $w$;

create or replace function public.revise_modeling_model_command(p_model_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_revise_model(p_model_id); $w$;

create or replace function public.archive_modeling_model_command(
  p_model_id uuid, p_archived boolean default true)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_set_archived(p_model_id, p_archived); $w$;

create or replace function public.upsert_modeling_assumption_command(
  p_model_id uuid, p_key text, p_label text, p_unit text, p_value double precision,
  p_low double precision default null, p_high double precision default null,
  p_label_ar text default null, p_note text default '', p_sort integer default 0)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_upsert_assumption(
  p_model_id, p_key, p_label, p_unit, p_value, p_low, p_high, p_label_ar, p_note, p_sort); $w$;

create or replace function public.delete_modeling_assumption_command(
  p_model_id uuid, p_key text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_delete_assumption(p_model_id, p_key); $w$;

create or replace function public.upsert_modeling_row_command(
  p_model_id uuid, p_key text, p_label text, p_unit text,
  p_formula text default null, p_given double precision[] default null,
  p_label_ar text default null, p_note text default '', p_sort integer default 0)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_upsert_row(
  p_model_id, p_key, p_label, p_unit, p_formula, p_given, p_label_ar, p_note, p_sort); $w$;

create or replace function public.delete_modeling_row_command(p_model_id uuid, p_key text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_delete_row(p_model_id, p_key); $w$;

create or replace function public.upsert_modeling_scenario_command(
  p_model_id uuid, p_key text, p_name text, p_base_key text default null,
  p_name_ar text default null, p_note text default '', p_sort integer default 0)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_upsert_scenario(
  p_model_id, p_key, p_name, p_base_key, p_name_ar, p_note, p_sort); $w$;

create or replace function public.delete_modeling_scenario_command(
  p_model_id uuid, p_key text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_delete_scenario(p_model_id, p_key); $w$;

create or replace function public.set_modeling_override_command(
  p_model_id uuid, p_scenario_key text, p_assumption_key text,
  p_value double precision, p_note text default '')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_set_override(
  p_model_id, p_scenario_key, p_assumption_key, p_value, p_note); $w$;

create or replace function public.clear_modeling_override_command(
  p_model_id uuid, p_scenario_key text, p_assumption_key text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_clear_override(p_model_id, p_scenario_key, p_assumption_key); $w$;

create or replace function public.record_modeling_certificate_command(
  p_model_id uuid, p_scenario_key text, p_target_key text, p_target_kind text,
  p_target_period integer, p_grade text, p_results_hash text, p_full_hash text,
  p_passed integer, p_warned integer, p_failed integer, p_unmeasured integer,
  p_checks jsonb, p_limitations text[] default '{}')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $w$ select private.modeling_record_certificate(
  p_model_id, p_scenario_key, p_target_key, p_target_kind, p_target_period,
  p_grade, p_results_hash, p_full_hash,
  p_passed, p_warned, p_failed, p_unmeasured, p_checks, p_limitations); $w$;

-- ============================================================================
-- L. Grants.
--
--    The default on a newly created function is EXECUTE to PUBLIC, and PUBLIC here
--    includes anon. A SECURITY DEFINER function left in that state is not a leak in
--    one table's policy, it is an unauthenticated read of every model in every
--    agency -- the definer bit means the policies do not run, and the guards inside
--    are the only thing standing there. So every signature is revoked outright and
--    then granted back to authenticated only, by name, in a loop that fails loudly
--    if a name is wrong rather than silently leaving one function open.
-- ============================================================================

do $grants$
declare
  v_fn text;
  -- The three predicates are the exception, and the exception is not a softening of
  -- the rule -- it is the rule read properly. A CHECK constraint's expression is
  -- evaluated as the user doing the INSERT, so EXECUTE on the function inside it is
  -- checked then, on that user. Revoked, every direct PostgREST insert into these
  -- tables fails with "permission denied for function modeling_key_ok" -- a refusal
  -- about privileges for what is actually a valid row, which is the least debuggable
  -- kind of error to ship. Inserts through the commands would keep working, because
  -- a definer body runs as the owner, and that difference is exactly what would make
  -- the bug survive testing.
  --
  -- Granting them away costs nothing that matters: none of the three is SECURITY
  -- DEFINER, none touches a table, and all a caller learns is what the reserved-word
  -- list is and whether a float is finite. The revoke rule exists because a definer
  -- body bypasses RLS. These bypass nothing.
  v_preds text[] := array[
    'private.modeling_key_ok(text)',
    'private.modeling_finite(double precision)',
    'private.modeling_finite_series(double precision[])'
  ];
  v_fns text[] := array[
    'public.get_modeling_spec(uuid)',
    'public.get_modeling_overview()',
    'public.get_modeling_certificates(uuid, integer)',
    'public.create_modeling_model_command(text, text, text[], text, text)',
    'public.update_modeling_model_command(uuid, text, text[], text, text)',
    'public.publish_modeling_model_command(uuid, text)',
    'public.revise_modeling_model_command(uuid)',
    'public.archive_modeling_model_command(uuid, boolean)',
    'public.upsert_modeling_assumption_command(uuid, text, text, text, double precision, double precision, double precision, text, text, integer)',
    'public.delete_modeling_assumption_command(uuid, text)',
    'public.upsert_modeling_row_command(uuid, text, text, text, text, double precision[], text, text, integer)',
    'public.delete_modeling_row_command(uuid, text)',
    'public.upsert_modeling_scenario_command(uuid, text, text, text, text, text, integer)',
    'public.delete_modeling_scenario_command(uuid, text)',
    'public.set_modeling_override_command(uuid, text, text, double precision, text)',
    'public.clear_modeling_override_command(uuid, text, text)',
    'public.record_modeling_certificate_command(uuid, text, text, text, integer, text, text, text, integer, integer, integer, integer, jsonb, text[])'
  ];
begin
  foreach v_fn in array v_fns loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array v_preds loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$grants$;

-- ============================================================================
-- M. The assertions.
--
--    Everything above is DDL, and DDL that ran is not the same as DDL that did what
--    it said. A trigger created inside a format() with a typo'd table name is a
--    successful migration and an unenforced rule. So the file ends by looking, in the
--    catalogue, for the four things it would be worst to be wrong about:
--
--      the five guards exist, attached to the tables they were written for;
--      the certificate ledger has no policy that can write to it;
--      row level security is on for all six tables, not five;
--      no private body is executable by a logged-in user.
--
--    Each one raises. A migration that notices its own failure and continues is a
--    migration that has taught you to ignore its output.
-- ============================================================================

do $assert$
declare
  v_pair   text[];
  v_pairs  text[][] := array[
    array['modeling_rows',        'trg_modeling_rows_namespace'],
    array['modeling_assumptions', 'trg_modeling_assumptions_namespace'],
    array['modeling_rows',        'trg_modeling_rows_series'],
    array['modeling_models',      'trg_modeling_models_horizon'],
    array['modeling_scenarios',   'trg_modeling_scenarios_chain']
  ];
  v_tbl    text;
  v_tables text[] := array[
    'modeling_models','modeling_assumptions','modeling_rows',
    'modeling_scenarios','modeling_overrides','modeling_certificates'
  ];
  v_bad    text;
  v_open   text;
begin
  foreach v_pair slice 1 in array v_pairs loop
    if not exists (
      select 1 from pg_trigger tg
       where tg.tgrelid = ('public.' || v_pair[1])::regclass
         and tg.tgname  = v_pair[2]
         and not tg.tgisinternal) then
      raise exception 'guard % is missing from public.%; the rule it enforces is not enforced',
        v_pair[2], v_pair[1];
    end if;
  end loop;

  select string_agg(p.polname, ', ')
    into v_bad
    from pg_policy p
   where p.polrelid = 'public.modeling_certificates'::regclass
     and p.polcmd <> 'r';
  if v_bad is not null then
    raise exception
      'public.modeling_certificates has writable policies (%); the ledger is not append-only', v_bad;
  end if;

  foreach v_tbl in array v_tables loop
    if not (select c.relrowsecurity from pg_class c
             where c.oid = ('public.' || v_tbl)::regclass) then
      raise exception 'row level security is off for public.%', v_tbl;
    end if;
  end loop;

  -- prosecdef, not every private function. The three CHECK predicates are executable
  -- by authenticated on purpose and explained in section L; what must never be
  -- reachable is a body that runs as the owner, because that is the one that does not
  -- consult a policy.
  select string_agg(p.proname, ', ')
    into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname like 'modeling%'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_open is not null then
    raise exception
      'private definer functions are executable by authenticated (%); the wrappers are bypassable',
      v_open;
  end if;
end;
$assert$;

select 'modeling engine vertical slice installed' as status;
