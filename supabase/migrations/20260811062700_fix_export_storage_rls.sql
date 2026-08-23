-- 20260821000001_fix_export_storage_rls.sql

-- Drop the overly broad policies
DROP POLICY IF EXISTS "Authenticated users can upload exports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read exports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete exports" ON storage.objects;

-- Create strict policies using the folder structure: agency_id/user_id/...
CREATE POLICY "Strict upload for own exports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'exports' AND
    (storage.foldername(name))[1] = public.current_staff_agency_id()::text AND
    (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Strict read for own exports"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'exports' AND
    (storage.foldername(name))[1] = public.current_staff_agency_id()::text AND
    (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Strict delete for own exports"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'exports' AND
    (storage.foldername(name))[1] = public.current_staff_agency_id()::text AND
    (storage.foldername(name))[2] = auth.uid()::text
);
