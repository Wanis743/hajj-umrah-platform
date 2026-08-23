create or replace function private.confirm_reservation_transaction(p_reservation_id uuid,p_package_id uuid,p_group_id uuid default null,p_passport_number text default null,p_payment_amount_dzd numeric default 0,p_payment_amount_sar numeric default 0,p_payment_method text default 'Cash',p_notes text default null) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.reservations%rowtype; p public.packages%rowtype; pilgrim_id uuid; booking_id uuid; payment_id uuid; booking_reference text; travelers int; total_dzd numeric(14,2); total_sar numeric(14,2); journal_id uuid;
begin
 if not public.has_permission('reservations','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized to confirm reservations' using errcode='42501'; end if;
 if coalesce(p_payment_amount_dzd,0)>0 and coalesce(p_payment_amount_sar,0)>0 then raise exception 'Multi-currency payment must be posted as separate currency transactions' using errcode='22023'; end if;
 select * into r from public.reservations where id=p_reservation_id for update; if not found then raise exception 'Reservation not found'; end if;
 if not public.row_in_staff_scope(r.agency_id,r.branch_id) then raise exception 'Reservation outside staff scope' using errcode='42501'; end if;
 if lower(coalesce(r.status,''))='confirmed' then raise exception 'Reservation already confirmed'; end if;
 select * into p from public.packages where id=p_package_id for update; if not found then raise exception 'Package not found'; end if;
 if p.status<>'ACTIVE' then raise exception 'Package is not active'; end if;
 travelers:=greatest(coalesce(r.travelers,1),1);
 if coalesce(p.seats_available,0)<travelers then raise exception 'Package capacity exceeded'; end if;
 total_dzd:=coalesce(p.price_dzd,0)*travelers; total_sar:=coalesce(p.price_sar,0)*travelers;
 if coalesce(p_payment_amount_dzd,0)<0 or coalesce(p_payment_amount_sar,0)<0 then raise exception 'Payment amount cannot be negative'; end if;
 if coalesce(p_payment_amount_dzd,0)>total_dzd or coalesce(p_payment_amount_sar,0)>total_sar then raise exception 'Payment exceeds booking total'; end if;
 insert into public.pilgrims(agency_id,branch_id,full_name,full_name_ar,passport_number,phone,email,group_id,package_id,payment_status,visa_status,status) values(r.agency_id,r.branch_id,r.name,r.name,nullif(trim(p_passport_number),''),r.phone,nullif(trim(r.email),''),p_group_id,p.id,case when coalesce(p_payment_amount_dzd,0)>0 or coalesce(p_payment_amount_sar,0)>0 then 'PARTIAL' else 'NONE' end,'NOT_STARTED','REGISTERED') returning id into pilgrim_id;
 booking_reference:='BOOK-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.bookings(agency_id,branch_id,reference,pilgrim_id,package_id,group_id,status,travelers,total_dzd,total_sar,paid_dzd,paid_sar,payment_method,notes,confirmed_at) values(r.agency_id,r.branch_id,booking_reference,pilgrim_id,p.id,p_group_id,'CONFIRMED',travelers,total_dzd,total_sar,coalesce(p_payment_amount_dzd,0),coalesce(p_payment_amount_sar,0),p_payment_method,p_notes,now()) returning id into booking_id;
 if coalesce(p_payment_amount_dzd,0)>0 or coalesce(p_payment_amount_sar,0)>0 then
   insert into public.payments(agency_id,branch_id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,notes) values(r.agency_id,r.branch_id,booking_id,pilgrim_id,coalesce(p_payment_amount_dzd,0),coalesce(p_payment_amount_sar,0),p_payment_method,'CONFIRMED','PAY-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_notes) returning id into payment_id;
   select private.post_payment_journal(payment_id) into journal_id;
 end if;
 update public.packages set seats_available=seats_available-travelers,updated_at=now() where id=p.id;
 update public.reservations set status='confirmed',updated_at=now() where id=r.id;
 return jsonb_build_object('booking_id',booking_id,'booking_reference',booking_reference,'pilgrim_id',pilgrim_id,'payment_id',payment_id,'journal_entry_id',journal_id);
end; $$;
revoke all on function private.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) from public,anon,authenticated;
