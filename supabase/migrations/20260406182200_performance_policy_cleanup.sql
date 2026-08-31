-- Remove duplicate settings policies and duplicate indexes; cover FKs.
drop policy if exists staff_delete_settings on public.settings;
drop policy if exists staff_insert_settings on public.settings;
drop policy if exists staff_update_settings on public.settings;
drop policy if exists auth_all on public.settings;
drop policy if exists anon_all on public.settings;
drop policy if exists public_read_settings on public.settings;
drop policy if exists settings_staff_write on public.settings;
drop policy if exists settings_public_read on public.settings;
grant select on public.settings to anon;
grant select, insert, update, delete on public.settings to authenticated;
create policy settings_public_read on public.settings for select to anon using (true);
create policy settings_staff_write on public.settings for all to authenticated using ((public.staff_role())='ADMIN') with check ((public.staff_role())='ADMIN');
drop policy if exists staff_profile_self_select on public.staff_profiles;
create policy staff_profile_self_select on public.staff_profiles for select to authenticated using ((user_id=(select auth.uid())) or public.is_admin());
create index if not exists idx_contracts_supplier_id on public.contracts(supplier_id);
create index if not exists idx_pilgrims_package_id on public.pilgrims(package_id);
-- Same three non-existent objects as 20260331100100; see the note there.
do $index_guard$
begin
  if to_regclass('public.payment_reversals') is not null then
    create index if not exists idx_payment_reversals_created_by on public.payment_reversals(created_by);
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.reservations')
                and attname = 'branch_uuid' and not attisdropped) then
    create index if not exists idx_reservations_branch_uuid on public.reservations(branch_uuid);
  end if;
  if to_regclass('public.support_tickets') is not null then
    create index if not exists idx_support_tickets_pilgrim_id on public.support_tickets(pilgrim_id);
  end if;
end
$index_guard$;
drop index if exists public.idx_audit_logs_scope_created;
drop index if exists public.idx_bookings_status_scope;
drop index if exists public.idx_reservations_scope_status_created;
