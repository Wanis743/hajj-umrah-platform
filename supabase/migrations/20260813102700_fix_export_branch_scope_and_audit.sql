-- 20260821000002_fix_export_branch_scope_and_audit.sql

-- Add tracking columns to export_history
ALTER TABLE public.export_history
ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS file_path TEXT,
ADD COLUMN IF NOT EXISTS fields_hash TEXT,
ADD COLUMN IF NOT EXISTS expiry TIMESTAMPTZ;

-- Drop and recreate the log_export RPC to require the new tracking fields
DROP FUNCTION IF EXISTS public.log_export(text, text, text, integer, jsonb);

CREATE OR REPLACE FUNCTION public.log_export(
  p_module    TEXT,
  p_format    TEXT,
  p_scope     TEXT,
  p_row_count INTEGER,
  p_file_path TEXT,
  p_fields_hash TEXT,
  p_expiry    TIMESTAMPTZ,
  p_metadata  JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_export_id UUID;
  v_export_number TEXT;
  v_agency_id UUID;
  v_branch_id UUID;
BEGIN
  -- Strict context checks
  v_agency_id := public.current_staff_agency_id();
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Agency context required' USING ERRCODE = '42501';
  END IF;

  SELECT branch_id INTO v_branch_id FROM public.staff_profiles WHERE user_id = auth.uid() AND is_active = true;

  -- Generate human-readable export number
  v_export_number := 'EXP-' || to_char(NOW(), 'YYYYMMDD') || '-' || substring(md5(random()::text) from 1 for 6);

  INSERT INTO public.export_history (
    agency_id,
    branch_id,
    export_number,
    module,
    format,
    scope,
    row_count,
    file_path,
    fields_hash,
    expiry,
    metadata,
    created_by
  )
  VALUES (
    v_agency_id,
    v_branch_id,
    v_export_number,
    p_module,
    p_format,
    p_scope,
    p_row_count,
    p_file_path,
    p_fields_hash,
    p_expiry,
    p_metadata,
    auth.uid()
  )
  RETURNING id INTO v_export_id;

  RETURN v_export_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_export(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_export(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;
