/**
 * Treasury — the manifest.
 *
 * The cash window, and the only app in the finance suite whose subject is not the
 * book but the money itself: what is in the bank this morning, what leaves it
 * before the month is out, and what is owed to the agency and has not arrived.
 *
 * `ledger.read` and nothing that writes. Treasury does not post — a payment is
 * recorded by whoever took it and a bill by whoever received it. What this window
 * adds is the arithmetic nobody otherwise keeps in one place: the bank's balance
 * beside the ledger's, and both beside what falls due.
 *
 * Three lenses, because cash asks three questions and they do not share a row
 * shape. A bank account, a supplier bill and an unsettled invoice are counted
 * differently and are wrong in different ways, so each lens states which of its
 * figures the projections can actually support. A partly paid invoice is the
 * standing example: what has been paid against it is not exposed to an app, so it
 * is counted whole and the window says so rather than quietly netting it down.
 *
 * `shell.launch` has two uses, both hand-offs a treasurer asks for out loud —
 * "which postings make up the book balance" belongs to the general ledger, and
 * "why do the two balances disagree" belongs to reconciliation.
 */
import { APP_IDS } from '@/platform/sdk';
import { defineApp, text } from '../shared/manifest';

export const treasuryManifest = defineApp({
  id: APP_IDS.treasury,
  name: text('الخزينة', 'Trésorerie', 'Treasury'),
  description: text(
    'أرصدة البنوك مقابل الدفتر، والمستحقّات الخارجة والداخلة خلال أفق محدَّد، بعملة واحدة',
    'Soldes bancaires face au grand livre, échéances à payer et à encaisser sur un horizon, en une seule monnaie',
    'Bank balances against the book, and what falls due out and in over a horizon, stated in one currency',
  ),
  category: 'treasury',
  icon: 'wallet',
  capabilities: ['ledger.read', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1400, h: 900 },
  minSize: { w: 1000, h: 640 },
  keywords: [
    'treasury',
    'cash',
    'bank',
    'balance',
    'liquidity',
    'payable',
    'receivable',
    'due',
    'overdue',
    'runway',
    'forecast',
    'trésorerie',
    'banque',
    'solde',
    'liquidité',
    'échéance',
    'fournisseur',
    'encaissement',
    'décaissement',
    'الخزينة',
    'النقدية',
    'البنك',
    'الرصيد',
    'السيولة',
    'استحقاق',
    'متأخّر',
    'تحصيل',
    'مدفوعات',
  ],
  jumpList: [
    { id: 'lens:cash', title: text('النقدية', 'Trésorerie', 'Cash') },
    { id: 'lens:payable', title: text('المستحقّ للدفع', 'À payer', 'Payable') },
    { id: 'lens:receivable', title: text('المستحقّ للتحصيل', 'À encaisser', 'Receivable') },
  ],
  commands: [
    { id: 'lens:cash', title: text('النقدية', 'Trésorerie', 'Cash'), accelerator: 'Ctrl+1' },
    { id: 'lens:payable', title: text('المستحقّ للدفع', 'À payer', 'Payable'), accelerator: 'Ctrl+2' },
    {
      id: 'lens:receivable',
      title: text('المستحقّ للتحصيل', 'À encaisser', 'Receivable'),
      accelerator: 'Ctrl+3',
    },
    { id: 'sort:amount', title: text('ترتيب بالمبلغ', 'Trier par montant', 'Sort by amount') },
    { id: 'sort:due', title: text('ترتيب بالاستحقاق', 'Trier par échéance', 'Sort by due date') },
    { id: 'sort:name', title: text('ترتيب بالاسم', 'Trier par nom', 'Sort by name') },
    {
      id: 'ledger',
      title: text('فتح الحساب في الدفتر', 'Ouvrir le compte dans le grand livre', 'Open the account in the ledger'),
    },
    {
      id: 'reconcile',
      title: text('فتح المطابقة', 'Ouvrir le rapprochement', 'Open reconciliation'),
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
