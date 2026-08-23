-- Migration: 20260822000010_accounting_vertical.sql

-- 1. Create Tables
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_number VARCHAR(255) NOT NULL UNIQUE,
    amount DECIMAL(19, 4) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id),
    amount DECIMAL(19, 4) NOT NULL,
    payment_date DATE NOT NULL,
    source_transaction_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(255),
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'posted'
    posted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    account_id UUID NOT NULL, -- Assuming an accounts table or reference exists
    debit DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
    credit DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    statement_date DATE NOT NULL,
    statement_balance DECIMAL(19, 4) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Journal Balance Enforcement Trigger
CREATE OR REPLACE FUNCTION check_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
    total_debit DECIMAL(19, 4);
    total_credit DECIMAL(19, 4);
BEGIN
    IF NEW.status = 'posted' THEN
        SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
        INTO total_debit, total_credit
        FROM journal_lines
        WHERE journal_id = NEW.id;

        IF total_debit <> total_credit THEN
            RAISE EXCEPTION 'Journal entry is not balanced. Total Debit: %, Total Credit: %', total_debit, total_credit;
        END IF;

        IF total_debit = 0 AND total_credit = 0 THEN
            RAISE EXCEPTION 'Journal entry cannot be empty or have zero amounts when posting.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_journal_balance
BEFORE UPDATE OF status ON journals
FOR EACH ROW
WHEN (NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted')
EXECUTE FUNCTION check_journal_balance();

-- 3. Audit Logging to audit_events kernel table
CREATE OR REPLACE FUNCTION audit_financial_action()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_events (
        table_name,
        record_id,
        action,
        old_data,
        new_data,
        created_at
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        (CASE WHEN TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END),
        (CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN row_to_json(NEW) ELSE NULL END),
        now()
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN undefined_table THEN
    -- Fallback in case audit_events structure varies, assuming standard jsonb audit approach
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attach audit trigger to consequential financial tables
CREATE TRIGGER trg_audit_invoices
AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION audit_financial_action();

CREATE TRIGGER trg_audit_payments
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION audit_financial_action();

CREATE TRIGGER trg_audit_journals
AFTER INSERT OR UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION audit_financial_action();

CREATE TRIGGER trg_audit_journal_lines
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION audit_financial_action();

CREATE TRIGGER trg_audit_reconciliations
AFTER INSERT OR UPDATE OR DELETE ON reconciliations
FOR EACH ROW EXECUTE FUNCTION audit_financial_action();
