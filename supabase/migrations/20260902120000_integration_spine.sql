-- ============================================================================
-- The integration spine.
--
-- Twelve applications in this suite already share a database, a scope function and
-- an audit trail. What they do not share is a subject. A quote becomes a booking
-- becomes a document becomes a journal entry becomes a number in a model becomes a
-- plan becomes an approval becomes a payment, and today every one of those arrows
-- is a person remembering. `shell.launch` can open the next app with arguments and
-- `ipc.publish` can shout at whoever is listening, but neither survives a refresh
-- and neither leaves a trace, so nothing in the system can answer the two questions
-- integration is actually for:
--
--   what is waiting on me, from anywhere?
--   and how did this booking get to be a payment?
--
-- This file is the answer to both, and it is deliberately not a message bus. A bus
-- delivers and forgets; the interesting part of a cross-application flow is the part
-- that is still open, who it is open against, and what it was that moved. So a
-- handoff here is a row with a state, not an event with a subscriber:
--
--   spine_chains          one flow, from the stage it started in to the stage it is in
--   spine_handoffs        one edge of that flow: from_stage -> to_stage, with a status
--   spine_handoff_events  every transition, append-only, including the refusals
--
-- Three properties are worth naming because they are what makes this a spine rather
-- than a second task table.
--
-- It is *checked*. A handoff points at a subject -- a quote, a document, a model --
-- and `subject_type`/`subject_id` cannot be a foreign key because it points at
-- twenty-five different tables. The DMS solved this in
-- `20260831120000_dms_vertical_slice.sql` with a trigger that resolves the type to a
-- table and confirms the row exists; section A does the same thing with one
-- improvement, described there: a single list, consulted by both the CHECK constraint
-- and the trigger, rather than two lists that have to be kept in agreement by hand.
--
-- It is *replayable*. `spine_handoff_events` never updates and never deletes, and
-- section E enforces that with a trigger rather than only with the absence of a
-- policy, because a SECURITY DEFINER body does not consult policies at all.
--
-- It *cannot ring*. A chain is a tree of handoffs by `parent_id`, and a cycle in it
-- would be a flow that is its own predecessor -- readable in the UI as an inbox item
-- that can never be closed. Section E walks the ancestry on write and refuses with
-- 23514, in the same idiom as the modelling engine's scenario-inheritance guard.
--
-- No new syscall and no new capability. Every read here is a function the broker can
-- expose as a dataset and every write is a named command, which is the architecture
-- `src/platform/kernel/core/broker.ts` already chose: applications cannot widen their
-- own reach, so a spine that needed a new door would be a spine built in the wrong
-- place.
-- ============================================================================

-- ============================================================================
-- A. The stage vocabulary, and the subject resolver.
--
--    Two closed lists, each written exactly once, because both of them are consulted
--    from two places -- a CHECK constraint and a PL/pgSQL body -- and a list that
--    exists twice is a list that will disagree with itself.
--
--    The stages are the twelve the platform actually has, in flow order. They are not
--    an enum: adding a stage to a type used by four columns rewrites all four tables,
--    and a text column with a predicate lets a later migration widen the vocabulary
--    with one function replacement. The order is not encoded anywhere and is not
--    enforced -- a flow may skip stages, and CRM handing straight to ACCOUNTING for a
--    prepayment is a real flow, not a violation. What is enforced is that both ends
--    of a handoff are stages that exist.
--
--    The subject list is longer and its shape is different: each name maps to a table
--    and a key column. `spine_subject_target` returns both, as a two-element array,
--    and returns NULL for a name it does not know. That single return is what lets the
--    CHECK constraint be `... is not null` instead of a second copy of the list.
-- ============================================================================

create schema if not exists private;

-- A.1  The twelve stages.
--
--      Named for the subsystem, not the verb, because the verb is what `intent`
--      carries. "APPROVAL" is where a decision is made; whether that decision is
--      approve, reject or escalate is the handoff's business.
create or replace function private.spine_stage_ok(p_stage text)
returns boolean
language sql
immutable
as $fn$
  select p_stage is not null and p_stage in (
    'CRM', 'OPERATIONS', 'DMS', 'ACCOUNTING', 'BI', 'MODELING',
    'PLANNING', 'SIMULATION', 'DECISION', 'APPROVAL', 'EXECUTION', 'AUDIT');
$fn$;

-- A.2  What a handoff can be about: `{table, key_column}`, or NULL.
--
--      Twenty-five nouns, one per thing a person in this suite hands to another
--      person. The DMS's equivalent trigger carries seventeen of them in a `case` and
--      the same seventeen again in a CHECK constraint, and that duplication is the one
--      thing worth doing differently here: a name added to the constraint but not the
--      case is accepted by the constraint and then rejected by the trigger with
--      "Unknown ... subject_type", which reads like a bug in the caller rather than an
--      unfinished migration. With the list here, the constraint is
--      `spine_subject_target(subject_type) is not null` and there is nothing to keep
--      in step.
--
--      The key column is part of the answer because it is not always `id`.
--      `staff_profiles` is keyed on `user_id` and has no `id` column at all, so a
--      resolver that assumed one would raise 42703 on every handoff assigned to a
--      person. That was learned in the DMS slice; it is recorded here rather than
--      rediscovered.
--
--      IMMUTABLE and free of any table reference on purpose. It answers "is this a
--      name I know", not "does this row exist" -- the second question needs the row's
--      agency and belongs in the trigger in section E, where it can be asked with the
--      scope predicate alongside it.
create or replace function private.spine_subject_target(p_type text)
returns text[]
language sql
immutable
as $fn$
  select case p_type
    -- Operations: the things a pilgrim's journey is made of.
    when 'pilgrim'            then array['pilgrims', 'id']
    when 'booking'            then array['bookings', 'id']
    when 'group'              then array['groups', 'id']
    when 'package'            then array['packages', 'id']
    when 'visa'               then array['visas', 'id']
    when 'external_operation' then array['external_operations', 'id']
    -- CRM: the pipeline, and the work recorded against it.
    when 'crm_customer'       then array['crm_customers', 'id']
    when 'crm_opportunity'    then array['crm_opportunities', 'id']
    when 'crm_quote'          then array['crm_quotes', 'id']
    when 'crm_activity'       then array['crm_activities', 'id']
    when 'crm_campaign'       then array['crm_campaigns', 'id']
    -- Accounting: money owed, money moved, and the entry that says so.
    when 'invoice'            then array['invoices', 'id']
    when 'payment'            then array['payments', 'id']
    when 'supplier'           then array['suppliers', 'id']
    when 'supplier_bill'      then array['supplier_bills', 'id']
    when 'journal_entry'      then array['journal_entries', 'id']
    when 'bank_transaction'   then array['bank_transactions', 'id']
    -- Contracts and documents.
    when 'contract'           then array['contracts', 'id']
    when 'hotel_contract'     then array['hotel_contracts', 'id']
    when 'dms_document'       then array['dms_documents', 'id']
    -- Close, plan, model, dashboard: the four things a period is judged by.
    when 'close_task'         then array['close_tasks', 'id']
    when 'fiscal_period'      then array['fiscal_periods', 'id']
    when 'modeling_model'     then array['modeling_models', 'id']
    when 'bi_dashboard'       then array['bi_dashboards', 'id']
    -- A person. Keyed on user_id, which is the whole reason this returns a pair.
    when 'staff_profile'      then array['staff_profiles', 'user_id']
  end;
$fn$;

revoke all on function private.spine_stage_ok(text) from public, anon;
revoke all on function private.spine_subject_target(text) from public, anon;

-- ============================================================================
-- B. The chain.
--
--    One flow, and the only row in this file a person would name out loud: "the
--    Ramadan group's quote", "the March close". Everything else here is an edge or an
--    event on one of those.
--
--    `current_stage` is derived -- it is the `to_stage` of the most recently completed
--    handoff, or `origin_stage` when nothing has completed yet -- and it is stored
--    anyway, maintained by a trigger in section E rather than by the commands. Two
--    reasons. A list of forty chains would otherwise need a lateral window over every
--    handoff to render its most important column, and more importantly, derived state
--    that any of five commands may move is derived state that will eventually be moved
--    by four of them. A trigger cannot be forgotten by a sixth command written later.
--
--    `status` is narrow on purpose. A chain is OPEN, or it reached its end (CLOSED), or
--    somebody gave up on it (ABANDONED). It is not "in progress" or "blocked": those
--    are properties of the handoff that is open right now, and duplicating them here
--    would create two answers to one question.
-- ============================================================================

