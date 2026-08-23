const fs = require('fs');
const path = require('path');

const indexFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'index.tsx');
let indexContent = fs.readFileSync(indexFile, 'utf8');
indexContent = indexContent.replace("Search, Plus, X, Bell, Maximize2 } from 'lucide-react';", "Search, Plus, X, Bell, Maximize2, TrendingUp } from 'lucide-react';");
fs.writeFileSync(indexFile, indexContent, 'utf8');

const reconFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'ReconciliationWorkspace.tsx');
let reconContent = fs.readFileSync(reconFile, 'utf8');
reconContent = reconContent.replace("<span>Account: {l.account_id?.slice(0,8)}...</span>", "<span>Account: {(l.account_id || '').slice(0,8)}...</span>");
fs.writeFileSync(reconFile, reconContent, 'utf8');

const econFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'UnitEconomicsWorkspace.tsx');
let econContent = fs.readFileSync(econFile, 'utf8');
econContent = econContent.replace("Array.isArray(data) && (data as any[]).length > 0", "Array.isArray(data) && data.length > 0");
// if that doesn't work, just replace the whole if statement
econContent = econContent.replace("if (data && (data as any[]).length > 0) {", "if (Array.isArray(data) && data.length > 0) {");
fs.writeFileSync(econFile, econContent, 'utf8');

console.log('Fixed TS errors.');
