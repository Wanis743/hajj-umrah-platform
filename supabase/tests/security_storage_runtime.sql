-- Runtime storage authorization contract. Execute against a real staging DB with authenticated fixtures.
-- The test must fail when fixture vars are absent; it never treats missing runtime setup as PASS.
DO $$
DECLARE
  required_bucket boolean;
  bad_policy_count integer;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id='documents' AND public=false AND file_size_limit=10485760) INTO required_bucket;
  IF NOT required_bucket THEN RAISE EXCEPTION 'documents bucket fixture/configuration missing'; END IF;
  SELECT count(*) INTO bad_policy_count
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname='documents_insert_scoped'
    AND (qual::text ILIKE '%true%' OR with_check::text ILIKE '%true%');
  IF bad_policy_count > 0 THEN RAISE EXCEPTION 'Arbitrary storage insert policy detected'; END IF;
END$$;