create table if not exists public.spine_chains (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id(),
  branch_id     uuid,
  title         text not null,
  title_ar      text,
  -- What the whole flow is about. A chain always has a subject; a flow with nothing
  -- at the centre of it is a to-do list, and this suite has one of those already.
  subject_type  text not null,
  subject_id    uuid not null,
  origin_stage  text not null,
  current_stage text not null,
  status        text not null default 'OPEN',
  priority      text not null default 'NORMAL',
  opened_by     uuid default auth.uid(),
  opened_at     timestamptz not null default now(),
  closed_by     uuid,
  closed_at     timestamptz,
  closed_note   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint spine_chains_title_present check (btrim(title) <> ''),
  constraint spine_chains_subject_known
    check (private.spine_subject_target(subject_type) is not null),
  constraint spine_chains_origin_stage_known check (private.spine_stage_ok(origin_stage)),
  constraint spine_chains_current_stage_known check (private.spine_stage_ok(current_stage)),
  constraint spine_chains_status_known check (status in ('OPEN', 'CLOSED', 'ABANDONED')),
  constraint spine_chains_priority_known
    check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  -- A closed chain knows when it closed, and an open one has not. Half a closure --
  -- a timestamp with the status still OPEN -- is the state that makes a queue lie.
  constraint spine_chains_closure_consistent
    check ((status = 'OPEN') = (closed_at is null))
);

create index if not exists idx_spine_chains_scope   on public.spine_chains(agency_id, branch_id);
create index if not exists idx_spine_chains_subject on public.spine_chains(subject_type, subject_id);
create index if not exists idx_spine_chains_open
  on public.spine_chains(agency_id, current_stage) where status = 'OPEN';

-- ============================================================================
-- C. The handoff.
--
--    One edge: this stage is done with the subject and that stage is being asked for
--    something. It is the row the Inbox renders, so every column here has to be
--    answerable by somebody who has never seen the chain -- who is asking, for what,
--    about what, and how long it has been sitting there.
--
--    `intent` is a closed list of ten and that number is the design. An open text
--    field would be a second title, and a list per stage would be a hundred labels to
--    translate; ten kinds of ask cover every arrow in the platform because the asks
--    genuinely repeat -- ACCOUNTING asking DMS to REVIEW an invoice is the same shape
--    of request as OPERATIONS asking DMS to REVIEW a visa. The stages say where, the
--    intent says what kind, `note` says the rest.
--
--    `assigned_role` is nullable, and null means "whoever holds the permission". That
--    is not laziness: a handoff addressed to a role nobody currently holds is a
--    handoff nobody will ever see, and for most flows the role that should act is
--    already implied by the destination stage's permissions. Naming a role is for the
--    cases where it is genuinely narrower than that.
--
--    `payload` is the deep link -- what `shell.launch` hands the destination app so it
--    opens on the right record rather than on its own front page. It is constrained to
--    a JSON object because `LaunchArgs` is `Record<string, string>` on the other side,
--    and an array arriving there would be spread into arguments named 0, 1, 2.
-- ============================================================================

-- C.1  The seven roles this platform has.
--
--      `staff_profiles.role` is free text and `staff_role()` returns it unchecked, so
--      this predicate is the only place that says which values are real. A handoff
--      addressed to 'FINANACE' would otherwise insert cleanly and then sit in a queue
--      that no login can ever match.
create or replace function private.spine_role_ok(p_role text)
returns boolean
language sql
immutable
as $fn$
  select p_role is null or p_role in (
    'ADMIN', 'FINANCE', 'OPERATIONS_MANAGER', 'CRM', 'AGENT', 'VISA_AGENT', 'GUIDE');
$fn$;

revoke all on function private.spine_role_ok(text) from public, anon;

create table if not exists public.spine_handoffs (
  id            uuid primary key default gen_random_uuid(),
  chain_id      uuid not null references public.spine_chains(id) on delete cascade,
  -- The handoff this one answers. Null for the first edge of a chain, and for any
  -- edge opened alongside another rather than after it -- a chain is a tree, because
  -- ACCOUNTING and DMS can both be asked at once and neither waits for the other.
  parent_id     uuid references public.spine_handoffs(id) on delete set null,
  seq           integer not null,
  agency_id     uuid not null default public.current_staff_agency_id(),
  branch_id     uuid,
  from_stage    text not null,
  to_stage      text not null,
  intent        text not null,
  -- Usually the chain's subject, sometimes narrower: a chain about a booking whose
  -- ACCOUNTING edge is about one invoice of it.
  subject_type  text not null,
  subject_id    uuid not null,
  title         text not null,
  title_ar      text,
  note          text not null default '',
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'OPEN',
  assigned_role text,
  assigned_to   uuid,
  due_on        date,
  opened_by     uuid default auth.uid(),
  opened_at     timestamptz not null default now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decided_note  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint spine_handoffs_seq_positive check (seq > 0),
  constraint spine_handoffs_seq_unique unique (chain_id, seq),
  constraint spine_handoffs_title_present check (btrim(title) <> ''),
  constraint spine_handoffs_from_known check (private.spine_stage_ok(from_stage)),
  constraint spine_handoffs_to_known check (private.spine_stage_ok(to_stage)),
  -- A handoff from a stage to itself is not a handoff. Within-stage variety is what
  -- `intent` is for; an edge that crosses nothing would make `current_stage` stand
  -- still while the chain looked like it moved.
  constraint spine_handoffs_crosses check (from_stage <> to_stage),
  constraint spine_handoffs_intent_known
    check (intent in ('REVIEW', 'APPROVE', 'RECORD', 'FULFIL', 'INVESTIGATE',
                      'CERTIFY', 'PUBLISH', 'SETTLE', 'ESCALATE', 'INFORM')),
  constraint spine_handoffs_subject_known
    check (private.spine_subject_target(subject_type) is not null),
  constraint spine_handoffs_status_known
    check (status in ('OPEN', 'ACCEPTED', 'DONE', 'DECLINED', 'SUPERSEDED')),
  constraint spine_handoffs_role_known check (private.spine_role_ok(assigned_role)),
  constraint spine_handoffs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint spine_handoffs_not_self_parent check (parent_id is null or parent_id <> id),
  -- Decided means finished, in either direction. OPEN and ACCEPTED are the two states
  -- that are still somebody's problem, and neither carries a decision timestamp.
  constraint spine_handoffs_decision_consistent
    check ((status in ('OPEN', 'ACCEPTED')) = (decided_at is null))
);

create index if not exists idx_spine_handoffs_chain   on public.spine_handoffs(chain_id, seq);
create index if not exists idx_spine_handoffs_parent  on public.spine_handoffs(parent_id);
create index if not exists idx_spine_handoffs_subject on public.spine_handoffs(subject_type, subject_id);
create index if not exists idx_spine_handoffs_scope   on public.spine_handoffs(agency_id, branch_id);
-- The Inbox's only query: what is still open, oldest first, for a given stage.
create index if not exists idx_spine_handoffs_queue
  on public.spine_handoffs(agency_id, to_stage, opened_at)
  where status in ('OPEN', 'ACCEPTED');

-- ============================================================================
-- D. The event ledger.
--
--    Every transition, including the ones that ended a handoff badly. This is what
--    makes the question "how did this booking become a payment?" answerable six months
--    later, and it is why the spine stores state rather than publishing messages: the
--    current status of a handoff is one row, and how it got there is this table.
--
--    Append-only, and enforced twice -- no writable policy beyond insert, and a trigger
--    in section E that refuses UPDATE and DELETE outright. The trigger is not
--    redundant. Policies do not run inside a SECURITY DEFINER body, and every write in
--    this file happens inside one, so the policy alone would protect the ledger from
--    exactly the callers that were never going to touch it.
--
--    It cascades with its handoff, which is the same choice `dms_document_events` made
--    and it deserves stating rather than inheriting: this ledger is the history of a
--    live flow, not the permanent record. The permanent record is `audit_logs`, written
--    by `write_audit_log()` on every insert, update and delete of the two tables above,
--    including the delete that would empty this one.
-- ============================================================================

