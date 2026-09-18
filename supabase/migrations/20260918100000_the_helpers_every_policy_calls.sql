-- Row security calls six functions the caller was not allowed to call.
--
-- 20260830140000 ended with four revokes under the comment "The helpers stay off
-- the public API surface", taking EXECUTE on staff_role, has_permission,
-- row_in_staff_scope and stamp_staff_scope away from authenticated. The reasoning
-- holds for an RPC. It does not hold for a policy: a USING expression is evaluated
-- with the privileges of the role running the query, so a policy that calls
-- has_permission() requires that role to hold EXECUTE on has_permission(). The
-- revoke did not close an API surface, it disarmed row security on every table
-- whose policy names one of these helpers.
--
-- That migration could not have caught it. Its own proof block calls the helpers
-- from the migration session, which runs as postgres and holds EXECUTE, so the
-- assertions passed while authenticated was locked out.
--
-- Measured on the live catalogue before this file:
--   has_permission(text,text)      named by 192 policy expressions, 0 invoker bodies
--   row_in_staff_scope(uuid,uuid)  named by 196 policy expressions, 7 invoker bodies
--   current_staff_agency_id()      named by  12 policy expressions, 2 invoker bodies
--   staff_role()                   named by   1 policy expression,  2 invoker bodies
--   is_staff_in_agency(uuid)       named by   2 policy expressions, 0 invoker bodies
--   current_staff_branch_id()      named by   0 policy expressions, 2 invoker bodies
-- all six carrying the ACL postgres=X/postgres | service_role=X/postgres.
--
-- Simulated as a real staff session -- role authenticated with a genuine
-- staff_profiles user id in request.jwt.claims -- 48 of the 70 tables that
-- authenticated may SELECT and whose policy names a helper failed with
-- 42501 permission denied for function. The other 22 passed only because their
-- policy short-circuits on a conjunct that is false for that fixture.
--
-- Granting these to authenticated exposes nothing. All six are SECURITY DEFINER
-- and derive their answer from auth.uid(): they report the caller's own role,
-- scope and permissions. is_staff_in_agency(uuid) takes an argument, and answers
-- only "is the caller staff in that agency" -- a fact the caller already holds.
-- anon gets none of them, and the gate below proves that too.
--
-- stamp_staff_scope() is deliberately not granted. It is a trigger function, and
-- PostgreSQL does not check EXECUTE on a trigger function when the trigger fires.

grant execute on function public.has_permission(text, text) to authenticated;
grant execute on function public.row_in_staff_scope(uuid, uuid) to authenticated;
grant execute on function public.staff_role() to authenticated;
grant execute on function public.current_staff_agency_id() to authenticated;
grant execute on function public.current_staff_branch_id() to authenticated;

-- is_staff_in_agency(uuid) is revoked by 20260403172600 and created by no
-- migration in this repo -- that file says so in its own comment and wraps its
-- revoke the same way. It exists on the live database, so the grant is guarded
-- rather than assumed, and a fresh replay simply skips it.
do $$
begin
  if to_regprocedure('public.is_staff_in_agency(uuid)') is not null then
    execute 'grant execute on function public.is_staff_in_agency(uuid) to authenticated';
  else
    raise notice 'is_staff_in_agency(uuid) absent; grant skipped';
  end if;
end $$;

-- ============================================================================
-- Prove it.
--
-- (a) every helper the policies call is callable by authenticated
-- (b) none of them became callable by anon
-- (c) a simulated staff session reads every affected table without a 42501
-- ============================================================================
do $$
declare
  v_names    text[] := array['has_permission','row_in_staff_scope','staff_role',
                             'current_staff_agency_id','current_staff_branch_id'];
  v_missing  text;
  v_leaked   text;
  v_user     uuid;
  v_tbl      record;
  v_denied   int := 0;
  v_ok       int := 0;
  v_first    text;
  v_scratch  text;
begin
  -- (a) --------------------------------------------------------------------
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any(v_names)
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_missing is not null then
    raise exception 'helper gate (a): authenticated still cannot execute %', v_missing;
  end if;

  -- (b) --------------------------------------------------------------------
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname = any(v_names) or p.proname in ('is_staff_in_agency','stamp_staff_scope'))
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaked is not null then
    raise exception 'helper gate (b): anon can execute %', v_leaked;
  end if;

  -- (c) --------------------------------------------------------------------
  -- A fresh database has no staff rows and nothing to simulate; say so rather
  -- than let an empty loop read as a passing proof.
  select sp.user_id into v_user
    from public.staff_profiles sp
   where sp.user_id is not null
   order by (sp.role = 'ADMIN') desc
   limit 1;

  if v_user is null then
    raise notice 'helper gate (c): no staff_profiles row with a user_id; simulation skipped';
  else
    for v_tbl in
      with pol as (
        select distinct c.oid, c.relname
          from pg_policies p
          join pg_class c on c.relname = p.tablename
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         where p.schemaname = 'public'
           and c.relrowsecurity
           and 'authenticated' = any(p.roles)
           and (coalesce(p.qual::text,'') || ' ' || coalesce(p.with_check::text,''))
               ~ '(has_permission|staff_role|row_in_staff_scope|current_staff_|is_staff_in_agency)'
      )
      select relname from pol
       where has_table_privilege('authenticated', oid, 'SELECT')
       order by relname
    loop
      begin
        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
        perform set_config('role', 'authenticated', true);

        -- A SET that silently failed would turn this proof into theatre.
        if current_user <> 'authenticated' then
          raise exception 'helper gate (c): role switch did not take effect (current_user is %)',
                          current_user;
        end if;

        execute format('select count(*)::text from public.%I', v_tbl.relname) into v_scratch;
        v_ok := v_ok + 1;
      exception
        when insufficient_privilege then
          v_denied := v_denied + 1;
          if v_first is null then
            v_first := v_tbl.relname || ': ' || sqlerrm;
          end if;
      end;
      perform set_config('role', 'none', true);
    end loop;

    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);

    if v_ok + v_denied = 0 then
      raise exception 'helper gate (c): no table was probed; the proof is empty';
    end if;
    if v_denied > 0 then
      raise exception 'helper gate (c): % of % tables still deny a staff session (first: %)',
                      v_denied, v_ok + v_denied, v_first;
    end if;
    raise notice 'helper gate (c): % tables readable by a simulated staff session', v_ok;
  end if;
end $$;
