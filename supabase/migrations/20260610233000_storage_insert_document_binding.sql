-- Canonical storage insert authorization: an authenticated staff member may only upload
-- an object that was pre-registered in public.documents and is inside the row's agency/branch scope.
DROP POLICY IF EXISTS documents_insert_scoped ON storage.objects;
CREATE POLICY documents_insert_scoped
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (metadata->>'mimetype') IN ('application/pdf','image/jpeg','image/png','image/webp')
  AND COALESCE((metadata->>'size')::bigint,0) BETWEEN 1 AND 10485760
  AND EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.storage_bucket='documents'
      AND d.storage_path=name
      AND public.row_in_staff_scope(d.agency_id,d.branch_id)
      AND public.has_permission('documents','write')
  )
);
