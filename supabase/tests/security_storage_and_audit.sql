select 'anon_storage_document_policy' as check_name,
       count(*) = 0 as pass
from pg_policies p
where p.schemaname='storage' and p.tablename='objects' and p.roles @> array['anon']::name[]
  and (p.policyname ilike '%document%' or p.qual::text ilike '%documents%');

select 'audit_update_policy_absent' as check_name,count(*)=0 as pass
from pg_policies where schemaname='public' and tablename='audit_logs' and cmd='UPDATE';
select 'audit_delete_policy_absent' as check_name,count(*)=0 as pass
from pg_policies where schemaname='public' and tablename='audit_logs' and cmd='DELETE';

select 'audit_truncate_privilege' as check_name,
       has_table_privilege('authenticated','public.audit_logs','TRUNCATE') = false as pass;
