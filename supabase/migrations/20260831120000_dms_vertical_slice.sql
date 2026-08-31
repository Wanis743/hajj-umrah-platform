-- 20260831120000_dms_vertical_slice.sql
-- Gap-analysis item 2: document management as a complete vertical slice.
--
--   upload -> version -> extraction -> review -> approval -> expiry
--           -> relationships -> evidence -> audit
--
-- 20260822000013_dms_integration created five tables and stopped there: no UI
-- references them, no command names them, and nothing in the repo can put a byte
-- into one. That migration is exactly the shape item 10 objects to, so this file
-- finishes it rather than adding a sixth table beside it.
--
-- Five defects in those five tables are closed on the way, and each one is a
-- reason the schema could not have been used as delivered:
--
--   1. agency_id is nullable with a DEFAULT. current_staff_agency_id() returns
--      NULL for a session with no active staff profile, so an insert from such a
--      session wrote a row with agency_id IS NULL -- and `agency_id = f()` is
--      then NULL for every reader, including the writer. The row is invisible,
--      undeletable through the API, and still counted by any aggregate that does
--      not filter. Made NOT NULL here.
--
--   2. Every UPDATE policy has USING and no WITH CHECK. Postgres checks USING
--      against the old row and WITH CHECK against the new one; with WITH CHECK
--      absent it defaults to the USING expression... for tables, but the
--      asymmetry that matters is that agency_id itself is writable, so a staff
--      member could set agency_id to another agency and hand the row away.
--      Replaced with scope-checked policies on both sides.
--
--   3. The policies ask only `agency_id = current_staff_agency_id()`. Every other
--      tenant table in this ledger uses row_in_staff_scope(agency_id, branch_id)
--      and gates the verb on has_permission(...). There is no branch_id column at
--      all, so a branch-scoped clerk saw the whole agency. Added, and the
--      policies rewritten to the house predicate.
--
--   4. dms_document_versions has no unique constraint on (document_id,
--      version_number) and version_number is supplied by the caller, so "version
--      3" could exist twice and the latest version was whatever sort order the
--      reader happened to use. Assigned server-side now, and unique.
--
--   5. A version row records a storage_path and nothing else: no size, no mime
--      type, no checksum. There was no way to tell a truncated upload from a
--      complete one, or to notice that the bytes behind an approved document had
--      been replaced. The upload is a two-step reserve/finalize with a checksum,
--      and the storage policies key on the reserved row.
--
-- Conventions taken from 20260830120000_crm_vertical_slice (table + RLS + audit
-- shape, command naming, analytics), 20260609204800_storage_bucket_canonical_documents
-- (a storage policy that keys on a domain row) and 20260830140000 (guards that
-- are total).

-- ============================================================================
-- A. Make the 20260822000013 tables usable: tenancy, then constraints.
-- ============================================================================

-- A NULL agency_id is unreachable through RLS, so a row holding one cannot be
-- repaired through the API either. Refuse rather than guess which agency it
-- belonged to.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['dms_documents','dms_document_versions','evidence_packages',
                           'evidence_package_documents','extraction_jobs'] loop
    execute format('select count(*) from public.%I where agency_id is null', t) into n;
    if n > 0 then
      raise exception 'public.% holds % row(s) with a null agency_id; assign an agency before replaying this migration', t, n
        using errcode = '22023';
    end if;
  end loop;
end $$;

-- branch_id first, because stamp_staff_scope() assigns new.branch_id
-- unconditionally: attaching that trigger to a table without the column raises
-- 42703 on every insert. Existing rows inherit the agency's HQ branch, which is
-- what the stamp would have given them.
do $$
declare
  t text;
begin
  foreach t in array array['dms_documents','dms_document_versions','evidence_packages',
                           'evidence_package_documents','extraction_jobs'] loop
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
  end loop;
end $$;

-- workspace_id is NOT NULL with no default, no FK and no check: every caller had
-- to invent a value and no two callers would have agreed. It stays -- dropping a
-- column is not reversible and something outside this repo may read it -- but it
-- defaults now, so a command does not have to name it.
alter table public.dms_documents    alter column workspace_id set default 'DEFAULT';
alter table public.evidence_packages alter column workspace_id set default 'DEFAULT';

-- ============================================================================
-- B. dms_documents: the lifecycle the table was missing.
--
--    document_status ('draft','active','archived') is a publication state, not a
--    review state, and it cannot answer "who approved this and when". Rather
--    than extend the enum -- alter type ... add value cannot be used in the same
--    transaction that reads the new label -- review_status is a text column with
--    a check, which is what every crm_* table in 20260830120000 uses.
--
--    The machine, enforced in section L and asserted in supabase/tests:
--      DRAFT -> PENDING_REVIEW -> UNDER_REVIEW -> APPROVED | REJECTED
--                                             -> CHANGES_REQUESTED -> DRAFT
--      APPROVED -> EXPIRED   (only from APPROVED, only by the expiry sweep)
--      APPROVED -> SUPERSEDED
-- ============================================================================

alter table public.dms_documents
  add column if not exists document_number   text,
  add column if not exists description       text,
  add column if not exists review_status     text not null default 'DRAFT',
  add column if not exists confidentiality   text not null default 'INTERNAL',
  add column if not exists tags              text[] not null default '{}',
  add column if not exists current_version_id uuid,
  add column if not exists version_count     integer not null default 0,
  add column if not exists submitted_at      timestamptz,
  add column if not exists submitted_by      uuid references auth.users(id),
  add column if not exists review_started_at timestamptz,
  add column if not exists reviewer_id       uuid references auth.users(id),
  add column if not exists reviewed_at       timestamptz,
  add column if not exists review_notes      text,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by       uuid references auth.users(id),
  add column if not exists rejection_reason  text,
  add column if not exists issued_on         date,
  add column if not exists expires_on        date,
  add column if not exists expiry_notice_days integer not null default 30,
  add column if not exists expiry_notified_at timestamptz,
  add column if not exists retention_until   date,
  add column if not exists archived_at       timestamptz,
  add column if not exists updated_by        uuid references auth.users(id);

-- Constraints go on separately: `add constraint if not exists` does not exist,
-- and a bare `add constraint` fails a replay against a database that already
-- carries it. Drop-then-add is the idiom the rest of the ledger uses.
alter table public.dms_documents drop constraint if exists dms_documents_review_status_check;
alter table public.dms_documents add constraint dms_documents_review_status_check
  check (review_status in ('DRAFT','PENDING_REVIEW','UNDER_REVIEW','APPROVED',
                           'REJECTED','CHANGES_REQUESTED','EXPIRED','SUPERSEDED'));

