/**
 * Statements — the manifest.
 *
 * The window that reads the book and says nothing back to it: `ledger.read` and
 * no `ledger.post`, so a report can never be the thing that changed a number.
 * Every figure here is somebody else's posting, restated.
 *
 * `.fxreport` is the one document this app owns, and it holds a *question*, not
 * an answer — which statement, on which basis, over which period, compared
 * against what. Saving the numbers would be saving a screenshot that can go
 * stale without looking stale; saving the question means opening the file next
 * quarter re-runs it against the book as it stands. That is what `fs.read` and
 * `fs.write` are for, alongside the CSV export.
 *
 * `shell.launch` has exactly one use: every line of every statement is an
 * account, and "which postings made this number" is the general ledger's
 * question, not this window's.
 */
import { APP_IDS } from '@/platform/sdk';
import { defineApp, text } from '../shared/manifest';

export const statementsManifest = defineApp({
  id: APP_IDS.statements,
  name: text('القوائم المالية', 'États financiers', 'Statements'),
  description: text(
    'حساب النتيجة والميزانية وميزان المراجعة من القيود المرحَّلة، مع مقارنة بالفترة السابقة وفحص التوازن',
    'Compte de résultat, bilan et balance générale à partir du réalisé, avec comparaison à la période précédente et contrôle d’équilibre',
    'Income statement, balance sheet and trial balance from posted entries, with a prior-period comparison and a balance check',
  ),
  category: 'accounting',
  icon: 'library',
  capabilities: ['ledger.read', 'fs.read', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1320, h: 860 },
  minSize: { w: 960, h: 600 },
  desktopShortcut: true,
  keywords: [
    'statements',
    'statement',
    'income statement',
    'profit and loss',
    'p&l',
    'balance sheet',
    'trial balance',
    'report',
    'reporting',
    'result',
    'equity',
    'états financiers',
    'compte de résultat',
    'bilan',
    'balance générale',
    'rapport',
    'résultat',
    'قوائم',
    'حساب النتيجة',
    'الميزانية',
    'ميزان المراجعة',
    'تقرير',
    'النتيجة',
  ],
  fileAssociations: [{ contentType: 'application/vnd.financeos.report', extensions: ['.fxreport'] }],
  jumpList: [
    { id: 'view:income', title: text('حساب النتيجة', 'Compte de résultat', 'Income statement') },
    { id: 'view:balance', title: text('الميزانية', 'Bilan', 'Balance sheet') },
    { id: 'view:trial', title: text('ميزان المراجعة', 'Balance générale', 'Trial balance') },
  ],
  commands: [
    { id: 'view:income', title: text('حساب النتيجة', 'Compte de résultat', 'Income statement'), accelerator: 'Ctrl+1' },
    { id: 'view:balance', title: text('الميزانية', 'Bilan', 'Balance sheet'), accelerator: 'Ctrl+2' },
    { id: 'view:trial', title: text('ميزان المراجعة', 'Balance générale', 'Trial balance'), accelerator: 'Ctrl+3' },
    { id: 'compare', title: text('مقارنة بالفترة السابقة', 'Comparer à la période précédente', 'Compare with the prior period') },
    { id: 'ledger', title: text('فتح الحساب في الدفتر', 'Ouvrir le compte dans le grand livre', 'Open the account in the ledger') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export CSV'), accelerator: 'Ctrl+E' },
    { id: 'copy', title: text('نسخ الملخّص', 'Copier le résumé', 'Copy summary'), accelerator: 'Ctrl+Shift+C' },
    { id: 'save', title: text('حفظ التقرير…', 'Enregistrer le rapport…', 'Save the report…'), accelerator: 'Ctrl+S' },
    { id: 'open', title: text('فتح تقرير…', 'Ouvrir un rapport…', 'Open a report…'), accelerator: 'Ctrl+O' },
  ],
});
