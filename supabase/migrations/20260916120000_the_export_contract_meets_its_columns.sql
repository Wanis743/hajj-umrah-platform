-- 20260916120000_the_export_contract_meets_its_columns.sql
--
-- What is actually wrong
-- ----------------------
-- `20260809033800_unify_export_contract.sql` authored public.get_export_view and
-- the migration ledger records it as applied. The function is nevertheless absent
-- from the live catalogue: `supabase gen types typescript --linked` emits every
-- routine in `public`, and get_export_view appears nowhere in the 10,984 lines it
-- produced. src/components/admin/ExportCenter.tsx calls it on every export, so the
-- Export Center currently fails at the first RPC for all six modules.
--
-- Re-applying the original text would not have fixed it. Cross-read against the
-- live column lists, four of its six branches reference columns that do not exist:
--
--   bookings            total_price_dzd / total_price_sar   ->  total_dzd / total_sar
--   groups              capacity                            ->  max_capacity
--   groups              staff_profiles.name                 ->  no such column, anywhere
--   visas               application_date, notes             ->  neither exists
--   external_operations reference, provider_name,           ->  external_reference, provider,
--                       amount, currency, status                internal_status/external_status,
--                                                               and no money columns at all
--
-- plpgsql compiles lazily, which is why this was never caught at authoring time:
-- CREATE FUNCTION succeeds against columns that do not exist, and the 42703 only
-- fires at call time, once per branch, in front of a user.
--
-- The guide name is the one loss. public.staff_profiles holds agency_id, branch_id,
-- branch_uuid, created_at, is_active, role, updated_at, user_id -- and nothing else.
-- No live table joins a staff user_id to a display name, so 'guide_name' cannot be
-- sourced at any price; the export now carries 'guide_id' instead.
--
-- What this migration keeps
-- -------------------------
-- Everything that was already right: the SECURITY DEFINER + pinned search_path pair,
-- the two 42501 authorization guards, the 10000-row chunk ceiling, the per-role PII
-- redaction, the branch-isolation predicates, the 22023 on an unknown module, and the
-- REVOKE-from-PUBLIC / GRANT-to-authenticated pair. The argument list and JSONB return
-- are unchanged, because ExportCenter.tsx is already written against them.
--
-- What this migration does not claim
-- ----------------------------------
-- It does not prove the body runs. No psql and no Docker on this machine, so nothing
-- here executes the function. What the gate below does instead is assert that every
-- (table, column) pair the new body reads actually resolves in the live catalogue --
-- the closest available stand-in for the compile check plpgsql refuses to perform,
-- and precisely the class of defect that left the original broken in place.

