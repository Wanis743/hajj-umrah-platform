-- CANONICAL FRESH-INSTALL BOOTSTRAP
-- SOURCE OF TRUTH: supabase/migrations/*.sql
-- This file intentionally contains no demo/sample seed data.
-- Development seed data lives only in supabase/seed.dev.sql.
\set ON_ERROR_STOP on

-- >>> supabase/migrations/20260805041144_create_inquiries_table.sql
\ir supabase/migrations/20260805041144_create_inquiries_table.sql
-- <<< supabase/migrations/20260805041144_create_inquiries_table.sql

-- >>> supabase/migrations/20260805042757_create_reservations_table.sql
\ir supabase/migrations/20260805042757_create_reservations_table.sql
-- <<< supabase/migrations/20260805042757_create_reservations_table.sql

-- >>> supabase/migrations/20260807012752_20260807000001_tighten_security_add_settings_drop_inquiries.sql
\ir supabase/migrations/20260807012752_20260807000001_tighten_security_add_settings_drop_inquiries.sql
-- <<< supabase/migrations/20260807012752_20260807000001_tighten_security_add_settings_drop_inquiries.sql

-- >>> supabase/migrations/20260808003704_create_reservations_table.sql
\ir supabase/migrations/20260808003704_create_reservations_table.sql
-- <<< supabase/migrations/20260808003704_create_reservations_table.sql

-- >>> supabase/migrations/20260808003724_add_settings_table.sql
\ir supabase/migrations/20260808003724_add_settings_table.sql
-- <<< supabase/migrations/20260808003724_add_settings_table.sql

-- >>> supabase/migrations/20260808020000_fix_auth_users_null_tokens.sql
\ir supabase/migrations/20260808020000_fix_auth_users_null_tokens.sql
-- <<< supabase/migrations/20260808020000_fix_auth_users_null_tokens.sql

-- >>> supabase/migrations/20260810000000_comprehensive_schema_expansion.sql
\ir supabase/migrations/20260810000000_comprehensive_schema_expansion.sql
-- <<< supabase/migrations/20260810000000_comprehensive_schema_expansion.sql

-- >>> supabase/migrations/20260811000000_full_system_restoration.sql
\ir supabase/migrations/20260811000000_full_system_restoration.sql
-- <<< supabase/migrations/20260811000000_full_system_restoration.sql

-- >>> supabase/migrations/20260813000000_production_hardening.sql
\ir supabase/migrations/20260813000000_production_hardening.sql
-- <<< supabase/migrations/20260813000000_production_hardening.sql

-- >>> supabase/migrations/20260813010000_enterprise_security_and_domain.sql
\ir supabase/migrations/20260813010000_enterprise_security_and_domain.sql
-- <<< supabase/migrations/20260813010000_enterprise_security_and_domain.sql

-- >>> supabase/migrations/20260813020000_close_remaining_p0_boundaries.sql
\ir supabase/migrations/20260813020000_close_remaining_p0_boundaries.sql
-- <<< supabase/migrations/20260813020000_close_remaining_p0_boundaries.sql

-- >>> supabase/migrations/20260813110000_final_p2_hardening.sql
\ir supabase/migrations/20260813110000_final_p2_hardening.sql
-- <<< supabase/migrations/20260813110000_final_p2_hardening.sql

-- >>> supabase/migrations/20260813110000_final_workflow_p1p2.sql
\ir supabase/migrations/20260813110000_final_workflow_p1p2.sql
-- <<< supabase/migrations/20260813110000_final_workflow_p1p2.sql

-- >>> supabase/migrations/20260813112000_finalize_function_execute_security.sql
\ir supabase/migrations/20260813112000_finalize_function_execute_security.sql
-- <<< supabase/migrations/20260813112000_finalize_function_execute_security.sql

-- >>> supabase/migrations/20260813113000_performance_policy_cleanup.sql
\ir supabase/migrations/20260813113000_performance_policy_cleanup.sql
-- <<< supabase/migrations/20260813113000_performance_policy_cleanup.sql

-- >>> supabase/migrations/20260813130000_internalize_staff_permissions.sql
\ir supabase/migrations/20260813130000_internalize_staff_permissions.sql
-- <<< supabase/migrations/20260813130000_internalize_staff_permissions.sql

-- >>> supabase/migrations/20260813140000_full_enterprise_gap_closure.sql
\ir supabase/migrations/20260813140000_full_enterprise_gap_closure.sql
-- <<< supabase/migrations/20260813140000_full_enterprise_gap_closure.sql

-- >>> supabase/migrations/20260813141000_server_side_mfa_and_erp_posting.sql
\ir supabase/migrations/20260813141000_server_side_mfa_and_erp_posting.sql
-- <<< supabase/migrations/20260813141000_server_side_mfa_and_erp_posting.sql

-- >>> supabase/migrations/20260813142000_close_new_security_advisor_findings.sql
\ir supabase/migrations/20260813142000_close_new_security_advisor_findings.sql
-- <<< supabase/migrations/20260813142000_close_new_security_advisor_findings.sql

-- >>> supabase/migrations/20260813143000_edge_only_reservation_rpc.sql
\ir supabase/migrations/20260813143000_edge_only_reservation_rpc.sql
-- <<< supabase/migrations/20260813143000_edge_only_reservation_rpc.sql

-- >>> supabase/migrations/20260813144500_fix_journal_reference_collisions.sql
\ir supabase/migrations/20260813144500_fix_journal_reference_collisions.sql
-- <<< supabase/migrations/20260813144500_fix_journal_reference_collisions.sql

-- >>> supabase/migrations/20260813145000_one_time_admin_bootstrap.sql
\ir supabase/migrations/20260813145000_one_time_admin_bootstrap.sql
-- <<< supabase/migrations/20260813145000_one_time_admin_bootstrap.sql

-- >>> supabase/migrations/20260813150000_index_all_enterprise_foreign_keys.sql
\ir supabase/migrations/20260813150000_index_all_enterprise_foreign_keys.sql
-- <<< supabase/migrations/20260813150000_index_all_enterprise_foreign_keys.sql

-- >>> supabase/migrations/20260813151000_granular_rbac_and_readiness.sql
\ir supabase/migrations/20260813151000_granular_rbac_and_readiness.sql
-- <<< supabase/migrations/20260813151000_granular_rbac_and_readiness.sql

-- >>> supabase/migrations/20260813152000_security_definer_view_cleanup.sql
\ir supabase/migrations/20260813152000_security_definer_view_cleanup.sql
-- <<< supabase/migrations/20260813152000_security_definer_view_cleanup.sql

-- >>> supabase/migrations/20260813153000_finance_aal2_enforcement.sql
\ir supabase/migrations/20260813153000_finance_aal2_enforcement.sql
-- <<< supabase/migrations/20260813153000_finance_aal2_enforcement.sql

-- >>> supabase/migrations/20260813161000_notification_worker_and_storage_tests.sql
\ir supabase/migrations/20260813161000_notification_worker_and_storage_tests.sql
-- <<< supabase/migrations/20260813161000_notification_worker_and_storage_tests.sql

-- >>> supabase/migrations/20260813162000_financial_reporting_reconciliation_and_governance.sql
\ir supabase/migrations/20260813162000_financial_reporting_reconciliation_and_governance.sql
-- <<< supabase/migrations/20260813162000_financial_reporting_reconciliation_and_governance.sql

-- >>> supabase/migrations/20260813170000_reservation_idempotency.sql
\ir supabase/migrations/20260813170000_reservation_idempotency.sql
-- <<< supabase/migrations/20260813170000_reservation_idempotency.sql

-- >>> supabase/migrations/20260813171000_restore_permission_function_execute.sql
\ir supabase/migrations/20260813171000_restore_permission_function_execute.sql
-- <<< supabase/migrations/20260813171000_restore_permission_function_execute.sql

-- >>> supabase/migrations/20260813172000_explicit_deny_staff_permissions.sql
\ir supabase/migrations/20260813172000_explicit_deny_staff_permissions.sql
-- <<< supabase/migrations/20260813172000_explicit_deny_staff_permissions.sql

-- >>> supabase/migrations/20260813173000_invoice_sequence_table.sql
\ir supabase/migrations/20260813173000_invoice_sequence_table.sql
-- <<< supabase/migrations/20260813173000_invoice_sequence_table.sql

-- >>> supabase/migrations/20260813180000_internalize_privileged_functions_with_invoker_wrappers.sql
\ir supabase/migrations/20260813180000_internalize_privileged_functions_with_invoker_wrappers.sql
-- <<< supabase/migrations/20260813180000_internalize_privileged_functions_with_invoker_wrappers.sql

-- >>> supabase/migrations/20260813200000_final_enterprise_hardening.sql
\ir supabase/migrations/20260813200000_final_enterprise_hardening.sql
-- <<< supabase/migrations/20260813200000_final_enterprise_hardening.sql

-- >>> supabase/migrations/20260813201000_storage_delete_hardening.sql
\ir supabase/migrations/20260813201000_storage_delete_hardening.sql
-- <<< supabase/migrations/20260813201000_storage_delete_hardening.sql

-- >>> supabase/migrations/20260813202000_final_audit_package_storage_alignment.sql
\ir supabase/migrations/20260813202000_final_audit_package_storage_alignment.sql
-- <<< supabase/migrations/20260813202000_final_audit_package_storage_alignment.sql

-- >>> supabase/migrations/20260813203000_unify_confirmation_payment_accounting.sql
\ir supabase/migrations/20260813203000_unify_confirmation_payment_accounting.sql
-- <<< supabase/migrations/20260813203000_unify_confirmation_payment_accounting.sql

-- >>> supabase/migrations/20260813204000_purge_legacy_demo_seed.sql
\ir supabase/migrations/20260813204000_purge_legacy_demo_seed.sql
-- <<< supabase/migrations/20260813204000_purge_legacy_demo_seed.sql

-- >>> supabase/migrations/20260813205000_storage_policy_unification.sql
\ir supabase/migrations/20260813205000_storage_policy_unification.sql
-- <<< supabase/migrations/20260813205000_storage_policy_unification.sql

-- >>> supabase/migrations/20260813206000_pilgrim_visa_state_machines.sql
\ir supabase/migrations/20260813206000_pilgrim_visa_state_machines.sql
-- <<< supabase/migrations/20260813206000_pilgrim_visa_state_machines.sql

-- >>> supabase/migrations/20260813207000_capacity_uniqueness_constraints.sql
\ir supabase/migrations/20260813207000_capacity_uniqueness_constraints.sql
-- <<< supabase/migrations/20260813207000_capacity_uniqueness_constraints.sql

-- >>> supabase/migrations/20260813210000_storage_bucket_canonical_documents.sql
\ir supabase/migrations/20260813210000_storage_bucket_canonical_documents.sql
-- <<< supabase/migrations/20260813210000_storage_bucket_canonical_documents.sql

-- >>> supabase/migrations/20260813211000_storage_insert_document_binding.sql
\ir supabase/migrations/20260813211000_storage_insert_document_binding.sql
-- <<< supabase/migrations/20260813211000_storage_insert_document_binding.sql

-- >>> supabase/migrations/20260813212000_internalize_state_machine_functions.sql
\ir supabase/migrations/20260813212000_internalize_state_machine_functions.sql
-- <<< supabase/migrations/20260813212000_internalize_state_machine_functions.sql