alter table public.dms_documents drop constraint if exists dms_documents_confidentiality_check;
alter table public.dms_documents add constraint dms_documents_confidentiality_check
  check (confidentiality in ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED'));

alter table public.dms_documents drop constraint if exists dms_documents_title_present;
alter table public.dms_documents add constraint dms_documents_title_present
  check (length(trim(title)) > 0);

-- An approved document that cannot say who approved it is not evidence of
-- anything. Same for a rejection with no reason.
alter table public.dms_documents drop constraint if exists dms_documents_approval_attributed;
alter table public.dms_documents add constraint dms_documents_approval_attributed
  check (review_status <> 'APPROVED' or (approved_at is not null and approved_by is not null));

alter table public.dms_documents drop constraint if exists dms_documents_rejection_explained;
alter table public.dms_documents add constraint dms_documents_rejection_explained
  check (review_status <> 'REJECTED' or length(trim(coalesce(rejection_reason,''))) > 0);

alter table public.dms_documents drop constraint if exists dms_documents_expiry_after_issue;
alter table public.dms_documents add constraint dms_documents_expiry_after_issue
  check (issued_on is null or expires_on is null or expires_on >= issued_on);

alter table public.dms_documents drop constraint if exists dms_documents_notice_days_sane;
alter table public.dms_documents add constraint dms_documents_notice_days_sane
  check (expiry_notice_days between 0 and 365);

-- A human-facing reference, unique inside the agency that issued it. Assigned by
-- the reserve command in section K; NULL stays legal so the pre-existing rows
-- this migration inherits do not have to be renumbered.
create unique index if not exists uq_dms_documents_number
  on public.dms_documents(agency_id, document_number) where document_number is not null;

-- 20260822000013 created no index at all beyond the primary keys, so every
-- screen this slice adds would have been a sequential scan of the whole table.
create index if not exists idx_dms_documents_scope       on public.dms_documents(agency_id, branch_id);
create index if not exists idx_dms_documents_review      on public.dms_documents(agency_id, review_status, submitted_at);
create index if not exists idx_dms_documents_expiry      on public.dms_documents(agency_id, expires_on) where expires_on is not null;
create index if not exists idx_dms_documents_type        on public.dms_documents(agency_id, document_type);
create index if not exists idx_dms_documents_reviewer    on public.dms_documents(reviewer_id, review_status);
create index if not exists idx_dms_documents_polymorphic on public.dms_documents(polymorphic_type, polymorphic_id)
  where polymorphic_id is not null;
create index if not exists idx_dms_documents_tags        on public.dms_documents using gin(tags);

-- ============================================================================
-- C. dms_document_versions: bytes that can be verified.
--
--    The table recorded a storage_path and nothing else. There was no way to
--    distinguish a truncated upload from a complete one, no way to notice that
--    the object behind an approved document had been replaced, and -- because
--    version_number came from the caller with no unique constraint -- no way to
--    say which row was the latest version.
--
--    upload_state is the half of the two-step upload that lives in the database:
--    RESERVED is a row with no object yet (and the row the storage INSERT policy
--    keys on), UPLOADED is a finalized object with a checksum.
-- ============================================================================

alter table public.dms_document_versions
  add column if not exists storage_bucket    text not null default 'dms',
  add column if not exists upload_state      text not null default 'UPLOADED',
  add column if not exists original_filename text,
  add column if not exists mime_type         text,
  add column if not exists size_bytes        bigint,
  add column if not exists checksum_sha256   text,
  add column if not exists page_count        integer,
  add column if not exists uploaded_at       timestamptz,
  add column if not exists superseded_at     timestamptz,
  add column if not exists notes             text,
  add column if not exists updated_at        timestamptz not null default now();

-- A version row that predates this migration has an object behind it but no
-- recorded checksum, and calling it UPLOADED would assert an integrity property
-- nobody ever measured. LEGACY says exactly what is true: the bytes are there
-- and unverified. New uploads cannot reach that state -- section K only ever
-- writes RESERVED then UPLOADED.
update public.dms_document_versions
   set upload_state = 'LEGACY',
       uploaded_at  = coalesce(uploaded_at, created_at)
 where checksum_sha256 is null and upload_state = 'UPLOADED';

alter table public.dms_document_versions drop constraint if exists dms_document_versions_upload_state_check;
alter table public.dms_document_versions add constraint dms_document_versions_upload_state_check
  check (upload_state in ('RESERVED','UPLOADED','LEGACY','FAILED'));

alter table public.dms_document_versions drop constraint if exists dms_document_versions_uploaded_is_measured;
alter table public.dms_document_versions add constraint dms_document_versions_uploaded_is_measured
  check (upload_state <> 'UPLOADED'
         or (checksum_sha256 is not null and size_bytes is not null and mime_type is not null));

alter table public.dms_document_versions drop constraint if exists dms_document_versions_checksum_shape;
alter table public.dms_document_versions add constraint dms_document_versions_checksum_shape
  check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$');

alter table public.dms_document_versions drop constraint if exists dms_document_versions_size_sane;
alter table public.dms_document_versions add constraint dms_document_versions_size_sane
  check (size_bytes is null or size_bytes between 1 and 26214400);

alter table public.dms_document_versions drop constraint if exists dms_document_versions_number_positive;
alter table public.dms_document_versions add constraint dms_document_versions_number_positive
  check (version_number >= 1);

-- Defect 4. Two rows could claim to be version 3 of the same document, and the
-- "latest" version was whatever sort order the reader happened to use.
create unique index if not exists uq_dms_document_versions_number
  on public.dms_document_versions(document_id, version_number);
-- The same bytes uploaded twice under the same document is a mistake worth
-- refusing rather than a second version worth storing.
create unique index if not exists uq_dms_document_versions_checksum
  on public.dms_document_versions(document_id, checksum_sha256) where checksum_sha256 is not null;
-- One object, one row: the storage policies in section J key on storage_path, so
-- two rows claiming the same path would make the grant ambiguous.
create unique index if not exists uq_dms_document_versions_path
  on public.dms_document_versions(storage_bucket, storage_path);

create index if not exists idx_dms_versions_document on public.dms_document_versions(document_id, version_number desc);
create index if not exists idx_dms_versions_scope    on public.dms_document_versions(agency_id, branch_id);
create index if not exists idx_dms_versions_state    on public.dms_document_versions(upload_state, created_at);

-- current_version_id was declared in section B and could not be constrained
-- there: the FK target is this table. ON DELETE SET NULL rather than CASCADE --
-- deleting a version must not delete the document that points at it.
alter table public.dms_documents drop constraint if exists dms_documents_current_version_fk;
alter table public.dms_documents add constraint dms_documents_current_version_fk
  foreign key (current_version_id) references public.dms_document_versions(id) on delete set null;

-- ============================================================================
-- D. Relationships. The lifecycle step 20260822000013 gestured at with an
--    untyped polymorphic_id / polymorphic_type pair: two nullable columns, no
--    FK, no check on the type string, and no index. A typo in polymorphic_type
--    was a silently orphaned document.
--
--    Two kinds of edge, because they are two different questions:
--      dms_document_links     - this document is about that business object
--      dms_document_relations - this document stands in a relation to that document
-- ============================================================================

create table if not exists public.dms_document_links (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id() references public.agencies(id),
  branch_id     uuid references public.branches(id),
  document_id   uuid not null references public.dms_documents(id) on delete cascade,
  entity_type   text not null,
  entity_id     uuid not null,
  relation      text not null default 'ABOUT',
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint dms_document_links_entity_type_check
    check (entity_type in ('pilgrim','booking','group','package','payment','invoice',
                           'supplier','supplier_bill','contract','hotel_contract',
                           'journal_entry','crm_customer','crm_quote','crm_opportunity',
                           'staff_profile','visa','external_operation')),
  constraint dms_document_links_relation_check
    check (relation in ('ABOUT','EVIDENCE_FOR','SIGNED_BY','ISSUED_BY','INVOICE_FOR','CONTRACT_FOR')),
  constraint dms_document_links_unique unique (document_id, entity_type, entity_id, relation)
);
create index if not exists idx_dms_links_entity   on public.dms_document_links(entity_type, entity_id);
create index if not exists idx_dms_links_document on public.dms_document_links(document_id);
create index if not exists idx_dms_links_scope    on public.dms_document_links(agency_id, branch_id);

-- entity_type/entity_id cannot be a foreign key -- it points at seventeen
-- different tables -- so the integrity a real FK would give comes from a trigger
-- that resolves the type to a table and checks the row exists in the same
-- agency. Anything less is the untyped polymorphic pair with extra steps.
create or replace function public.dms_check_link_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table text;
  v_key   text := 'id';
  v_reg   regclass;
  v_ok    boolean;
begin
  v_table := case new.entity_type
    when 'pilgrim'            then 'pilgrims'
    when 'booking'            then 'bookings'
    when 'group'              then 'groups'
    when 'package'            then 'packages'
    when 'payment'            then 'payments'
    when 'invoice'            then 'invoices'
    when 'supplier'           then 'suppliers'
    when 'supplier_bill'      then 'supplier_bills'
    when 'contract'           then 'contracts'
    when 'hotel_contract'     then 'hotel_contracts'
    when 'journal_entry'      then 'journal_entries'
    when 'crm_customer'       then 'crm_customers'
    when 'crm_quote'          then 'crm_quotes'
    when 'crm_opportunity'    then 'crm_opportunities'
    when 'staff_profile'      then 'staff_profiles'
    when 'visa'               then 'visas'
    when 'external_operation' then 'external_operations'
  end;
  if v_table is null then
    raise exception 'Unknown document link entity_type %', new.entity_type using errcode = '22023';
  end if;
  -- staff_profiles is keyed on user_id; it has no id column at all, so a check
  -- that assumed one would raise 42703 on every staff link.
  if new.entity_type = 'staff_profile' then v_key := 'user_id'; end if;

  -- A target table this ledger has not created yet is a reason to skip the
  -- check, not to refuse the link: the check constraint already limits the type
  -- to a known name, and a replay must not depend on migration order here.
  v_reg := to_regclass('public.' || v_table);
  if v_reg is null then
    return new;
  end if;

  execute format('select exists (select 1 from public.%I t where t.%I = $1)', v_table, v_key)
    into v_ok using new.entity_id;
  if not v_ok then
    raise exception 'No % row with id %', new.entity_type, new.entity_id using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.dms_check_link_target() from public, anon, authenticated;

drop trigger if exists trg_dms_check_link_target on public.dms_document_links;
create trigger trg_dms_check_link_target
  before insert or update of entity_type, entity_id on public.dms_document_links
  for each row execute function public.dms_check_link_target();

-- The polymorphic_id / polymorphic_type pair is left in place and unused. It has
-- no rows to migrate: nothing in this repository has ever written a dms_documents
-- row, which is the whole reason item 2 exists. New writes go through
-- dms_document_links.

create table if not exists public.dms_document_relations (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id() references public.agencies(id),
  branch_id     uuid references public.branches(id),
  from_document_id uuid not null references public.dms_documents(id) on delete cascade,
  to_document_id   uuid not null references public.dms_documents(id) on delete cascade,
  relation      text not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint dms_document_relations_relation_check
    check (relation in ('SUPERSEDES','SUPPORTS','TRANSLATION_OF','SIGNED_COPY_OF',
                        'ATTACHMENT_OF','AMENDS','RELATED')),
  constraint dms_document_relations_not_self check (from_document_id <> to_document_id),
  constraint dms_document_relations_unique unique (from_document_id, to_document_id, relation)
);
create index if not exists idx_dms_relations_from  on public.dms_document_relations(from_document_id);
create index if not exists idx_dms_relations_to    on public.dms_document_relations(to_document_id);
create index if not exists idx_dms_relations_scope on public.dms_document_relations(agency_id, branch_id);

-- ============================================================================
-- E. Extraction. extraction_jobs recorded a status and a JSONB blob: no engine,
--    no attempt count, no error text, no confidence, and no way for a human to
--    accept or correct one field without rewriting the blob. A blob nobody can
--    review is not the "OCR/extraction -> review" step, so the fields become
--    rows.
-- ============================================================================

alter table public.extraction_jobs
  add column if not exists version_id     uuid references public.dms_document_versions(id) on delete cascade,
  add column if not exists engine         text not null default 'MANUAL',
  add column if not exists attempts       integer not null default 0,
  add column if not exists max_attempts   integer not null default 3,
  add column if not exists error_message  text,
  add column if not exists started_at     timestamptz,
  add column if not exists finished_at    timestamptz,
  add column if not exists confidence     numeric(5,2),
  add column if not exists review_state   text not null default 'NOT_REVIEWED',
  add column if not exists reviewed_at    timestamptz,
  add column if not exists reviewed_by    uuid references auth.users(id),
  add column if not exists requested_by   uuid references auth.users(id);

alter table public.extraction_jobs drop constraint if exists extraction_jobs_engine_check;
alter table public.extraction_jobs add constraint extraction_jobs_engine_check
  check (engine in ('MANUAL','TESSERACT','TEXTRACT','DOCUMENT_AI','AZURE_DI','LLM'));

alter table public.extraction_jobs drop constraint if exists extraction_jobs_review_state_check;
alter table public.extraction_jobs add constraint extraction_jobs_review_state_check
  check (review_state in ('NOT_REVIEWED','PARTIALLY_REVIEWED','REVIEWED'));

alter table public.extraction_jobs drop constraint if exists extraction_jobs_confidence_range;
alter table public.extraction_jobs add constraint extraction_jobs_confidence_range
  check (confidence is null or confidence between 0 and 100);

alter table public.extraction_jobs drop constraint if exists extraction_jobs_attempts_sane;
alter table public.extraction_jobs add constraint extraction_jobs_attempts_sane
  check (attempts >= 0 and max_attempts between 1 and 10 and attempts <= max_attempts);

-- A failed job with no error text is a support ticket nobody can answer.
alter table public.extraction_jobs drop constraint if exists extraction_jobs_failure_explained;
alter table public.extraction_jobs add constraint extraction_jobs_failure_explained
  check (status <> 'failed' or length(trim(coalesce(error_message,''))) > 0);

create index if not exists idx_extraction_jobs_document on public.extraction_jobs(document_id);
create index if not exists idx_extraction_jobs_version  on public.extraction_jobs(version_id);
create index if not exists idx_extraction_jobs_scope    on public.extraction_jobs(agency_id, branch_id);
create index if not exists idx_extraction_jobs_queue    on public.extraction_jobs(status, created_at)
  where status in ('pending','processing');

-- One field, one row: a clerk accepts the passport number and corrects the
-- expiry date without touching the rest, and every correction is attributable.
create table if not exists public.dms_extracted_fields (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_staff_agency_id() references public.agencies(id),
  branch_id     uuid references public.branches(id),
  job_id        uuid not null references public.extraction_jobs(id) on delete cascade,
  document_id   uuid not null references public.dms_documents(id) on delete cascade,
  field_key     text not null,
  field_label   text,
  raw_value     text,
  value         text,
  confidence    numeric(5,2),
  page_number   integer,
  bounding_box  jsonb,
  review_state  text not null default 'PENDING',
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint dms_extracted_fields_key_present check (length(trim(field_key)) > 0),
  constraint dms_extracted_fields_state_check
    check (review_state in ('PENDING','ACCEPTED','CORRECTED','REJECTED')),
  constraint dms_extracted_fields_confidence_range
    check (confidence is null or confidence between 0 and 100),
  constraint dms_extracted_fields_reviewed_attributed
    check (review_state = 'PENDING' or (reviewed_at is not null and reviewed_by is not null)),
  constraint dms_extracted_fields_unique unique (job_id, field_key)
);
create index if not exists idx_dms_fields_job      on public.dms_extracted_fields(job_id);
create index if not exists idx_dms_fields_document on public.dms_extracted_fields(document_id, field_key);
create index if not exists idx_dms_fields_scope    on public.dms_extracted_fields(agency_id, branch_id);
create index if not exists idx_dms_fields_pending  on public.dms_extracted_fields(agency_id, review_state)
  where review_state = 'PENDING';

-- ============================================================================
-- F. Audit. document_access_logs exists and is the wrong table for this: its
--    document_id is a foreign key to public.documents ON DELETE RESTRICT, so a
--    DMS document id would fail the constraint, and its access_type vocabulary
--    is only VIEW/DOWNLOAD/PREVIEW/GENERATE_SIGNED_URL -- it has nowhere to
--    record an approval.
--
--    write_audit_log() covers the generic who-changed-what-when. This table is
--    the per-document narrative the UI shows on the document timeline, which is
--    the artefact that makes the lifecycle provable rather than asserted.
--    Append-only: the policies for update and delete are dropped in section H.
-- ============================================================================

create table if not exists public.dms_document_events (
  id            bigserial primary key,
  agency_id     uuid not null default public.current_staff_agency_id() references public.agencies(id),
  branch_id     uuid references public.branches(id),
  document_id   uuid not null references public.dms_documents(id) on delete cascade,
  version_id    uuid references public.dms_document_versions(id) on delete set null,
  event_type    text not null,
  from_state    text,
  to_state      text,
  detail        text,
  metadata      jsonb not null default '{}'::jsonb,
  actor_id      uuid default auth.uid() references auth.users(id),
  actor_role    text,
  correlation_id uuid,
  created_at    timestamptz not null default now(),
  constraint dms_document_events_type_check check (event_type in (
    'CREATED','VERSION_RESERVED','VERSION_UPLOADED','VERSION_DISCARDED',
    'SUBMITTED','REVIEW_STARTED','APPROVED','REJECTED','CHANGES_REQUESTED',
    'EXPIRED','EXPIRY_NOTICE','ARCHIVED','RESTORED','SUPERSEDED',
    'VIEWED','DOWNLOADED','SIGNED_URL_ISSUED',
    'EXTRACTION_QUEUED','EXTRACTION_COMPLETED','EXTRACTION_FAILED',
    'FIELD_ACCEPTED','FIELD_CORRECTED','FIELD_REJECTED',
    'LINK_ADDED','LINK_REMOVED','RELATION_ADDED','RELATION_REMOVED',
    'PACKAGE_ADDED','PACKAGE_REMOVED','PACKAGE_SEALED','METADATA_UPDATED'))
);
create index if not exists idx_dms_events_document on public.dms_document_events(document_id, created_at desc);
create index if not exists idx_dms_events_scope    on public.dms_document_events(agency_id, branch_id, created_at desc);
create index if not exists idx_dms_events_type     on public.dms_document_events(agency_id, event_type, created_at desc);
create index if not exists idx_dms_events_actor    on public.dms_document_events(actor_id, created_at desc);

-- Every command in sections K through P writes through this, so the timeline
-- cannot disagree with the state machine: the same statement that moves the
-- document records why.
create or replace function private.dms_log_event(
  p_document_id uuid,
  p_event_type  text,
  p_from_state  text default null,
  p_to_state    text default null,
  p_detail      text default null,
  p_version_id  uuid default null,
  p_metadata    jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_agency uuid;
  v_branch uuid;
  v_id     bigint;
begin
  select d.agency_id, d.branch_id into v_agency, v_branch
    from public.dms_documents d where d.id = p_document_id;
  if v_agency is null then
    raise exception 'Cannot log an event for a document that does not exist' using errcode = '22023';
  end if;
  insert into public.dms_document_events(
    agency_id, branch_id, document_id, version_id, event_type,
    from_state, to_state, detail, metadata, actor_id, actor_role)
  values (v_agency, v_branch, p_document_id, p_version_id, p_event_type,
          p_from_state, p_to_state, nullif(trim(coalesce(p_detail,'')),''),
          coalesce(p_metadata, '{}'::jsonb), auth.uid(), public.staff_role())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.dms_log_event(uuid,text,text,text,text,uuid,jsonb) from public, anon, authenticated;

-- ============================================================================
-- G. Evidence packages. The table had a name and a lowercase 'open' status with
--    no check, so a package could be spelled 'Open', 'OPEN' or 'sealed' and no
--    two readers would agree. Sealing is the point of an evidence package and
--    was entirely absent: nothing recorded who sealed it, when, or over what.
--
--    A sealed package carries a checksum over its members' checksums. If any
--    byte behind any member document is later replaced, recomputing the seal no
--    longer matches -- which is the difference between evidence and a folder.
-- ============================================================================

alter table public.evidence_packages
  add column if not exists reference      text,
  add column if not exists purpose        text,
  add column if not exists notes          text,
  add column if not exists document_count integer not null default 0,
  add column if not exists sealed_at      timestamptz,
  add column if not exists sealed_by      uuid references auth.users(id),
  add column if not exists seal_checksum  text;

update public.evidence_packages set status = upper(status) where status <> upper(status);
update public.evidence_packages set status = 'OPEN' where status not in ('OPEN','SEALED','VOID');
alter table public.evidence_packages alter column status set default 'OPEN';

alter table public.evidence_packages drop constraint if exists evidence_packages_status_check;
alter table public.evidence_packages add constraint evidence_packages_status_check
  check (status in ('OPEN','SEALED','VOID'));

alter table public.evidence_packages drop constraint if exists evidence_packages_name_present;
alter table public.evidence_packages add constraint evidence_packages_name_present
  check (length(trim(name)) > 0);

alter table public.evidence_packages drop constraint if exists evidence_packages_seal_complete;
alter table public.evidence_packages add constraint evidence_packages_seal_complete
  check (status <> 'SEALED'
         or (sealed_at is not null and sealed_by is not null and seal_checksum ~ '^[0-9a-f]{64}$'));

create unique index if not exists uq_evidence_packages_reference
  on public.evidence_packages(agency_id, reference) where reference is not null;
create index if not exists idx_evidence_packages_scope  on public.evidence_packages(agency_id, branch_id);
create index if not exists idx_evidence_packages_status on public.evidence_packages(agency_id, status, created_at desc);

alter table public.evidence_package_documents
  add column if not exists version_id        uuid references public.dms_document_versions(id) on delete set null,
  add column if not exists sequence_no       integer,
  add column if not exists checksum_sha256   text,
  add column if not exists note              text,
  add column if not exists added_by          uuid references auth.users(id);

create index if not exists idx_evidence_pkg_docs_document on public.evidence_package_documents(document_id);
create index if not exists idx_evidence_pkg_docs_scope    on public.evidence_package_documents(agency_id, branch_id);

-- ============================================================================
-- H. RLS, scope stamping, updated_at and audit.
--
--    The thirteen policies 20260822000013 created are dropped by name. They were
--    defects 1 through 3 in one expression: `agency_id = current_staff_agency_id()`
--    ignores the branch, ignores the verb, and -- on the three UPDATE policies,
--    which had USING and no WITH CHECK -- let a staff member rewrite agency_id
--    and move the row into another tenant.
--
--    The replacement is the loop from 20260324000300 / 20260428121700:
--    has_permission(<table>, verb) AND row_in_staff_scope(agency_id, branch_id),
--    with WITH CHECK on every UPDATE.
-- ============================================================================

do $$
declare
  p record;
begin
  for p in select * from (values
    ('dms_documents',              'Authenticated users can read documents'),
    ('dms_documents',              'Authenticated users can insert documents'),
    ('dms_documents',              'Authenticated users can update documents'),
    ('dms_document_versions',      'Authenticated users can read document_versions'),
    ('dms_document_versions',      'Authenticated users can insert document_versions'),
    ('evidence_packages',          'Authenticated users can read evidence_packages'),
    ('evidence_packages',          'Authenticated users can insert evidence_packages'),
    ('evidence_packages',          'Authenticated users can update evidence_packages'),
    ('evidence_package_documents', 'Authenticated users can read evidence_package_documents'),
    ('evidence_package_documents', 'Authenticated users can insert evidence_package_documents'),
    ('evidence_package_documents', 'Authenticated users can delete evidence_package_documents'),
    ('extraction_jobs',            'Authenticated users can read extraction_jobs'),
    ('extraction_jobs',            'Authenticated users can insert extraction_jobs'),
    ('extraction_jobs',            'Authenticated users can update extraction_jobs')
  ) as t(tbl, pol) loop
    execute format('drop policy if exists %I on public.%I', p.pol, p.tbl);
  end loop;
end $$;

do $$
declare
  t         text;
  has_audit boolean;
  dms_tables text[] := array[
    'dms_documents','dms_document_versions','dms_document_links','dms_document_relations',
    'dms_document_events','dms_extracted_fields','extraction_jobs',
    'evidence_packages','evidence_package_documents'
  ];
  -- evidence_package_documents and dms_document_events have no updated_at column
  -- to maintain; the rest do.
  no_updated_at text[] := array['evidence_package_documents','dms_document_events'];
begin
  select exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = 'write_audit_log'
  ) into has_audit;

  foreach t in array dms_tables loop
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

    if not (t = any(no_updated_at)) then
      execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
      execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', 'trg_' || t || '_updated_at', t);
    end if;

    if has_audit then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()', 'trg_audit_' || t, t);
    end if;
  end loop;
end $$;

-- 20260822000013 named its updated_at triggers handle_updated_at_documents on a
-- table called dms_documents. The loop above installed correctly-named ones;
-- leaving the originals in place would run update_updated_at_column() twice per
-- row for the same effect.
drop trigger if exists handle_updated_at_documents         on public.dms_documents;
drop trigger if exists handle_updated_at_evidence_packages on public.evidence_packages;
drop trigger if exists handle_updated_at_extraction_jobs   on public.extraction_jobs;

-- dms_document_events is the audit ledger. A subsystem that can rewrite its own
-- audit trail is not audited, so there is no client UPDATE or DELETE path at all
-- -- private.dms_log_event is SECURITY DEFINER and inserts; nothing else writes.
drop policy if exists staff_update on public.dms_document_events;
drop policy if exists staff_delete on public.dms_document_events;
drop policy if exists staff_insert on public.dms_document_events;
revoke insert, update, delete, truncate on public.dms_document_events from authenticated;
-- ...and no write_audit_log trigger on it either: auditing the audit ledger
-- writes a second row into audit_logs for every event, saying the same thing.
drop trigger if exists trg_audit_dms_document_events on public.dms_document_events;

-- ============================================================================
-- I. RBAC. The roles are the seven in staff_profiles_role_check; there is no DMS
--    role and inventing one would orphan every existing staff profile.
--
--    'approve' and 'seal' are separate actions rather than aliases for 'update',
--    which is the whole point: an agent who uploads a passport scan and submits
--    it for review must not be the person who approves it. Only ADMIN (implicitly,
--    through has_permission) and OPERATIONS_MANAGER can approve.
-- ============================================================================

insert into public.staff_permissions(role, resource, action) values
  ('OPERATIONS_MANAGER','dms_documents','read'),('OPERATIONS_MANAGER','dms_documents','create'),
  ('OPERATIONS_MANAGER','dms_documents','update'),('OPERATIONS_MANAGER','dms_documents','delete'),
  ('OPERATIONS_MANAGER','dms_documents','approve'),
  ('OPERATIONS_MANAGER','dms_document_versions','read'),('OPERATIONS_MANAGER','dms_document_versions','create'),
  ('OPERATIONS_MANAGER','dms_document_versions','update'),
  ('OPERATIONS_MANAGER','dms_document_links','read'),('OPERATIONS_MANAGER','dms_document_links','create'),
  ('OPERATIONS_MANAGER','dms_document_links','delete'),
  ('OPERATIONS_MANAGER','dms_document_relations','read'),('OPERATIONS_MANAGER','dms_document_relations','create'),
  ('OPERATIONS_MANAGER','dms_document_relations','delete'),
  ('OPERATIONS_MANAGER','dms_document_events','read'),
  ('OPERATIONS_MANAGER','extraction_jobs','read'),('OPERATIONS_MANAGER','extraction_jobs','create'),
  ('OPERATIONS_MANAGER','extraction_jobs','update'),
  ('OPERATIONS_MANAGER','dms_extracted_fields','read'),('OPERATIONS_MANAGER','dms_extracted_fields','update'),
  ('OPERATIONS_MANAGER','evidence_packages','read'),('OPERATIONS_MANAGER','evidence_packages','create'),
  ('OPERATIONS_MANAGER','evidence_packages','update'),('OPERATIONS_MANAGER','evidence_packages','seal'),
  ('OPERATIONS_MANAGER','evidence_package_documents','read'),('OPERATIONS_MANAGER','evidence_package_documents','create'),
  ('OPERATIONS_MANAGER','evidence_package_documents','delete'),

  ('VISA_AGENT','dms_documents','read'),('VISA_AGENT','dms_documents','create'),('VISA_AGENT','dms_documents','update'),
  ('VISA_AGENT','dms_document_versions','read'),('VISA_AGENT','dms_document_versions','create'),
  ('VISA_AGENT','dms_document_links','read'),('VISA_AGENT','dms_document_links','create'),
  ('VISA_AGENT','dms_document_events','read'),
  ('VISA_AGENT','extraction_jobs','read'),('VISA_AGENT','extraction_jobs','create'),
  ('VISA_AGENT','dms_extracted_fields','read'),('VISA_AGENT','dms_extracted_fields','update'),

  ('FINANCE','dms_documents','read'),('FINANCE','dms_documents','create'),('FINANCE','dms_documents','update'),
  ('FINANCE','dms_document_versions','read'),('FINANCE','dms_document_versions','create'),
  ('FINANCE','dms_document_links','read'),('FINANCE','dms_document_links','create'),('FINANCE','dms_document_links','delete'),
  ('FINANCE','dms_document_relations','read'),('FINANCE','dms_document_events','read'),
  ('FINANCE','extraction_jobs','read'),('FINANCE','dms_extracted_fields','read'),
  ('FINANCE','evidence_packages','read'),('FINANCE','evidence_packages','create'),
  ('FINANCE','evidence_packages','update'),('FINANCE','evidence_packages','seal'),
  ('FINANCE','evidence_package_documents','read'),('FINANCE','evidence_package_documents','create'),
  ('FINANCE','evidence_package_documents','delete'),

  ('CRM','dms_documents','read'),('CRM','dms_documents','create'),('CRM','dms_documents','update'),
  ('CRM','dms_document_versions','read'),('CRM','dms_document_versions','create'),
  ('CRM','dms_document_links','read'),('CRM','dms_document_links','create'),
  ('CRM','dms_document_events','read'),

  ('AGENT','dms_documents','read'),('AGENT','dms_documents','create'),
  ('AGENT','dms_document_versions','read'),('AGENT','dms_document_versions','create'),
  ('AGENT','dms_document_links','read'),('AGENT','dms_document_links','create'),
  ('AGENT','dms_document_events','read'),

  ('GUIDE','dms_documents','read'),('GUIDE','dms_document_versions','read')
on conflict (role, resource, action) do nothing;

-- ============================================================================
-- J. Storage. A dedicated private bucket rather than reusing `documents`,
--    because 20260609204800's INSERT policy on that bucket keys on a row in
--    public.documents and this subsystem's rows live in
--    dms_document_versions -- two permissive INSERT policies on one bucket are
--    OR'd, so sharing it would mean each policy silently widened the other.
--
--    The rule is 20260609204800's, keyed on the version row: an object may only
--    be created where a version row already exists claiming that exact path.
--    That is what makes the reserve-then-upload order in section K mandatory
--    rather than a convention -- an upload to an unreserved path is refused by
--    the database, not by the client.
--
--    The mime allowlist is wider than the pilgrim bucket's (office documents are
--    ordinary DMS content) and the limit is 25 MiB, matching the size_bytes
--    check in section C.
-- ============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    -- A self-hosted Postgres without the Supabase storage schema is a valid
    -- replay target for this ledger; the DMS tables above are still correct.
    raise notice 'storage schema absent; skipping the dms bucket and its policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('dms','dms', false, 26214400, array[
    'application/pdf','image/jpeg','image/png','image/webp','image/tiff',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain'
  ]::text[])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end $$;

