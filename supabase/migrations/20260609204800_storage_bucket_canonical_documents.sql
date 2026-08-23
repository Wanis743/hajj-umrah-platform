-- Canonical private document bucket is the existing production bucket `documents`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='pilgrim-documents') AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='documents') THEN
    UPDATE storage.buckets SET id='documents', name='documents', public=false, file_size_limit=10485760, allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[] WHERE id='pilgrim-documents';
  ELSIF EXISTS (SELECT 1 FROM storage.buckets WHERE id='documents') AND EXISTS (SELECT 1 FROM storage.buckets WHERE id='pilgrim-documents') THEN
    DELETE FROM storage.objects WHERE bucket_id='pilgrim-documents' AND NOT EXISTS (SELECT 1 FROM storage.objects o2 WHERE o2.bucket_id='documents' AND o2.name=storage.objects.name);
    DELETE FROM storage.buckets WHERE id='pilgrim-documents';
  END IF;
END $$;
UPDATE storage.buckets SET public=false, file_size_limit=10485760, allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[] WHERE id='documents';
DROP POLICY IF EXISTS pilgrim_documents_read ON storage.objects;
DROP POLICY IF EXISTS pilgrim_documents_insert ON storage.objects;
DROP POLICY IF EXISTS pilgrim_documents_update ON storage.objects;
DROP POLICY IF EXISTS pilgrim_documents_delete ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_read ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_write ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_delete ON storage.objects;
CREATE POLICY documents_read_scoped ON storage.objects FOR SELECT TO authenticated USING (bucket_id='documents' AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket='documents' AND d.storage_path=name AND public.row_in_staff_scope(d.agency_id,d.branch_id) AND public.has_permission('documents','read')));
CREATE POLICY documents_insert_scoped ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='documents' AND (metadata->>'mimetype') IN ('application/pdf','image/jpeg','image/png','image/webp') AND COALESCE((metadata->>'size')::bigint,0) BETWEEN 1 AND 10485760 AND split_part(name,'/',1) = COALESCE((SELECT d.agency_id::text FROM public.documents d WHERE d.storage_bucket='documents' AND d.storage_path=name LIMIT 1),'__no_document__') AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket='documents' AND d.storage_path=name AND public.row_in_staff_scope(d.agency_id,d.branch_id) AND public.has_permission('documents','write')));
CREATE POLICY documents_update_scoped ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='documents' AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket='documents' AND d.storage_path=name AND public.row_in_staff_scope(d.agency_id,d.branch_id) AND public.has_permission('documents','write'))) WITH CHECK (bucket_id='documents' AND (metadata->>'mimetype') IN ('application/pdf','image/jpeg','image/png','image/webp') AND COALESCE((metadata->>'size')::bigint,0) BETWEEN 1 AND 10485760);
CREATE POLICY documents_delete_scoped_final ON storage.objects FOR DELETE TO authenticated USING (bucket_id='documents' AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket='documents' AND d.storage_path=name AND public.row_in_staff_scope(d.agency_id,d.branch_id) AND public.has_permission('documents','delete')));
