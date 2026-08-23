const fs = require('fs');
const path = require('path');

const typesFile = path.join(process.cwd(), 'src', 'components', 'admin', 'adminDashboardTypes.ts');
let typesContent = fs.readFileSync(typesFile, 'utf8');
if (!typesContent.includes('operations_os')) {
  typesContent = typesContent.replace("'finance_os'", "'finance_os' | 'operations_os'");
  fs.writeFileSync(typesFile, typesContent, 'utf8');
}

const indexFile = path.join(process.cwd(), 'src', 'components', 'admin', 'AdminDashboard', 'index.tsx');
let indexContent = fs.readFileSync(indexFile, 'utf8');
if (!indexContent.includes('operations_os')) {
  // Add lazy import
  indexContent = indexContent.replace(
    "const LazyFinanceOS = lazy(() => import('@/components/admin/FinanceOS'));",
    "const LazyFinanceOS = lazy(() => import('@/components/admin/FinanceOS'));\nconst LazyOperationsOS = lazy(() => import('@/components/admin/OperationsOS').then(m => ({ default: m.OperationsOS })));"
  );
  
  // Add to navSections under operations
  indexContent = indexContent.replace(
    "{ id: 'groups', ar: 'O U,U.O_U.U^O1O O', fr: 'Groupes', en: 'Groups', icon: Users, badge: count(groups.length), descAr: 'O OU,O_ O U,OU?U^O O_U.O O', descFr: 'Gestion des cohortes', descEn: 'Cohort management' },",
    "{ id: 'operations_os', ar: 'O U,O1U.U,USO O', fr: 'OpAcrations OS', en: 'Operations OS', icon: Target, descAr: 'O U,OOOU. O U,U,U^O_O3OUS', descFr: 'Mission control logistique', descEn: 'Mission control logistics' },\n          { id: 'groups', ar: 'O U,U.O_U.U^O1O O', fr: 'Groupes', en: 'Groups', icon: Users, badge: count(groups.length), descAr: 'O OU,O_ O U,OU?U^O O_U.O O', descFr: 'Gestion des cohortes', descEn: 'Cohort management' },"
  );

  // Add launcher button
  indexContent = indexContent.replace(
    "<h2 className=\"text-2xl font-semibold text-sand-900 dark:text-sand-50\">Operations Dashboard</h2>",
    "<h2 className=\"text-2xl font-semibold text-sand-900 dark:text-sand-50\">Operations OS</h2>"
  );
  indexContent = indexContent.replace(
    "onClick={() => goTab('group_ops')}",
    "onClick={() => goTab('operations_os')}"
  );

  // Add root render block
  indexContent = indexContent.replace(
    "if (activeTab === 'finance_os') {",
    "if (activeTab === 'operations_os') {\n      return (\n        <Suspense fallback={<div className=\"p-8 text-center\">Loading Operations OS...</div>}>\n          <LazyOperationsOS onBack={() => setActiveTab('command_center')} />\n        </Suspense>\n      );\n    }\n\n    if (activeTab === 'finance_os') {"
  );

  fs.writeFileSync(indexFile, indexContent, 'utf8');
}
