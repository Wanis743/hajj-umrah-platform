const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'index.tsx');
let content = fs.readFileSync(file, 'utf8');
if (!content.includes('TrendingUp')) {
  // Let's just add it at the top manually if it's missing from lucide-react
  content = "import { TrendingUp } from 'lucide-react';\n" + content;
} else if (content.match(/import \{[^}]*TrendingUp[^}]*\} from 'lucide-react';/) === null) {
  content = "import { TrendingUp } from 'lucide-react';\n" + content;
}

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed TrendingUp import');