do $stor$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute 'drop policy if exists dms_objects_read on storage.objects';
  execute $p$
    create policy dms_objects_read on storage.objects for select to authenticated
    using (bucket_id = 'dms' and exists (
      select 1 from public.dms_document_versions v
       where v.storage_bucket = 'dms' and v.storage_path = name
         and public.row_in_staff_scope(v.agency_id, v.branch_id)
         and public.has_permission('dms_documents','read')))
  $p$;

  -- An object may only be created at a path a version row already reserved, in
  -- the reserving staff member's own agency, with the agency id as the first path
  -- segment. The COALESCE default is a literal that cannot be a valid uuid, so an
  -- unreserved path fails the comparison rather than comparing NULL (which would
  -- make the whole WITH CHECK neither true nor false -- and therefore not true,
  -- but for the wrong reason and only by accident).
  --
  -- The mime allowlist is not repeated here: storage.buckets.allowed_mime_types
  -- rejects a disallowed type before a row reaches this policy, and the list is
  -- eleven entries. Size is repeated because the bucket limit and the
  -- size_bytes check in section C must agree, and stating it twice is how a
  -- later edit to one of them gets noticed.
  execute 'drop policy if exists dms_objects_insert on storage.objects';
  execute $p$
    create policy dms_objects_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'dms'
      and coalesce((metadata->>'size')::bigint, 0) between 1 and 26214400
      and split_part(name,'/',1) = coalesce(
            (select v.agency_id::text from public.dms_document_versions v
              where v.storage_bucket = 'dms' and v.storage_path = name limit 1),
            '__no_reservation__')
      and exists (
        select 1 from public.dms_document_versions v
         where v.storage_bucket = 'dms' and v.storage_path = name
           and v.upload_state = 'RESERVED'
           and public.row_in_staff_scope(v.agency_id, v.branch_id)
           and public.has_permission('dms_document_versions','create')))
  $p$;

  -- Bytes are immutable once finalized. Replacing the object behind an approved
  -- document would leave the recorded checksum describing content that is no
  -- longer there, which is the failure mode defect 5 exists to prevent; a new
  -- version is the supported way to change a document.
  execute 'drop policy if exists dms_objects_update on storage.objects';
  execute $p$
    create policy dms_objects_update on storage.objects for update to authenticated
    using (bucket_id = 'dms' and exists (
      select 1 from public.dms_document_versions v
       where v.storage_bucket = 'dms' and v.storage_path = name
         and v.upload_state = 'RESERVED'
         and public.row_in_staff_scope(v.agency_id, v.branch_id)
         and public.has_permission('dms_document_versions','update')))
    with check (bucket_id = 'dms'
      and coalesce((metadata->>'size')::bigint, 0) between 1 and 26214400)
  $p$;

  execute 'drop policy if exists dms_objects_delete on storage.objects';
  execute $p$
    create policy dms_objects_delete on storage.objects for delete to authenticated
    using (bucket_id = 'dms' and exists (
      select 1 from public.dms_document_versions v
        join public.dms_documents d on d.id = v.document_id
       where v.storage_bucket = 'dms' and v.storage_path = name
         and d.review_status not in ('APPROVED','SUPERSEDED','EXPIRED')
         and public.row_in_staff_scope(v.agency_id, v.branch_id)
         and public.has_permission('dms_documents','delete')))
  $p$;
end
$stor$;

-- ============================================================================
-- K. Upload: reserve, then put the bytes, then finalize.
--
--    The order is forced by section J -- storage refuses an object at a path no
--    version row has reserved -- and it is the right order anyway: a crash
--    between steps leaves a RESERVED row with no object, which is visible and
--    collectable, instead of an object with no row, which is not.
-- ============================================================================

-- A per-agency, per-year counter. `insert ... on conflict do update ... returning`
-- is a single atomic statement, so two concurrent reservations cannot be handed
-- the same number; a max(document_number)+1 read would need an explicit lock and
-- would still race against a rollback.
create table if not exists public.dms_document_sequences (
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  year       integer not null,
  next_value integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (agency_id, year)
);
alter table public.dms_document_sequences enable row level security;
-- No policies, deliberately: the allocator below is SECURITY DEFINER and is the
-- only thing that may read or advance a counter. RLS with zero policies denies
-- every client, which is the intent.
revoke all on public.dms_document_sequences from anon, authenticated;

-- Bytes outlive rows, and once a version row is gone every storage policy in
-- section J refuses to authorize deleting the object it pointed at -- all four
-- key on a version row existing at that path. So a path whose row is about to
-- disappear is recorded here first, and a service-role janitor empties the
-- bucket afterwards. RLS on with no policies: no client reads this, ever.
create table if not exists public.dms_storage_orphans (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null,
  storage_bucket text not null,
  storage_path   text not null,
  document_id    uuid,
  reason         text,
  requested_by   uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  purged_at      timestamptz
);
alter table public.dms_storage_orphans enable row level security;
revoke all on public.dms_storage_orphans from anon, authenticated;
create index if not exists idx_dms_storage_orphans_pending
  on public.dms_storage_orphans(created_at) where purged_at is null;

