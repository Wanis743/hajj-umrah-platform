-- Finalize SECURITY DEFINER execute privileges and immutable helper exposure.
revoke all on function public.assign_reservation_reference() from public, anon, authenticated;
revoke all on function public.assign_reservation_scope() from public, anon, authenticated;
revoke all on function public.can_access_agency(uuid) from public, anon, authenticated;
revoke all on function public.can_access_branch(uuid) from public, anon, authenticated;
revoke all on function public.current_staff_agency_id() from public, anon, authenticated;
revoke all on function public.current_staff_branch_id() from public, anon, authenticated;
revoke all on function public.has_permission(text,text) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.is_staff_in_agency(uuid) from public, anon, authenticated;
revoke all on function public.row_in_staff_scope(uuid,uuid) from public, anon, authenticated;
revoke all on function public.staff_agency_id() from public, anon, authenticated;
revoke all on function public.staff_branch_id() from public, anon, authenticated;
revoke all on function public.staff_role() from public, anon, authenticated;
revoke all on function public.cancel_booking_transaction(uuid,text) from public, anon;
grant execute on function public.cancel_booking_transaction(uuid,text) to authenticated;
revoke all on function public.cancel_reservation_request(uuid,text) from public, anon;
grant execute on function public.cancel_reservation_request(uuid,text) to authenticated;
revoke all on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) to authenticated;
revoke all on function public.create_invoice_transaction(uuid,text) from public, anon;
grant execute on function public.create_invoice_transaction(uuid,text) to authenticated;
revoke all on function public.create_reservation_request(jsonb) from public, anon;
grant execute on function public.create_reservation_request(jsonb) to authenticated;
revoke all on function public.record_payment_transaction(uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.record_payment_transaction(uuid,numeric,numeric,text,text) to authenticated;
revoke all on function public.reverse_payment_transaction(uuid,numeric,numeric,text) from public, anon;
grant execute on function public.reverse_payment_transaction(uuid,numeric,numeric,text) to authenticated;
revoke all on function public.update_departure_setting(date) from public, anon;
grant execute on function public.update_departure_setting(date) to authenticated;
revoke all on function public.record_payment(uuid,numeric,text,text) from public, anon, authenticated;
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;

revoke all on public.reservations from anon;
drop policy if exists reservations_anon_insert on public.reservations;
