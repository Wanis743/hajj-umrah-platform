create or replace function public.require_admin_aal2()
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.staff_role()='ADMIN' and coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then
    raise exception 'Admin MFA is required for this operation' using errcode='42501';
  end if;
end $$;
revoke all on function public.require_admin_aal2() from public,anon,authenticated;
create or replace function public.assert_open_fiscal_period(p_agency_id uuid,p_entry_date date) returns uuid language plpgsql security definer set search_path=public as $$ declare v_id uuid; begin select id into v_id from public.fiscal_periods where agency_id=p_agency_id and p_entry_date between start_date and end_date and status='OPEN' limit 1; if v_id is null then raise exception 'No open fiscal period for date %',p_entry_date; end if; return v_id; end $$;
revoke all on function public.assert_open_fiscal_period(uuid,date) from public,anon,authenticated;
