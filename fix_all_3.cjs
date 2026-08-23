const fs = require('fs');
const path = require('path');

const reconFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'ReconciliationWorkspace.tsx');
let reconContent = fs.readFileSync(reconFile, 'utf8');
reconContent = reconContent.replace(/\{l\.description \|\| 'Ledger Entry'\}/g, "{String(l.description || 'Ledger Entry')}");
reconContent = reconContent.replace(/\{\(l\.account_id \|\| ''\)\.slice\(0,8\)\}/g, "{String(l.account_id || '').slice(0,8)}");
fs.writeFileSync(reconFile, reconContent, 'utf8');

const econFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'UnitEconomicsWorkspace.tsx');
let econContent = fs.readFileSync(econFile, 'utf8');
econContent = econContent.replace(/if \(data && data\.length > 0\) \{/g, "if (data && Array.isArray(data) && data.length > 0) {");
fs.writeFileSync(econFile, econContent, 'utf8');

console.log('Fixed TS Errors again.');
