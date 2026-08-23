-- Migration: post_journal_entry RPC
CREATE OR REPLACE FUNCTION public.post_journal_entry(
    p_reference TEXT,
    p_description TEXT,
    p_entry_date DATE,
    p_lines JSONB -- Array of { account_id, debit, credit, currency_code, memo, branch_id, package_id }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_journal_id UUID;
    v_total_debit NUMERIC := 0;
    v_total_credit NUMERIC := 0;
    v_line JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Validate Debit = Credit
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
        v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
    END LOOP;

    -- Using exact matching for invariant
    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Debit and Credit must be equal (Debit: %, Credit: %)', v_total_debit, v_total_credit
        USING ERRCODE = 'P0001';
    END IF;

    IF v_total_debit = 0 THEN
        RAISE EXCEPTION 'Journal entry must have non-zero amounts'
        USING ERRCODE = 'P0001';
    END IF;

    -- Insert Journal Entry
    INSERT INTO public.journal_entries (
        agency_id,
        reference,
        description,
        entry_date,
        status,
        total_debit,
        total_credit
    ) VALUES (
        v_agency,
        p_reference,
        p_description,
        p_entry_date,
        'DRAFT', -- Initial state before approval flow
        v_total_debit,
        v_total_credit
    ) RETURNING id INTO v_journal_id;

    -- Insert Lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        INSERT INTO public.journal_lines (
            journal_entry_id,
            account_id,
            debit,
            credit,
            currency_code,
            memo,
            branch_id,
            package_id
        ) VALUES (
            v_journal_id,
            (v_line->>'account_id')::UUID,
            COALESCE((v_line->>'debit')::NUMERIC, 0),
            COALESCE((v_line->>'credit')::NUMERIC, 0),
            COALESCE(v_line->>'currency_code', 'DZD'),
            v_line->>'memo',
            NULLIF(v_line->>'branch_id', '')::UUID,
            NULLIF(v_line->>'package_id', '')::UUID
        );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'journal_entry_id', v_journal_id);
END;
$$;
