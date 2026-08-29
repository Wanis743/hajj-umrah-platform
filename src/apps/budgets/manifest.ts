/**
 * Budgets — manifest.
 *
 * A budget is a promise about money that has not been spent yet, and the only
 * interesting question about one is how it is holding up. So this app is not a form for
 * typing numbers into: it is the variance report, and the typing is what you do when the
 * report tells you the plan was wrong.
 *
 * Three registers, and each answers a different question. *Variance* is the report —
 * planned against posted, per account, for the period the budget belongs to. *Plan* is
 * the whole chart of accounts, including the accounts nobody has planned for, because an
 * unplanned account that is spending money is the most expensive thing a budget can
 * miss. *Rollup* is the same numbers by account type, which is the version that goes
 * into the meeting.
 *
 * `budget.upsert` carries `ledger.post`, which is privileged: the kernel raises its own
 * consent every time an amount is set, so nothing here asks first. The dialog this app
 * owns is an amount field, not a confirmation.
 *
 * Actuals are read, never written. A budget line moves; the book does not.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const budgetsManifest = defineApp({
  id: APP_IDS.budgets,
  name: text('الموازنات', 'Budgets', 'Budgets'),
  description: text(
    'الموازنة مقابل المنفَّذ: الفرق لكل حساب، وتحرير الخطة',
    'Le budget face au réalisé : l’écart par compte, et la saisie du plan',
    'Budget against actual: the variance per account, and the plan behind it',
  ),
  category: 'planning',
  icon: 'target',
  capabilities: ['ledger.read', 'ledger.post', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1360, h: 840 },
  minSize: { w: 940, h: 560 },
  keywords: [
    'budget',
    'budgets',
    'plan',
    'planning',
    'forecast',
    'variance',
    'target',
    'overspend',
    'budgétaire',
    'prévision',
    'écart',
    'dépassement',
    'objectif',
    'موازنة',
    'ميزانية',
    'خطة',
    'تقدير',
    'فرق',
    'تجاوز',
  ],
  jumpList: [
    { id: 'view:variance', title: text('الفروق', 'Écarts', 'Variance') },
    { id: 'view:plan', title: text('الخطة', 'Plan', 'Plan') },
    { id: 'view:rollup', title: text('التجميع', 'Synthèse', 'Rollup') },
  ],
  commands: [
    {
      id: 'set',
      title: text('تعيين المبلغ', 'Définir le montant', 'Set the amount'),
      accelerator: 'Ctrl+Enter',
    },
    {
      id: 'seed',
      title: text('أخذ المنفَّذ كخطة', 'Reprendre le réalisé', 'Take the actual as the plan'),
      accelerator: 'Ctrl+Shift+S',
    },
    { id: 'ledger', title: text('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    {
      id: 'export',
      title: text('تصدير المعروض', 'Exporter la vue', 'Export this view'),
      accelerator: 'Ctrl+E',
    },
    { id: 'view:variance', title: text('الفروق', 'Écarts', 'Variance') },
    { id: 'view:plan', title: text('الخطة', 'Plan', 'Plan') },
    { id: 'view:rollup', title: text('التجميع', 'Synthèse', 'Rollup') },
  ],
});
