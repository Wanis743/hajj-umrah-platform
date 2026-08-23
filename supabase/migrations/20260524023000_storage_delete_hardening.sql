-- Storage delete is explicit and branch/permission scoped. The UI does not expose delete until a server workflow is available.
drop policy if exists pilgrim_documents_delete on storage.objects;
create policy pilgrim_documents_delete on storage.objects for delete to authenticated using (
  bucket_id='documents' and public.has_permission('documents','delete')
  and (storage.foldername(name))[1]=public.staff_agency_id()::text
  and (public.staff_role()='ADMIN' or (storage.foldername(name))[2]=public.staff_branch_id()::text)
);