DROP FUNCTION IF EXISTS public.get_export_view(TEXT, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_export_view(TEXT, DATE, DATE, INT, INT);

CREATE OR REPLACE FUNCTION public.get_export_view(
    p_module TEXT,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL,
    p_limit INT DEFAULT 5000,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_branch UUID;
    v_role TEXT;
    v_result JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Missing agency context' USING ERRCODE = '42501';
    END IF;

    -- Strict Role & Branch validation (P1-02, P1-08)
    SELECT role, branch_id INTO v_role, v_branch
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND is_active = true;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF p_limit > 10000 THEN
        RAISE EXCEPTION 'Export limit exceeded: maximum 10000 rows per chunk';
    END IF;

    -- Evaluate PII capability (P1-06)
    -- Only ADMIN can see sensitive PII fields.
    -- (This guarantees redaction at the database layer)

    CASE p_module
        WHEN 'pilgrims' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'full_name', full_name,
                    'passport_number', CASE WHEN v_role = 'ADMIN' THEN passport_number ELSE '[REDACTED]' END,
                    'phone', CASE WHEN v_role = 'ADMIN' THEN phone ELSE '[REDACTED]' END,
                    'birth_date', birth_date,
                    'wilaya', wilaya,
                    'gender', gender,
                    'visa_status', visa_status,
                    'payment_status', payment_status,
                    'status', status,
                    'departure_airport', departure_airport,
                    'created_at', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.pilgrims
                WHERE agency_id = v_agency
                  -- Branch isolation: Admin sees all, others see only their branch
                  AND (v_role = 'ADMIN' OR branch_id = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'bookings' THEN
            -- total_dzd / total_sar: the live money columns. The original read
            -- total_price_dzd / total_price_sar, which have never existed here.
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'booking_reference', b.reference,
                    'status', b.status,
                    'amount_dzd', CASE WHEN v_role = 'ADMIN' THEN b.total_dzd ELSE NULL END,
                    'amount_sar', CASE WHEN v_role = 'ADMIN' THEN b.total_sar ELSE NULL END,
                    'payment_method', (SELECT method FROM public.payments p WHERE p.booking_id = b.id ORDER BY created_at LIMIT 1),
                    'created_at', b.created_at
                ) ORDER BY b.created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.bookings b
                WHERE b.agency_id = v_agency
                  AND (v_role = 'ADMIN' OR b.branch_id = v_branch)
                  AND (p_date_from IS NULL OR b.created_at >= p_date_from)
                  AND (p_date_to IS NULL OR b.created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY b.created_at
                LIMIT p_limit OFFSET p_offset
            ) b;

        WHEN 'payments' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'amount_dzd', CASE WHEN v_role = 'ADMIN' THEN py.amount_dzd ELSE NULL END,
                    'payment_method', py.method,
                    'payment_date', COALESCE(py.received_at, py.created_at),
                    'status', py.status,
                    'notes', py.notes
                ) ORDER BY COALESCE(py.received_at, py.created_at)
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.payments py
                WHERE py.agency_id = v_agency
                  -- Branch scoped via bookings
                  AND (v_role = 'ADMIN' OR (SELECT branch_id FROM public.bookings b WHERE b.id = py.booking_id) = v_branch)
                  AND (p_date_from IS NULL OR COALESCE(py.received_at, py.created_at) >= p_date_from)
                  AND (p_date_to IS NULL OR COALESCE(py.received_at, py.created_at) < (p_date_to + INTERVAL '1 day'))
                ORDER BY COALESCE(py.received_at, py.created_at)
                LIMIT p_limit OFFSET p_offset
            ) py;

        WHEN 'groups' THEN
            -- capacity reads max_capacity (the live column). guide_name is gone:
            -- staff_profiles carries no name, and no other live table maps a
            -- staff user_id to one, so the export carries the id it can prove.
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'code', code,
                    'name', name,
                    'departure_date', departure_date,
                    'capacity', max_capacity,
                    'current_capacity', current_capacity,
                    'guide_id', guide_id,
                    'status', status,
                    'created_at', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.groups
                WHERE agency_id = v_agency
                  AND (v_role = 'ADMIN' OR branch_id = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'visas' THEN
            -- application_date reads created_at: the row is written when the
            -- application is filed, and no separate application_date column exists.
            -- 'notes' is replaced by rejection_reason, the only free-text column here;
            -- renamed rather than aliased, because they do not mean the same thing.
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'pilgrim_name', (SELECT full_name FROM public.pilgrims p WHERE p.id = pilgrim_id LIMIT 1),
                    'passport_number', CASE WHEN v_role = 'ADMIN' THEN COALESCE(passport_number, (SELECT passport_number FROM public.pilgrims p WHERE p.id = pilgrim_id LIMIT 1)) ELSE '[REDACTED]' END,
                    'status', status,
                    'application_date', created_at,
                    'issue_date', issue_date,
                    'expiry_date', expiry_date,
                    'rejection_reason', rejection_reason
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.visas
                WHERE agency_id = v_agency
                  AND (v_role = 'ADMIN' OR (SELECT branch_id FROM public.pilgrims p WHERE p.id = pilgrim_id) = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'external_operations' THEN
            -- The original read reference / provider_name / amount / currency / status.
            -- Live: external_reference / provider / (no money columns at all) /
            -- internal_status + external_status. evidence_status is denormalised onto
            -- the operation row, so the old unordered LIMIT 1 subselect against
            -- external_operation_evidence -- which picked an arbitrary evidence row --
            -- is replaced by the column the table already maintains.
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'external_reference', external_reference,
                    'operation_type', operation_type,
                    'provider', provider,
                    'internal_status', internal_status,
                    'external_status', external_status,
                    'evidence_status', evidence_status,
                    'sla_deadline', sla_deadline,
                    'submitted_at', submitted_at,
                    'completed_at', completed_at,
                    'created_at', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT eo.*
                FROM public.external_operations eo
                WHERE eo.agency_id = v_agency
                  -- External ops might not have a branch, restrict to ADMIN only for safety
                  AND v_role = 'ADMIN'
                  AND (p_date_from IS NULL OR eo.created_at >= p_date_from)
                  AND (p_date_to IS NULL OR eo.created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY eo.created_at
                LIMIT p_limit OFFSET p_offset
            ) eo;

        ELSE
            RAISE EXCEPTION 'Unknown export module %', p_module USING ERRCODE = '22023';
    END CASE;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_export_view(TEXT, DATE, DATE, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_export_view(TEXT, DATE, DATE, INT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Gate. A gate that cannot fail is worse than no gate, and "the function
-- exists" is exactly such a gate here -- the broken original would have passed
-- it. So the first check is the one that matters: every column the body reads
-- must resolve in the live catalogue. If this database is not shaped the way
-- the body assumes, the migration aborts instead of installing another
-- function that only fails in front of a user.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
    v_missing TEXT;
    v_oid     OID;
    v_secdef  BOOLEAN;
    v_path    BOOLEAN;
    v_public  BOOLEAN;
    v_auth    BOOLEAN;
BEGIN
    SELECT string_agg(format('%s.%s', r.tbl, r.col), ', ' ORDER BY r.tbl, r.col)
      INTO v_missing
      FROM (VALUES
        ('pilgrims','full_name'), ('pilgrims','passport_number'), ('pilgrims','phone'),
        ('pilgrims','birth_date'), ('pilgrims','wilaya'), ('pilgrims','gender'),
        ('pilgrims','visa_status'), ('pilgrims','payment_status'), ('pilgrims','status'),
        ('pilgrims','departure_airport'), ('pilgrims','created_at'),
        ('pilgrims','agency_id'), ('pilgrims','branch_id'), ('pilgrims','id'),
        ('bookings','reference'), ('bookings','status'), ('bookings','total_dzd'),
        ('bookings','total_sar'), ('bookings','created_at'), ('bookings','agency_id'),
        ('bookings','branch_id'), ('bookings','id'),
        ('payments','method'), ('payments','booking_id'), ('payments','created_at'),
        ('payments','amount_dzd'), ('payments','received_at'), ('payments','status'),
        ('payments','notes'), ('payments','agency_id'),
        ('groups','code'), ('groups','name'), ('groups','departure_date'),
        ('groups','max_capacity'), ('groups','current_capacity'), ('groups','guide_id'),
        ('groups','status'), ('groups','created_at'), ('groups','agency_id'),
        ('groups','branch_id'),
        ('visas','pilgrim_id'), ('visas','status'), ('visas','created_at'),
        ('visas','issue_date'), ('visas','expiry_date'), ('visas','rejection_reason'),
        ('visas','passport_number'), ('visas','agency_id'),
        ('external_operations','external_reference'), ('external_operations','operation_type'),
        ('external_operations','provider'), ('external_operations','internal_status'),
        ('external_operations','external_status'), ('external_operations','evidence_status'),
        ('external_operations','sla_deadline'), ('external_operations','submitted_at'),
        ('external_operations','completed_at'), ('external_operations','created_at'),
        ('external_operations','agency_id'),
        ('staff_profiles','role'), ('staff_profiles','branch_id'),
        ('staff_profiles','user_id'), ('staff_profiles','is_active')
      ) AS r(tbl, col)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name   = r.tbl
           AND c.column_name  = r.col
     );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'get_export_view gate: body reads columns that do not exist: %', v_missing
            USING ERRCODE = '42703';
    END IF;

    -- Resolve by oid rather than by a rendered argument string:
    -- pg_get_function_identity_arguments() includes parameter NAMES
    -- ("p_module text, ..."), so comparing it against bare type lists
    -- never matches. to_regprocedure() resolves on types alone.
    v_oid := to_regprocedure('public.get_export_view(text, date, date, integer, integer)');

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'get_export_view gate: function absent at the 5-argument signature'
            USING ERRCODE = '42883';
    END IF;

    SELECT p.prosecdef,
           EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                    WHERE cfg LIKE 'search_path=%')
      INTO v_secdef, v_path
      FROM pg_proc p
     WHERE p.oid = v_oid;

    IF NOT v_secdef THEN
        RAISE EXCEPTION 'get_export_view gate: function is not SECURITY DEFINER'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_path THEN
        RAISE EXCEPTION 'get_export_view gate: function has no pinned search_path'
            USING ERRCODE = '42501';
    END IF;

    v_public := has_function_privilege('public', v_oid, 'EXECUTE');
    v_auth   := has_function_privilege('authenticated', v_oid, 'EXECUTE');

    IF v_public THEN
        RAISE EXCEPTION 'get_export_view gate: PUBLIC still holds EXECUTE'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_auth THEN
        RAISE EXCEPTION 'get_export_view gate: authenticated lacks EXECUTE'
            USING ERRCODE = '42501';
    END IF;

    RAISE NOTICE 'get_export_view gate: 63 column references resolved; definer, pinned, PUBLIC revoked, authenticated granted.';
END;
$gate$;