create table if not exists public.spine_handoff_events (
  id          uuid primary key default gen_random_uuid(),
  handoff_id  uuid not null references public.spine_handoffs(id) on delete cascade,
  -- Denormalised from the handoff so that a chain's whole history is one index scan
  -- rather than a join back through every edge of it.
  chain_id    uuid not null references public.spine_chains(id) on delete cascade,
  agency_id   uuid not null default public.current_staff_agency_id(),
  branch_id   uuid,
  action      text not null,
  from_status text,
  to_status   text,
  -- The actor as both identities, because neither is sufficient alone: `auth.uid()`
  -- is what the row is scoped by and the e-mail is what a person reads. The Inbox
  -- prints the uid only when it has nothing better.
  actor       uuid default auth.uid(),
  actor_email text,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now(),

  constraint spine_events_action_known
    check (action in ('OPENED', 'ACCEPTED', 'COMPLETED', 'DECLINED',
                      'SUPERSEDED', 'REASSIGNED', 'NOTED')),
  constraint spine_events_detail_object check (jsonb_typeof(detail) = 'object')
);

create index if not exists idx_spine_events_handoff on public.spine_handoff_events(handoff_id, at);
create index if not exists idx_spine_events_chain   on public.spine_handoff_events(chain_id, at);
create index if not exists idx_spine_events_scope   on public.spine_handoff_events(agency_id, branch_id);

-- ============================================================================
-- E. The guards a CHECK cannot express.
--
--    Five rules that need another row to evaluate, which is what puts them here
--    instead of in a constraint. Each raises, and each raises the SQLSTATE the client
--    already knows how to read: 23503 for a subject that does not exist, 23514 for a
--    ring, 22023 for a transition the state machine refuses.
-- ============================================================================

-- E.1  The subject exists, and it is ours.
--
--      `subject_type`/`subject_id` is a polymorphic pair and cannot be a foreign key,
--      so this is the foreign key -- resolve the type to a table through the one list
--      in section A, then look. Two differences from `dms_check_link_target()`, which
--      is the function this is modelled on, and both are deliberate:
--
--      It fires AFTER, not BEFORE. `trg_stamp_staff_scope` is what fills `agency_id`
--      when there is no session -- a seed, a replay -- and trigger order is
--      alphabetical, which puts a `trg_spine_*` name ahead of `trg_stamp_*`. A BEFORE
--      trigger here would read a null agency and refuse every row in exactly the
--      context where the data is being loaded. Raising from an AFTER trigger aborts
--      the statement just as effectively.
--
--      It checks the agency, where the DMS checked only existence. A handoff pointing
--      at another agency's booking is a cross-tenant reference, and the refusal is
--      spelled the same as "no such row" on purpose: telling the caller that the id
--      exists but belongs to someone else turns this trigger into a way to enumerate
--      other agencies' primary keys. When the target table has no `agency_id` column
--      at all, or this row has none to compare against, the weaker existence check is
--      what is available and what is done.
create or replace function private.spine_check_subject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_target text[];
  v_reg    regclass;
  v_scoped boolean;
  v_ok     boolean;
begin
  v_target := private.spine_subject_target(new.subject_type);
  if v_target is null then
    -- Unreachable through the CHECK constraint, which consults the same list. Kept
    -- because a constraint dropped by a later migration should not silently turn this
    -- into a no-op.
    raise exception 'Unknown spine subject_type %', new.subject_type using errcode = '22023';
  end if;

  -- A target table this ledger has not created yet is a reason to skip the check, not
  -- to refuse the handoff: the constraint already limits the type to a known name, and
  -- a replay must not depend on migration order here.
  v_reg := to_regclass('public.' || v_target[1]);
  if v_reg is null then
    return null;
  end if;

  select exists (
    select 1 from pg_attribute a
     where a.attrelid = v_reg and a.attname = 'agency_id'
       and a.attnum > 0 and not a.attisdropped)
    into v_scoped;

  if v_scoped and new.agency_id is not null then
    execute format(
      'select exists (select 1 from public.%I t where t.%I = $1 and t.agency_id = $2)',
      v_target[1], v_target[2])
      into v_ok using new.subject_id, new.agency_id;
  else
    execute format('select exists (select 1 from public.%I t where t.%I = $1)',
      v_target[1], v_target[2])
      into v_ok using new.subject_id;
  end if;

  if not v_ok then
    raise exception 'No % row with id % is available here', new.subject_type, new.subject_id
      using errcode = '23503';
  end if;

  -- AFTER trigger: the return value is discarded either way.
  return null;
end;
$fn$;

revoke all on function private.spine_check_subject() from public, anon, authenticated;

drop trigger if exists trg_spine_chains_subject on public.spine_chains;
create trigger trg_spine_chains_subject
  after insert or update of subject_type, subject_id on public.spine_chains
  for each row execute function private.spine_check_subject();

drop trigger if exists trg_spine_handoffs_subject on public.spine_handoffs;
create trigger trg_spine_handoffs_subject
  after insert or update of subject_type, subject_id on public.spine_handoffs
  for each row execute function private.spine_check_subject();

-- E.2  A chain is a tree, and a tree has no rings.
--
--      `parent_id` is what makes the chain readable as a flow rather than a bag of
--      edges, and it is also the one column here that can express something incoherent:
--      a handoff descended from itself. In the UI that is an inbox row whose "what came
--      before this" walk never terminates, which is a hang rather than an error
--      message.
--
--      Two rules, both needing another row. The parent must be in the same chain --
--      otherwise "the history of this chain" silently reaches into another one -- and
--      the ancestry must terminate. The walk has a depth cap as well as a self test,
--      because a cap is what turns a corrupted ancestry into a refusal instead of a
--      session that spins until it is killed.
--
--      On INSERT the self test cannot fire: `new.id` is a fresh uuid that no existing
--      row can point at. It is written for UPDATE, which is where re-parenting happens
--      and where a ring is actually reachable.
create or replace function private.spine_guard_ancestry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain  uuid;
  v_cursor uuid;
  v_depth  integer := 0;
  v_max    constant integer := 32;
begin
  if new.parent_id is null then
    return new;
  end if;

  select h.chain_id into v_chain from public.spine_handoffs h where h.id = new.parent_id;
  if not found then
    raise exception 'The parent handoff % does not exist', new.parent_id using errcode = '23503';
  end if;
  if v_chain <> new.chain_id then
    raise exception 'A handoff and its parent must belong to the same chain'
      using errcode = '23514';
  end if;

  v_cursor := new.parent_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'That parent would make the handoff its own ancestor'
        using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > v_max then
      raise exception 'Handoff ancestry is deeper than % steps; the chain is malformed', v_max
        using errcode = '23514';
    end if;
    select h.parent_id into v_cursor from public.spine_handoffs h where h.id = v_cursor;
  end loop;

  return new;
end;
$fn$;

revoke all on function private.spine_guard_ancestry() from public, anon, authenticated;

drop trigger if exists trg_spine_handoffs_ancestry on public.spine_handoffs;
create trigger trg_spine_handoffs_ancestry
  before insert or update of parent_id, chain_id on public.spine_handoffs
  for each row execute function private.spine_guard_ancestry();

-- E.3  The status machine, written once.
--
--      `spine_handoffs_status_known` says which words are statuses. It does not say
--      which word may follow which, and without that a handoff can go from DONE back
--      to OPEN, which makes the event ledger a record of something that did not happen.
--
--      The successors live in one immutable function rather than in five commands,
--      for the reason section B gives about derived state: a machine encoded in the
--      commands is a machine that gets a sixth command and only four of the rules.
--
--      OPEN -> DONE is allowed on purpose. ACCEPTED means "I have this and it will take
--      a while"; requiring it before DONE would make every INFORM handoff a two-click
--      formality, and a step nobody needs is a step people learn to click without
--      reading. DONE, DECLINED and SUPERSEDED are terminal: the way to reopen a
--      question is a new handoff, which is also the only way the ledger can show that
--      it was asked twice.
create or replace function private.spine_status_next(p_status text)
returns text[]
language sql
immutable
as $fn$
  select case p_status
    when 'OPEN'       then array['ACCEPTED', 'DONE', 'DECLINED', 'SUPERSEDED']
    when 'ACCEPTED'   then array['DONE', 'DECLINED', 'SUPERSEDED']
    when 'DONE'       then array[]::text[]
    when 'DECLINED'   then array[]::text[]
    when 'SUPERSEDED' then array[]::text[]
    else null
  end;
