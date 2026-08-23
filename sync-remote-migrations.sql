-- High-risk operational script to sync migration ledger.
-- DO NOT treat as a normal application migration.
-- NEVER run automatically on startup/deployment.

\prompt 'This script will TRUNCATE the schema_migrations table. Have you taken a database backup? (yes/no): ' backup_confirmed
\prompt 'Are you running in dry-run mode? (yes/no): ' dry_run
\prompt 'Target environment (local/staging/production): ' target_env
\prompt 'If production, type "OVERRIDE" to confirm: ' prod_override

DO $$
BEGIN
    IF :'target_env' = 'production' AND :'prod_override' != 'OVERRIDE' THEN
        RAISE EXCEPTION 'Production execution requires explicit OVERRIDE.';
    END IF;
    
    IF :'backup_confirmed' != 'yes' THEN
        RAISE EXCEPTION 'Database backup required before execution.';
    END IF;
END $$;

BEGIN;

DO $$
BEGIN
    IF :'dry_run' = 'yes' THEN
        RAISE NOTICE 'DRY RUN MODE: Migrations would be truncated and replaced with 71 ledger entries.';
    ELSE
        TRUNCATE TABLE supabase_migrations.schema_migrations;
        INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
        ('20260304091600', 'create_inquiries_table'),
        ('20260305153000', 'create_reservations_table'),
        ('20260308220100', '20260807000001_tighten_security_add_settings_drop_inquiries'),
        ('20260312021200', 'create_reservations_table'),
        ('20260314050900', 'add_settings_table'),
        ('20260316072500', 'fix_auth_users_null_tokens'),
        ('20260318102300', 'comprehensive_schema_expansion'),
        ('20260321133200', 'full_system_restoration'),
        ('20260322174100', 'production_hardening'),
        ('20260324000300', 'enterprise_security_and_domain'),
        ('20260325010500', 'close_remaining_p0_boundaries'),
        ('20260328033900', 'final_workflow_p1p2'),
        ('20260331100100', 'final_p2_hardening'),
        ('20260403172600', 'finalize_function_execute_security'),
        ('20260406182200', 'performance_policy_cleanup'),
        ('20260408191900', 'internalize_staff_permissions'),
        ('20260410030400', 'full_enterprise_gap_closure'),
        ('20260413094900', 'server_side_mfa_and_erp_posting'),
        ('20260414173000', 'close_new_security_advisor_findings'),
        ('20260417203300', 'edge_only_reservation_rpc'),
        ('20260419215600', 'fix_journal_reference_collisions'),
        ('20260421230900', 'one_time_admin_bootstrap'),
        ('20260425042200', 'index_all_enterprise_foreign_keys'),
        ('20260428121700', 'granular_rbac_and_readiness'),
        ('20260501135300', 'security_definer_view_cleanup'),
        ('20260502213600', 'finance_aal2_enforcement'),
        ('20260506051000', 'notification_worker_and_storage_tests'),
        ('20260509100100', 'financial_reporting_reconciliation_and_governance'),
        ('20260510160200', 'reservation_idempotency'),
        ('20260512180200', 'restore_permission_function_execute'),
        ('20260515212000', 'explicit_deny_staff_permissions'),
        ('20260519000700', 'invoice_sequence_table'),
        ('20260520002500', 'internalize_privileged_functions_with_invoker_wrappers'),
        ('20260521002500', 'final_enterprise_hardening'),
        ('20260524023000', 'storage_delete_hardening'),
        ('20260526071200', 'final_audit_package_storage_alignment'),
        ('20260529084300', 'unify_confirmation_payment_accounting'),
        ('20260531102000', 'purge_legacy_demo_seed'),
        ('20260603122500', 'storage_policy_unification'),
        ('20260605150600', 'pilgrim_visa_state_machines'),
        ('20260607200000', 'capacity_uniqueness_constraints'),
        ('20260609204800', 'storage_bucket_canonical_documents'),
        ('20260610233000', 'storage_insert_document_binding'),
        ('20260612015200', 'internalize_state_machine_functions'),
        ('20260615081800', 'dashboard_executive_snapshot'),
        ('20260616112500', 'dashboard_integrity_hardening'),
        ('20260618152700', 'dashboard_truth_unification'),
        ('20260619175800', 'dashboard_analytics_contract'),
        ('20260622222800', 'dashboard_drilldown'),
        ('20260625223000', 'enterprise_release_hardening'),
        ('20260626233700', 'business_command_authority'),
        ('20260629071500', 'maintainability_finance_contract'),
        ('20260630134500', 'business_command_adapters'),
        ('20260702185000', 'atomic_visa_stage_command'),
        ('20260705234300', 'export_center_rpc'),
        ('20260709003000', 'external_operations'),
        ('20260711005800', 'accounting_series'),
        ('20260714054700', 'data_quality'),
        ('20260717102200', 'export_views'),
        ('20260720172300', 'export_views_fixed'),
        ('20260722001500', 'bounded_exports'),
        ('20260724002100', 'journal_entries_rpc'),
        ('20260727081100', 'journal_entries_rpc_v2'),
        ('20260730140300', 'drop_legacy_export'),
        ('20260802170400', 'external_evidence_integrity'),
        ('20260805002500', 'external_ref_branch'),
        ('20260807030300', 'external_operations_validation'),
        ('20260809033800', 'unify_export_contract'),
        ('20260811062700', 'fix_export_storage_rls'),
        ('20260813102700', 'fix_export_branch_scope_and_audit'),
        ('20260814165200', 'export_storage_bucket');
        
        RAISE NOTICE 'Ledger sync applied.';
    END IF;
END $$;

-- Verify the ledger
DO $$
DECLARE
    entry_count INT;
BEGIN
    SELECT COUNT(*) INTO entry_count FROM supabase_migrations.schema_migrations;
    RAISE NOTICE 'Migration ledger now contains % entries.', entry_count;
END $$;

COMMIT;