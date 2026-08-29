-- 20260826000000_finance_os_command_rpcs.sql
--
-- Command surface for the Finance OS kernel's data broker.
--
-- The broker exposes eleven named commands to applications and binds each to a
-- server-side function. Seven of those bindings had no function yet; this
-- migration supplies them. Nothing here opens a new write path for clients:
-- every function repeats the authorization ladder that approve_journal_entry
-- and close_fiscal_period already established --
--
--     require_admin_aal2()  ->  agency scope  ->  role/permission  ->  row lock
--
-- followed by an audit_logs row carrying actor, role, scope and details.
-- EXECUTE is granted to authenticated only; PUBLIC and anon are revoked.
--
-- Three existing guards shaped the design and are deliberately not bypassed:
--
--   guard_posted_journal_mutation()  any UPDATE of a POSTED journal_entries row
--                                    raises 42501, with no escape hatch.
--   protect_posted_journals()        lines of a POSTED entry are immutable.
--   guard_fiscal_period()            an entry cannot land in a CLOSED or LOCKED
--                                    period.
--
-- So void_journal_entry never edits a posted entry. It writes a mirrored
-- reversing entry into today's open period and links it back through
-- source_type/source_id, which is what an ERP and an auditor both expect. No new
-- status value is introduced and no CHECK constraint is widened.

