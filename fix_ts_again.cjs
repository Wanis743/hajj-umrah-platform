const fs = require('fs');
const path = require('path');

const indexFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'index.tsx');
let indexContent = fs.readFileSync(indexFile, 'utf8');
if (!indexContent.includes('TrendingUp,')) {
  indexContent = indexContent.replace("Search, Plus, X, Bell, Maximize2 } from 'lucide-react';", "Search, Plus, X, Bell, Maximize2, TrendingUp } from 'lucide-react';");
  fs.writeFileSync(indexFile, indexContent, 'utf8');
}

const econFile = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'UnitEconomicsWorkspace.tsx');
let econContent = fs.readFileSync(econFile, 'utf8');
econContent = econContent.replace("p_group_id: selectedGroup.id", "p_group_id: selectedGroup?.id || ''");
econContent = econContent.replace("(data as any[]).length > 0", "Array.isArray(data) && (data as any[]).length > 0");
// Fix animate calls
econContent = econContent.replace("animate({\n        targets: chartRef.current,", "animate(chartRef.current, {");
econContent = econContent.replace("animate({\n        targets: obj,", "animate(obj, {");
fs.writeFileSync(econFile, econContent, 'utf8');
