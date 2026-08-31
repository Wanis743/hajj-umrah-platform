-- ============================================================================
-- Authorization guards that actually fire.
--
-- About thirty SECURITY DEFINER commands in this schema guard themselves with
-- one of two shapes:
--
--     if not public.has_permission('bookings','update')
--        and public.staff_role() <> 'ADMIN' then
--       raise exception 'Not authorized' using errcode = '42501';
--     end if;
--
--     if public.staff_role() <> 'ADMIN' then
--       raise exception 'Admin authorization required' using errcode = '42501';
--     end if;
--
-- Both evaluate to NULL, not true, for a caller with no active row in
-- staff_profiles:
--
--     staff_role()             -> NULL            (no profile row)
--     NULL = 'ADMIN'           -> NULL
--     exists(... role = NULL)  -> false           (NULL matches no row)
--     has_permission()         -> NULL or false   -> NULL
--     not NULL                 -> NULL
--     NULL <> 'ADMIN'          -> NULL
--     NULL and NULL            -> NULL
--
-- `if NULL then` does not take its branch. The raise never happened and the
-- body ran on. Every one of those bodies is SECURITY DEFINER, so row security
-- was evaluated as the function owner and skipped too, and every one is granted
-- to `authenticated` -- which here is any signed-in Supabase user, because
-- signing in does not create a staff_profiles row. A signed-in non-staff
-- account could move a visa stage, confirm a reservation, issue an invoice,
-- reverse a payment, or rewrite the platform's next departure date, on any
-- agency's rows.
--
-- Row-level security was never affected: a policy whose expression is NULL
-- denies the row. That is why this stayed invisible -- reading was blocked
-- while the commands that write were not.
--
-- The fix belongs in the three helpers, not in thirty call sites, so a guard
-- written tomorrow in the same shape is safe by construction:
--
--     staff_role()          returns 'NONE' rather than NULL, so <> 'ADMIN' is true
--     has_permission()      total: false, never NULL
--     row_in_staff_scope()  total: false, never NULL
--
-- 'NONE' is not a value staff_profiles.role can hold and staff_role() only ever
-- reads that column, so the sentinel cannot round-trip into a real profile.
-- ============================================================================

-- ============================================================================
-- A. staff_role() is total.
--
--    Callers that want "is there a profile at all" have is_staff(); callers that
--    want the role compare it to a role name. Neither needs NULL, and NULL is
--    what silently disarmed the guards.
-- ============================================================================

create or replace function public.staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select role from public.staff_profiles
      where user_id = auth.uid() and is_active = true limit 1),
    'NONE');
$$;

-- ============================================================================
-- B. has_permission() and row_in_staff_scope() are total.
--
--    row_in_staff_scope keeps the rule from 20260325010500 exactly: a role is
--    scoped to one agency, an ADMIN spans that agency's branches, and nobody
--    crosses agencies. Only its NULL-ness changes.
-- ============================================================================

create or replace function public.has_permission(p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  -- coalesce is redundant while staff_role() is total, and deliberate anyway:
  -- if a later migration makes that function nullable again, this one keeps
  -- answering false instead of quietly disarming every guard that calls it.
  select coalesce(
    public.staff_role() = 'ADMIN'
      or exists (
        select 1 from public.staff_permissions sp
        where sp.role = public.staff_role()
          and sp.resource = p_resource
          and sp.action = p_action
      ),
    false);
$$;

create or replace function public.row_in_staff_scope(p_agency_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    p_agency_id = public.staff_agency_id()
      and (public.staff_role() = 'ADMIN' or p_branch_id = public.staff_branch_id()),
    false);
$$;

-- ============================================================================
-- C. stamp_staff_scope() asked `staff_role() is not null` to mean "the caller is
--    staff". That question now has a different answer, so it asks the profile
--    table directly. The branch it chose is unchanged for both real cases:
--    a staff session stamps from its own profile, and a session with no JWT at
--    all (migrations, the service role, seed scripts) falls back to DEFAULT/HQ.
--
--    A signed-in non-staff caller now reaches neither: staff_agency_id() is
--    NULL, so the insert fails the table's NOT NULL rather than landing in
--    another agency's data. That is the point.
-- ============================================================================

create or replace function public.stamp_staff_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_staff boolean;
begin
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and is_active = true
  ) into v_is_staff;

  if auth.uid() is not null and v_is_staff then
    if new.agency_id is null then new.agency_id := public.staff_agency_id(); end if;
    if new.branch_id is null then new.branch_id := public.staff_branch_id(); end if;
  elsif auth.uid() is null then
    select id into new.agency_id from public.agencies where code = 'DEFAULT' limit 1;
    select b.id into new.branch_id from public.branches b
     where b.agency_id = new.agency_id and b.code = 'HQ' limit 1;
  end if;
  return new;
end;
$$;

-- The helpers stay off the public API surface; 20260325010500 and
-- 20260403172600 revoked them and `create or replace` does not restore grants,
-- but stating it here means a future reader does not have to go and check.
revoke all on function public.staff_role() from public, anon, authenticated;
revoke all on function public.has_permission(text, text) from public, anon, authenticated;
revoke all on function public.row_in_staff_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.stamp_staff_scope() from public, anon, authenticated;

-- ============================================================================
-- D. Prove it at migration time.
--
--    A migration session has no JWT, so auth.uid() is NULL and this is exactly
--    the caller the guards were failing to stop. The assertions below are the
--    guard expressions themselves, verbatim from the call sites, and they must
--    now be true -- meaning the raise fires. If a later edit reintroduces the
--    NULL, `supabase db reset` fails here instead of shipping.
-- ============================================================================

do $$
declare
  v_role  text    := public.staff_role();
  v_perm  boolean := public.has_permission('bookings','update');
  v_scope boolean := public.row_in_staff_scope(gen_random_uuid(), gen_random_uuid());
begin
  if v_role is null then
    raise exception 'staff_role() returned NULL; every "staff_role() <> ''ADMIN''" guard is disarmed';
  end if;
  if v_perm is null then
    raise exception 'has_permission() returned NULL; every "not has_permission(...)" guard is disarmed';
  end if;
  if v_scope is null then
    raise exception 'row_in_staff_scope() returned NULL; every scope guard is disarmed';
  end if;
  if v_perm then
    raise exception 'has_permission() granted bookings.update to a session with no staff profile';
  end if;
  if v_scope then
    raise exception 'row_in_staff_scope() admitted a random agency for a session with no staff profile';
  end if;

  -- The two guard shapes, copied from the call sites. Both must be true here.
  if not (not v_perm and v_role <> 'ADMIN') then
    raise exception 'the "not has_permission(...) and staff_role() <> ''ADMIN''" guard still does not fire';
  end if;
  if not (v_role <> 'ADMIN') then
    raise exception 'the bare "staff_role() <> ''ADMIN''" guard still does not fire';
  end if;

  if exists (select 1 from public.staff_profiles where role = 'NONE') then
    raise exception 'a staff_profiles row holds the reserved sentinel role NONE';
  end if;
end $$;