$fn$;

revoke all on function private.spine_status_next(text) from public, anon;

create or replace function private.spine_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_next text[];
begin
  if new.status = old.status then
    return new;
  end if;

  v_next := private.spine_status_next(old.status);
  if v_next is null or not (new.status = any (v_next)) then
    raise exception 'A handoff cannot go from % to %', old.status, new.status
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

revoke all on function private.spine_guard_status() from public, anon, authenticated;

drop trigger if exists trg_spine_handoffs_status on public.spine_handoffs;
create trigger trg_spine_handoffs_status
  before update of status on public.spine_handoffs
  for each row execute function private.spine_guard_status();

-- E.4  Where the flow is now.
--
--      `spine_chains.current_stage` is derived, and section B says why it is stored
--      anyway. This is the trigger that keeps the promise: no command writes that
--      column, so no command can forget to.
--
--      The preference order is deliberate. A chain sits at the stage that owes
--      something -- the `to_stage` of its newest live handoff -- because that is the
--      answer to "who is this waiting on", which is the question the inbox asks. With
--      nothing live it sits at the last stage that finished something, which is the
--      answer to "how far did this get". With no handoffs at all it sits where it
--      started. Three cases, so the function is total; `origin_stage` is not null, so
--      the coalesce cannot fall through.
--
--      Ordering is by `seq`, not by time. `seq` is unique per chain and is the order
--      the chain is read in; two handoffs opened in the same millisecond would make an
--      `opened_at` ordering arbitrary, and an arbitrary answer here is a stage that
--      flickers between two values on replay.
--
--      A chain being deleted cascades to its handoffs, and this trigger then updates a
--      chain row that is already gone. Nothing is written and nothing raises, which is
--      the behaviour wanted: the alternative is a guard that exists only to say the
--      update matched no rows.
create or replace function private.spine_sync_chain_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain uuid := coalesce(new.chain_id, old.chain_id);
  v_stage text;
begin
  if v_chain is null then
    return null;
  end if;

  select coalesce(
      (select h.to_stage from public.spine_handoffs h
        where h.chain_id = v_chain and h.status in ('OPEN', 'ACCEPTED')
        order by h.seq desc limit 1),
      (select h.to_stage from public.spine_handoffs h
        where h.chain_id = v_chain and h.status = 'DONE'
        order by h.seq desc limit 1),
      c.origin_stage)
    into v_stage
    from public.spine_chains c
   where c.id = v_chain;

  if v_stage is null then
    return null;
  end if;

  update public.spine_chains c
     set current_stage = v_stage
   where c.id = v_chain
     and c.current_stage <> v_stage;

  return null;
end;
$fn$;

revoke all on function private.spine_sync_chain_stage() from public, anon, authenticated;

drop trigger if exists trg_spine_handoffs_stage on public.spine_handoffs;
create trigger trg_spine_handoffs_stage
  after insert or delete or update of status, to_stage, seq on public.spine_handoffs
  for each row execute function private.spine_sync_chain_stage();

-- E.5  The event ledger is append-only, and that is enforced here rather than in a
--      policy.
--
--      Section F will give `spine_handoff_events` an insert policy and no update or
--      delete policy, which stops a client. It does not stop the commands in section H,
--      because a SECURITY DEFINER body does not consult policies at all. An append-only
--      table whose append-only-ness lives in RLS is append-only for everyone except the
--      code most able to rewrite it.
--
--      UPDATE is refused outright. There is no state of an event row that makes editing
--      it correct: an event says a thing happened at a time, and if that is wrong the
--      repair is another event.
--
--      DELETE is refused unless the thing the event is about has itself gone. A cascade
--      from `spine_handoffs` or `spine_chains` fires this trigger after the parent row
--      is already deleted, so "is my parent still there" separates a cascade from a
--      client deleting history and keeping the flow. It is not a proxy for the cascade;
--      it is the actual rule -- an event may only leave with its subject.
--
--      `audit_logs` still records whatever does get deleted, which is why this table can
--      afford to be the history of a live flow rather than the permanent record.
--
--      The errcode is 42501 and not 22023: no state of the row makes the edit
--      acceptable, so this is a statement about what may be done, not about when.
create or replace function private.spine_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_orphan boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'spine_handoff_events is append-only; record a new event instead'
      using errcode = '42501';
  end if;

  select not exists (select 1 from public.spine_handoffs h where h.id = old.handoff_id)
      or not exists (select 1 from public.spine_chains c where c.id = old.chain_id)
    into v_orphan;

  if not v_orphan then
    raise exception 'An event cannot be deleted while its handoff still exists'
      using errcode = '42501';
  end if;

  return old;
end;
$fn$;

revoke all on function private.spine_events_append_only() from public, anon, authenticated;

drop trigger if exists trg_spine_events_append_only on public.spine_handoff_events;
create trigger trg_spine_events_append_only
  before update or delete on public.spine_handoff_events
  for each row execute function private.spine_events_append_only();

-- F.  Row level security, in four verbs, plus the two triggers every table in this
--     ledger carries.
--
--     The shape is the one the rest of the schema uses: a permission check on the
--     resource named after the table, and a scope check on (agency_id, branch_id).
--     Both have to hold. A role with the permission but the wrong agency sees nothing,
--     and a role in the right agency without the permission sees nothing, and neither
--     case produces an error -- it produces an empty list, which is what a policy is
--     for.
--
--     `spine_handoff_events` is the exception and gets select and insert only. Section
--     E.5 explains why the append-only rule is not left to this list.
do $rls$
declare
  t text;
begin
  foreach t in array array['spine_chains', 'spine_handoffs', 'spine_handoff_events'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);

    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);

    execute format('revoke all on public.%I from anon', t);
  end loop;

  foreach t in array array['spine_chains', 'spine_handoffs'] loop
    execute format('drop policy if exists staff_update on public.%I', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id)) with check (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id))', t, t, t);

    execute format('drop policy if exists staff_delete on public.%I', t);
    execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and public.row_in_staff_scope(agency_id, branch_id))', t, t);
  end loop;
end
$rls$;

-- F.2  The three triggers that make a table part of this ledger rather than a table that
--      happens to live next to it: the scope stamp, the updated_at touch, and the audit
--      write.
--
--      Each is guarded on the function existing. A migration that runs against a
--      database where `write_audit_log` has not been created yet should install the
--      spine and skip the audit trigger, not refuse the whole file -- the same argument
--      section E.1 makes about a subject table that does not exist yet. The guard is on
--      the helper, not on the table, because the table is created above.
--
--      `spine_handoff_events` gets no updated_at trigger because it has no updated_at
--      column, which is section E.5's rule expressed in the shape of the table.
do $trg$
declare
  t text;
begin
  foreach t in array array['spine_chains', 'spine_handoffs', 'spine_handoff_events'] loop
    if to_regproc('public.stamp_staff_scope') is not null then
      execute format('drop trigger if exists trg_stamp_staff_scope on public.%I', t);
      execute format('create trigger trg_stamp_staff_scope before insert on public.%I for each row execute function public.stamp_staff_scope()', t);
    end if;

    if to_regproc('public.write_audit_log') is not null then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()', 'trg_audit_' || t, t);
    end if;
  end loop;

  if to_regproc('public.update_updated_at_column') is not null then
    foreach t in array array['spine_chains', 'spine_handoffs'] loop
      execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
      execute format('create trigger trg_touch_updated_at before update on public.%I for each row execute function public.update_updated_at_column()', t);
    end loop;
  end if;
end
$trg$;

