const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'components', 'admin', 'FinanceOS', 'UnitEconomicsWorkspace.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace("import anime from 'animejs';", "import { animate } from 'animejs';");
content = content.replace(/anime\(\{/g, "animate({");
content = content.replace("import { useTranslation } from 'react-i18next';", "");
content = content.replace("const { t } = useTranslation();", "");

// Type casting for data
content = content.replace("const mapped = data.map(d => ({", "const mapped = data.map((d: any) => ({");
content = content.replace("if (data && data.length > 0)", "if (data && (data as any[]).length > 0)");
content = content.replace("setEconomics(data[0]);", "setEconomics((data as any)[0]);");
content = content.replace("id: d.id,", "id: d.id || '',");
content = content.replace("name: d.name,", "name: d.name || '',");
content = content.replace("status: d.status,", "status: d.status || '',");
content = content.replace("capacity: d.max_capacity,", "capacity: d.max_capacity || 0,");
content = content.replace("readiness_score: d.readiness_score", "readiness_score: d.readiness_score || 0");

fs.writeFileSync(file, content, 'utf8');
