/**
 * Profitability — the manifest.
 *
 * The window that asks the book a question it does not volunteer: not what the
 * agency earned, which the income statement already says, but where the earning
 * came from. `ledger.read` and no `ledger.post`, because an analysis that could
 * change a number is not an analysis.
 *
 * What it can honestly slice by is decided by the projections, not by ambition.
 * Money carries exactly two analytical tags into this app — `package_id` and
 * `branch_id`, both on the posting and on its entry — so those are the two
 * dimensions, and per-departure margin is not offered at all rather than
 * offered wrong. The window says as much in words on the way past.
 *
 * `shell.launch` has one use, the same one every reporting window has: the
 * question after "which package lost money" is "on which postings", and that
 * belongs to the general ledger.
 */
import { APP_IDS } from '@/platform/sdk';
import { defineApp, text } from '../shared/manifest';

export const profitabilityManifest = defineApp({
  id: APP_IDS.profitability,
  name: text('الربحية', 'Rentabilité', 'Profitability'),
  description: text(
    'الإيرادات والتكاليف والهامش لكل باقة أو فرع، من القيود المرحَّلة، مع نسبة ما تعذّر تخصيصه',
    'Produits, charges et marge par forfait ou succursale, à partir du réalisé, avec la part non affectée',
    'Revenue, cost and margin per package or branch from posted entries, with the share nothing was allocated to',
  ),
  category: 'analysis',
  icon: 'chart-pie',
  capabilities: ['ledger.read', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1360, h: 880 },
  minSize: { w: 980, h: 620 },
  keywords: [
    'profitability',
    'profit',
    'margin',
    'contribution',
    'package',
    'branch',
    'analysis',
    'cost',
    'revenue',
    'allocation',
    'rentabilité',
    'marge',
    'contribution',
    'forfait',
    'succursale',
    'analyse',
    'charges',
    'produits',
    'الربحية',
    'الهامش',
    'المساهمة',
    'باقة',
    'فرع',
    'تحليل',
    'التكاليف',
    'الإيرادات',
  ],
  jumpList: [
    { id: 'dimension:package', title: text('حسب الباقة', 'Par forfait', 'By package') },
    { id: 'dimension:branch', title: text('حسب الفرع', 'Par succursale', 'By branch') },
  ],
  commands: [
    {
      id: 'dimension:package',
      title: text('حسب الباقة', 'Par forfait', 'By package'),
      accelerator: 'Ctrl+1',
    },
    {
      id: 'dimension:branch',
      title: text('حسب الفرع', 'Par succursale', 'By branch'),
      accelerator: 'Ctrl+2',
    },
    {
      id: 'sort:margin',
      title: text('ترتيب بالهامش', 'Trier par marge', 'Sort by margin'),
    },
    {
      id: 'sort:revenue',
      title: text('ترتيب بالإيراد', 'Trier par produits', 'Sort by revenue'),
    },
    {
      id: 'compare',
      title: text('مقارنة بالفترة السابقة', 'Comparer à la période précédente', 'Compare with the prior period'),
    },
    {
      id: 'ledger',
      title: text('فتح الحساب في الدفتر', 'Ouvrir le compte dans le grand livre', 'Open the account in the ledger'),
    },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export CSV'), accelerator: 'Ctrl+E' },
    {
      id: 'copy',
      title: text('نسخ الملخّص', 'Copier le résumé', 'Copy summary'),
      accelerator: 'Ctrl+Shift+C',
    },
    { id: 'copyRow', title: text('نسخ السطر', 'Copier la ligne', 'Copy the row') },
  ],
});
