CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL CHECK (fiscal_year >= 2000 AND fiscal_year <= 3000),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, fiscal_year)
);
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_sequences FROM anon, authenticated;
DROP POLICY IF EXISTS invoice_sequences_client_deny ON public.invoice_sequences;
CREATE POLICY invoice_sequences_client_deny ON public.invoice_sequences AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
INSERT INTO public.invoice_sequences (agency_id,fiscal_year,next_number)
SELECT a.id, extract(year from current_date)::int,
       COALESCE((SELECT max(NULLIF(regexp_replace(i.invoice_number,'^INV-'||extract(year from current_date)::int||'-','')::bigint,0)) FROM public.invoices i WHERE i.agency_id=a.id AND i.invoice_number LIKE 'INV-'||extract(year from current_date)::int||'-%'),0)+1
FROM public.agencies a
ON CONFLICT (agency_id,fiscal_year) DO UPDATE SET next_number=GREATEST(public.invoice_sequences.next_number, EXCLUDED.next_number), updated_at=now();
CREATE OR REPLACE FUNCTION public.create_invoice_transaction(p_booking_id uuid,p_status text default 'DRAFT') returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; invoice_id uuid; invoice_number text; seq bigint; current_year int:=extract(year from current_date)::int; agency uuid; branch uuid; begin
  if not public.has_permission('invoices','create') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized to create invoices' using errcode='42501'; end if;
  if p_status not in ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED') then raise exception 'Invalid invoice status' using errcode='22023'; end if;
  if upper(p_status)<>'DRAFT' then perform public.require_finance_aal2(); end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id,coalesce(b.branch_id,b.branch_uuid)) then raise exception 'Booking not found in staff scope' using errcode='42501'; end if;
  agency:=b.agency_id; branch:=coalesce(b.branch_id,b.branch_uuid);
  insert into public.invoice_sequences(agency_id,fiscal_year,next_number) values(agency,current_year,1) on conflict (agency_id,fiscal_year) do nothing;
  select next_number into seq from public.invoice_sequences where agency_id=agency and fiscal_year=current_year for update;
  update public.invoice_sequences set next_number=seq+1, updated_at=now() where agency_id=agency and fiscal_year=current_year;
  invoice_number:='INV-'||current_year||'-'||lpad(seq::text,6,'0');
  insert into public.invoices(agency_id,branch_id,booking_id,invoice_number,total_dzd,total_sar,status,issued_at) values(agency,branch,b.id,invoice_number,coalesce(b.total_dzd,0),coalesce(b.total_sar,0),upper(p_status),case when upper(p_status)='DRAFT' then null else now() end) returning id into invoice_id;
  return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'booking_id',b.id);
exception when unique_violation then raise exception 'Invoice number collision; retry transaction' using errcode='40001';
end; $$;
REVOKE ALL ON FUNCTION public.create_invoice_transaction(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_transaction(uuid,text) TO authenticated;
