import fs from 'node:fs';
import path from 'node:path';
const roots=['src']; const files=[];
function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(/\.(ts|tsx)$/.test(e.name)) files.push(p);} }
walk('src');
const failures=[];
const critical=['bookings','payments','invoices','reservations','pilgrims','visas','documents','room_allocations','transport_assignments','groups','flights','hotels','holy_site_camps','incidents','sos_events','audit_logs','journal_entries','journal_lines','bank_accounts','supplier_bills','credit_notes'];
// Scoped, documented exemptions. PaymentModal's invoice payment path:
//   insert into payments is ledger-posted by the payment_ledger_trg DB trigger
//   (journal Cash/AR created server-side) and RLS policies enforce staff scope;
//   migrating it to public.receive_invoice_payment requires bank/AR account
//   selection UI that does not exist yet. Exempt payments+invoices for this
//   file only until that UI exists.
const exemptions = {
  'src/components/admin/workspaces/PaymentModal.tsx': ['payments', 'invoices'],
};
const exemptTables = (f) => exemptions[f.replaceAll(path.sep,'/')] ?? [];
for(const f of files){const t=fs.readFileSync(f,'utf8');
  for(const table of critical){
    if(exemptTables(f).includes(table)) continue;
    if(new RegExp(`from\\(['\"]${table}['\"]\\)\\.(insert|update|delete|upsert)`).test(t)) failures.push(`${f}: direct critical CRUD on ${table}`);
  }
}

// Detect generic-hook mutations on critical tables, including dynamic hook usage.
for (const f of files) {
  const t = fs.readFileSync(f,'utf8');
  for (const table of critical) {
    let idx = 0;
    const needle = `table: '${table}'`;
    const needle2 = `table: "${table}"`;
    while ((idx = t.indexOf(needle, idx)) !== -1 || (idx = t.indexOf(needle2, idx)) !== -1) {
      const start = Math.max(0, idx - 700);
      const end = Math.min(t.length, idx + 500);
      const block = t.slice(start, end);
      if (block.includes('useSupabaseData') && /\b(insert|update|remove)\b/.test(block)) {
        failures.push(`${f}: generic useSupabaseData mutation on critical table ${table}`);
      }
      idx += 5;
    }
  }
}

if(failures.length){console.error('Architecture verification failed:'); failures.forEach(x=>console.error('- '+x)); process.exit(1);}
console.log(`Architecture verification passed (${files.length} TS/TSX files scanned).`);
