const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'index.tsx');
let content = fs.readFileSync(file, 'utf8');

// Add import
content = content.replace("import { ReportsWorkspace } from './ReportsWorkspace';", "import { ReportsWorkspace } from './ReportsWorkspace';\nimport { UnitEconomicsWorkspace } from './UnitEconomicsWorkspace';");

// Add to WorkspaceMode
content = content.replace("type WorkspaceMode = 'JOURNAL' | 'LEDGER' | 'MODEL' | 'PLANNING' | 'RECONCILE' | 'CLOSE' | 'REPORTS';", "type WorkspaceMode = 'JOURNAL' | 'LEDGER' | 'MODEL' | 'PLANNING' | 'RECONCILE' | 'CLOSE' | 'REPORTS' | 'UNIT_ECON';");

// Add icon import
content = content.replace("Search, Plus, X, Bell, Maximize2 } from 'lucide-react';", "Search, Plus, X, Bell, Maximize2, TrendingUp } from 'lucide-react';");

// Add to availableApps
content = content.replace("{ mode: 'REPORTS', label: 'Reports', icon: <PieChart className=\"w-5 h-5 text-cyan-400\" />, desc: 'Generate standard financial statements.' },", "{ mode: 'REPORTS', label: 'Reports', icon: <PieChart className=\"w-5 h-5 text-cyan-400\" />, desc: 'Generate standard financial statements.' },\n    { mode: 'UNIT_ECON', label: 'Unit Economics', icon: <TrendingUp className=\"w-5 h-5 text-emerald-400\" />, desc: 'Track profitability per operational group.' },");

// Add to render
content = content.replace("{tab.mode === 'REPORTS' && <ReportsWorkspace />}", "{tab.mode === 'REPORTS' && <ReportsWorkspace />}\n                    {tab.mode === 'UNIT_ECON' && <UnitEconomicsWorkspace />}");

fs.writeFileSync(file, content, 'utf8');
console.log('Updated index.tsx');
