const fs = require('fs');
const path = require('path');

const dirPath = "C:\\Users\\sam\\Downloads\\000000000001\\hajj-umrah-assest\\supabase\\migrations";
const filesToFix = [
    "20260822000012_crm_integration.sql",
    "20260822000013_dms_integration.sql",
    "20260822000014_fpa_modeling.sql",
    "20260822000015_business_simulation.sql",
    "20260822000016_controls_treasury_risk.sql",
    "20260822000017_ai_layer.sql"
];

const auditReplacement = `    INSERT INTO public.audit_events (
        actor, timestamp, agency_scope, branch_scope, object_type,
        object_id, correlation_id, reason, source, action, changes
    ) VALUES (
        auth.uid(), now(), public.current_staff_agency_id(), NULL, TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id), NULL, NULL, 'database_trigger', TG_OP,
        CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END
    );`;

// We use regex to find INSERT INTO audit_events ... VALUES (...);
const auditPattern1 = /INSERT INTO audit_events\s*\([^;]*\s*VALUES\s*\([^;]*\);/gim;
const auditPattern2 = /INSERT INTO public\.audit_events\s*\([^;]*\s*VALUES\s*\([^;]*\);/gim;

for (const filename of filesToFix) {
    const filePath = path.join(dirPath, filename);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${filename}, not found`);
        continue;
    }
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. RLS replacements
    content = content.replace(/USING\s*\(\s*true\s*\)/gi, 'USING (agency_id = public.current_staff_agency_id())');
    content = content.replace(/WITH\s+CHECK\s*\(\s*true\s*\)/gi, 'WITH CHECK (agency_id = public.current_staff_agency_id())');
    
    // 2. Add agency_id to all tables
    // Match CREATE TABLE ... (
    const tablePattern = /(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-zA-Z0-9_\.]+\s*\()/gi;
    content = content.replace(tablePattern, (match) => {
        // Find if this table creation already has agency_id in it
        // We do a simple approach: just add it right after the parenthesis
        return match + "\n    agency_id UUID DEFAULT public.current_staff_agency_id(),";
    });
    
    // 3. Replace Audit Triggers
    if (content.includes('audit_events')) {
        content = content.replace(auditPattern1, auditReplacement);
        content = content.replace(auditPattern2, auditReplacement);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filename}`);
}

console.log("Done");
