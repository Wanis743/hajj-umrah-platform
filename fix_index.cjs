const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'index.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace("export type FinanceMode = 'JOURNAL' | 'LEDGER' | 'MODEL' | 'PLANNING' | 'RECONCILE' | 'CLOSE' | 'REPORTS';", "export type FinanceMode = 'JOURNAL' | 'LEDGER' | 'MODEL' | 'PLANNING' | 'RECONCILE' | 'CLOSE' | 'REPORTS' | 'UNIT_ECON';");

// Make sure TrendingUp is imported
if (!content.includes('TrendingUp')) {
  content = content.replace("Search, Plus, X, Bell, Maximize2 } from 'lucide-react';", "Search, Plus, X, Bell, Maximize2, TrendingUp } from 'lucide-react';");
}

fs.writeFileSync(file, content, 'utf8');
