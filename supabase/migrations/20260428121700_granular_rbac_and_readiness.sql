-- Granular RBAC for enterprise tables.
DO $$
declare t text; tables_branch text[] := array['bank_accounts','credit_notes','data_quality_issues','document_access_logs','journal_entries','journal_lines','manifest_snapshots','missing_pilgrim_events','notification_queue','payment_allocations','supplier_bills','workflow_jobs']; tables_agency text[] := array['chart_of_accounts','fiscal_periods','readiness_rules']; tables_global text[] := array['payment_methods','airports','airlines','countries','exchange_rates'];
begin
  foreach t in array tables_branch loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists staff_scoped_all on public.%I',t);
      execute format('drop policy if exists staff_select on public.%I',t); execute format('drop policy if exists staff_insert on public.%I',t); execute format('drop policy if exists staff_update on public.%I',t); execute format('drop policy if exists staff_delete on public.%I',t);
      execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id,branch_id))',t,t);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and public.row_in_staff_scope(agency_id,branch_id))',t,t);
      execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id,branch_id)) with check (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id,branch_id))',t,t,t);
      execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and public.row_in_staff_scope(agency_id,branch_id))',t,t);
    end if;
  end loop;
  foreach t in array tables_agency loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists staff_scoped_all on public.%I',t);
      execute format('drop policy if exists staff_select on public.%I',t); execute format('drop policy if exists staff_insert on public.%I',t); execute format('drop policy if exists staff_update on public.%I',t); execute format('drop policy if exists staff_delete on public.%I',t);
      execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and agency_id=public.current_staff_agency_id())',t,t);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and agency_id=public.current_staff_agency_id())',t,t);
      execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and agency_id=public.current_staff_agency_id()) with check (public.has_permission(%L,''update'') and agency_id=public.current_staff_agency_id())',t,t,t);
      execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and agency_id=public.current_staff_agency_id())',t,t);
    end if;
  end loop;
  foreach t in array tables_global loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists staff_scoped_all on public.%I',t);
      execute format('drop policy if exists staff_select on public.%I',t); execute format('drop policy if exists staff_insert on public.%I',t); execute format('drop policy if exists staff_update on public.%I',t); execute format('drop policy if exists staff_delete on public.%I',t);
      execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read''))',t,t);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create''))',t,t);
      execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'')) with check (public.has_permission(%L,''update''))',t,t,t);
      execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete''))',t,t);
    end if;
  end loop;
end $$;

delete from public.staff_permissions where resource in ('fiscal_periods','chart_of_accounts','journal_entries','journal_lines','bank_accounts','supplier_bills','payment_allocations','credit_notes','notification_queue','workflow_jobs','document_access_logs','data_quality_issues','readiness_rules','manifest_snapshots','missing_pilgrim_events','exchange_rates','payment_methods','airports','airlines','countries');
insert into public.staff_permissions(role,resource,action) values
('OPERATIONS_MANAGER','manifest_snapshots','read'),('OPERATIONS_MANAGER','manifest_snapshots','create'),('OPERATIONS_MANAGER','missing_pilgrim_events','read'),('OPERATIONS_MANAGER','missing_pilgrim_events','create'),('OPERATIONS_MANAGER','missing_pilgrim_events','update'),('OPERATIONS_MANAGER','data_quality_issues','read'),('OPERATIONS_MANAGER','data_quality_issues','create'),('OPERATIONS_MANAGER','data_quality_issues','update'),('OPERATIONS_MANAGER','readiness_rules','read'),('OPERATIONS_MANAGER','readiness_rules','update'),('OPERATIONS_MANAGER','workflow_jobs','read'),('OPERATIONS_MANAGER','notification_queue','read'),('OPERATIONS_MANAGER','payment_methods','read'),('OPERATIONS_MANAGER','airports','read'),('OPERATIONS_MANAGER','airlines','read'),('OPERATIONS_MANAGER','countries','read'),
('VISA_AGENT','manifest_snapshots','read'),('VISA_AGENT','data_quality_issues','read'),('VISA_AGENT','payment_methods','read'),('VISA_AGENT','airports','read'),('VISA_AGENT','airlines','read'),('VISA_AGENT','countries','read'),
('FINANCE','fiscal_periods','read'),('FINANCE','fiscal_periods','update'),('FINANCE','chart_of_accounts','read'),('FINANCE','chart_of_accounts','create'),('FINANCE','chart_of_accounts','update'),('FINANCE','journal_entries','read'),('FINANCE','journal_entries','create'),('FINANCE','journal_entries','update'),('FINANCE','journal_lines','read'),('FINANCE','bank_accounts','read'),('FINANCE','bank_accounts','create'),('FINANCE','bank_accounts','update'),('FINANCE','supplier_bills','read'),('FINANCE','supplier_bills','create'),('FINANCE','supplier_bills','update'),('FINANCE','payment_allocations','read'),('FINANCE','payment_allocations','create'),('FINANCE','credit_notes','read'),('FINANCE','credit_notes','create'),('FINANCE','credit_notes','update'),('FINANCE','exchange_rates','read'),('FINANCE','workflow_jobs','read'),('FINANCE','notification_queue','read'),('FINANCE','countries','read'),('FINANCE','payment_methods','read'),
('CRM','notification_queue','read'),('CRM','workflow_jobs','read'),('CRM','data_quality_issues','read'),('GUIDE','manifest_snapshots','read'),('GUIDE','missing_pilgrim_events','read'),('GUIDE','missing_pilgrim_events','create'),('GUIDE','missing_pilgrim_events','update'),('AGENT','manifest_snapshots','read'),('AGENT','data_quality_issues','read'),('AGENT','readiness_rules','read'),('AGENT','payment_methods','read'),('AGENT','airports','read'),('AGENT','airlines','read'),('AGENT','countries','read') ON CONFLICT (role,resource,action) DO NOTHING;

create or replace function public.require_finance_aal2() returns void language plpgsql stable security definer set search_path=public as $$ declare aal text; begin if public.staff_role() not in ('ADMIN','FINANCE') then raise exception 'Finance role required' using errcode='42501'; end if; aal:=coalesce(auth.jwt()->>'aal','aal1'); if aal<>'aal2' then raise exception 'MFA required (AAL2)' using errcode='42501'; end if; end; $$;
revoke all on function public.require_finance_aal2() from public,anon,authenticated;

DO $$ declare a uuid; begin select id into a from public.agencies order by created_at limit 1; if a is not null then insert into public.readiness_rules(agency_id,code,label,weight,config,is_active) values (a,'DOCUMENTS','Travel documents',20,'{"required":true,"min_score":100}',true),(a,'VISA','Visa approval',20,'{"required":true,"min_score":100}',true),(a,'FLIGHT','Flight assignment',15,'{"required":true,"min_score":100}',true),(a,'HOTEL','Hotel allocation',15,'{"required":true,"min_score":100}',true),(a,'TRANSPORT','Transport assignment',10,'{"required":true,"min_score":100}',true),(a,'PAYMENTS','Payment completion',10,'{"required":true,"min_score":100}',true),(a,'COMMUNICATION','Required communications',5,'{"required":false,"min_score":100,"required_per_member":false}',true),(a,'GUIDE','Guide assignment',5,'{"required":true,"min_score":100}',true) on conflict (agency_id,code) do update set label=excluded.label,weight=excluded.weight,config=excluded.config,is_active=excluded.is_active; end if; end $$;