create or replace function private.dms_next_document_number(p_agency_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_next integer;
begin
  -- next_value always names the number that will be handed out next, so a fresh
  -- row is created holding 2 and the caller gets 1; on conflict the row advances
  -- and the caller gets the value it held before. Both cases are `returning
  -- next_value - 1`, evaluated after the update.
  insert into public.dms_document_sequences(agency_id, year, next_value)
  values (p_agency_id, v_year, 2)
  on conflict (agency_id, year) do update
    set next_value = dms_document_sequences.next_value + 1,
        updated_at = now()
  returning next_value - 1 into v_next;
  return 'DOC-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
end;
$$;
revoke all on function private.dms_next_document_number(uuid) from public, anon, authenticated;

create or replace function private.dms_reserve_upload(
  p_title              text,
  p_document_type      text,
  p_original_filename  text,
  p_document_id        uuid    default null,
  p_description        text    default null,
  p_confidentiality    text    default 'INTERNAL',
  p_issued_on          date    default null,
  p_expires_on         date    default null,
  p_expiry_notice_days integer default 30,
  p_tags               text[]  default '{}',
  p_workspace_id       text    default 'DEFAULT'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d        public.dms_documents%rowtype;
  v_agency uuid;
  v_branch uuid;
  v_number integer;
  v_ext    text;
  v_path   text;
  v_version_id uuid;
  v_new_document boolean := p_document_id is null;
begin
  if not public.has_permission('dms_document_versions','create') then
    raise exception 'Not authorized to upload documents' using errcode = '42501';
  end if;

  if v_new_document then
    if not public.has_permission('dms_documents','create') then
      raise exception 'Not authorized to create documents' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_title,''))) = 0 then
      raise exception 'A document title is required' using errcode = '22023';
    end if;
    if length(trim(coalesce(p_document_type,''))) = 0 then
      raise exception 'A document type is required' using errcode = '22023';
    end if;

    v_agency := public.staff_agency_id();
    v_branch := public.staff_branch_id();
    if v_agency is null then
      raise exception 'No active staff profile for this session' using errcode = '42501';
    end if;

    insert into public.dms_documents(
      agency_id, branch_id, created_by, updated_by, status, review_status,
      title, description, document_type, workspace_id, document_number,
      confidentiality, tags, issued_on, expires_on, expiry_notice_days)
    values (
      v_agency, v_branch, auth.uid(), auth.uid(), 'draft', 'DRAFT',
      trim(p_title), nullif(trim(coalesce(p_description,'')),''), trim(p_document_type),
      coalesce(nullif(trim(coalesce(p_workspace_id,'')),''), 'DEFAULT'),
      private.dms_next_document_number(v_agency),
      coalesce(p_confidentiality,'INTERNAL'), coalesce(p_tags,'{}'),
      p_issued_on, p_expires_on, coalesce(p_expiry_notice_days, 30))
    returning * into d;

    perform private.dms_log_event(d.id, 'CREATED', null, 'DRAFT',
      'Document ' || d.document_number || ' created');
  else
    select * into d from public.dms_documents where id = p_document_id for update;
    if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
      raise exception 'Document not found in authorized scope' using errcode = '42501';
    end if;
    if d.review_status = 'UNDER_REVIEW' then
      raise exception 'A document under review cannot take a new version; finish the review first'
        using errcode = '22023';
    end if;
  end if;

  -- Defect 4 and 7: the version number is assigned here, under the row lock the
  -- document already holds, and the unique index on (document_id, version_number)
  -- is the backstop if a future caller reaches the table another way.
  select coalesce(max(v.version_number), 0) + 1 into v_number
    from public.dms_document_versions v where v.document_id = d.id;

  -- The extension is cosmetic -- storage decides nothing from it and the mime
  -- type is recorded separately -- so it is reduced to at most eight lowercase
  -- alphanumerics and dropped entirely if the filename has none. A path is not
  -- the place to carry user text.
  v_ext := lower(regexp_replace(coalesce(substring(p_original_filename from '\.([A-Za-z0-9]{1,8})$'), ''), '[^a-z0-9]', '', 'g'));
  v_path := d.agency_id::text || '/dms/' || d.id::text || '/v' || v_number::text
            || '_' || replace(gen_random_uuid()::text, '-', '')
            || case when v_ext = '' then '' else '.' || v_ext end;

  insert into public.dms_document_versions(
    agency_id, branch_id, document_id, version_number, storage_bucket, storage_path,
    upload_state, original_filename, created_by, notes)
  values (
    d.agency_id, d.branch_id, d.id, v_number, 'dms', v_path,
    'RESERVED', nullif(trim(coalesce(p_original_filename,'')),''), auth.uid(), null)
  returning id into v_version_id;

  perform private.dms_log_event(d.id, 'VERSION_RESERVED', null, null,
    'Version ' || v_number::text || ' reserved', v_version_id,
    jsonb_build_object('storage_path', v_path, 'original_filename', p_original_filename));

  return jsonb_build_object(
    'document_id',     d.id,
    'document_number', d.document_number,
    'version_id',      v_version_id,
    'version_number',  v_number,
    'storage_bucket',  'dms',
    'storage_path',    v_path,
    'is_new_document', v_new_document);
end;
$$;
revoke all on function private.dms_reserve_upload(text,text,text,uuid,text,text,date,date,integer,text[],text)
  from public, anon, authenticated;

create or replace function private.dms_finalize_upload(
  p_version_id       uuid,
  p_size_bytes       bigint,
  p_mime_type        text,
  p_checksum_sha256  text,
  p_page_count       integer default null,
  p_queue_extraction boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v        public.dms_document_versions%rowtype;
  d        public.dms_documents%rowtype;
  v_object_size bigint;
  v_prev_status text;
  v_job_id uuid;
  v_count  integer;
begin
  if not public.has_permission('dms_document_versions','create') then
    raise exception 'Not authorized to upload documents' using errcode = '42501';
  end if;

  select * into v from public.dms_document_versions where id = p_version_id for update;
  if not found or not public.row_in_staff_scope(v.agency_id, v.branch_id) then
    raise exception 'Upload reservation not found in authorized scope' using errcode = '42501';
  end if;
  if v.upload_state <> 'RESERVED' then
    raise exception 'Version % is already %', v.version_number, v.upload_state using errcode = '22023';
  end if;

  if coalesce(p_checksum_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase hex sha256 checksum of the uploaded bytes is required'
      using errcode = '22023';
  end if;
  if coalesce(p_size_bytes, 0) not between 1 and 26214400 then
    raise exception 'Uploaded size must be between 1 byte and 25 MiB' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_mime_type,''))) = 0 then
    raise exception 'The uploaded content type is required' using errcode = '22023';
  end if;

  -- The reason this step exists at all: confirm the object is really there, and
  -- that its length matches what the client says it uploaded. A truncated upload
  -- reports a smaller object than the checksum it computed locally, and without
  -- this comparison the version row would claim bytes nobody can verify.
  if to_regclass('storage.objects') is not null then
    execute 'select coalesce((metadata->>''size'')::bigint, -1) from storage.objects where bucket_id = $1 and name = $2'
      into v_object_size using v.storage_bucket, v.storage_path;
    if v_object_size is null then
      raise exception 'No object was uploaded to the reserved path' using errcode = '22023';
    end if;
    if v_object_size >= 0 and v_object_size <> p_size_bytes then
      raise exception 'Uploaded object is % bytes but % was reported; the upload is incomplete',
        v_object_size, p_size_bytes using errcode = '22023';
    end if;
  end if;

  select * into d from public.dms_documents where id = v.document_id for update;
  v_prev_status := d.review_status;

  update public.dms_document_versions
     set upload_state = 'UPLOADED', uploaded_at = now(),
         size_bytes = p_size_bytes, mime_type = trim(p_mime_type),
         checksum_sha256 = p_checksum_sha256, page_count = p_page_count,
         updated_at = now()
   where id = v.id;

  -- The version this one replaces stops being current. superseded_at is on the
  -- old row rather than derived from max(version_number) so the history says when
  -- it stopped being authoritative, not just that a newer row exists.
  update public.dms_document_versions
     set superseded_at = now(), updated_at = now()
   where document_id = d.id and id <> v.id and superseded_at is null
     and upload_state in ('UPLOADED','LEGACY');

  select count(*) into v_count from public.dms_document_versions
   where document_id = d.id and upload_state in ('UPLOADED','LEGACY');

  -- A new version invalidates whatever review the previous one passed. Leaving
  -- the document APPROVED would mean the approval stamp describes bytes that are
  -- no longer the current ones, which is the same lie defect 5 was about.
  if v_prev_status in ('APPROVED','REJECTED','CHANGES_REQUESTED','EXPIRED','SUPERSEDED') then
    update public.dms_documents
       set current_version_id = v.id, version_count = v_count,
           review_status = 'DRAFT',
           submitted_at = null, submitted_by = null,
           review_started_at = null, reviewer_id = null, reviewed_at = null,
           approved_at = null, approved_by = null, rejection_reason = null,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;
    perform private.dms_log_event(d.id, 'SUPERSEDED', v_prev_status, 'DRAFT',
      'Version ' || v.version_number::text || ' replaces the reviewed content', v.id);
  else
    update public.dms_documents
       set current_version_id = v.id, version_count = v_count,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;
  end if;

  perform private.dms_log_event(d.id, 'VERSION_UPLOADED', null, null,
    'Version ' || v.version_number::text || ' uploaded', v.id,
    jsonb_build_object('size_bytes', p_size_bytes, 'mime_type', p_mime_type,
                       'checksum_sha256', p_checksum_sha256, 'page_count', p_page_count));

  -- Extraction is queued, never run here: this function holds a row lock and
  -- runs inside the caller's request. A worker picks the job up from the queue
  -- index in section E.
  if p_queue_extraction and trim(p_mime_type) in
       ('application/pdf','image/jpeg','image/png','image/webp','image/tiff') then
    insert into public.extraction_jobs(
      agency_id, branch_id, document_id, version_id, status, engine, requested_by)
    values (d.agency_id, d.branch_id, d.id, v.id, 'pending', 'MANUAL', auth.uid())
    returning id into v_job_id;
    perform private.dms_log_event(d.id, 'EXTRACTION_QUEUED', null, null,
      'Extraction queued for version ' || v.version_number::text, v.id,
      jsonb_build_object('job_id', v_job_id));
  end if;

  return jsonb_build_object(
    'document_id', d.id, 'version_id', v.id, 'version_number', v.version_number,
    'version_count', v_count, 'review_status',
    case when v_prev_status in ('APPROVED','REJECTED','CHANGES_REQUESTED','EXPIRED','SUPERSEDED')
         then 'DRAFT' else v_prev_status end,
    'extraction_job_id', v_job_id);
end;
$$;
revoke all on function private.dms_finalize_upload(uuid,bigint,text,text,integer,boolean)
  from public, anon, authenticated;

