-- Final alignment after enterprise hardening.
create or replace function private.redact_audit_jsonb(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare item record; result jsonb := case jsonb_typeof(p_value) when 'object' then '{}'::jsonb when 'array' then '[]'::jsonb else p_value end; item_key text; val jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) not in ('object','array') then return p_value; end if;
  if jsonb_typeof(p_value)='array' then
    for item in select elem from jsonb_array_elements(p_value) as t(elem) loop
      result:=result||jsonb_build_array(private.redact_audit_jsonb(item.elem));
    end loop;
    return result;
  end if;
  for item in select e.k,e.v from jsonb_each(p_value) as e(k,v) loop
    item_key:=lower(item.k);
    if item_key ~ '(passport|document(_number)?|medical|emergency_phone|authorization|apikey|api_key|access_token|refresh_token|password|secret|cookie|cvv|card_number|iban)' then val:=to_jsonb('[REDACTED]'::text);
    elsif item_key ~ '(phone|email)' and jsonb_typeof(item.v)='string' then val:=to_jsonb('[MASKED]'::text);
    else val:=private.redact_audit_jsonb(item.v); end if;
    result:=result||jsonb_build_object(item.k,val);
  end loop;
  return result;
end; $$;
revoke all on function private.redact_audit_jsonb(jsonb) from public,anon,authenticated;

DO $$ BEGIN
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='reservations' and column_name='package_id' and data_type='text') then execute 'alter table public.reservations rename column package_id to legacy_package_id'; end if;
END $$;
alter table public.reservations add column if not exists package_id uuid;
alter table public.reservations add column if not exists package_name_snapshot text;
update public.reservations r set package_id=p.id from public.packages p where r.legacy_package_id ~* '^[0-9a-f-]{36}$' and r.legacy_package_id::uuid=p.id;
update public.reservations set package_name_snapshot=coalesce(package_name,package_name_snapshot) where package_name_snapshot is null;
DO $$ BEGIN
  if not exists(select 1 from pg_constraint where conname='fk_reservations_package_final') then alter table public.reservations add constraint fk_reservations_package_final foreign key(package_id) references public.packages(id) on delete restrict; end if;
END $$;
create index if not exists idx_reservations_package_id_final on public.reservations(package_id);

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare h jsonb:='{}'::jsonb; request_text text; correlation_text text; actor uuid; actor_role text; ip inet; row_id text; agency uuid; branch uuid; before_json jsonb; after_json jsonb; detail_json jsonb;
begin
  begin h:=coalesce(current_setting('request.headers',true),'{}')::jsonb; exception when others then h:='{}'::jsonb; end;
  request_text:=nullif(h->>'x-request-id',''); correlation_text:=coalesce(request_text,nullif(current_setting('request.id',true),'')); actor:=auth.uid(); actor_role:=nullif(h->>'x-user-role','');
  begin ip:=nullif(coalesce(h->>'cf-connecting-ip',h->>'x-real-ip'),'')::inet; exception when others then ip:=null; end;
  if tg_op='DELETE' then row_id:=to_jsonb(old)->>'id'; agency:=(to_jsonb(old)->>'agency_id')::uuid; branch:=(to_jsonb(old)->>'branch_id')::uuid; else row_id:=to_jsonb(new)->>'id'; agency:=(to_jsonb(new)->>'agency_id')::uuid; branch:=(to_jsonb(new)->>'branch_id')::uuid; end if;
  before_json:=case when tg_op in ('UPDATE','DELETE') then private.redact_audit_jsonb(to_jsonb(old)) end;
  after_json:=case when tg_op in ('INSERT','UPDATE') then private.redact_audit_jsonb(to_jsonb(new)) end;
  detail_json:=jsonb_build_object('before',before_json,'after',after_json,'operation',tg_op);
  insert into public.audit_logs(id,action,resource,resource_id,user_email,details,timestamp,created_at,agency_id,branch_id,request_id,correlation_id,ip_address,user_agent,actor_role,retention_until)
  values(gen_random_uuid(),tg_op,tg_table_name,row_id,null,private.redact_audit_jsonb(detail_json),now(),now(),agency,branch,
    case when request_text is not null and request_text ~* '^[0-9a-f-]{36}$' then request_text::uuid end,
    case when correlation_text is not null and correlation_text ~* '^[0-9a-f-]{36}$' then correlation_text::uuid else gen_random_uuid() end,
    ip,nullif(h->>'user-agent',''),actor_role,now()+interval '7 years');
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.write_audit_log() from public,anon,authenticated;

create or replace function private.post_payment_journal(p_payment_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare p public.payments%rowtype; je uuid; cash uuid; ar uuid; fp uuid; ref text;
begin
 select * into p from public.payments where id=p_payment_id for update;
 if not found then raise exception 'Payment not found'; end if;
 if coalesce(p.amount_dzd,0)>0 and coalesce(p.amount_sar,0)>0 then raise exception 'Multi-currency payment must be posted as separate currency transactions' using errcode='22023'; end if;
 fp:=public.assert_open_fiscal_period(p.agency_id,current_date); ref:='JE-PAY-'||replace(p.id::text,'-','');
 if exists(select 1 from public.journal_entries where agency_id=p.agency_id and reference=ref) then return (select id from public.journal_entries where agency_id=p.agency_id and reference=ref limit 1); end if;
 if coalesce(p.amount_dzd,0)>0 then
   cash:=private.resolve_payment_account(p.agency_id,p.method,'DZD'); select id into ar from public.chart_of_accounts where agency_id=p.agency_id and code='1200' limit 1; if ar is null then raise exception 'DZD accounts receivable account is not configured' using errcode='22023'; end if;
   insert into public.journal_entries(agency_id,branch_id,fiscal_period_id,reference,description,source_type,source_id,created_by) values(p.agency_id,coalesce(p.branch_id,p.branch_uuid),fp,ref,'Payment received','PAYMENT',p.id,auth.uid()) returning id into je;
   insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),cash,'DZD',p.amount_dzd,0,'Payment method account'),(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),ar,'DZD',0,p.amount_dzd,'Accounts receivable');
 elsif coalesce(p.amount_sar,0)>0 then
   cash:=private.resolve_payment_account(p.agency_id,p.method,'SAR'); select id into ar from public.chart_of_accounts where agency_id=p.agency_id and code='1201' limit 1; if ar is null then raise exception 'SAR accounts receivable account is not configured' using errcode='22023'; end if;
   insert into public.journal_entries(agency_id,branch_id,fiscal_period_id,reference,description,source_type,source_id,created_by) values(p.agency_id,coalesce(p.branch_id,p.branch_uuid),fp,ref,'Payment received','PAYMENT',p.id,auth.uid()) returning id into je;
   insert into public.journal_lines(journal_entry_id,agency_id,branch_id,account_id,currency_code,debit,credit,memo) values(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),cash,'SAR',p.amount_sar,0,'Payment method account'),(je,p.agency_id,coalesce(p.branch_id,p.branch_uuid),ar,'SAR',0,p.amount_sar,'Accounts receivable');
 else raise exception 'Payment amount is empty' using errcode='22023'; end if;
 perform public.assert_journal_balanced(je); return je;
end; $$;
revoke all on function private.post_payment_journal(uuid) from public,anon,authenticated;
