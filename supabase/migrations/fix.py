import os
import re

dir_path = r"C:\Users\sam\Downloads\000000000001\hajj-umrah-assest\supabase\migrations"
files_to_fix = [
    "20260822000012_crm_integration.sql",
    "20260822000013_dms_integration.sql",
    "20260822000014_fpa_modeling.sql",
    "20260822000015_business_simulation.sql",
    "20260822000016_controls_treasury_risk.sql",
    "20260822000017_ai_layer.sql"
]

audit_replacement = """    INSERT INTO audit_events (
        actor, timestamp, agency_scope, branch_scope, object_type,
        object_id, correlation_id, reason, source, action, changes
    ) VALUES (
        auth.uid(), now(), public.current_staff_agency_id(), NULL, TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id), NULL, NULL, 'database_trigger', TG_OP,
        CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END
    );"""

# Matches the INSERT INTO ... VALUES ( ... ); part of the audit trigger
audit_pattern_1 = re.compile(r"INSERT INTO audit_events\s*\([^;]*\s*VALUES\s*\([^;]*\);", re.MULTILINE | re.IGNORECASE | re.DOTALL)
audit_pattern_2 = re.compile(r"INSERT INTO public\.audit_events\s*\([^;]*\s*VALUES\s*\([^;]*\);", re.MULTILINE | re.IGNORECASE | re.DOTALL)


for filename in files_to_fix:
    path = os.path.join(dir_path, filename)
    if not os.path.exists(path):
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. RLS replacements
    content = re.sub(r'USING\s*\(\s*true\s*\)', 'USING (agency_id = public.current_staff_agency_id())', content, flags=re.IGNORECASE)
    content = re.sub(r'WITH\s+CHECK\s*\(\s*true\s*\)', 'WITH CHECK (agency_id = public.current_staff_agency_id())', content, flags=re.IGNORECASE)
    
    # 2. Add agency_id to all tables
    # Find all table creations and add agency_id right after the opening parenthesis
    def table_repl(match):
        # Only add if not already there
        if "agency_id" not in match.group(0):
            return match.group(1) + "\n    agency_id UUID DEFAULT public.current_staff_agency_id(),"
        return match.group(0)
    
    # Matches `CREATE TABLE [IF NOT EXISTS] table_name (`
    content = re.sub(r'(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-zA-Z0-9_\.]+\s*\()', table_repl, content, flags=re.IGNORECASE)
    
    # 3. Replace Audit Triggers
    if "audit_events" in content:
        content = audit_pattern_1.sub(audit_replacement, content)
        content = audit_pattern_2.sub(audit_replacement, content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

print("Done")