-- A reservation whose upload never happened. The object cannot exist (storage
-- refused it or the client aborted), so the row is the only residue.
create or replace function private.dms_discard_reservation(p_version_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v public.dms_document_versions%rowtype;
begin
  select * into v from public.dms_document_versions where id = p_version_id for update;
  if not found or not public.row_in_staff_scope(v.agency_id, v.branch_id) then
    raise exception 'Upload reservation not found in authorized scope' using errcode = '42501';
  end if;
  if v.upload_state <> 'RESERVED' then
    raise exception 'Version % is % and cannot be discarded', v.version_number, v.upload_state
      using errcode = '22023';
  end if;
  perform private.dms_log_event(v.document_id, 'VERSION_DISCARDED', null, null,
    coalesce(nullif(trim(coalesce(p_reason,'')),''),
             'Reservation for version ' || v.version_number::text || ' discarded'),
    null, jsonb_build_object('storage_path', v.storage_path));
  -- A reservation can be discarded after the bytes were already put, so the path
  -- is queued for the janitor rather than left unreachable: it is unique, so
  -- nothing can ever reuse it, and no policy can authorize deleting it once the
  -- row below is gone.
  insert into public.dms_storage_orphans(
    agency_id, storage_bucket, storage_path, document_id, reason)
  values (v.agency_id, v.storage_bucket, v.storage_path, v.document_id, 'reservation discarded');
  delete from public.dms_document_versions where id = v.id;
  return jsonb_build_object('version_id', v.id, 'discarded', true);
end;
$$;
revoke all on function private.dms_discard_reservation(uuid,text) from public, anon, authenticated;

-- ============================================================================
-- L. Review and approval: one state machine, not five near-copies.
--
--    The legal moves live in a single VALUES list so the machine can be read in
--    one place and asserted in one place (supabase/tests/dms_lifecycle.sql walks
--    every edge and every non-edge). The business-named commands in section N are
--    thin wrappers that fix the target state.
--
--    Segregation of duties is enforced, not documented: the account that
--    submitted a document cannot be the account that approves it unless it is an
--    ADMIN. An agency small enough that one person does both should say so by
--    giving that person the ADMIN role, rather than having the control quietly
--    not apply.
-- ============================================================================

create or replace function private.dms_review_transition(
  p_document_id uuid,
  p_to          text,
  p_note        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d           public.dms_documents%rowtype;
  v_from      text;
  v_allowed   boolean;
  v_needs     text;   -- the permission action this target requires
  v_note      text := nullif(trim(coalesce(p_note,'')),'');
  v_cur       public.dms_document_versions%rowtype;
begin
  select * into d from public.dms_documents where id = p_document_id for update;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  v_from := d.review_status;

  select true into v_allowed from (values
    ('DRAFT','PENDING_REVIEW'),
    ('CHANGES_REQUESTED','PENDING_REVIEW'),
    ('PENDING_REVIEW','UNDER_REVIEW'),
    ('UNDER_REVIEW','APPROVED'),
    ('UNDER_REVIEW','REJECTED'),
    ('UNDER_REVIEW','CHANGES_REQUESTED'),
    ('CHANGES_REQUESTED','DRAFT'),
    ('REJECTED','DRAFT'),
    ('PENDING_REVIEW','DRAFT')
  ) as m(f, t) where m.f = v_from and m.t = p_to;
  if not coalesce(v_allowed, false) then
    raise exception 'A document cannot move from % to %', v_from, p_to using errcode = '22023';
  end if;

  v_needs := case when p_to in ('APPROVED','REJECTED','CHANGES_REQUESTED','UNDER_REVIEW')
                  then 'approve' else 'update' end;
  if not public.has_permission('dms_documents', v_needs) then
    raise exception 'Not authorized to % this document', v_needs using errcode = '42501';
  end if;

  if p_to = 'PENDING_REVIEW' then
    -- Nothing to review without bytes. current_version_id is only set by
    -- dms_finalize_upload, so this also proves the upload completed.
    if d.current_version_id is null then
      raise exception 'Upload a version before submitting this document for review'
        using errcode = '22023';
    end if;
    select * into v_cur from public.dms_document_versions where id = d.current_version_id;
    if v_cur.upload_state not in ('UPLOADED','LEGACY') then
      raise exception 'The current version is % and cannot be reviewed', v_cur.upload_state
        using errcode = '22023';
    end if;
    update public.dms_documents
       set review_status = 'PENDING_REVIEW', submitted_at = now(), submitted_by = auth.uid(),
           review_started_at = null, reviewer_id = null, reviewed_at = null,
           review_notes = coalesce(v_note, review_notes),
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;

  elsif p_to = 'UNDER_REVIEW' then
    update public.dms_documents
       set review_status = 'UNDER_REVIEW', review_started_at = now(), reviewer_id = auth.uid(),
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;

  elsif p_to = 'APPROVED' then
    if d.submitted_by is not null and d.submitted_by = auth.uid() and public.staff_role() <> 'ADMIN' then
      raise exception 'The account that submitted a document cannot approve it'
        using errcode = '42501';
    end if;
    update public.dms_documents
       set review_status = 'APPROVED', status = 'active',
           reviewed_at = now(), approved_at = now(), approved_by = auth.uid(),
           rejection_reason = null,
           review_notes = coalesce(v_note, review_notes),
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;

  elsif p_to = 'REJECTED' then
    if v_note is null then
      raise exception 'A rejection needs a reason' using errcode = '22023';
    end if;
    update public.dms_documents
       set review_status = 'REJECTED', reviewed_at = now(), rejection_reason = v_note,
           approved_at = null, approved_by = null,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;

  elsif p_to = 'CHANGES_REQUESTED' then
    if v_note is null then
      raise exception 'Say what needs to change' using errcode = '22023';
    end if;
    update public.dms_documents
       set review_status = 'CHANGES_REQUESTED', reviewed_at = now(), review_notes = v_note,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;

  else -- DRAFT: the author takes it back to rework it.
    update public.dms_documents
       set review_status = 'DRAFT',
           submitted_at = null, submitted_by = null,
           review_started_at = null, reviewer_id = null, reviewed_at = null,
           approved_at = null, approved_by = null, rejection_reason = null,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;
  end if;

  perform private.dms_log_event(d.id,
    case p_to
      when 'PENDING_REVIEW'     then 'SUBMITTED'
      when 'UNDER_REVIEW'       then 'REVIEW_STARTED'
      when 'APPROVED'           then 'APPROVED'
      when 'REJECTED'           then 'REJECTED'
      when 'CHANGES_REQUESTED'  then 'CHANGES_REQUESTED'
      else 'RESTORED'
    end,
    v_from, p_to, v_note, d.current_version_id);

  return jsonb_build_object('document_id', d.id, 'from', v_from, 'to', p_to);
end;
$$;
revoke all on function private.dms_review_transition(uuid,text,text) from public, anon, authenticated;

-- ============================================================================
-- M. Expiry. A passport that expired last month is not a valid document, and a
--    subsystem that cannot say so is not managing documents. EXPIRED is reachable
--    only from APPROVED and only through this sweep: it is a fact about the
--    calendar, not a decision a person makes, so it deliberately has no command.
--
--    The sweep is idempotent and safe to run on a schedule. It also emits one
--    EXPIRY_NOTICE per document per notice window -- expiry_notified_at is what
--    stops a daily job from writing the same warning thirty times.
-- ============================================================================

create or replace function private.dms_expire_due_documents()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r        record;
  v_expired integer := 0;
  v_noticed integer := 0;
begin
  if not public.has_permission('dms_documents','update') then
    raise exception 'Not authorized to run the document expiry sweep' using errcode = '42501';
  end if;

  for r in
    select d.id, d.review_status, d.expires_on
      from public.dms_documents d
     where d.review_status = 'APPROVED'
       and d.expires_on is not null
       and d.expires_on < current_date
       and public.row_in_staff_scope(d.agency_id, d.branch_id)
     order by d.expires_on
     for update
  loop
    update public.dms_documents
       set review_status = 'EXPIRED', updated_at = now()
     where id = r.id;
    perform private.dms_log_event(r.id, 'EXPIRED', 'APPROVED', 'EXPIRED',
      'Expired on ' || r.expires_on::text);
    v_expired := v_expired + 1;
  end loop;

  for r in
    select d.id, d.expires_on
      from public.dms_documents d
     where d.review_status = 'APPROVED'
       and d.expires_on is not null
       and d.expires_on >= current_date
       and d.expires_on <= current_date + d.expiry_notice_days
       and d.expiry_notified_at is null
       and public.row_in_staff_scope(d.agency_id, d.branch_id)
     order by d.expires_on
     for update
  loop
    update public.dms_documents set expiry_notified_at = now(), updated_at = now() where id = r.id;
    perform private.dms_log_event(r.id, 'EXPIRY_NOTICE', 'APPROVED', 'APPROVED',
      'Expires on ' || r.expires_on::text);
    v_noticed := v_noticed + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'notified', v_noticed, 'as_of', current_date);
end;
$$;
revoke all on function private.dms_expire_due_documents() from public, anon, authenticated;

create or replace function private.dms_set_document_archived(
  p_document_id uuid, p_archived boolean, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d public.dms_documents%rowtype;
begin
  if not public.has_permission('dms_documents','update') then
    raise exception 'Not authorized to archive documents' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_document_id for update;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;

  if p_archived then
    if d.status = 'archived' then
      raise exception 'Document is already archived' using errcode = '22023';
    end if;
    -- A document inside a sealed evidence package is part of a record somebody
    -- has already relied on. Archiving hides it from the workspace, which would
    -- make that record incomplete to the next reader.
    if exists (
      select 1 from public.evidence_package_documents epd
        join public.evidence_packages ep on ep.id = epd.evidence_package_id
       where epd.document_id = d.id and ep.status = 'SEALED') then
      raise exception 'This document belongs to a sealed evidence package and cannot be archived'
        using errcode = '22023';
    end if;
    update public.dms_documents
       set status = 'archived', archived_at = now(), updated_by = auth.uid(), updated_at = now()
     where id = d.id;
    perform private.dms_log_event(d.id, 'ARCHIVED', d.status::text, 'archived', p_reason);
  else
    if d.status <> 'archived' then
      raise exception 'Document is not archived' using errcode = '22023';
    end if;
    update public.dms_documents
       set status = case when d.review_status = 'APPROVED' then 'active' else 'draft' end::document_status,
           archived_at = null, updated_by = auth.uid(), updated_at = now()
     where id = d.id;
    perform private.dms_log_event(d.id, 'RESTORED', 'archived', 'active', p_reason);
  end if;
  return jsonb_build_object('document_id', d.id, 'archived', p_archived);
end;
$$;
revoke all on function private.dms_set_document_archived(uuid,boolean,text) from public, anon, authenticated;

-- ============================================================================
-- N. Relationships: link to a business object, or relate to another document.
-- ============================================================================

create or replace function private.dms_link_document(
  p_document_id uuid, p_entity_type text, p_entity_id uuid,
  p_relation text default 'ABOUT', p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d      public.dms_documents%rowtype;
  v_id   uuid;
begin
  if not public.has_permission('dms_document_links','create') then
    raise exception 'Not authorized to link documents' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_document_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;

  insert into public.dms_document_links(
    agency_id, branch_id, document_id, entity_type, entity_id, relation, note, created_by)
  values (d.agency_id, d.branch_id, d.id, p_entity_type, p_entity_id,
          coalesce(p_relation,'ABOUT'), nullif(trim(coalesce(p_note,'')),''), auth.uid())
  on conflict (document_id, entity_type, entity_id, relation) do nothing
  returning id into v_id;

  if v_id is null then
    -- Already linked. Returning the existing edge is what the caller wanted; a
    -- unique violation here would be a failure report for a state that is correct.
    select l.id into v_id from public.dms_document_links l
     where l.document_id = d.id and l.entity_type = p_entity_type
       and l.entity_id = p_entity_id and l.relation = coalesce(p_relation,'ABOUT');
    return jsonb_build_object('link_id', v_id, 'created', false);
  end if;

  perform private.dms_log_event(d.id, 'LINK_ADDED', null, null,
    p_relation || ' ' || p_entity_type, null,
    jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id,
                       'relation', coalesce(p_relation,'ABOUT'), 'link_id', v_id));
  return jsonb_build_object('link_id', v_id, 'created', true);
end;
$$;
revoke all on function private.dms_link_document(uuid,text,uuid,text,text) from public, anon, authenticated;

create or replace function private.dms_unlink_document(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l public.dms_document_links%rowtype;
begin
  if not public.has_permission('dms_document_links','delete') then
    raise exception 'Not authorized to unlink documents' using errcode = '42501';
  end if;
  select * into l from public.dms_document_links where id = p_link_id;
  if not found or not public.row_in_staff_scope(l.agency_id, l.branch_id) then
    raise exception 'Link not found in authorized scope' using errcode = '42501';
  end if;
  delete from public.dms_document_links where id = l.id;
  perform private.dms_log_event(l.document_id, 'LINK_REMOVED', null, null,
    l.relation || ' ' || l.entity_type, null,
    jsonb_build_object('entity_type', l.entity_type, 'entity_id', l.entity_id));
  return jsonb_build_object('link_id', l.id, 'removed', true);
end;
$$;
revoke all on function private.dms_unlink_document(uuid) from public, anon, authenticated;

create or replace function private.dms_relate_documents(
  p_from_document_id uuid, p_to_document_id uuid, p_relation text, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a public.dms_documents%rowtype;
  b public.dms_documents%rowtype;
  v_id uuid;
begin
  if not public.has_permission('dms_document_relations','create') then
    raise exception 'Not authorized to relate documents' using errcode = '42501';
  end if;
  if p_from_document_id = p_to_document_id then
    raise exception 'A document cannot be related to itself' using errcode = '22023';
  end if;
  select * into a from public.dms_documents where id = p_from_document_id;
  if not found or not public.row_in_staff_scope(a.agency_id, a.branch_id) then
    raise exception 'Source document not found in authorized scope' using errcode = '42501';
  end if;
  select * into b from public.dms_documents where id = p_to_document_id;
  if not found or not public.row_in_staff_scope(b.agency_id, b.branch_id) then
    raise exception 'Target document not found in authorized scope' using errcode = '42501';
  end if;

  -- SUPERSEDES is the one relation with a direction that means something, so it
  -- is the one that must not form a cycle: A supersedes B supersedes A leaves no
  -- current document and makes any "latest" query loop forever.
  --
  -- The walk starts at the TARGET and asks whether the source is already
  -- downstream of it, and that direction is the entire check. Adding from -> to
  -- closes a loop exactly when `to` can already reach `from`. Walking out from
  -- `from` instead would answer a different question -- whether `to` is already
  -- downstream of `from` -- which flags a redundant shortcut (A supersedes B
  -- supersedes C, then A supersedes C) as a cycle while letting the actual
  -- two-step loop through, since a freshly superseded document supersedes nothing
  -- and its own walk terminates immediately.
  if p_relation = 'SUPERSEDES' and exists (
    with recursive chain(id) as (
      select p_to_document_id
      union
      select r.to_document_id from public.dms_document_relations r
        join chain c on c.id = r.from_document_id
       where r.relation = 'SUPERSEDES'
    )
    select 1 from chain where id = p_from_document_id
  ) then
    raise exception 'That would make a supersede cycle' using errcode = '22023';
  end if;

  insert into public.dms_document_relations(
    agency_id, branch_id, from_document_id, to_document_id, relation, note, created_by)
  values (a.agency_id, a.branch_id, a.id, b.id, p_relation,
          nullif(trim(coalesce(p_note,'')),''), auth.uid())
  on conflict (from_document_id, to_document_id, relation) do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id from public.dms_document_relations r
     where r.from_document_id = a.id and r.to_document_id = b.id and r.relation = p_relation;
    return jsonb_build_object('relation_id', v_id, 'created', false);
  end if;

  perform private.dms_log_event(a.id, 'RELATION_ADDED', null, null,
    p_relation || ' ' || coalesce(b.document_number, b.id::text), null,
    jsonb_build_object('to_document_id', b.id, 'relation', p_relation, 'relation_id', v_id));

  -- A superseded document is not a current document. Saying so on the target is
  -- the whole reason to record the relation.
  if p_relation = 'SUPERSEDES' and b.review_status = 'APPROVED' then
    update public.dms_documents
       set review_status = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now()
     where id = b.id;
    perform private.dms_log_event(b.id, 'SUPERSEDED', 'APPROVED', 'SUPERSEDED',
      'Superseded by ' || coalesce(a.document_number, a.id::text));
  end if;

  return jsonb_build_object('relation_id', v_id, 'created', true);
end;
$$;
revoke all on function private.dms_relate_documents(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function private.dms_unrelate_documents(p_relation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.dms_document_relations%rowtype;
begin
  if not public.has_permission('dms_document_relations','delete') then
    raise exception 'Not authorized to remove document relations' using errcode = '42501';
  end if;
  select * into r from public.dms_document_relations where id = p_relation_id;
  if not found or not public.row_in_staff_scope(r.agency_id, r.branch_id) then
    raise exception 'Relation not found in authorized scope' using errcode = '42501';
  end if;
  delete from public.dms_document_relations where id = r.id;
  perform private.dms_log_event(r.from_document_id, 'RELATION_REMOVED', null, null, r.relation,
    null, jsonb_build_object('to_document_id', r.to_document_id, 'relation', r.relation));
  return jsonb_build_object('relation_id', r.id, 'removed', true);
end;
$$;
revoke all on function private.dms_unrelate_documents(uuid) from public, anon, authenticated;

-- ============================================================================
-- O. Extraction and its review. The job carries the run; the fields carry what
--    was read and whether a human has confirmed it. Nothing in this file performs
--    OCR -- that is a worker's job -- but everything the worker needs to report
--    into, and everything a reviewer needs to correct, is here.
-- ============================================================================

create or replace function private.dms_queue_extraction(
  p_document_id uuid, p_engine text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d      public.dms_documents%rowtype;
  v_job  uuid;
begin
  if not public.has_permission('extraction_jobs','create') then
    raise exception 'Not authorized to queue extraction' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_document_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  if d.current_version_id is null then
    raise exception 'There is nothing to extract until a version is uploaded' using errcode = '22023';
  end if;
  if exists (select 1 from public.extraction_jobs j
              where j.version_id = d.current_version_id and j.status in ('pending','processing')) then
    raise exception 'An extraction job for this version is already queued' using errcode = '22023';
  end if;

  insert into public.extraction_jobs(
    agency_id, branch_id, document_id, version_id, status, engine, requested_by)
  values (d.agency_id, d.branch_id, d.id, d.current_version_id, 'pending',
          coalesce(p_engine,'MANUAL'), auth.uid())
  returning id into v_job;

  perform private.dms_log_event(d.id, 'EXTRACTION_QUEUED', null, null,
    'Engine ' || coalesce(p_engine,'MANUAL'), d.current_version_id,
    jsonb_build_object('job_id', v_job));
  return jsonb_build_object('job_id', v_job, 'status', 'pending');
end;
$$;
revoke all on function private.dms_queue_extraction(uuid,text) from public, anon, authenticated;

create or replace function private.dms_record_extraction_result(
  p_job_id     uuid,
  p_status     text,
  p_fields     jsonb   default '[]'::jsonb,
  p_confidence numeric default null,
  p_error      text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j        public.extraction_jobs%rowtype;
  f        jsonb;
  v_count  integer := 0;
begin
  if not public.has_permission('extraction_jobs','update') then
    raise exception 'Not authorized to record extraction results' using errcode = '42501';
  end if;
  if p_status not in ('processing','completed','failed') then
    raise exception 'Extraction status must be processing, completed or failed' using errcode = '22023';
  end if;
  select * into j from public.extraction_jobs where id = p_job_id for update;
  if not found or not public.row_in_staff_scope(j.agency_id, j.branch_id) then
    raise exception 'Extraction job not found in authorized scope' using errcode = '42501';
  end if;
  if j.status in ('completed','failed') then
    raise exception 'Extraction job is already %', j.status using errcode = '22023';
  end if;
  if p_status = 'failed' and length(trim(coalesce(p_error,''))) = 0 then
    raise exception 'A failed extraction needs an error message' using errcode = '22023';
  end if;
  if p_status <> 'processing' and j.attempts + 1 > j.max_attempts then
    raise exception 'Extraction job has used all % attempts', j.max_attempts using errcode = '22023';
  end if;

  update public.extraction_jobs
     set status        = p_status::extraction_job_status,
         attempts      = case when p_status = 'processing' then attempts else attempts + 1 end,
         started_at    = coalesce(started_at, now()),
         finished_at   = case when p_status = 'processing' then null else now() end,
         confidence    = coalesce(p_confidence, confidence),
         error_message = case when p_status = 'failed' then trim(p_error) else null end,
         extracted_data = case when p_status = 'completed'
                               then coalesce(p_fields, '[]'::jsonb) else extracted_data end,
         updated_at    = now()
   where id = j.id;

  if p_status = 'completed' then
    -- Re-running an extraction replaces the machine's reading. Fields a human has
    -- already accepted or corrected are kept: their review is the more reliable
    -- value, and silently discarding it would make the review pointless.
    delete from public.dms_extracted_fields
     where job_id = j.id and review_state = 'PENDING';

    for f in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
      if coalesce(trim(f->>'key'), '') <> '' then
        insert into public.dms_extracted_fields(
          agency_id, branch_id, job_id, document_id, field_key, field_label,
          raw_value, value, confidence, page_number, bounding_box)
        values (
          j.agency_id, j.branch_id, j.id, j.document_id, trim(f->>'key'), f->>'label',
          f->>'raw_value', coalesce(f->>'value', f->>'raw_value'),
          nullif(f->>'confidence','')::numeric, nullif(f->>'page_number','')::integer,
          case when jsonb_typeof(f->'bounding_box') = 'object' then f->'bounding_box' end)
        on conflict (job_id, field_key) do nothing;
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  perform private.dms_log_event(j.document_id,
    case when p_status = 'failed' then 'EXTRACTION_FAILED'
         when p_status = 'completed' then 'EXTRACTION_COMPLETED'
         else 'EXTRACTION_QUEUED' end,
    j.status::text, p_status, coalesce(p_error, v_count::text || ' field(s) read'),
    j.version_id, jsonb_build_object('job_id', j.id, 'confidence', p_confidence));

  return jsonb_build_object('job_id', j.id, 'status', p_status, 'fields', v_count);
end;
$$;
revoke all on function private.dms_record_extraction_result(uuid,text,jsonb,numeric,text)
  from public, anon, authenticated;

create or replace function private.dms_review_extracted_field(
  p_field_id uuid, p_action text, p_value text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  fld       public.dms_extracted_fields%rowtype;
  v_state   text;
  v_pending integer;
  v_touched integer;
  v_job     text;
begin
  if not public.has_permission('dms_extracted_fields','update') then
    raise exception 'Not authorized to review extracted fields' using errcode = '42501';
  end if;
  if p_action not in ('ACCEPT','CORRECT','REJECT') then
    raise exception 'Field review action must be ACCEPT, CORRECT or REJECT' using errcode = '22023';
  end if;
  select * into fld from public.dms_extracted_fields where id = p_field_id for update;
  if not found or not public.row_in_staff_scope(fld.agency_id, fld.branch_id) then
    raise exception 'Extracted field not found in authorized scope' using errcode = '42501';
  end if;
  if p_action = 'CORRECT' and length(coalesce(p_value,'')) = 0 then
    raise exception 'A correction needs the corrected value' using errcode = '22023';
  end if;

  v_state := case p_action when 'ACCEPT' then 'ACCEPTED'
                           when 'CORRECT' then 'CORRECTED'
                           else 'REJECTED' end;

  update public.dms_extracted_fields
     set review_state = v_state,
         value = case when p_action = 'CORRECT' then p_value
                      when p_action = 'REJECT'  then null
                      else coalesce(value, raw_value) end,
         reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
   where id = fld.id;

  select count(*) filter (where review_state = 'PENDING'),
         count(*) filter (where review_state <> 'PENDING')
    into v_pending, v_touched
    from public.dms_extracted_fields where job_id = fld.job_id;

  v_job := case when v_pending = 0 then 'REVIEWED'
                when v_touched > 0 then 'PARTIALLY_REVIEWED'
                else 'NOT_REVIEWED' end;
  update public.extraction_jobs
     set review_state = v_job,
         reviewed_at = case when v_pending = 0 then now() else reviewed_at end,
         reviewed_by = case when v_pending = 0 then auth.uid() else reviewed_by end,
         updated_at = now()
   where id = fld.job_id;

  perform private.dms_log_event(fld.document_id,
    case p_action when 'ACCEPT' then 'FIELD_ACCEPTED'
                  when 'CORRECT' then 'FIELD_CORRECTED'
                  else 'FIELD_REJECTED' end,
    'PENDING', v_state, fld.field_key, null,
    jsonb_build_object('field_key', fld.field_key, 'job_id', fld.job_id,
                       'raw_value', fld.raw_value, 'value', p_value));

  return jsonb_build_object('field_id', fld.id, 'review_state', v_state,
                            'job_review_state', v_job, 'pending', v_pending);
end;
$$;
revoke all on function private.dms_review_extracted_field(uuid,text,text) from public, anon, authenticated;

-- ============================================================================
-- P. Evidence packages. A package is only worth something if it can be sealed
--    and then verified, so both operations exist here and the seal is a checksum
--    over the members' checksums in a fixed order.
-- ============================================================================

create or replace function private.dms_create_evidence_package(
  p_name text, p_purpose text default null, p_reference text default null, p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_agency uuid := public.staff_agency_id();
  v_id uuid;
begin
  if not public.has_permission('evidence_packages','create') then
    raise exception 'Not authorized to create evidence packages' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then
    raise exception 'An evidence package needs a name' using errcode = '22023';
  end if;
  if v_agency is null then
    raise exception 'No active staff profile for this session' using errcode = '42501';
  end if;
  insert into public.evidence_packages(
    agency_id, branch_id, name, status, purpose, reference, notes, workspace_id, created_by)
  values (v_agency, public.staff_branch_id(), trim(p_name), 'OPEN',
          nullif(trim(coalesce(p_purpose,'')),''), nullif(trim(coalesce(p_reference,'')),''),
          nullif(trim(coalesce(p_notes,'')),''), 'DEFAULT', auth.uid())
  returning id into v_id;
  return jsonb_build_object('evidence_package_id', v_id, 'status', 'OPEN');
end;
$$;
revoke all on function private.dms_create_evidence_package(text,text,text,text) from public, anon, authenticated;

create or replace function private.dms_set_package_document(
  p_package_id uuid, p_document_id uuid, p_include boolean, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  ep      public.evidence_packages%rowtype;
  d       public.dms_documents%rowtype;
  v_seq   integer;
  v_count integer;
begin
  if not public.has_permission('evidence_package_documents', case when p_include then 'create' else 'delete' end) then
    raise exception 'Not authorized to change evidence package contents' using errcode = '42501';
  end if;
  select * into ep from public.evidence_packages where id = p_package_id for update;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;
  if ep.status <> 'OPEN' then
    raise exception 'Evidence package is % and can no longer be changed', ep.status using errcode = '22023';
  end if;
  select * into d from public.dms_documents where id = p_document_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;

  if p_include then
    -- current_version_id is NULL until an upload is finalized, and the insert
    -- below selects from the version row -- so without this the call would be a
    -- silent no-op instead of an answer.
    if d.current_version_id is null then
      raise exception 'This document has no uploaded version to include' using errcode = '22023';
    end if;
    select coalesce(max(sequence_no), 0) + 1 into v_seq
      from public.evidence_package_documents where evidence_package_id = ep.id;
    insert into public.evidence_package_documents(
      agency_id, branch_id, evidence_package_id, document_id, version_id,
      sequence_no, checksum_sha256, note, added_by)
    select ep.agency_id, ep.branch_id, ep.id, d.id, d.current_version_id,
           v_seq, v.checksum_sha256, nullif(trim(coalesce(p_note,'')),''), auth.uid()
      from public.dms_document_versions v where v.id = d.current_version_id
    on conflict (evidence_package_id, document_id) do nothing;
    perform private.dms_log_event(d.id, 'PACKAGE_ADDED', null, null, ep.name, d.current_version_id,
      jsonb_build_object('evidence_package_id', ep.id));
  else
    delete from public.evidence_package_documents
     where evidence_package_id = ep.id and document_id = d.id;
    perform private.dms_log_event(d.id, 'PACKAGE_REMOVED', null, null, ep.name, null,
      jsonb_build_object('evidence_package_id', ep.id));
  end if;

  select count(*) into v_count from public.evidence_package_documents
   where evidence_package_id = ep.id;
  update public.evidence_packages set document_count = v_count, updated_at = now() where id = ep.id;

  return jsonb_build_object('evidence_package_id', ep.id, 'document_id', d.id,
                            'included', p_include, 'document_count', v_count);
end;
$$;
revoke all on function private.dms_set_package_document(uuid,uuid,boolean,text) from public, anon, authenticated;

-- The seal digest, factored out so sealing and verifying cannot disagree: the
-- members in sequence order, each as document_id:version_id:checksum, joined and
-- hashed. sha256() over bytea is in core Postgres, so this needs no extension.
create or replace function private.dms_package_digest(p_package_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select encode(sha256(convert_to(coalesce(string_agg(
           epd.document_id::text || ':' || coalesce(epd.version_id::text,'-') || ':' ||
           coalesce(v.checksum_sha256, epd.checksum_sha256, '-'),
           '|' order by epd.sequence_no, epd.document_id), ''), 'UTF8')), 'hex')
    from public.evidence_package_documents epd
    left join public.dms_document_versions v on v.id = epd.version_id
   where epd.evidence_package_id = p_package_id;
$$;
revoke all on function private.dms_package_digest(uuid) from public, anon, authenticated;

create or replace function private.dms_seal_evidence_package(p_package_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  ep       public.evidence_packages%rowtype;
  v_count  integer;
  v_bad    text;
  v_digest text;
begin
  if not public.has_permission('evidence_packages','seal') then
    raise exception 'Not authorized to seal evidence packages' using errcode = '42501';
  end if;
  select * into ep from public.evidence_packages where id = p_package_id for update;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;
  if ep.status <> 'OPEN' then
    raise exception 'Evidence package is already %', ep.status using errcode = '22023';
  end if;

  select count(*) into v_count from public.evidence_package_documents
   where evidence_package_id = ep.id;
  if v_count = 0 then
    raise exception 'An empty evidence package cannot be sealed' using errcode = '22023';
  end if;

  -- The rule that makes a seal mean something: every member is an approved
  -- document whose bytes were measured. A package of drafts is a folder.
  select string_agg(coalesce(d.document_number, d.id::text) || ' (' || d.review_status || ')', ', ')
    into v_bad
    from public.evidence_package_documents epd
    join public.dms_documents d on d.id = epd.document_id
   where epd.evidence_package_id = ep.id and d.review_status <> 'APPROVED';
  if v_bad is not null then
    raise exception 'These documents are not approved: %', v_bad using errcode = '22023';
  end if;

  select string_agg(coalesce(d.document_number, d.id::text), ', ')
    into v_bad
    from public.evidence_package_documents epd
    join public.dms_documents d on d.id = epd.document_id
    left join public.dms_document_versions v on v.id = epd.version_id
   where epd.evidence_package_id = ep.id and coalesce(v.checksum_sha256, '') = '';
  if v_bad is not null then
    raise exception 'These documents have no verified checksum: %', v_bad using errcode = '22023';
  end if;

  v_digest := private.dms_package_digest(ep.id);

  update public.evidence_packages
     set status = 'SEALED', sealed_at = now(), sealed_by = auth.uid(),
         seal_checksum = v_digest, document_count = v_count,
         notes = coalesce(nullif(trim(coalesce(p_note,'')),''), notes), updated_at = now()
   where id = ep.id;

  -- One event per member: the package is sealed, and each document's own timeline
  -- says which record it became part of.
  perform private.dms_log_event(epd.document_id, 'PACKAGE_SEALED', 'OPEN', 'SEALED',
            ep.name, epd.version_id,
            jsonb_build_object('evidence_package_id', ep.id, 'seal_checksum', v_digest))
     from public.evidence_package_documents epd
    where epd.evidence_package_id = ep.id;

  return jsonb_build_object('evidence_package_id', ep.id, 'status', 'SEALED',
                            'document_count', v_count, 'seal_checksum', v_digest);
end;
$$;
revoke all on function private.dms_seal_evidence_package(uuid,text) from public, anon, authenticated;

-- Verification is the other half of sealing, and without it the seal is
-- decoration. Recompute the digest and say whether it still matches, plus which
-- members drifted -- a document whose current version is no longer the version
-- that was sealed, or whose recorded checksum changed.
create or replace function private.dms_verify_evidence_package(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  ep      public.evidence_packages%rowtype;
  v_now   text;
  v_drift jsonb;
begin
  if not public.has_permission('evidence_packages','read') then
    raise exception 'Not authorized to read evidence packages' using errcode = '42501';
  end if;
  select * into ep from public.evidence_packages where id = p_package_id;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;

  v_now := private.dms_package_digest(ep.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id',      epd.document_id,
           'document_number',  d.document_number,
           'title',            d.title,
           'sealed_version_id', epd.version_id,
           'current_version_id', d.current_version_id,
           'sealed_checksum',  epd.checksum_sha256,
           'current_checksum', v.checksum_sha256,
           'review_status',    d.review_status)
         order by epd.sequence_no), '[]'::jsonb) into v_drift
    from public.evidence_package_documents epd
    join public.dms_documents d on d.id = epd.document_id
    left join public.dms_document_versions v on v.id = epd.version_id
   where epd.evidence_package_id = ep.id
     and (epd.version_id is distinct from d.current_version_id
          or coalesce(v.checksum_sha256,'') is distinct from coalesce(epd.checksum_sha256,''));

  return jsonb_build_object(
    'evidence_package_id', ep.id,
    'status',              ep.status,
    'sealed_at',           ep.sealed_at,
    'seal_checksum',       ep.seal_checksum,
    'recomputed_checksum', v_now,
    'matches',             ep.status = 'SEALED' and ep.seal_checksum = v_now,
    'drift',               v_drift);
end;
$$;
revoke all on function private.dms_verify_evidence_package(uuid) from public, anon, authenticated;
-- ============================================================================
-- Q. Public command surface. Business names only; the UI never names a table
--    and never names a state string it did not get from a command's own name.
--    Six of these wrap one private body -- dms_review_transition -- because
--    the machine lives in exactly one place (section L) and a caller that can
--    only say "approve" cannot invent a transition the machine does not have.
-- ============================================================================

create or replace function public.reserve_dms_upload_command(
  p_title              text,
  p_document_type      text,
  p_original_filename  text,
  p_document_id        uuid    default null,
  p_description        text    default null,
  p_confidentiality    text    default 'INTERNAL',
  p_issued_on          date    default null,
  p_expires_on         date    default null,
  p_expiry_notice_days integer default 30,
  p_tags               text[]  default '{}',
  p_workspace_id       text    default 'DEFAULT'
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_reserve_upload($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
$w$;

create or replace function public.finalize_dms_upload_command(
  p_version_id       uuid,
  p_size_bytes       bigint,
  p_mime_type        text,
  p_checksum_sha256  text,
  p_page_count       integer default null,
  p_queue_extraction boolean default true
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_finalize_upload($1, $2, $3, $4, $5, $6);
$w$;

create or replace function public.discard_dms_upload_command(
  p_version_id uuid, p_reason text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_discard_reservation($1, $2);
$w$;

create or replace function public.submit_dms_document_command(
  p_document_id uuid, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'PENDING_REVIEW', $2);
$w$;

create or replace function public.start_dms_review_command(
  p_document_id uuid, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'UNDER_REVIEW', $2);
$w$;

create or replace function public.approve_dms_document_command(
  p_document_id uuid, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'APPROVED', $2);
$w$;

create or replace function public.reject_dms_document_command(
  p_document_id uuid, p_reason text
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'REJECTED', $2);
$w$;

create or replace function public.request_dms_changes_command(
  p_document_id uuid, p_note text
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'CHANGES_REQUESTED', $2);
$w$;

create or replace function public.reopen_dms_document_command(
  p_document_id uuid, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_transition($1, 'DRAFT', $2);
$w$;

create or replace function public.archive_dms_document_command(
  p_document_id uuid, p_archived boolean default true, p_reason text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_set_document_archived($1, $2, $3);
$w$;

-- No expire_dms_document_command exists on purpose: EXPIRED is a fact about the
-- calendar, so the only way in is the sweep, which decides by date and not by
-- who asked.
create or replace function public.run_dms_expiry_sweep_command()
returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_expire_due_documents();
$w$;

create or replace function public.link_dms_document_command(
  p_document_id uuid, p_entity_type text, p_entity_id uuid,
  p_relation text default 'ABOUT', p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_link_document($1, $2, $3, $4, $5);
$w$;

create or replace function public.unlink_dms_document_command(p_link_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_unlink_document($1);
$w$;

create or replace function public.relate_dms_documents_command(
  p_from_document_id uuid, p_to_document_id uuid, p_relation text, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_relate_documents($1, $2, $3, $4);
$w$;

create or replace function public.unrelate_dms_documents_command(p_relation_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_unrelate_documents($1);
$w$;

create or replace function public.queue_dms_extraction_command(
  p_document_id uuid, p_engine text default 'MANUAL'
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_queue_extraction($1, $2);
$w$;

create or replace function public.record_dms_extraction_result_command(
  p_job_id     uuid,
  p_status     text,
  p_fields     jsonb   default '[]'::jsonb,
  p_confidence numeric default null,
  p_error      text    default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_record_extraction_result($1, $2, $3, $4, $5);
$w$;

create or replace function public.review_dms_extracted_field_command(
  p_field_id uuid, p_action text, p_value text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_review_extracted_field($1, $2, $3);
$w$;

create or replace function public.create_dms_evidence_package_command(
  p_name text, p_purpose text default null, p_reference text default null, p_notes text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_create_evidence_package($1, $2, $3, $4);
$w$;

create or replace function public.set_dms_package_document_command(
  p_package_id uuid, p_document_id uuid, p_include boolean default true, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_set_package_document($1, $2, $3, $4);
$w$;

create or replace function public.seal_dms_evidence_package_command(
  p_package_id uuid, p_note text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.dms_seal_evidence_package($1, $2);
$w$;

create or replace function public.verify_dms_evidence_package_command(p_package_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $w$
  select private.dms_verify_evidence_package($1);
$w$;

-- One statement per grant so a reader can see the whole public write surface of
-- this subsystem in one screen, and so a name added later without a grant fails
-- loudly at the UI rather than quietly widening anything.
do $grants$
declare sig text;
begin
  foreach sig in array array[
    'reserve_dms_upload_command(text,text,text,uuid,text,text,date,date,integer,text[],text)',
    'finalize_dms_upload_command(uuid,bigint,text,text,integer,boolean)',
    'discard_dms_upload_command(uuid,text)',
    'submit_dms_document_command(uuid,text)',
    'start_dms_review_command(uuid,text)',
    'approve_dms_document_command(uuid,text)',
    'reject_dms_document_command(uuid,text)',
    'request_dms_changes_command(uuid,text)',
    'reopen_dms_document_command(uuid,text)',
    'archive_dms_document_command(uuid,boolean,text)',
    'run_dms_expiry_sweep_command()',
    'link_dms_document_command(uuid,text,uuid,text,text)',
    'unlink_dms_document_command(uuid)',
    'relate_dms_documents_command(uuid,uuid,text,text)',
    'unrelate_dms_documents_command(uuid)',
    'queue_dms_extraction_command(uuid,text)',
    'record_dms_extraction_result_command(uuid,text,jsonb,numeric,text)',
    'review_dms_extracted_field_command(uuid,text,text)',
    'create_dms_evidence_package_command(text,text,text,text)',
    'set_dms_package_document_command(uuid,uuid,boolean,text)',
    'seal_dms_evidence_package_command(uuid,text)',
    'verify_dms_evidence_package_command(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', sig);
    execute format('grant execute on function public.%s to authenticated', sig);
  end loop;
end $grants$;

-- ============================================================================
-- R. Metadata commands, written out rather than generated.
--
--    The CRM slice generates create/update/delete adapters over
--    patch_scoped_command_row, which accepts any column except
--    id/agency_id/branch_id/created_at/updated_at. On these two tables that
--    would be a hole, not a convenience: a client could patch
--    dms_documents.review_status to 'APPROVED' with its own approved_by, or
--    evidence_packages.status to 'SEALED' with a seal_checksum it made up, and
--    every control in sections L and P would be decoration. So the writable
--    columns are named here, one by one, and the state columns are reachable
--    only through the commands that own them.
-- ============================================================================

create or replace function public.update_dms_document_metadata_command(
  p_id                 uuid,
  p_title              text    default null,
  p_description        text    default null,
  p_document_type      text    default null,
  p_confidentiality    text    default null,
  p_issued_on          date    default null,
  p_expires_on         date    default null,
  p_expiry_notice_days integer default null,
  p_clear_expiry       boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  d public.dms_documents%rowtype;
begin
  if not public.has_permission('dms_documents','update') then
    raise exception 'Not authorized to edit documents' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_id for update;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  if d.review_status = 'UNDER_REVIEW' then
    raise exception 'A document under review cannot be edited; request changes first'
      using errcode = '22023';
  end if;

  update public.dms_documents
     set title              = coalesce(nullif(trim(coalesce(p_title,'')),''), title),
         description        = coalesce(p_description, description),
         document_type      = coalesce(nullif(trim(coalesce(p_document_type,'')),''), document_type),
         confidentiality    = coalesce(nullif(trim(coalesce(p_confidentiality,'')),''), confidentiality),
         issued_on          = coalesce(p_issued_on, issued_on),
         expires_on         = case when p_clear_expiry then null
                                   else coalesce(p_expires_on, expires_on) end,
         expiry_notice_days = coalesce(p_expiry_notice_days, expiry_notice_days),
         -- a new expiry date is a new warning to send, so the sent-marker clears
         expiry_notified_at = case when p_clear_expiry
                                    or (p_expires_on is not null and p_expires_on is distinct from d.expires_on)
                                   then null else expiry_notified_at end,
         updated_by         = auth.uid(),
         updated_at         = now()
   where id = d.id;

  perform private.dms_log_event(d.id, 'METADATA_UPDATED', d.review_status, d.review_status,
    'Metadata edited');
  return jsonb_build_object('id', d.id, 'updated', true);
end;
$$;

-- tags is text[]; it goes through its own command rather than a jsonb payload.
create or replace function public.set_dms_document_tags_command(p_id uuid, p_tags text[])
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row jsonb;
begin
  if not public.has_permission('dms_documents','update') then
    raise exception 'Not authorized to edit documents' using errcode = '42501';
  end if;
  update public.dms_documents t
     set tags = coalesce(p_tags, '{}'), updated_by = auth.uid(), updated_at = now()
   where t.id = p_id and public.row_in_staff_scope(t.agency_id, t.branch_id)
  returning jsonb_build_object('id', t.id, 'tags', t.tags) into v_row;
  if v_row is null then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- Deleting the row cascades the version rows, so their storage paths go into the
-- orphan queue declared in section K before the cascade runs -- afterwards no
-- policy can authorize removing those objects.
--
-- Deletion is the one operation an audit trail cannot reconstruct, so it is
-- refused for anything that has been approved, superseded, expired, or sealed
-- into a package. Those documents archive; they do not disappear.
create or replace function public.delete_dms_document_command(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  d public.dms_documents%rowtype;
  v_packages text;
  v_objects  integer;
begin
  if not public.has_permission('dms_documents','delete') then
    raise exception 'Not authorized to delete documents' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_id for update;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  if d.review_status in ('APPROVED','SUPERSEDED','EXPIRED') then
    raise exception 'A % document cannot be deleted; archive it instead', d.review_status
      using errcode = '22023';
  end if;

  select string_agg(ep.name, ', ') into v_packages
    from public.evidence_package_documents epd
    join public.evidence_packages ep on ep.id = epd.evidence_package_id
   where epd.document_id = d.id and ep.status = 'SEALED';
  if v_packages is not null then
    raise exception 'This document is sealed into: %', v_packages using errcode = '22023';
  end if;

  insert into public.dms_storage_orphans(
    agency_id, storage_bucket, storage_path, document_id, reason)
  select v.agency_id, v.storage_bucket, v.storage_path, v.document_id, 'document deleted'
    from public.dms_document_versions v
   where v.document_id = d.id;
  v_objects := coalesce((select count(*) from public.dms_document_versions where document_id = d.id), 0);

  delete from public.dms_documents where id = d.id;
  return jsonb_build_object('id', d.id, 'deleted', true, 'orphaned_objects', v_objects);
end;
$$;

-- Package metadata, and only metadata: status, sealed_at, sealed_by and
-- seal_checksum belong to section P and are unreachable from here.
create or replace function public.update_dms_evidence_package_command(
  p_id        uuid,
  p_name      text default null,
  p_purpose   text default null,
  p_reference text default null,
  p_notes     text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare ep public.evidence_packages%rowtype;
begin
  if not public.has_permission('evidence_packages','update') then
    raise exception 'Not authorized to edit evidence packages' using errcode = '42501';
  end if;
  select * into ep from public.evidence_packages where id = p_id for update;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;
  if ep.status <> 'OPEN' then
    raise exception 'A % package cannot be edited', ep.status using errcode = '22023';
  end if;
  update public.evidence_packages
     set name      = coalesce(nullif(trim(coalesce(p_name,'')),''), name),
         purpose   = coalesce(p_purpose, purpose),
         reference = coalesce(p_reference, reference),
         notes     = coalesce(p_notes, notes),
         updated_at = now()
   where id = ep.id;
  return jsonb_build_object('id', ep.id, 'updated', true);
end;
$$;

-- VOID is reachable only from OPEN. Voiding a sealed package would erase the one
-- fact the seal exists to record, and the constraint that a SEALED row carries a
-- checksum says nothing about a row that stopped being SEALED.
create or replace function public.void_dms_evidence_package_command(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare ep public.evidence_packages%rowtype;
begin
  if not public.has_permission('evidence_packages','update') then
    raise exception 'Not authorized to edit evidence packages' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'A reason is required to void a package' using errcode = '22023';
  end if;
  select * into ep from public.evidence_packages where id = p_id for update;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;
  if ep.status <> 'OPEN' then
    raise exception 'A % package cannot be voided', ep.status using errcode = '22023';
  end if;
  update public.evidence_packages
     set status = 'VOID',
         notes  = trim(coalesce(notes || E'\n', '') || 'Voided: ' || trim(p_reason)),
         updated_at = now()
   where id = ep.id;
  return jsonb_build_object('id', ep.id, 'status', 'VOID');
end;
$$;

create or replace function public.delete_dms_evidence_package_command(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare ep public.evidence_packages%rowtype; n integer;
begin
  if not public.has_permission('evidence_packages','delete') then
    raise exception 'Not authorized to delete evidence packages' using errcode = '42501';
  end if;
  select * into ep from public.evidence_packages where id = p_id for update;
  if not found or not public.row_in_staff_scope(ep.agency_id, ep.branch_id) then
    raise exception 'Evidence package not found in authorized scope' using errcode = '42501';
  end if;
  if ep.status <> 'OPEN' then
    raise exception 'A % package cannot be deleted; it is part of the record', ep.status
      using errcode = '22023';
  end if;
  select count(*) into n from public.evidence_package_documents where evidence_package_id = ep.id;
  if n > 0 then
    raise exception 'Remove the % document(s) from this package first, or void it', n
      using errcode = '22023';
  end if;
  delete from public.evidence_packages where id = ep.id;
  return jsonb_build_object('id', ep.id, 'deleted', true);
end;
$$;

-- Reading a confidential document is an event. The old document_access_logs
-- table cannot hold these -- its document_id references public.documents with
-- ON DELETE RESTRICT, so a DMS id fails the foreign key -- which is why access
-- lands in dms_document_events like every other fact about the document.
create or replace function public.record_dms_document_access_command(
  p_document_id uuid, p_action text default 'VIEWED'
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id bigint;
begin
  if p_action not in ('VIEWED','DOWNLOADED','SIGNED_URL_ISSUED') then
    raise exception 'Unknown access action %', p_action using errcode = '22023';
  end if;
  if not public.has_permission('dms_documents','read') then
    raise exception 'Not authorized to read documents' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.dms_documents d
     where d.id = p_document_id and public.row_in_staff_scope(d.agency_id, d.branch_id)
  ) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;
  v_id := private.dms_log_event(p_document_id, p_action, null, null, null);
  return jsonb_build_object('event_id', v_id, 'action', p_action);
end;
$$;

do $grants$
declare sig text;
begin
  foreach sig in array array[
    'update_dms_document_metadata_command(uuid,text,text,text,text,date,date,integer,boolean)',
    'set_dms_document_tags_command(uuid,text[])',
    'delete_dms_document_command(uuid)',
    'update_dms_evidence_package_command(uuid,text,text,text,text)',
    'void_dms_evidence_package_command(uuid,text)',
    'delete_dms_evidence_package_command(uuid)',
    'record_dms_document_access_command(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', sig);
    execute format('grant execute on function public.%s to authenticated', sig);
  end loop;
end $grants$;

-- ============================================================================
-- S. Analytics. SECURITY DEFINER bypasses RLS, so every query filters on
--    public.row_in_staff_scope explicitly.
-- ============================================================================

create or replace function public.get_dms_dashboard(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_status jsonb; v_type jsonb; v_conf jsonb; v_activity jsonb; v_totals jsonb;
begin
  if not public.has_permission('dms_documents','read') then
    raise exception 'Not authorized to read the document dashboard' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) into v_status
  from (
    select s.review_status, s.sort_order, count(d.id) as document_count
      from (values ('DRAFT',1),('PENDING_REVIEW',2),('UNDER_REVIEW',3),('APPROVED',4),
                   ('CHANGES_REQUESTED',5),('REJECTED',6),('EXPIRED',7),('SUPERSEDED',8))
             as s(review_status, sort_order)
      left join public.dms_documents d
             on d.review_status = s.review_status
            and public.row_in_staff_scope(d.agency_id, d.branch_id)
     group by s.review_status, s.sort_order
  ) x;

  select coalesce(jsonb_agg(x order by x.document_count desc, x.document_type), '[]'::jsonb) into v_type
  from (
    select d.document_type, count(*) as document_count,
           count(*) filter (where d.review_status = 'APPROVED') as approved_count
      from public.dms_documents d
     where public.row_in_staff_scope(d.agency_id, d.branch_id)
     group by d.document_type
  ) x;

  select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) into v_conf
  from (
    select c.confidentiality, c.sort_order, count(d.id) as document_count
      from (values ('PUBLIC',1),('INTERNAL',2),('CONFIDENTIAL',3),('RESTRICTED',4))
             as c(confidentiality, sort_order)
      left join public.dms_documents d
             on d.confidentiality = c.confidentiality
            and public.row_in_staff_scope(d.agency_id, d.branch_id)
     group by c.confidentiality, c.sort_order
  ) x;

  select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) into v_activity
  from (
    select to_char(g.day, 'YYYY-MM-DD') as day,
           count(e.id) filter (where e.event_type in ('VERSION_UPLOADED','CREATED')) as uploads,
           count(e.id) filter (where e.event_type = 'APPROVED')                      as approvals,
           count(e.id) filter (where e.event_type in ('REJECTED','CHANGES_REQUESTED')) as returns
      from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') as g(day)
      left join public.dms_document_events e
             on date_trunc('day', e.created_at) = g.day
            and public.row_in_staff_scope(e.agency_id, e.branch_id)
     group by g.day
  ) x;

  select jsonb_build_object(
    'documents',        count(*),
    'approved',         count(*) filter (where d.review_status = 'APPROVED'),
    'awaiting_review',  count(*) filter (where d.review_status in ('PENDING_REVIEW','UNDER_REVIEW')),
    'expiring_soon',    count(*) filter (where d.review_status = 'APPROVED' and d.expires_on is not null
                                           and d.expires_on <= current_date + 30),
    'expired',          count(*) filter (where d.review_status = 'EXPIRED'),
    'archived',         count(*) filter (where d.archived_at is not null),
    'versions',         coalesce(sum(d.version_count), 0),
    'created_in_window', count(*) filter (where d.created_at >= v_since)
  ) into v_totals
  from public.dms_documents d
  where public.row_in_staff_scope(d.agency_id, d.branch_id);

  return jsonb_build_object(
    'window_days',     v_days,
    'totals',          coalesce(v_totals, '{}'::jsonb),
    'by_status',       v_status,
    'by_type',         v_type,
    'by_confidentiality', v_conf,
    'activity',        v_activity);
end;
$$;

-- One call behind the document detail view. staff_profiles carries no name
-- column in this schema, so an actor is reported as its uuid and the role it
-- held at the time -- which is what the event row actually knows.
create or replace function public.get_dms_document_360(p_document_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  d public.dms_documents%rowtype;
  v_versions jsonb; v_links jsonb; v_relations jsonb; v_events jsonb;
  v_jobs jsonb; v_packages jsonb;
begin
  if not public.has_permission('dms_documents','read') then
    raise exception 'Not authorized to read documents' using errcode = '42501';
  end if;
  select * into d from public.dms_documents where id = p_document_id;
  if not found or not public.row_in_staff_scope(d.agency_id, d.branch_id) then
    raise exception 'Document not found in authorized scope' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'version_number', v.version_number, 'upload_state', v.upload_state,
           'original_filename', v.original_filename, 'mime_type', v.mime_type,
           'size_bytes', v.size_bytes, 'checksum_sha256', v.checksum_sha256,
           'page_count', v.page_count, 'storage_bucket', v.storage_bucket,
           'storage_path', v.storage_path, 'uploaded_at', v.uploaded_at,
           'superseded_at', v.superseded_at, 'notes', v.notes,
           'is_current', v.id = d.current_version_id)
         order by v.version_number desc), '[]'::jsonb) into v_versions
    from public.dms_document_versions v where v.document_id = d.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'entity_type', l.entity_type, 'entity_id', l.entity_id,
           'relation', l.relation, 'note', l.note, 'created_at', l.created_at)
         order by l.created_at), '[]'::jsonb) into v_links
    from public.dms_document_links l where l.document_id = d.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'direction', r.direction, 'relation', r.relation,
           'document_id', r.other_id, 'document_number', o.document_number,
           'title', o.title, 'review_status', o.review_status)
         order by r.created_at), '[]'::jsonb) into v_relations
    from (
      select id, 'OUTGOING'::text as direction, relation, to_document_id   as other_id, created_at
        from public.dms_document_relations where from_document_id = d.id
      union all
      select id, 'INCOMING'::text as direction, relation, from_document_id as other_id, created_at
        from public.dms_document_relations where to_document_id = d.id
    ) r
    join public.dms_documents o on o.id = r.other_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'event_type', e.event_type, 'from_state', e.from_state,
           'to_state', e.to_state, 'detail', e.detail, 'metadata', e.metadata,
           'actor_id', e.actor_id, 'actor_role', e.actor_role,
           'version_id', e.version_id, 'created_at', e.created_at)
         order by e.created_at desc), '[]'::jsonb) into v_events
    from public.dms_document_events e where e.document_id = d.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'version_id', j.version_id, 'status', j.status,
           'engine', j.engine, 'attempts', j.attempts, 'confidence', j.confidence,
           'review_state', j.review_state, 'error_message', j.error_message,
           'started_at', j.started_at, 'finished_at', j.finished_at,
           'created_at', j.created_at,
           'fields', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', f.id, 'field_key', f.field_key, 'field_label', f.field_label,
                      'raw_value', f.raw_value, 'value', f.value, 'confidence', f.confidence,
                      'page_number', f.page_number, 'review_state', f.review_state)
                    order by f.field_key)
               from public.dms_extracted_fields f where f.job_id = j.id), '[]'::jsonb))
         order by j.created_at desc), '[]'::jsonb) into v_jobs
    from public.extraction_jobs j where j.document_id = d.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ep.id, 'name', ep.name, 'status', ep.status, 'reference', ep.reference,
           'sealed_at', ep.sealed_at, 'sequence_no', epd.sequence_no,
           'sealed_version_id', epd.version_id)
         order by ep.created_at desc), '[]'::jsonb) into v_packages
    from public.evidence_package_documents epd
    join public.evidence_packages ep on ep.id = epd.evidence_package_id
   where epd.document_id = d.id;

  return jsonb_build_object(
    'document',  to_jsonb(d),
    'versions',  v_versions,
    'links',     v_links,
    'relations', v_relations,
    'events',    v_events,
    'extraction_jobs', v_jobs,
    'evidence_packages', v_packages);
end;
$$;

-- The review queue is ordered by how long a document has been waiting, because
-- that is the only ordering a reviewer can act on. waiting_hours is measured
-- from submitted_at, not created_at: a document that sat in DRAFT for a month
-- has not been waiting on anybody.
create or replace function public.get_dms_review_queue(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v jsonb;
begin
  if not public.has_permission('dms_documents','read') then
    raise exception 'Not authorized to read the review queue' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.waiting_hours desc nulls last), '[]'::jsonb) into v
  from (
    select d.id, d.document_number, d.title, d.document_type, d.review_status,
           d.confidentiality, d.submitted_at, d.submitted_by, d.reviewer_id,
           d.review_started_at, d.version_count, d.expires_on,
           round(extract(epoch from (now() - coalesce(d.submitted_at, d.created_at))) / 3600.0, 1)
             as waiting_hours,
           v.checksum_sha256 is not null as has_verified_bytes,
           v.mime_type, v.size_bytes
      from public.dms_documents d
      left join public.dms_document_versions v on v.id = d.current_version_id
     where d.review_status in ('PENDING_REVIEW','UNDER_REVIEW','CHANGES_REQUESTED')
       and d.archived_at is null
       and public.row_in_staff_scope(d.agency_id, d.branch_id)
     limit v_limit
  ) x;
  return v;
end;
$$;

create or replace function public.get_dms_expiry_report(p_horizon_days integer default 90)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_days integer := least(greatest(coalesce(p_horizon_days, 90), 1), 730);
  v_buckets jsonb; v_rows jsonb;
begin
  if not public.has_permission('dms_documents','read') then
    raise exception 'Not authorized to read the expiry report' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'expired',      count(*) filter (where d.expires_on < current_date),
    'within_7',     count(*) filter (where d.expires_on between current_date and current_date + 7),
    'within_30',    count(*) filter (where d.expires_on between current_date and current_date + 30),
    'within_90',    count(*) filter (where d.expires_on between current_date and current_date + 90),
    'beyond',       count(*) filter (where d.expires_on > current_date + 90),
    'no_expiry',    count(*) filter (where d.expires_on is null)
  ) into v_buckets
  from public.dms_documents d
  where d.archived_at is null
    and public.row_in_staff_scope(d.agency_id, d.branch_id);

  select coalesce(jsonb_agg(x order by x.expires_on), '[]'::jsonb) into v_rows
  from (
    select d.id, d.document_number, d.title, d.document_type, d.review_status,
           d.issued_on, d.expires_on, d.expiry_notice_days, d.expiry_notified_at,
           (d.expires_on - current_date) as days_remaining,
           coalesce((
             select jsonb_agg(distinct l.entity_type) from public.dms_document_links l
              where l.document_id = d.id), '[]'::jsonb) as linked_entity_types
      from public.dms_documents d
     where d.expires_on is not null
       and d.archived_at is null
       and d.expires_on <= current_date + v_days
       and public.row_in_staff_scope(d.agency_id, d.branch_id)
  ) x;

  return jsonb_build_object('horizon_days', v_days, 'buckets', coalesce(v_buckets, '{}'::jsonb),
                            'documents', v_rows);
end;
$$;

-- Extraction quality is measured against the humans who corrected it, which is
-- the only ground truth available: a field accepted as-is was right, a field
-- corrected was wrong, and the ratio is what tells you whether the engine is
-- worth its confidence score.
create or replace function public.get_dms_extraction_quality(p_days integer default 90)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 90), 1), 730);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_jobs jsonb; v_fields jsonb; v_engines jsonb;
begin
  if not public.has_permission('extraction_jobs','read') then
    raise exception 'Not authorized to read extraction quality' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total',       count(*),
    'pending',     count(*) filter (where j.status = 'pending'),
    'processing',  count(*) filter (where j.status = 'processing'),
    'completed',   count(*) filter (where j.status = 'completed'),
    'failed',      count(*) filter (where j.status = 'failed'),
    'reviewed',    count(*) filter (where j.review_state = 'REVIEWED'),
    'avg_confidence', round(avg(j.confidence) filter (where j.confidence is not null), 2),
    'avg_seconds', round(avg(extract(epoch from (j.finished_at - j.started_at)))
                           filter (where j.finished_at is not null and j.started_at is not null), 1)
  ) into v_jobs
  from public.extraction_jobs j
  where j.created_at >= v_since
    and public.row_in_staff_scope(j.agency_id, j.branch_id);

  select coalesce(jsonb_agg(x order by x.corrected desc, x.field_key), '[]'::jsonb) into v_fields
  from (
    select f.field_key,
           count(*)                                                as extracted,
           count(*) filter (where f.review_state = 'ACCEPTED')     as accepted,
           count(*) filter (where f.review_state = 'CORRECTED')    as corrected,
           count(*) filter (where f.review_state = 'REJECTED')     as rejected,
           count(*) filter (where f.review_state = 'PENDING')      as pending,
           round(avg(f.confidence) filter (where f.confidence is not null), 2) as avg_confidence,
           case when count(*) filter (where f.review_state in ('ACCEPTED','CORRECTED','REJECTED')) = 0
                then null
                else round(100.0 * count(*) filter (where f.review_state = 'ACCEPTED')
                           / count(*) filter (where f.review_state in ('ACCEPTED','CORRECTED','REJECTED')), 1)
           end as accuracy_pct
      from public.dms_extracted_fields f
     where f.created_at >= v_since
       and public.row_in_staff_scope(f.agency_id, f.branch_id)
     group by f.field_key
  ) x;

  select coalesce(jsonb_agg(x order by x.jobs desc, x.engine), '[]'::jsonb) into v_engines
  from (
    select j.engine, count(*) as jobs,
           count(*) filter (where j.status = 'failed') as failed,
           round(avg(j.confidence) filter (where j.confidence is not null), 2) as avg_confidence
      from public.extraction_jobs j
     where j.created_at >= v_since
       and public.row_in_staff_scope(j.agency_id, j.branch_id)
     group by j.engine
  ) x;

  return jsonb_build_object('window_days', v_days, 'jobs', coalesce(v_jobs, '{}'::jsonb),
                            'by_field', v_fields, 'by_engine', v_engines);
end;
$$;

-- The package list reports drift per package, so a sealed package that no longer
-- matches its members is visible in the list rather than only when somebody
-- thinks to verify it.
create or replace function public.get_dms_evidence_packages(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v jsonb;
begin
  if not public.has_permission('evidence_packages','read') then
    raise exception 'Not authorized to read evidence packages' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v
  from (
    select ep.id, ep.name, ep.status, ep.reference, ep.purpose, ep.notes,
           ep.document_count, ep.sealed_at, ep.sealed_by, ep.seal_checksum,
           ep.created_at, ep.created_by,
           case when ep.status = 'SEALED'
                then ep.seal_checksum = private.dms_package_digest(ep.id)
           end as seal_matches,
           coalesce((
             select count(*) from public.evidence_package_documents epd
              join public.dms_documents d on d.id = epd.document_id
             where epd.evidence_package_id = ep.id
               and epd.version_id is distinct from d.current_version_id), 0) as drifted_documents,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'document_id', epd.document_id, 'sequence_no', epd.sequence_no,
                      'document_number', d.document_number, 'title', d.title,
                      'review_status', d.review_status, 'version_id', epd.version_id,
                      'checksum_sha256', epd.checksum_sha256)
                    order by epd.sequence_no)
               from public.evidence_package_documents epd
               join public.dms_documents d on d.id = epd.document_id
              where epd.evidence_package_id = ep.id), '[]'::jsonb) as documents
      from public.evidence_packages ep
     where public.row_in_staff_scope(ep.agency_id, ep.branch_id)
     limit v_limit
  ) x;
  return v;
end;
$$;

do $grants$
declare sig text;
begin
  foreach sig in array array[
    'get_dms_dashboard(integer)',
    'get_dms_document_360(uuid)',
    'get_dms_review_queue(integer)',
    'get_dms_expiry_report(integer)',
    'get_dms_extraction_quality(integer)',
    'get_dms_evidence_packages(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', sig);
    execute format('grant execute on function public.%s to authenticated', sig);
  end loop;
end $grants$;

-- ============================================================================
-- T. Realtime. A review queue that does not move while a colleague approves
--    something is a screenshot.
-- ============================================================================

do $realtime$
declare tbl text;
begin
  foreach tbl in array array[
    'dms_documents','dms_document_versions','dms_document_links',
    'dms_document_relations','dms_document_events','dms_extracted_fields',
    'extraction_jobs','evidence_packages','evidence_package_documents'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    exception
      when duplicate_object     then null;
      when undefined_object     then null;
      when insufficient_privilege then null;
    end;
  end loop;
end $realtime$;

-- ============================================================================
-- U. Prove the surface exists, at replay time.
--
--    Every gate in this repository that can run without a database runs against
--    the file; this block runs against the schema the file just built, so a
--    rename in one place and not the other fails `supabase db reset` instead of
--    failing a user.
-- ============================================================================

do $assert$
declare
  v_missing text[] := '{}';
  v_name    text;
  v_tables  text[] := array[
    'dms_documents','dms_document_versions','dms_document_links','dms_document_relations',
    'dms_document_events','dms_extracted_fields','extraction_jobs','evidence_packages',
    'evidence_package_documents','dms_document_sequences','dms_storage_orphans'];
  v_funcs   text[] := array[
    'reserve_dms_upload_command','finalize_dms_upload_command','discard_dms_upload_command',
    'submit_dms_document_command','start_dms_review_command','approve_dms_document_command',
    'reject_dms_document_command','request_dms_changes_command','reopen_dms_document_command',
    'archive_dms_document_command','run_dms_expiry_sweep_command','link_dms_document_command',
    'unlink_dms_document_command','relate_dms_documents_command','unrelate_dms_documents_command',
    'queue_dms_extraction_command','record_dms_extraction_result_command',
    'review_dms_extracted_field_command','create_dms_evidence_package_command',
    'set_dms_package_document_command','seal_dms_evidence_package_command',
    'verify_dms_evidence_package_command','update_dms_document_metadata_command',
    'set_dms_document_tags_command','delete_dms_document_command',
    'update_dms_evidence_package_command','void_dms_evidence_package_command',
    'delete_dms_evidence_package_command','record_dms_document_access_command',
    'get_dms_dashboard','get_dms_document_360','get_dms_review_queue',
    'get_dms_expiry_report','get_dms_extraction_quality','get_dms_evidence_packages'];
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
      v_missing := v_missing || ('function ' || v_name);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'DMS slice incomplete: %', array_to_string(v_missing, ', ');
  end if;
end $assert$;

-- Every table this slice writes must have a NOT NULL agency_id and a branch_id,
-- or trg_stamp_staff_scope raises 42703 on insert and the tenancy guarantee in
-- section H is only a comment.
do $assert$
declare
  t text;
  v_nullable boolean;
begin
  foreach t in array array[
    'dms_documents','dms_document_versions','dms_document_links','dms_document_relations',
    'dms_document_events','dms_extracted_fields','extraction_jobs','evidence_packages',
    'evidence_package_documents'
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

select 'dms vertical slice installed' as status;
