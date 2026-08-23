alter view public.ar_aging set (security_invoker=true);
alter view public.ap_aging set (security_invoker=true);
create or replace function public.mask_passport_number(p_value text)
returns text language sql immutable strict set search_path=pg_catalog
as $$ select case when length(p_value)<=4 then repeat('*',length(p_value)) else left(p_value,2)||repeat('*',greatest(length(p_value)-4,1))||right(p_value,2) end $$;
revoke all on function public.mask_passport_number(text) from public,anon,authenticated;
alter table if exists public.admin_bootstrap enable row level security;
revoke all on public.admin_bootstrap from anon,authenticated;
drop policy if exists admin_bootstrap_no_client_access on public.admin_bootstrap;
create policy admin_bootstrap_no_client_access on public.admin_bootstrap as restrictive for all to authenticated using (false) with check (false);
