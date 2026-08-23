alter table public.currencies enable row level security;
revoke all on public.currencies from anon, authenticated;
grant select on public.currencies to authenticated;
drop policy if exists staff_read_currencies on public.currencies;
create policy staff_read_currencies on public.currencies for select to authenticated using (public.is_staff());
revoke all on function public.populate_audit_request_context() from public, anon, authenticated;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;
