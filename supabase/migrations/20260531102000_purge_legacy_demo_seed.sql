-- Final state must contain no deterministic demo seed rows.
begin;
alter table public.audit_logs disable trigger user;
delete from public.audit_logs where id in ('fa000000-0000-0000-0000-000000000030','fa000000-0000-0000-0000-000000000031') or lower(coalesce(user_email,''))='admin@bousalem.dz';
alter table public.audit_logs enable trigger user;
delete from public.documents where id in ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002');
delete from public.sos_events where id='fa000000-0000-0000-0000-000000000040';
delete from public.incidents where id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002');
delete from public.transport_assignments where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
delete from public.transport_vehicles where id in ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003');
delete from public.room_allocations where id in ('80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002');
delete from public.holy_site_camps where id in ('c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003');
delete from public.hotels where id in ('22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222223','22222222-2222-2222-2222-222222222224');
delete from public.flights where id in ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000003');
delete from public.visas where id in ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003');
delete from public.payments where id in ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
delete from public.invoices where id='fa000000-0000-0000-0000-000000000050';
delete from public.bookings where id in ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
delete from public.pilgrims where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');
delete from public.groups where id in ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111112');
delete from public.crm_leads where id in ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003');
delete from public.actions where id in ('fa000000-0000-0000-0000-000000000020','fa000000-0000-0000-0000-000000000021');
delete from public.alerts where id in ('fa000000-0000-0000-0000-000000000010','fa000000-0000-0000-0000-000000000011');
delete from public.contracts where id in ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000002');
delete from public.suppliers where id in ('f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000003');
delete from public.mutawwif_guides where id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003');
delete from public.packages where id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004');
commit;

create or replace function private.assert_no_legacy_demo_seed() returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if exists(select 1 from public.packages where id::text like '10000000-0000-0000-0000-%') then raise exception 'Legacy demo package seed still present'; end if;
 if exists(select 1 from public.pilgrims where id::text like '20000000-0000-0000-0000-%') then raise exception 'Legacy demo pilgrim seed still present'; end if;
 if exists(select 1 from public.bookings where id::text like '30000000-0000-0000-0000-%') then raise exception 'Legacy demo booking seed still present'; end if;
 if exists(select 1 from public.payments where id::text like '40000000-0000-0000-0000-%') then raise exception 'Legacy demo payment seed still present'; end if;
end; $$;
revoke all on function private.assert_no_legacy_demo_seed() from public,anon,authenticated;
