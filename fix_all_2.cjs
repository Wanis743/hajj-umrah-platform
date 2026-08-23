const fs = require('fs');
const path = require('path');

const reconFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'ReconciliationWorkspace.tsx');
let reconContent = fs.readFileSync(reconFile, 'utf8');
// Fix all instances of l.account_id?.slice
reconContent = reconContent.replace(/\{l\.account_id\?\.slice\(0,8\)\}/g, "{(l.account_id || '').slice(0,8)}");
reconContent = reconContent.replace(/\{l\.account_id\?\.slice\(0,\s*8\)\}/g, "{(l.account_id || '').slice(0,8)}");
fs.writeFileSync(reconFile, reconContent, 'utf8');

const econFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'UnitEconomicsWorkspace.tsx');
let econContent = fs.readFileSync(econFile, 'utf8');
econContent = econContent.replace(/if\s*\(data\s*&&\s*\(data\s*as\s*any\[\]\)\.length\s*>\s*0\)/g, "if (Array.isArray(data) && data.length > 0)");
econContent = econContent.replace(/if\s*\(Array\.isArray\(data\)\s*&&\s*\(data\s*as\s*any\[\]\)\.length\s*>\s*0\)/g, "if (Array.isArray(data) && data.length > 0)");
econContent = econContent.replace(/Array\.isArray\(data\)\s*&&\s*data\.length\s*>\s*0/g, "Array.isArray(data) && data.length > 0"); // already there?
// Let's just fix line 65
const lines = econContent.split('\\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('data.length > 0') && !lines[i].includes('Array.isArray(data)')) {
    lines[i] = lines[i].replace('data.length > 0', 'Array.isArray(data) && data.length > 0');
  }
  if (lines[i].includes('(data as any[]).length > 0')) {
    lines[i] = lines[i].replace('(data as any[]).length > 0', '(Array.isArray(data) && data.length > 0)');
  }
}
fs.writeFileSync(econFile, lines.join('\\n'), 'utf8');

const gccFile = path.join(process.cwd(), 'src', 'components', 'admin', 'OperationsOS', 'GroupControlCenter.tsx');
let gccContent = fs.readFileSync(gccFile, 'utf8');
// Remove react-i18next import since it might not be installed or we don't need it.
gccContent = gccContent.replace("import { useTranslation } from 'react-i18next';", "");
gccContent = gccContent.replace("const { t } = useTranslation();", "");

// Cast data
gccContent = gccContent.replace("setGroups(data);", "setGroups(data as OpsGroup[]);");
gccContent = gccContent.replace("setSelectedGroup(data[0]);", "setSelectedGroup(data[0] as OpsGroup);");

fs.writeFileSync(gccFile, gccContent, 'utf8');

console.log('Fixed more ts errors.');
