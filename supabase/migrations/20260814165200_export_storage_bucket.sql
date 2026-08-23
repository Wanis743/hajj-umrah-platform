-- Migration: Create private exports bucket and policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exports',
  'exports',
  false,
  104857600, -- 100MB limit for export files
  ARRAY['text/csv', 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  file_size_limit = 104857600,
  allowed_mime_types = ARRAY['text/csv', 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'];

CREATE POLICY "Authenticated users can upload exports" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'exports');

CREATE POLICY "Authenticated users can read exports" 
ON storage.objects FOR SELECT 
TO authenticated 
USING (bucket_id = 'exports');

CREATE POLICY "Authenticated users can delete exports" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'exports');

