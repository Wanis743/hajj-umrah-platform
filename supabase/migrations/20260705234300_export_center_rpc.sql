-- Migration: Export Center RPC
-- Adds the log_export function used by ExportCenter.tsx to record every export operation
-- Also creates export_history if not present (idempotent)

-- ── export_history table (created in import_export_engine migration, just ensure it exists) ──
CREATE TABLE IF NOT EXISTS public.export_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  export_number   TEXT NOT NULL,
  module          TEXT NOT NULL,
  format          TEXT NOT NULL CHECK (format IN ('CSV', 'JSON', 'XLSX', 'PDF', 'PRINT')),
  scope           TEXT NOT NULL DEFAULT 'ENTIRE_DATASET',
  row_count       INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'export_history' AND policyname = 'export_history_agency_access'
  ) THEN
    CREATE POLICY export_history_agency_access ON public.export_history
      USING (agency_id = current_staff_agency_id());
  END IF;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS export_history_agency_id_idx ON public.export_history (agency_id, created_at DESC);

-- ── log_export RPC ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_export(
  p_module    text,
  p_format    text,
  p_scope     text,
  p_row_count integer,
  p_metadata  jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id    uuid;
  v_user_id      uuid;
  v_export_number text;
  v_id           uuid;
BEGIN
  -- Guard: must be authenticated staff
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  v_agency_id := current_staff_agency_id();
  v_user_id   := auth.uid();

  -- Generate export number: EXP-YYYYMMDD-NNNNN
  SELECT 'EXP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
    LPAD((
      SELECT COALESCE(COUNT(*), 0) + 1
      FROM export_history
      WHERE agency_id = v_agency_id
        AND created_at::date = NOW()::date
    )::text, 5, '0')
  INTO v_export_number;

  INSERT INTO public.export_history (
    id, agency_id, export_number, module, format, scope,
    row_count, metadata, created_by
  ) VALUES (
    gen_random_uuid(), v_agency_id, v_export_number, p_module, p_format,
    p_scope, p_row_count, p_metadata, v_user_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Grant execute to authenticated users (RLS handles row filtering)
GRANT EXECUTE ON FUNCTION public.log_export(text, text, text, integer, jsonb) TO authenticated;
