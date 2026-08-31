-- Finalize SECURITY DEFINER execute privileges and immutable helper exposure.
revoke all on function public.assign_reservation_reference() from public, anon, authenticated;
revoke all on function public.current_staff_agency_id() from public, anon, authenticated;
revoke all on function public.current_staff_branch_id() from public, anon, authenticated;
revoke all on function public.has_permission(text,text) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.row_in_staff_scope(uuid,uuid) from public, anon, authenticated;
revoke all on function public.staff_agency_id() from public, anon, authenticated;
revoke all on function public.staff_branch_id() from public, anon, authenticated;
revoke all on function public.staff_role() from public, anon, authenticated;

-- Five names below belong to a schema this ledger never created:
-- assign_reservation_scope, can_access_agency, can_access_branch,
-- is_staff_in_agency and record_payment are revoked here and defined nowhere, so a
-- replay from migrations alone raised 42883 on line 3 and never reached the rest of
-- the file. Guarded rather than deleted, for the same reason the support_tickets
-- policy in 20260331100100 was guarded rather than deleted: a database that does
-- carry these functions -- and the production one may, they predate the ledger --
-- must still have them taken away from anon and authenticated. Where they are
-- absent this block does nothing, which is the honest outcome.
do $legacy_helpers$
begin
  if to_regprocedure('public.assign_reservation_scope()') is not null then
    revoke all on function public.assign_reservation_scope() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.can_access_agency(uuid)') is not null then
    revoke all on function public.can_access_agency(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.can_access_branch(uuid)') is not null then
    revoke all on function public.can_access_branch(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.is_staff_in_agency(uuid)') is not null then
    revoke all on function public.is_staff_in_agency(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.record_payment(uuid,numeric,text,text)') is not null then
    revoke all on function public.record_payment(uuid,numeric,text,text) from public, anon, authenticated;
  end if;
end
$legacy_helpers$;

revoke all on function public.cancel_booking_transaction(uuid,text) from public, anon;
grant execute on function public.cancel_booking_transaction(uuid,text) to authenticated;
revoke all on function public.cancel_reservation_request(uuid,text) from public, anon;
grant execute on function public.cancel_reservation_request(uuid,text) to authenticated;
revoke all on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) to authenticated;
revoke all on function public.create_reservation_request(jsonb) from public, anon;
grant execute on function public.create_reservation_request(jsonb) to authenticated;
revoke all on function public.record_payment_transaction(uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.record_payment_transaction(uuid,numeric,numeric,text,text) to authenticated;
revoke all on function public.update_departure_setting(date) from public, anon;
grant execute on function public.update_departure_setting(date) to authenticated;

-- create_invoice_transaction and reverse_payment_transaction do not exist yet at
-- this point in the ledger: 20260502213600_finance_aal2_enforcement.sql creates
-- them, ninety-nine migrations later, and issues this exact revoke-and-grant pair
-- on lines 7-8 immediately afterwards. So the intent is already recorded where it
-- can actually take effect, and these two lines only ever had one effect on a fresh
-- replay -- 42883, stopping the file. Guarded, for a database old enough to have
-- them under a previous lineage.
do $late_finance_rpcs$
begin
  if to_regprocedure('public.create_invoice_transaction(uuid,text)') is not null then
    revoke all on function public.create_invoice_transaction(uuid,text) from public, anon;
    grant execute on function public.create_invoice_transaction(uuid,text) to authenticated;
  end if;
  if to_regprocedure('public.reverse_payment_transaction(uuid,numeric,numeric,text)') is not null then
    revoke all on function public.reverse_payment_transaction(uuid,numeric,numeric,text) from public, anon;
    grant execute on function public.reverse_payment_transaction(uuid,numeric,numeric,text) to authenticated;
  end if;
end
$late_finance_rpcs$;

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;

revoke all on public.reservations from anon;
drop policy if exists reservations_anon_insert on public.reservations;