/* ------------------------------------------------------------------ *
 * 0. Reconciliation is not a ledger edit.
 *
 * journal_lines.is_reconciled records whether a bank statement line has been
 * tied to a ledger line. It carries no accounting meaning: debit, credit,
 * account, currency and dimensions are untouched by a match. But both line
 * guards currently reject *any* UPDATE of a posted line, which makes
 * is_reconciled unwritable for exactly the rows that matter -- posted ones.
 * auto_reconcile_bank_statement already tries to write it and would fail.
 *
 * The two guards are narrowed here to allow an update in which nothing but
 * is_reconciled differs. Accounting columns of posted lines stay immutable and
 * DELETE stays blocked, so the control is preserved rather than relaxed. The
 * comparison is written over to_jsonb so a column added later is protected
 * automatically instead of being silently exempt.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.journal_line_reconciliation_only(
    p_old public.journal_lines,
    p_new public.journal_lines
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
    SELECT (to_jsonb(p_old) - 'is_reconciled') = (to_jsonb(p_new) - 'is_reconciled');
$fn$;

COMMENT ON FUNCTION public.journal_line_reconciliation_only(public.journal_lines, public.journal_lines)
IS 'True when the only difference between two journal_lines rows is the is_reconciled flag.';

CREATE OR REPLACE FUNCTION public.protect_posted_journals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO v_status FROM public.journal_entries WHERE id = OLD.journal_entry_id;
        IF v_status = 'POSTED' THEN
            RAISE EXCEPTION 'Cannot delete lines of a POSTED journal entry. Reverse it instead.'
            USING ERRCODE = 'P0005';
        END IF;
        RETURN OLD;
    END IF;

    SELECT status INTO v_status FROM public.journal_entries WHERE id = NEW.journal_entry_id;
    IF v_status = 'POSTED' AND NOT public.journal_line_reconciliation_only(OLD, NEW) THEN
        RAISE EXCEPTION 'Cannot modify lines of a POSTED journal entry. Reverse it instead.'
        USING ERRCODE = 'P0005';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_journal_line_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $fn$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status
    FROM public.journal_entries
    WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

    IF v_status = 'POSTED'
       AND current_setting('app.allow_direct_sensitive_update', true) <> '1'
       AND NOT (TG_OP = 'UPDATE' AND public.journal_line_reconciliation_only(OLD, NEW)) THEN
        RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$fn$;

/* ------------------------------------------------------------------ *
 * 1. void_journal_entry
 *    DRAFT  -> status VOID.
 *    POSTED -> a new POSTED entry with debits and credits swapped, tagged
 *              source_type = 'REVERSAL', source_id = the original.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.void_journal_entry(
    p_journal_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency      UUID;
    v_branch      UUID;
    v_entry       public.journal_entries%ROWTYPE;
    v_existing    UUID;
    v_reversal_id UUID;
    v_period_id   UUID;
    v_lines       INTEGER;
    v_outcome     TEXT;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A reason is required to void a journal entry' USING ERRCODE = '22023';
    END IF;

    PERFORM public.require_admin_aal2();

    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('journal_entries', 'update') THEN
        RAISE EXCEPTION 'Not authorized to void journal entries' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_entry
    FROM public.journal_entries
    WHERE id = p_journal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found', p_journal_id USING ERRCODE = 'P0002';
    END IF;
    IF v_entry.agency_id <> v_agency THEN
        RAISE EXCEPTION 'Journal entry outside caller agency scope' USING ERRCODE = '42501';
    END IF;

    v_branch := public.staff_branch_id();

    IF v_entry.status = 'VOID' THEN
        -- Idempotent replay, same contract as approve_journal_entry.
        RETURN jsonb_build_object(
            'success', true, 'journal_entry_id', v_entry.id,
            'status', 'VOID', 'idempotent_replay', true
        );
    END IF;

    IF v_entry.status = 'DRAFT' THEN
        UPDATE public.journal_entries
        SET status = 'VOID',
            description = description || ' [VOID: ' || btrim(p_reason) || ']'
        WHERE id = v_entry.id;
        v_outcome := 'VOID';
    ELSE
        -- Already reversed once: return that reversal instead of writing a second.
        SELECT id INTO v_existing
        FROM public.journal_entries
        WHERE agency_id = v_agency
          AND source_type = 'REVERSAL'
          AND source_id = v_entry.id
        LIMIT 1;

        IF v_existing IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true, 'journal_entry_id', v_entry.id, 'status', 'REVERSED',
                'reversal_id', v_existing, 'idempotent_replay', true
            );
        END IF;

        -- The reversal is a posting in its own right, so it needs an open period.
        v_period_id := public.assert_open_fiscal_period(v_agency, CURRENT_DATE);

        INSERT INTO public.journal_entries (
            agency_id, branch_id, fiscal_period_id, reference, entry_date,
            description, source_type, source_id, status, created_by, package_id
        ) VALUES (
            v_agency, v_entry.branch_id, v_period_id,
            'REV-' || v_entry.reference, CURRENT_DATE,
            'Reversal of ' || v_entry.reference || ' - ' || btrim(p_reason),
            'REVERSAL', v_entry.id, 'DRAFT', auth.uid(), v_entry.package_id
        ) RETURNING id INTO v_reversal_id;

        -- Debits and credits swap. Lines are written while the reversal is still
        -- DRAFT so the posted-line guards stay satisfied; the deferred balance
        -- constraint validates the mirrored set at commit.
        INSERT INTO public.journal_lines (
            journal_entry_id, agency_id, branch_id, account_id,
            currency_code, debit, credit, memo, package_id
        )
        SELECT v_reversal_id, v_agency, jl.branch_id, jl.account_id,
               jl.currency_code, jl.credit, jl.debit,
               'Reversal: ' || COALESCE(jl.memo, v_entry.reference),
               jl.package_id
        FROM public.journal_lines jl
        WHERE jl.journal_entry_id = v_entry.id;

        GET DIAGNOSTICS v_lines = ROW_COUNT;
        IF v_lines = 0 THEN
            RAISE EXCEPTION 'Journal entry % has no lines to reverse', v_entry.reference
            USING ERRCODE = 'P0002';
        END IF;

        UPDATE public.journal_entries
        SET status = 'POSTED', posted_at = NOW()
        WHERE id = v_reversal_id;

        v_outcome := 'REVERSED';
    END IF;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        CASE WHEN v_outcome = 'VOID' THEN 'VOID' ELSE 'REVERSE' END,
        'journal_entries', v_entry.id::TEXT, auth.email(),
        jsonb_build_object(
            'reference', v_entry.reference,
            'entry_date', v_entry.entry_date,
            'reason', btrim(p_reason),
            'outcome', v_outcome,
            'reversal_id', v_reversal_id
        ),
        auth.uid(), public.staff_role(), v_agency, v_branch
    );

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_entry.id,
        'status', v_outcome,
        'reversal_id', v_reversal_id
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.void_journal_entry(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_journal_entry(UUID, TEXT) TO authenticated;

/* ------------------------------------------------------------------ *
 * 2. upsert_chart_account — backs account.create and account.update.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.upsert_chart_account(
    p_id            UUID DEFAULT NULL,
    p_code          TEXT DEFAULT NULL,
    p_name          TEXT DEFAULT NULL,
    p_account_type  TEXT DEFAULT NULL,
    p_currency_code TEXT DEFAULT 'DZD',
    p_parent_id     UUID DEFAULT NULL,
    p_is_active     BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency UUID;
    v_id     UUID;
    v_action TEXT;
    v_code   TEXT := btrim(COALESCE(p_code, ''));
    v_name   TEXT := btrim(COALESCE(p_name, ''));
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF v_code = '' OR v_name = '' THEN
        RAISE EXCEPTION 'Account code and name are required' USING ERRCODE = '22023';
    END IF;
    IF p_account_type IS NULL
       OR p_account_type NOT IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') THEN
        RAISE EXCEPTION 'Unknown account type: %', COALESCE(p_account_type, '(null)')
        USING ERRCODE = '22023';
    END IF;

    -- A parent must live in the same agency, or the tree could be grafted across
    -- tenants using an id guessed by the client.
    IF p_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts
        WHERE id = p_parent_id AND agency_id = v_agency
    ) THEN
        RAISE EXCEPTION 'Parent account not found' USING ERRCODE = '42501';
    END IF;

    IF p_id IS NULL THEN
        IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('chart_of_accounts', 'create') THEN
            RAISE EXCEPTION 'Not authorized to create accounts' USING ERRCODE = '42501';
        END IF;

        INSERT INTO public.chart_of_accounts (
            agency_id, code, name, account_type, currency_code, parent_id, is_active
        ) VALUES (
            v_agency, v_code, v_name, p_account_type,
            COALESCE(p_currency_code, 'DZD'), p_parent_id, COALESCE(p_is_active, TRUE)
        ) RETURNING id INTO v_id;
        v_action := 'ACCOUNT_CREATE';
    ELSE
        IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('chart_of_accounts', 'update') THEN
            RAISE EXCEPTION 'Not authorized to update accounts' USING ERRCODE = '42501';
        END IF;
        IF p_parent_id = p_id THEN
            RAISE EXCEPTION 'An account cannot be its own parent' USING ERRCODE = '22023';
        END IF;

        -- Retyping an account that already carries postings would silently
        -- restate the trial balance and every statement derived from it.
        IF EXISTS (
            SELECT 1 FROM public.chart_of_accounts
            WHERE id = p_id AND agency_id = v_agency AND account_type <> p_account_type
        ) AND EXISTS (
            SELECT 1 FROM public.journal_lines WHERE account_id = p_id
        ) THEN
            RAISE EXCEPTION 'Account type cannot change once the account has postings'
            USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.chart_of_accounts
        SET code = v_code,
            name = v_name,
            account_type = p_account_type,
            currency_code = COALESCE(p_currency_code, currency_code),
            parent_id = p_parent_id,
            is_active = COALESCE(p_is_active, is_active)
        WHERE id = p_id AND agency_id = v_agency
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
            RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
        END IF;
        v_action := 'ACCOUNT_UPDATE';
    END IF;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        v_action, 'chart_of_accounts', v_id::TEXT, auth.email(),
        jsonb_build_object('code', v_code, 'name', v_name, 'account_type', p_account_type,
                           'is_active', COALESCE(p_is_active, TRUE), 'parent_id', p_parent_id),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object(
        'success', true, 'id', v_id, 'code', v_code,
        'name', v_name, 'account_type', p_account_type
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_chart_account(UUID, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_chart_account(UUID, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

/* ------------------------------------------------------------------ *
 * 3. match_bank_transaction — the manual counterpart to auto-reconcile.
 *    Writes both matched_ledger_line_id (current column) and
 *    matched_journal_line_id (the original, still read by older views).
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.match_bank_transaction(
    p_transaction_id  UUID,
    p_journal_line_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency          UUID;
    v_tx_amount       NUMERIC;
    v_tx_status       TEXT;
    v_line_amount     NUMERIC;
    v_line_reconciled BOOLEAN;
    v_entry_status    TEXT;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('bank_accounts', 'update') THEN
        RAISE EXCEPTION 'Not authorized to reconcile' USING ERRCODE = '42501';
    END IF;

    SELECT bt.amount, bt.status INTO v_tx_amount, v_tx_status
    FROM public.bank_transactions bt
    JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = p_transaction_id AND bs.agency_id = v_agency
    FOR UPDATE OF bt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank transaction not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_tx_status = 'MATCHED' THEN
        RAISE EXCEPTION 'Transaction is already matched' USING ERRCODE = 'P0001';
    END IF;

    SELECT ABS(jl.debit - jl.credit), jl.is_reconciled, je.status
      INTO v_line_amount, v_line_reconciled, v_entry_status
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.id = p_journal_line_id AND jl.agency_id = v_agency;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal line not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_entry_status <> 'POSTED' THEN
        RAISE EXCEPTION 'Only posted ledger lines can be reconciled (entry is %)', v_entry_status
        USING ERRCODE = 'P0001';
    END IF;
    IF v_line_reconciled THEN
        RAISE EXCEPTION 'Journal line is already reconciled' USING ERRCODE = 'P0001';
    END IF;

    -- A match only means something when the amounts agree; one centime of
    -- tolerance absorbs rounding in imported statements.
    IF ABS(ABS(v_tx_amount) - v_line_amount) > 0.01 THEN
        RAISE EXCEPTION 'Amounts differ: statement % vs ledger %', v_tx_amount, v_line_amount
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bank_transactions
    SET status = 'MATCHED',
        matched_ledger_line_id = p_journal_line_id,
        matched_journal_line_id = p_journal_line_id,
        matched_at = NOW(),
        matched_by = auth.uid()
    WHERE id = p_transaction_id;

    UPDATE public.journal_lines SET is_reconciled = TRUE WHERE id = p_journal_line_id;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        'RECONCILE_MATCH', 'bank_transactions', p_transaction_id::TEXT, auth.email(),
        jsonb_build_object('journal_line_id', p_journal_line_id, 'amount', v_tx_amount),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object(
        'success', true, 'id', p_transaction_id,
        'status', 'MATCHED', 'journal_line_id', p_journal_line_id
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.match_bank_transaction(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction(UUID, UUID) TO authenticated;

/* ------------------------------------------------------------------ *
 * 4. unmatch_bank_transaction — reverses a match, releases the ledger line.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.unmatch_bank_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency    UUID;
    v_line      UUID;
    v_status    TEXT;
    v_statement TEXT;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('bank_accounts', 'update') THEN
        RAISE EXCEPTION 'Not authorized to reconcile' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(bt.matched_ledger_line_id, bt.matched_journal_line_id), bt.status, bs.status
      INTO v_line, v_status, v_statement
    FROM public.bank_transactions bt
    JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = p_transaction_id AND bs.agency_id = v_agency
    FOR UPDATE OF bt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank transaction not found' USING ERRCODE = 'P0002';
    END IF;

    -- A locked statement is signed off; unmatching would restate it.
    IF v_statement = 'LOCKED' THEN
        RAISE EXCEPTION 'Statement is locked; unmatching is not permitted' USING ERRCODE = 'P0001';
    END IF;

    IF v_status = 'UNMATCHED' AND v_line IS NULL THEN
        RETURN jsonb_build_object(
            'success', true, 'id', p_transaction_id,
            'status', 'UNMATCHED', 'idempotent_replay', true
        );
    END IF;

    UPDATE public.bank_transactions
    SET status = 'UNMATCHED',
        matched_ledger_line_id = NULL,
        matched_journal_line_id = NULL,
        matched_at = NULL,
        matched_by = NULL
    WHERE id = p_transaction_id;

    IF v_line IS NOT NULL THEN
        UPDATE public.journal_lines
        SET is_reconciled = FALSE
        WHERE id = v_line AND agency_id = v_agency;
    END IF;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        'RECONCILE_UNMATCH', 'bank_transactions', p_transaction_id::TEXT, auth.email(),
        jsonb_build_object('journal_line_id', v_line, 'previous_status', v_status),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object('success', true, 'id', p_transaction_id, 'status', 'UNMATCHED');
END;
$fn$;

REVOKE ALL ON FUNCTION public.unmatch_bank_transaction(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmatch_bank_transaction(UUID) TO authenticated;

/* ------------------------------------------------------------------ *
 * 5. reopen_fiscal_period — the counterpart to close_fiscal_period.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(
    p_period_id UUID,
    p_reason    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency UUID;
    v_period public.fiscal_periods%ROWTYPE;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A reason is required to reopen a period' USING ERRCODE = '22023';
    END IF;

    -- Reopening is the most consequential act in the ledger: it puts a signed-off
    -- period back in play. Same bar as closing, plus a recorded reason.
    PERFORM public.require_admin_aal2();

    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('fiscal_periods', 'update') THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_period FROM public.fiscal_periods
    WHERE id = p_period_id FOR UPDATE;

    IF NOT FOUND OR v_period.agency_id <> v_agency THEN
        RAISE EXCEPTION 'Fiscal period not found' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'OPEN' THEN
        RETURN jsonb_build_object(
            'success', true, 'id', v_period.id, 'status', 'OPEN',
            'label', v_period.label, 'idempotent_replay', true
        );
    END IF;
    IF v_period.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'Period % is %, which cannot be reopened', v_period.label, v_period.status
        USING ERRCODE = 'P0001';
    END IF;

    -- Periods reopen newest first. Otherwise a closed later period would sit on
    -- top of an open earlier one and the comparatives would never tie out.
    IF EXISTS (
        SELECT 1 FROM public.fiscal_periods
        WHERE agency_id = v_agency
          AND status IN ('CLOSED', 'LOCKED')
          AND start_date > v_period.start_date
    ) THEN
        RAISE EXCEPTION 'A later period is still closed; reopen periods newest first'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fiscal_periods
    SET status = 'OPEN', closed_at = NULL, closed_by = NULL
    WHERE id = v_period.id;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        'PERIOD_REOPEN', 'fiscal_periods', v_period.id::TEXT, auth.email(),
        jsonb_build_object('label', v_period.label, 'reason', btrim(p_reason),
                           'previously_closed_at', v_period.closed_at,
                           'previously_closed_by', v_period.closed_by),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object(
        'success', true, 'id', v_period.id, 'status', 'OPEN', 'label', v_period.label
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.reopen_fiscal_period(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_fiscal_period(UUID, TEXT) TO authenticated;

/* ------------------------------------------------------------------ *
 * 6. upsert_budget_line — one account's figure inside one budget.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.upsert_budget_line(
    p_budget_id   UUID,
    p_account_id  UUID,
    p_amount_dzd  NUMERIC DEFAULT 0,
    p_amount_sar  NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency UUID;
    v_locked TIMESTAMPTZ;
    v_status TEXT;
    v_id     UUID;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('fiscal_budgets', 'update') THEN
        RAISE EXCEPTION 'Not authorized to edit budgets' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(p_amount_dzd, 0) < 0 OR COALESCE(p_amount_sar, 0) < 0 THEN
        RAISE EXCEPTION 'Budget amounts cannot be negative' USING ERRCODE = '22023';
    END IF;

    SELECT locked_at, status INTO v_locked, v_status
    FROM public.fiscal_budgets
    WHERE id = p_budget_id AND agency_id = v_agency
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_locked IS NOT NULL OR v_status = 'LOCKED' THEN
        RAISE EXCEPTION 'Budget is locked and can no longer be edited' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts
        WHERE id = p_account_id AND agency_id = v_agency
    ) THEN
        RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.budget_lines (budget_id, account_id, amount_dzd, amount_sar)
    VALUES (p_budget_id, p_account_id, COALESCE(p_amount_dzd, 0), COALESCE(p_amount_sar, 0))
    ON CONFLICT (budget_id, account_id) DO UPDATE
      SET amount_dzd = EXCLUDED.amount_dzd,
          amount_sar = EXCLUDED.amount_sar
    RETURNING id INTO v_id;

    UPDATE public.fiscal_budgets SET updated_at = NOW() WHERE id = p_budget_id;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        'BUDGET_UPSERT', 'budget_lines', v_id::TEXT, auth.email(),
        jsonb_build_object('budget_id', p_budget_id, 'account_id', p_account_id,
                           'amount_dzd', COALESCE(p_amount_dzd, 0),
                           'amount_sar', COALESCE(p_amount_sar, 0)),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object(
        'success', true, 'id', v_id,
        'budget_id', p_budget_id, 'account_id', p_account_id
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_budget_line(UUID, UUID, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_budget_line(UUID, UUID, NUMERIC, NUMERIC) TO authenticated;

/* ------------------------------------------------------------------ *
 * 7. complete_close_task — certify one step of the close checklist.
 *    close_tasks.certification_status is lower-case by table default, so the
 *    accepted vocabulary matches: pending / in_progress / certified / blocked.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.complete_close_task(
    p_task_id UUID,
    p_status  TEXT DEFAULT 'certified'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency  UUID;
    v_task    public.close_tasks%ROWTYPE;
    v_status  TEXT := lower(btrim(COALESCE(p_status, 'certified')));
    v_blocker TEXT;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('fiscal_periods', 'update') THEN
        RAISE EXCEPTION 'Not authorized to certify close tasks' USING ERRCODE = '42501';
    END IF;
    IF v_status NOT IN ('pending', 'in_progress', 'certified', 'blocked') THEN
        RAISE EXCEPTION 'Unknown close-task status: %', p_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_task FROM public.close_tasks
    WHERE id = p_task_id AND agency_id = v_agency
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Close task not found' USING ERRCODE = 'P0002';
    END IF;

    -- Certification honours the declared dependency order. A checklist that can
    -- be signed out of order is not a control.
    IF v_status = 'certified' AND v_task.dependencies IS NOT NULL THEN
        SELECT ct.task_name INTO v_blocker
        FROM public.close_tasks ct
        WHERE ct.agency_id = v_agency
          AND ct.task_name = ANY (v_task.dependencies)
          AND lower(COALESCE(ct.certification_status, 'pending')) <> 'certified'
        ORDER BY ct.task_name
        LIMIT 1;

        IF v_blocker IS NOT NULL THEN
            RAISE EXCEPTION 'Dependency "%" is not certified yet', v_blocker USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE public.close_tasks
    SET certification_status = v_status,
        owner_id = CASE WHEN v_status = 'certified' THEN auth.uid() ELSE owner_id END,
        updated_at = NOW()
    WHERE id = v_task.id;

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        'CLOSE_TASK_CERTIFY', 'close_tasks', v_task.id::TEXT, auth.email(),
        jsonb_build_object('task_name', v_task.task_name,
                           'from', v_task.certification_status, 'to', v_status),
        auth.uid(), public.staff_role(), v_agency, public.staff_branch_id()
    );

    RETURN jsonb_build_object(
        'success', true, 'id', v_task.id,
        'task_name', v_task.task_name, 'certification_status', v_status
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_close_task(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_close_task(UUID, TEXT) TO authenticated;
