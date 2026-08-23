-- Rebuild only payment journal references using full UUIDs to avoid prefix collisions.
delete from public.journal_lines where journal_entry_id in (select id from public.journal_entries where source_type='PAYMENT');
delete from public.journal_entries where source_type='PAYMENT';
create or replace function public.post_payment_journal(p_payment_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare p public.payments%rowtype; je uuid; cash uuid; ar uuid; fp uuid; ref text;
begin
  select * into p from public.payments where id=p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  fp:=public.assert_open_fiscal_period(p.agency_id,current_date); ref:='JE-PAY-'||replace(p.id::text,'-','');
  if exists(select 1 from public.journal_entries where agency_id=p.agency_id and reference=ref) then return (select id from public.journal_entries where agency_id=p.agency_id and reference=ref limit 1); end if;
  select id into cash from public.chart_of_accounts where agency_id=p.agency_id and code=case when coalesce(p.amount_sar,0)>0 and coalesce(p.amount_dzd,0)=0 then '1101' else '1100' end;
  select id into ar from public.chart_of_accounts where agency_id=p.agency_id and code=case when coalesce(p.amount_sar,0)>0 and coalesce(p.amount_dzd,0)=0 then '1201' else '1200' end;
  insert into public.journal_entries(agency_id,branch_id,fiscal_period_id,reference,description,source_type,source_id,created_by) values(p.agency_id,coalesce(p.branch_id,p.branch_uuid),fp,ref,'Payment received','PAYMENT',p.id,auth.uid()) returning id into je;
  if coalesce(p.amount_dzd,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),cash,'DZD',p.amount_dzd,0,'Cash/Bank received'),(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),ar,'DZD',0,p.amount_dzd,'Accounts receivable'); end if;
  if coalesce(p.amount_sar,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),cash,'SAR',p.amount_sar,0,'Cash/Bank received'),(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),ar,'SAR',0,p.amount_sar,'Accounts receivable'); end if;
  perform public.assert_journal_balanced(je); return je;
end $$;
revoke all on function public.post_payment_journal(uuid) from public,anon,authenticated;
create or replace function public.post_reversal_journal(p_reversal_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare r public.payment_reversals%rowtype; je uuid; cash uuid; ar uuid; fp uuid; ref text;
begin
  select * into r from public.payment_reversals where id=p_reversal_id; if not found then raise exception 'Reversal not found'; end if;
  fp:=public.assert_open_fiscal_period(r.agency_id,current_date); ref:='JE-REV-'||replace(r.id::text,'-','');
  if exists(select 1 from public.journal_entries where agency_id=r.agency_id and reference=ref) then return (select id from public.journal_entries where agency_id=r.agency_id and reference=ref limit 1); end if;
  select id into cash from public.chart_of_accounts where agency_id=r.agency_id and code=case when coalesce(r.amount_sar,0)>0 and coalesce(r.amount_dzd,0)=0 then '1101' else '1100' end;
  select id into ar from public.chart_of_accounts where agency_id=r.agency_id and code=case when coalesce(r.amount_sar,0)>0 and coalesce(r.amount_dzd,0)=0 then '1201' else '1200' end;
  insert into public.journal_entries(agency_id,branch_id,fiscal_period_id,reference,description,source_type,source_id,created_by) values(r.agency_id,coalesce(r.branch_id,r.branch_uuid),fp,ref,'Payment reversal','REVERSAL',r.id,auth.uid()) returning id into je;
  if coalesce(r.amount_dzd,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,r.agency_id,coalesce(r.branch_id,r.branch_uuid),ar,'DZD',r.amount_dzd,0,'Reverse receivable'),(je,r.agency_id,coalesce(r.branch_id,r.branch_uuid),cash,'DZD',0,r.amount_dzd,'Cash refund'); end if;
  if coalesce(r.amount_sar,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,r.agency_id,coalesce(r.branch_id,r.branch_uuid),ar,'SAR',r.amount_sar,0,'Reverse receivable'),(je,r.agency_id,coalesce(r.branch_id,r.branch_uuid),cash,'SAR',0,r.amount_sar,'Cash refund'); end if;
  perform public.assert_journal_balanced(je); return je;
end $$;
revoke all on function public.post_reversal_journal(uuid) from public,anon,authenticated;
create or replace function public.post_invoice_journal(p_invoice_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype; je uuid; ar uuid; rev uuid; fp uuid; ref text;
begin
  perform public.require_admin_aal2(); if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  select * into i from public.invoices where id=p_invoice_id for update; if not found or not public.row_in_staff_scope(i.agency_id,coalesce(i.branch_id,i.branch_uuid)) then raise exception 'Invoice not in scope' using errcode='42501'; end if;
  fp:=public.assert_open_fiscal_period(i.agency_id,current_date); ref:='JE-INV-'||replace(i.id::text,'-','');
  if exists(select 1 from public.journal_entries where agency_id=i.agency_id and reference=ref) then return (select id from public.journal_entries where agency_id=i.agency_id and reference=ref limit 1); end if;
  select id into ar from public.chart_of_accounts where agency_id=i.agency_id and code=case when coalesce(i.total_sar,0)>0 and coalesce(i.total_dzd,0)=0 then '1201' else '1200' end limit 1;
  select id into rev from public.chart_of_accounts where agency_id=i.agency_id and code=case when coalesce(i.total_sar,0)>0 and coalesce(i.total_dzd,0)=0 then '4001' else '4000' end limit 1;
  insert into public.journal_entries(agency_id,branch_id,fiscal_period_id,reference,description,source_type,source_id,created_by) values(i.agency_id,coalesce(i.branch_id,i.branch_uuid),fp,ref,'Invoice posted','INVOICE',i.id,auth.uid()) returning id into je;
  if coalesce(i.total_dzd,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,i.agency_id,coalesce(i.branch_id,i.branch_uuid),ar,'DZD',i.total_dzd,0,'Accounts receivable'),(je,i.agency_id,coalesce(i.branch_id,i.branch_uuid),rev,'DZD',0,i.total_dzd,'Revenue'); end if;
  if coalesce(i.total_sar,0)>0 then insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,i.agency_id,coalesce(i.branch_id,i.branch_uuid),ar,'SAR',i.total_sar,0,'Accounts receivable'),(je,i.agency_id,coalesce(i.branch_id,i.branch_uuid),rev,'SAR',0,i.total_sar,'Revenue'); end if;
  perform public.assert_journal_balanced(je); return je;
end $$;
revoke all on function public.post_invoice_journal(uuid) from public,anon; grant execute on function public.post_invoice_journal(uuid) to authenticated;
