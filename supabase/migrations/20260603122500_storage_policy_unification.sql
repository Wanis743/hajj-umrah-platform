drop policy if exists documents_authenticated_delete on storage.objects;
drop policy if exists documents_authenticated_read on storage.objects;
drop policy if exists documents_authenticated_update on storage.objects;
drop policy if exists documents_authenticated_write on storage.objects;
drop policy if exists documents_delete_scoped on storage.objects;
create policy pilgrim_documents_read on storage.objects for select to authenticated using (bucket_id='documents' and exists (select 1 from public.documents d where d.storage_bucket='documents' and d.storage_path=name and public.row_in_staff_scope(d.agency_id,d.branch_id) and public.has_permission('documents','read')));
create policy pilgrim_documents_insert on storage.objects for insert to authenticated with check (bucket_id='documents' and (metadata->>'mimetype') in ('application/pdf','image/jpeg','image/png','image/webp') and coalesce((metadata->>'size')::bigint,0) between 1 and 10485760);
create policy pilgrim_documents_update on storage.objects for update to authenticated using (bucket_id='documents' and exists (select 1 from public.documents d where d.storage_bucket='documents' and d.storage_path=name and public.row_in_staff_scope(d.agency_id,d.branch_id) and public.has_permission('documents','write'))) with check (bucket_id='documents' and (metadata->>'mimetype') in ('application/pdf','image/jpeg','image/png','image/webp') and coalesce((metadata->>'size')::bigint,0) between 1 and 10485760);
create policy pilgrim_documents_delete on storage.objects for delete to authenticated using (bucket_id='documents' and exists (select 1 from public.documents d where d.storage_bucket='documents' and d.storage_path=name and public.row_in_staff_scope(d.agency_id,d.branch_id) and public.has_permission('documents','delete')));