-- G.  Permissions, seeded wider than anything else in this schema, and on purpose.
--
--     has_permission() returns true for ADMIN and otherwise looks the role up in
--     staff_permissions. A resource nobody has seeded is therefore ADMIN-only --
--     silently, and with policies that all look correct. Every other subsystem here
--     seeds two or three roles and lets that silence do the rest. The spine cannot.
--
--     A handoff exists to reach a stage that is not the one it came from, so every role
--     that staffs any stage has to be able to see one addressed to it and answer it.
--     A GUIDE who cannot select `spine_handoffs` has an inbox that is permanently empty
--     and no way to find out why; a VISA_AGENT who cannot update one can read the
--     request and not accept it. That is not a locked-down spine, it is a spine that
--     only ADMIN can use, which is a spine nobody will use. So read, create and update
--     go to all six non-ADMIN roles.
--
--     Delete is left unseeded, which makes it ADMIN-only. That is the same silence
--     described above, chosen this time and written down so it does not read as an
--     omission: a chain is a record of how a decision travelled, and the way to end one
--     is `close_spine_chain_command`, which leaves it readable. Deleting it takes the
--     handoffs and their events with it.
--
--     `spine_handoff_events` is seeded for read and create only. Section F gives it no
--     update or delete policy, so seeding those verbs would grant a permission that
--     cannot be exercised, and a seed that lists verbs the table does not support reads
--     as though the table supports them.
do $seed$
declare
  v_role   text;
  v_target text;
  v_action text;
begin
  if to_regclass('public.staff_permissions') is null then
    raise notice 'staff_permissions is absent; spine permissions were not seeded';
    return;
  end if;

  foreach v_role in array array['FINANCE', 'OPERATIONS_MANAGER', 'CRM', 'AGENT', 'VISA_AGENT', 'GUIDE'] loop
    foreach v_target in array array['spine_chains', 'spine_handoffs', 'spine_handoff_events'] loop
      foreach v_action in array array['read', 'create', 'update'] loop
        if v_target = 'spine_handoff_events' and v_action = 'update' then
          continue;
        end if;
        insert into public.staff_permissions (role, resource, action)
        values (v_role, v_target, v_action)
        on conflict (role, resource, action) do nothing;
      end loop;
    end loop;
  end loop;
end
$seed$;

-- H.  The commands.
--
--     Every write to this ledger goes through one of six SECURITY DEFINER functions.
--     That is not a preference about style: `stamp_staff_scope` fills agency and branch
--     from the session, the status machine in E.3 only sees transitions that arrive as
--     UPDATEs, and `seq` has to be allocated against the rest of the chain. A client
--     assembling those three things itself would be a client that can get any of them
--     wrong.
--
--     Each command refuses in the same order, and the order is the point: permission,
--     then existence and scope together, then state. A role with no business here is
--     told that and nothing else. Existence and scope are collapsed into one refusal
--     with the same code, because answering "that chain exists but is not yours"
--     differently from "no such chain" turns these functions into a way to enumerate
--     another agency's primary keys. State comes last, because a message about a closed
--     chain is only useful to somebody allowed to see that the chain is there.

-- H.1  Guard once, return the row.
--
--      Both guards hand back the row they checked. A guard that returns nothing is a
--      guard whose caller selects the row again, and the second select is the one that
--      forgets the scope predicate.
create or replace function private.spine_guard_chain(
  p_chain_id uuid,
  p_action text,
  p_require_open boolean default false)
returns public.spine_chains
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain public.spine_chains;
begin
  if not public.has_permission('spine_chains', p_action) then
    raise exception 'Your role cannot % a spine chain', p_action using errcode = '42501';
  end if;

  select c.* into v_chain
    from public.spine_chains c
   where c.id = p_chain_id
     and public.row_in_staff_scope(c.agency_id, c.branch_id);

  if not found then
    raise exception 'No spine chain % is available here', p_chain_id using errcode = '42501';
  end if;

  if p_require_open and v_chain.status <> 'OPEN' then
    raise exception 'Spine chain % is % and cannot take further work', p_chain_id, v_chain.status
      using errcode = '22023';
  end if;

  return v_chain;
end;
$fn$;

create or replace function private.spine_guard_handoff(
  p_handoff_id uuid,
  p_action text,
  p_require_live boolean default false)
returns public.spine_handoffs
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_handoff public.spine_handoffs;
begin
  if not public.has_permission('spine_handoffs', p_action) then
    raise exception 'Your role cannot % a handoff', p_action using errcode = '42501';
  end if;

  select h.* into v_handoff
    from public.spine_handoffs h
   where h.id = p_handoff_id
     and public.row_in_staff_scope(h.agency_id, h.branch_id);

  if not found then
    raise exception 'No handoff % is available here', p_handoff_id using errcode = '42501';
  end if;

  if p_require_live and v_handoff.status not in ('OPEN', 'ACCEPTED') then
    raise exception 'Handoff % is already %', p_handoff_id, v_handoff.status
      using errcode = '22023';
  end if;

  return v_handoff;
end;
$fn$;

-- H.2  Who did it, and the one place an event is written.
--
--      `actor_email` is denormalised into the event row on purpose. An event is read
--      months later, and resolving the uid then means joining `auth.users`, which a
--      client cannot do and which stops answering once the account is removed. The
--      email is what the row is for: it says who, in the form a person recognises.
create or replace function private.spine_actor_email()
returns text
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce((select u.email from auth.users u where u.id = auth.uid()), '');
$fn$;

