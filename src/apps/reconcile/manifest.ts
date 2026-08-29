/**
 * Reconciliation — manifest.
 *
 * The one exercise in accounting where two records of the same money are laid
 * beside each other and made to agree: what the bank says happened, and what the
 * ledger says was booked. A statement line with no ledger counterpart is either a
 * missing entry or a bank error, and a posted line with no statement line is money
 * that has not moved yet. This app is where somebody decides which.
 *
 * `ledger.read` covers all four sides of the exercise — the bank accounts, their
 * statements, the statement lines, and the posted journal lines of the mirrored
 * ledger account. `ledger.post` carries `reconcile.match` and `reconcile.unmatch`.
 * Both are privileged, so the kernel raises its own consent; nothing here asks
 * first, and the auto-match sweep is a loop over the same command rather than a
 * quieter path around it.
 *
 * There is no confirmation dialog on a match, because a match is reversible and
 * the server refuses every match worth confirming: amounts must agree within a
 * centime, the entry must be posted, the line must not already be reconciled, and
 * a locked statement cannot be unmatched at all. This app mirrors those rules so
 * it never offers a pairing the server would throw back.
 *
 * No file association — a reconciliation is a state, not a document. What is
 * written to disk is the CSV of what did not match, which is the paper somebody
 * takes to the bank.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const reconcileManifest = defineApp({
  id: APP_IDS.reconcile,
  name: text('المطابقة البنكية', 'Rapprochement', 'Reconciliation'),
  description: text(
    'مطابقة كشوف البنك مع قيود الدفتر سطرًا بسطر',
    'Rapprocher les relevés bancaires avec les écritures du livre, ligne à ligne',
    'Match bank statements against the ledger, line by line',
  ),
  category: 'accounting',
  icon: 'check-circle',
  capabilities: ['ledger.read', 'ledger.post', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1320, h: 800 },
  minSize: { w: 900, h: 540 },
  keywords: [
    'reconcile',
    'reconciliation',
    'bank',
    'statement',
    'match',
    'unmatch',
    'clearing',
    'cash',
    'rapprochement',
    'relevé',
    'banque',
    'lettrage',
    'pointage',
    'مطابقة',
    'تسوية',
    'بنك',
    'كشف',
    'حساب',
  ],
  jumpList: [
    { id: 'view:open', title: text('غير مطابقة', 'Non rapprochées', 'Unmatched') },
    { id: 'view:matched', title: text('مطابقة', 'Rapprochées', 'Matched') },
    { id: 'view:ledger', title: text('قيود غير مطابقة', 'Écritures non rapprochées', 'Ledger, unreconciled') },
  ],
  commands: [
    {
      id: 'match',
      title: text('مطابقة مع المرشّح', 'Rapprocher avec le candidat', 'Match with candidate'),
      accelerator: 'Ctrl+Enter',
    },
    {
      id: 'unmatch',
      title: text('إلغاء المطابقة', 'Annuler le rapprochement', 'Unmatch'),
      accelerator: 'Ctrl+Backspace',
    },
    {
      id: 'auto',
      title: text('مطابقة تلقائية للمؤكد', 'Rapprocher les certitudes', 'Auto-match the certain ones'),
      accelerator: 'Ctrl+Shift+A',
    },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير الفروق CSV', 'Exporter les écarts en CSV', 'Export differences as CSV'), accelerator: 'Ctrl+E' },
    { id: 'view:open', title: text('غير مطابقة', 'Non rapprochées', 'Unmatched') },
    { id: 'view:matched', title: text('مطابقة', 'Rapprochées', 'Matched') },
    { id: 'view:ledger', title: text('قيود غير مطابقة', 'Écritures non rapprochées', 'Ledger, unreconciled') },
  ],
});
