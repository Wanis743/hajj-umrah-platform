/**
 * Ledger — manifest.
 *
 * The chart of accounts, the trial balance, and the general ledger behind any one
 * account. Journal writes the book; this app defines the vocabulary the book is
 * written in, which is why it carries `ledger.post`: `upsert_chart_account` backs
 * both `account.create` and `account.update`, and both are privileged. The kernel
 * raises its own consent before either runs, so nothing here asks first.
 *
 * No file association. An account is not a document — it is a row other people's
 * postings point at — so the only thing this app writes to disk is a CSV of what
 * is on screen, which is why it takes `fs.write` and not `fs.read`.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const ledgerManifest = defineApp({
  id: APP_IDS.ledger,
  name: text('دليل الحسابات', 'Plan comptable', 'Ledger'),
  description: text(
    'دليل الحسابات وميزان المراجعة ودفتر الأستاذ لكل حساب',
    'Plan comptable, balance générale et grand livre par compte',
    'Chart of accounts, trial balance, and the general ledger behind each account',
  ),
  category: 'accounting',
  icon: 'list-tree',
  capabilities: ['ledger.read', 'ledger.post', 'fs.write', 'clipboard', 'notify'],
  defaultSize: { w: 1180, h: 720 },
  minSize: { w: 780, h: 460 },
  pinned: true,
  keywords: [
    'ledger',
    'chart of accounts',
    'coa',
    'account',
    'accounts',
    'trial balance',
    'general ledger',
    'plan comptable',
    'compte',
    'balance',
    'grand livre',
    'دليل',
    'حساب',
    'حسابات',
    'ميزان',
    'مراجعة',
    'أستاذ',
  ],
  jumpList: [
    { id: 'new', title: text('حساب جديد', 'Nouveau compte', 'New account') },
    { id: 'view:trial', title: text('ميزان المراجعة', 'Balance générale', 'Trial balance') },
  ],
  commands: [
    { id: 'new', title: text('حساب جديد', 'Nouveau compte', 'New account'), accelerator: 'Ctrl+N' },
    { id: 'edit', title: text('تعديل الحساب', 'Modifier le compte', 'Edit account'), accelerator: 'F2' },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
    { id: 'view:chart', title: text('دليل الحسابات', 'Plan comptable', 'Chart of accounts') },
    { id: 'view:trial', title: text('ميزان المراجعة', 'Balance générale', 'Trial balance') },
    { id: 'expand', title: text('توسيع الكل', 'Tout déplier', 'Expand all') },
    { id: 'collapse', title: text('طي الكل', 'Tout replier', 'Collapse all') },
  ],
});