create or replace function private.spine_log_event(
  p_handoff public.spine_handoffs,
  p_action text,
  p_from text,
  p_to text,
  p_detail jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id uuid;
begin
  insert into public.spine_handoff_events (
    handoff_id, chain_id, agency_id, branch_id,
    action, from_status, to_status, actor, actor_email, detail)
  values (
    p_handoff.id, p_handoff.chain_id, p_handoff.agency_id, p_handoff.branch_id,
    p_action, p_from, p_to, auth.uid(), private.spine_actor_email(),
    case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end)
  returning id into v_id;

  return v_id;
end;
$fn$;

-- H.3  Open a chain.
--
--      A chain needs a subject before it needs anything else -- "how did this booking
--      become a payment" is a question about a booking -- so the subject is checked by
--      the trigger in E.1 on the way in, and a name that resolves to no row is refused
--      here rather than discovered by the first person to open the chain in the inbox.
--
--      `current_stage` is set to `origin_stage` and then immediately becomes the
--      trigger's business. Section E.4 owns that column from this point on.
create or replace function private.spine_open_chain(
  p_title text,
  p_subject_type text,
  p_subject_id uuid,
  p_origin_stage text,
  p_title_ar text default null,
  p_priority text default 'NORMAL')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain public.spine_chains;
begin
  if not public.has_permission('spine_chains', 'create') then
    raise exception 'Your role cannot open a spine chain' using errcode = '42501';
  end if;

  insert into public.spine_chains (
    title, title_ar, subject_type, subject_id, origin_stage, current_stage, priority)
  values (
    btrim(p_title), nullif(btrim(coalesce(p_title_ar, '')), ''),
    p_subject_type, p_subject_id, p_origin_stage, p_origin_stage,
    coalesce(nullif(btrim(p_priority), ''), 'NORMAL'))
  returning * into v_chain;

  return to_jsonb(v_chain);
end;
$fn$;

-- H.4  Open a handoff.
--
--      The subject defaults to the chain's. Most handoffs are about the thing the chain
--      is about, and making the caller repeat it is making the caller able to get it
--      wrong -- a handoff whose subject drifts from its chain's is a chain that reads
--      like two flows spliced together.
--
--      `seq` is allocated here as max + 1 within the chain, under the unique constraint
--      from section C. Two callers opening a handoff on the same chain in the same
--      instant will collide and one will be refused, which is the correct outcome: the
--      alternative is a sequence with a gap or a duplicate, and both make the chain
--      unreadable in the order it happened.
create or replace function private.spine_open_handoff(
  p_chain_id uuid,
  p_from_stage text,
  p_to_stage text,
  p_intent text,
  p_title text,
  p_title_ar text default null,
  p_note text default '',
  p_assigned_role text default null,
  p_assigned_to uuid default null,
  p_due_on date default null,
  p_parent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_subject_type text default null,
  p_subject_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain   public.spine_chains;
  v_handoff public.spine_handoffs;
  v_seq     integer;
begin
  v_chain := private.spine_guard_chain(p_chain_id, 'read', true);

  if not public.has_permission('spine_handoffs', 'create') then
    raise exception 'Your role cannot open a handoff' using errcode = '42501';
  end if;

  select coalesce(max(h.seq), 0) + 1 into v_seq
    from public.spine_handoffs h where h.chain_id = p_chain_id;

  insert into public.spine_handoffs (
    chain_id, parent_id, seq, from_stage, to_stage, intent,
    subject_type, subject_id, title, title_ar, note,
    payload, assigned_role, assigned_to, due_on)
  values (
    p_chain_id, p_parent_id, v_seq, p_from_stage, p_to_stage, p_intent,
    coalesce(p_subject_type, v_chain.subject_type),
    coalesce(p_subject_id, v_chain.subject_id),
    btrim(p_title), nullif(btrim(coalesce(p_title_ar, '')), ''),
    coalesce(btrim(p_note), ''),
    case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end,
    nullif(btrim(coalesce(p_assigned_role, '')), ''), p_assigned_to, p_due_on)
  returning * into v_handoff;

  perform private.spine_log_event(v_handoff, 'OPENED', null, 'OPEN',
    jsonb_build_object('intent', p_intent, 'to_stage', p_to_stage));

  return to_jsonb(v_handoff);
end;
$fn$;

-- H.5  Accept: take ownership without answering yet.
--
--      Accepting writes `assigned_to` if nothing was addressed to a person, which is
--      what turns "whoever holds the permission" into "this one". Without that, two
--      people work the same request and find out afterwards.
create or replace function private.spine_accept_handoff(p_handoff_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_handoff public.spine_handoffs;
begin
  v_handoff := private.spine_guard_handoff(p_handoff_id, 'update', true);

  if v_handoff.status <> 'OPEN' then
    raise exception 'Handoff % has already been accepted', p_handoff_id using errcode = '22023';
  end if;

  update public.spine_handoffs h
     set status = 'ACCEPTED',
         assigned_to = coalesce(h.assigned_to, auth.uid())
   where h.id = p_handoff_id
  returning * into v_handoff;

  perform private.spine_log_event(v_handoff, 'ACCEPTED', 'OPEN', 'ACCEPTED',
    jsonb_build_object('note', coalesce(btrim(p_note), '')));

  return to_jsonb(v_handoff);
end;
$fn$;

-- H.6  Complete: the stage did the thing it was asked for.
create or replace function private.spine_complete_handoff(p_handoff_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_handoff public.spine_handoffs;
  v_from    text;
begin
  v_handoff := private.spine_guard_handoff(p_handoff_id, 'update', true);
  v_from := v_handoff.status;

  update public.spine_handoffs h
     set status = 'DONE',
         decided_by = auth.uid(),
         decided_at = now(),
         decided_note = coalesce(btrim(p_note), '')
   where h.id = p_handoff_id
  returning * into v_handoff;

  perform private.spine_log_event(v_handoff, 'COMPLETED', v_from, 'DONE',
    jsonb_build_object('note', coalesce(btrim(p_note), '')));

  return to_jsonb(v_handoff);
end;
$fn$;

-- H.7  Decline: the stage will not do it, and says why.
--
--      The reason is required. A declined handoff is the one row in this ledger that
--      leaves somebody else with a problem and no next step, and "DECLINED" on its own
--      does not tell them whether to fix something and ask again or to route the work
--      somewhere else. Every other note here is optional; this one is the message.
create or replace function private.spine_decline_handoff(p_handoff_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_handoff public.spine_handoffs;
  v_from    text;
  v_note    text := btrim(coalesce(p_note, ''));
begin
  v_handoff := private.spine_guard_handoff(p_handoff_id, 'update', true);

  if v_note = '' then
    raise exception 'Declining a handoff needs a reason' using errcode = '22023';
  end if;

  v_from := v_handoff.status;

  update public.spine_handoffs h
     set status = 'DECLINED',
         decided_by = auth.uid(),
         decided_at = now(),
         decided_note = v_note
   where h.id = p_handoff_id
  returning * into v_handoff;

  perform private.spine_log_event(v_handoff, 'DECLINED', v_from, 'DECLINED',
    jsonb_build_object('note', v_note));

  return to_jsonb(v_handoff);
end;
$fn$;

-- H.8  Close a chain, or abandon it.
--
--      Two words because there are two endings, and collapsing them loses the one piece
--      of information a reader wants from a chain that stopped: whether it finished.
--
--      CLOSED refuses while anything is still live. A closed chain with open handoffs is
--      inbox rows pointing at a flow nobody is watching, which is the failure this whole
--      migration exists to prevent -- so the refusal names the count rather than saying
--      no.
--
--      ABANDONED is the honest way out of that. It supersedes what is left, one event
--      per handoff, so the rows leave the queue and the ledger still says they were
--      asked. SUPERSEDED is exactly this state: asked, never answered, no longer
--      expected.
create or replace function private.spine_close_chain(
  p_chain_id uuid,
  p_status text default 'CLOSED',
  p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain  public.spine_chains;
  v_status text := upper(btrim(coalesce(p_status, 'CLOSED')));
  v_live   integer;
  v_row    public.spine_handoffs;
begin
  v_chain := private.spine_guard_chain(p_chain_id, 'update', true);

  if v_status not in ('CLOSED', 'ABANDONED') then
    raise exception 'A chain closes as CLOSED or ABANDONED, not %', v_status
      using errcode = '22023';
  end if;

  select count(*) into v_live
    from public.spine_handoffs h
   where h.chain_id = p_chain_id and h.status in ('OPEN', 'ACCEPTED');

  if v_status = 'CLOSED' and v_live > 0 then
    raise exception '% handoffs on this chain are still open; answer them or abandon the chain', v_live
      using errcode = '22023';
  end if;

  if v_live > 0 then
    for v_row in
      update public.spine_handoffs h
         set status = 'SUPERSEDED',
             decided_by = auth.uid(),
             decided_at = now(),
             decided_note = 'The chain was abandoned'
       where h.chain_id = p_chain_id and h.status in ('OPEN', 'ACCEPTED')
      returning *
    loop
      perform private.spine_log_event(v_row, 'SUPERSEDED', null, 'SUPERSEDED',
        jsonb_build_object('reason', 'chain abandoned'));
    end loop;
  end if;

  update public.spine_chains c
     set status = v_status,
         closed_by = auth.uid(),
         closed_at = now(),
         closed_note = coalesce(btrim(p_note), '')
   where c.id = p_chain_id
  returning * into v_chain;

  return to_jsonb(v_chain);
end;
$fn$;

-- I.  The read models.
--
--     These are SECURITY DEFINER like everything else here, which means the policies in
--     section F do not apply to them. So each one checks the permission itself and
--     carries the scope predicate in its WHERE clause. A definer read that leans on RLS
--     is a definer read that returns every agency's rows, and it looks correct right up
--     to the day a second agency exists.
--
--     Each returns one jsonb value: an array of flat objects where the client wants a
--     list, a single object where it wants a document. The broker's `asRows` and
--     `asDocumentRows` are on the other side of that choice, so it is made once here
--     rather than reshaped in TypeScript.

-- I.1  What is waiting on me, from anywhere.
--
--      `mine` is computed here and not in the client because it depends on
--      `staff_role()`, which is a session fact the browser does not have. Three ways for
--      a handoff to be mine: addressed to me by uid, addressed to my role and not yet
--      taken by anyone, or addressed to nobody in particular -- the "whoever holds the
--      permission" case from section C, which is mine because I am looking at it.
create or replace function private.spine_inbox(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_rows jsonb;
  v_role text := public.staff_role();
  v_uid  uuid := auth.uid();
begin
  if not public.has_permission('spine_handoffs', 'read') then
    raise exception 'Your role cannot read handoffs' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.opened_at, t.seq), '[]'::jsonb)
    into v_rows
    from (
      select h.id, h.chain_id, h.seq, h.parent_id,
             h.from_stage, h.to_stage, h.intent, h.status,
             h.subject_type, h.subject_id,
             h.title, h.title_ar, h.note, h.payload,
             h.assigned_role, h.assigned_to, h.due_on,
             h.opened_by, h.opened_at, h.decided_by, h.decided_at, h.decided_note,
             c.title as chain_title, c.title_ar as chain_title_ar,
             c.status as chain_status, c.priority as chain_priority,
             c.current_stage as chain_stage, c.origin_stage as chain_origin,
             (h.assigned_to = v_uid
               or (h.assigned_to is null and h.assigned_role = v_role)
               or (h.assigned_to is null and h.assigned_role is null)) as mine
        from public.spine_handoffs h
        join public.spine_chains c on c.id = h.chain_id
       where h.status in ('OPEN', 'ACCEPTED')
         and public.row_in_staff_scope(h.agency_id, h.branch_id)
       order by h.opened_at, h.seq
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) t;

  return v_rows;
end;
$fn$;

-- I.2  One chain, whole.
--
--      The handoffs come back in `seq` order and the events in time order, and both are
--      nested inside the one document rather than returned as three lists the client has
--      to join. The join is the part that has an ordering rule; doing it here means the
--      rule is written once, in the same file as the sequence that makes it meaningful.
--
--      The guard is `spine_guard_chain(..., 'read')`, so a chain in another agency and a
--      chain that does not exist produce the same refusal. Section H says why.
create or replace function private.spine_chain(p_chain_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_chain    public.spine_chains;
  v_handoffs jsonb;
  v_events   jsonb;
begin
  v_chain := private.spine_guard_chain(p_chain_id, 'read');

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.seq), '[]'::jsonb)
    into v_handoffs
    from (
      select h.id, h.chain_id, h.seq, h.parent_id,
             h.from_stage, h.to_stage, h.intent, h.status,
             h.subject_type, h.subject_id,
             h.title, h.title_ar, h.note, h.payload,
             h.assigned_role, h.assigned_to, h.due_on,
             h.opened_by, h.opened_at, h.decided_by, h.decided_at, h.decided_note
        from public.spine_handoffs h
       where h.chain_id = p_chain_id
       order by h.seq
    ) t;

  select coalesce(jsonb_agg(row_to_json(e)::jsonb order by e.at, e.id), '[]'::jsonb)
    into v_events
    from (
      select ev.id, ev.handoff_id, ev.action,
             ev.from_status, ev.to_status,
             ev.actor, ev.actor_email, ev.detail, ev.at
        from public.spine_handoff_events ev
       where ev.chain_id = p_chain_id
       order by ev.at, ev.id
    ) e;

  return jsonb_build_object(
    'chain', to_jsonb(v_chain),
    'handoffs', v_handoffs,
    'events', v_events);
end;
$fn$;

-- I.3  The shape of the whole board.
--
--      Counts by stage and by status, plus the chains that are still open. This is the
--      one read that exists for a dashboard rather than for a queue, so it answers "where
--      does work pile up" instead of "what is waiting on me".
--
--      `by_stage` counts the destination of live handoffs, because a stage's backlog is
--      the work addressed to it, not the work it has sent elsewhere. The two numbers
--      differ most exactly where a flow is stuck, which is the reason to look at all.
create or replace function private.spine_overview(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_by_stage  jsonb;
  v_by_status jsonb;
  v_chains    jsonb;
  v_oldest    timestamptz;
begin
  if not public.has_permission('spine_chains', 'read') then
    raise exception 'Your role cannot read spine chains' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(t.to_stage, t.n), '{}'::jsonb)
    into v_by_stage
    from (
      select h.to_stage, count(*) as n
        from public.spine_handoffs h
       where h.status in ('OPEN', 'ACCEPTED')
         and public.row_in_staff_scope(h.agency_id, h.branch_id)
       group by h.to_stage
    ) t;

  select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb)
    into v_by_status
    from (
      select h.status, count(*) as n
        from public.spine_handoffs h
       where public.row_in_staff_scope(h.agency_id, h.branch_id)
       group by h.status
    ) t;

  select min(h.opened_at) into v_oldest
    from public.spine_handoffs h
   where h.status in ('OPEN', 'ACCEPTED')
     and public.row_in_staff_scope(h.agency_id, h.branch_id);

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.opened_at desc), '[]'::jsonb)
    into v_chains
    from (
      select c.id, c.title, c.title_ar, c.status, c.priority,
             c.subject_type, c.subject_id,
             c.origin_stage, c.current_stage,
             c.opened_by, c.opened_at, c.closed_at, c.closed_note,
             (select count(*) from public.spine_handoffs h where h.chain_id = c.id) as steps,
             (select count(*) from public.spine_handoffs h
               where h.chain_id = c.id and h.status in ('OPEN', 'ACCEPTED')) as live
        from public.spine_chains c
       where public.row_in_staff_scope(c.agency_id, c.branch_id)
       order by c.opened_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) t;

  return jsonb_build_object(
    'byStage', v_by_stage,
    'byStatus', v_by_status,
    'oldestOpenAt', v_oldest,
    'chains', v_chains);
end;
$fn$;

-- J.  The public surface: nine one-line wrappers.
--
--     Every one is `select private.<body>(...)`, and that is the whole of it. The bodies
--     hold the argument names and defaults a client sees, which is to say PostgREST's
--     payload shape is decided in this section and nowhere else. A default moved from a
--     wrapper into a body would be a default the client cannot discover.
--
--     They are SECURITY DEFINER because section K revokes the private bodies from
--     `authenticated`. An INVOKER wrapper would compile, install, and then refuse every
--     call with "permission denied for function private.spine_open_chain" -- which reads
--     like a grant that was forgotten rather than a boundary that was drawn.

create or replace function public.open_spine_chain_command(
  p_title text,
  p_subject_type text,
  p_subject_id uuid,
  p_origin_stage text,
  p_title_ar text default null,
  p_priority text default 'NORMAL')
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_open_chain(
    p_title, p_subject_type, p_subject_id, p_origin_stage, p_title_ar, p_priority);
$w$;

create or replace function public.open_spine_handoff_command(
  p_chain_id uuid,
  p_from_stage text,
  p_to_stage text,
  p_intent text,
  p_title text,
  p_title_ar text default null,
  p_note text default '',
  p_assigned_role text default null,
  p_assigned_to uuid default null,
  p_due_on date default null,
  p_parent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_subject_type text default null,
  p_subject_id uuid default null)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_open_handoff(
    p_chain_id, p_from_stage, p_to_stage, p_intent, p_title, p_title_ar, p_note,
    p_assigned_role, p_assigned_to, p_due_on, p_parent_id, p_payload,
    p_subject_type, p_subject_id);
$w$;

create or replace function public.accept_spine_handoff_command(
  p_handoff_id uuid,
  p_note text default '')
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_accept_handoff(p_handoff_id, p_note);
$w$;

create or replace function public.complete_spine_handoff_command(
  p_handoff_id uuid,
  p_note text default '')
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_complete_handoff(p_handoff_id, p_note);
$w$;

-- No default on `p_note`. Section H.7 makes the argument; this is where a client finds
-- out about it, because PostgREST refuses the call before the body can explain itself.
create or replace function public.decline_spine_handoff_command(
  p_handoff_id uuid,
  p_note text)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_decline_handoff(p_handoff_id, p_note);
$w$;

create or replace function public.close_spine_chain_command(
  p_chain_id uuid,
  p_status text default 'CLOSED',
  p_note text default '')
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_close_chain(p_chain_id, p_status, p_note);
$w$;

create or replace function public.get_spine_inbox(p_limit integer default 200)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_inbox(p_limit);
$w$;

create or replace function public.get_spine_chain(p_chain_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_chain(p_chain_id);
$w$;

create or replace function public.get_spine_overview(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $w$
  select private.spine_overview(p_limit);
$w$;

-- K.  Grants.
--
--     A newly created function is EXECUTE to PUBLIC, and PUBLIC includes anon. Left
--     that way, a SECURITY DEFINER read here is not a hole in one policy -- it is an
--     unauthenticated list of every open handoff in every agency, because the definer
--     bit means section F never runs and the `has_permission` line inside the body is
--     the only thing standing there. So every signature is revoked outright and then
--     granted back by name, in a loop where a wrong name fails the migration instead
--     of quietly leaving one function open.
--
--     Three lists, because there are three different reasons to be reachable.

do $grants$
declare
  v_fn text;

  -- The bodies. Nothing outside this file calls them, and after this loop nothing
  -- outside this file can. Section J's wrappers reach them the only way left: as the
  -- owner, from inside a definer body.
  v_bodies text[] := array[
    'private.spine_guard_chain(uuid, text, boolean)',
    'private.spine_guard_handoff(uuid, text, boolean)',
    'private.spine_actor_email()',
    'private.spine_log_event(public.spine_handoffs, text, text, text, jsonb)',
    'private.spine_open_chain(text, text, uuid, text, text, text)',
    'private.spine_open_handoff(uuid, text, text, text, text, text, text, text, uuid, date, uuid, jsonb, text, uuid)',
    'private.spine_accept_handoff(uuid, text)',
    'private.spine_complete_handoff(uuid, text)',
    'private.spine_decline_handoff(uuid, text)',
    'private.spine_close_chain(uuid, text, text)',
    'private.spine_inbox(integer)',
    'private.spine_chain(uuid)',
    'private.spine_overview(integer)'
  ];

  -- The three predicates that live inside CHECK constraints, and the exception is not
  -- a softening of the rule -- it is the rule read properly. A CHECK expression is
  -- evaluated as the user doing the INSERT, so EXECUTE on the function inside it is
  -- checked then, against that user. Revoked, a direct PostgREST insert into
  -- spine_chains fails with "permission denied for function spine_stage_ok": a refusal
  -- about privileges for what is actually a valid row. Inserts through section J would
  -- keep working, because a definer body runs as the owner -- and that difference is
  -- exactly what would let the bug survive testing.
  --
  -- Granting them away costs nothing that matters. None is SECURITY DEFINER, none
  -- touches a table, and all a caller learns is which twelve stage names and which
  -- twenty-five subject names this file knows about. The revoke rule exists because a
  -- definer body bypasses RLS; these bypass nothing.
  v_preds text[] := array[
    'private.spine_stage_ok(text)',
    'private.spine_subject_target(text)',
    'private.spine_role_ok(text)'
  ];

  -- The surface. Nine names, and this is the whole of what a browser may call.
  v_fns text[] := array[
    'public.open_spine_chain_command(text, text, uuid, text, text, text)',
    'public.open_spine_handoff_command(uuid, text, text, text, text, text, text, text, uuid, date, uuid, jsonb, text, uuid)',
    'public.accept_spine_handoff_command(uuid, text)',
    'public.complete_spine_handoff_command(uuid, text)',
    'public.decline_spine_handoff_command(uuid, text)',
    'public.close_spine_chain_command(uuid, text, text)',
    'public.get_spine_inbox(integer)',
    'public.get_spine_chain(uuid)',
    'public.get_spine_overview(integer)'
  ];
begin
  foreach v_fn in array v_bodies loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;

  foreach v_fn in array v_preds loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array v_fns loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$grants$;

-- L.  The assertions.
--
--     Everything above is DDL, and DDL that ran is not DDL that did what it said. Six of
--     these triggers and all five policies were created inside format(), where a typo in
--     a table name is a successful migration and an unenforced rule. So the file ends by
--     going to the catalogue and looking.
--
--     Two blocks, because there are two kinds of thing to be wrong about. The first is
--     structural: the guards exist, attached to the tables they were written for, and the
--     index the Inbox reads through is there. The second is access: the ledger has no
--     writable policy, RLS is on for three tables rather than two, no private definer
--     body is reachable by a logged-in user, and -- the mirror of that, and the failure
--     nobody thinks to check -- all nine wrappers still are.
--
--     Each raises. A migration that notices its own failure and carries on is a migration
--     that has taught you to ignore its output.

do $structure$
declare
  v_pair  text[];
  v_pairs text[][] := array[
    array['spine_chains',        'trg_spine_chains_subject'],
    array['spine_handoffs',      'trg_spine_handoffs_subject'],
    array['spine_handoffs',      'trg_spine_handoffs_ancestry'],
    array['spine_handoffs',      'trg_spine_handoffs_status'],
    array['spine_handoffs',      'trg_spine_handoffs_stage'],
    array['spine_handoff_events','trg_spine_events_append_only']
  ];
  v_tbl text;
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

  -- Section F.2's triggers are conditional on the helper existing, so the assertion is
  -- conditional on the same thing. What it catches is the case the guard cannot: the
  -- helper was there, the format() ran, and the trigger still is not on the table.
  if to_regproc('public.stamp_staff_scope') is not null then
    foreach v_tbl in array array['spine_chains', 'spine_handoffs', 'spine_handoff_events'] loop
      if not exists (
        select 1 from pg_trigger tg
         where tg.tgrelid = ('public.' || v_tbl)::regclass
           and tg.tgname  = 'trg_stamp_staff_scope'
           and not tg.tgisinternal) then
        raise exception 'public.% has no scope stamp; agency_id would be whatever the client sent', v_tbl;
      end if;
    end loop;
  end if;

  if to_regproc('public.write_audit_log') is not null then
    foreach v_tbl in array array['spine_chains', 'spine_handoffs', 'spine_handoff_events'] loop
      if not exists (
        select 1 from pg_trigger tg
         where tg.tgrelid = ('public.' || v_tbl)::regclass
           and tg.tgname  = 'trg_audit_' || v_tbl
           and not tg.tgisinternal) then
        raise exception 'public.% is not audited; a cross-application flow with no audit trail is the one thing this file exists to prevent', v_tbl;
      end if;
    end loop;
  end if;

  -- Named, not inferred from the column list. An index on the same three columns without
  -- the WHERE clause would satisfy a looser check and would still make the Inbox scan
  -- every handoff this agency has ever closed.
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'idx_spine_handoffs_queue'
       and c.relkind = 'i') then
    raise exception 'idx_spine_handoffs_queue is missing; the Inbox query has no index behind it';
  end if;
end;
$structure$;

do $access$
declare
  v_tbl   text;
  v_tables text[] := array['spine_chains', 'spine_handoffs', 'spine_handoff_events'];
  v_fn    text;
  v_bad   text;
  v_open  text;
  v_shut  text[] := '{}';
begin
  select string_agg(p.polname, ', ')
    into v_bad
    from pg_policy p
   where p.polrelid = 'public.spine_handoff_events'::regclass
     and p.polcmd not in ('r', 'a');
  if v_bad is not null then
    raise exception
      'public.spine_handoff_events has policies that can rewrite history (%); the ledger is not append-only', v_bad;
  end if;

  foreach v_tbl in array v_tables loop
    if not (select c.relrowsecurity from pg_class c
             where c.oid = ('public.' || v_tbl)::regclass) then
      raise exception 'row level security is off for public.%', v_tbl;
    end if;
  end loop;

  -- prosecdef, not every private function. The three CHECK predicates are executable by
  -- authenticated on purpose and section K argues it at length; what must never be
  -- reachable is a body that runs as the owner, because that is the one that does not
  -- consult a policy.
  select string_agg(p.proname, ', ')
    into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname like 'spine%'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_open is not null then
    raise exception
      'private definer functions are executable by authenticated (%); the wrappers are bypassable',
      v_open;
  end if;

  -- And the mirror. A revoke that ran with a grant that did not is nine functions the
  -- browser cannot call, an app that fails on its first click, and a migration that
  -- reported success. to_regprocedure first, because has_function_privilege raises on a
  -- signature it cannot resolve and "function does not exist" is the more useful message.
  foreach v_fn in array array[
    'public.open_spine_chain_command(text, text, uuid, text, text, text)',
    'public.open_spine_handoff_command(uuid, text, text, text, text, text, text, text, uuid, date, uuid, jsonb, text, uuid)',
    'public.accept_spine_handoff_command(uuid, text)',
    'public.complete_spine_handoff_command(uuid, text)',
    'public.decline_spine_handoff_command(uuid, text)',
    'public.close_spine_chain_command(uuid, text, text)',
    'public.get_spine_inbox(integer)',
    'public.get_spine_chain(uuid)',
    'public.get_spine_overview(integer)',
    'private.spine_stage_ok(text)',
    'private.spine_subject_target(text)',
    'private.spine_role_ok(text)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'the migration installed no function %', v_fn;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute') then
      v_shut := v_shut || v_fn;
    end if;
  end loop;

  if array_length(v_shut, 1) is not null then
    raise exception 'authenticated cannot execute %; section K revoked and did not grant back',
      array_to_string(v_shut, ', ');
  end if;
end;
$access$;

select 'integration spine installed' as status;
