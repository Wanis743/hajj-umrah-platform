/**
 * Journal — manifest.
 *
 * The book of original entry, so this is the app that carries `ledger.post`. It
 * is a privileged capability: the kernel raises its own consent prompt before a
 * posting RPC runs, which is why nothing in this app asks "are you sure?" first.
 * Two dialogs for one decision teaches people to click through both.
 *
 * `.fxjournal` is a *draft* — an unposted entry saved to a file so a batch can be
 * prepared away from the books, reviewed, and posted later (or from another
 * machine). That is what `fs.read`/`fs.write` are for, together with the CSV
 * export; the association makes double-clicking one in Explorer open it here.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const journalManifest = defineApp({
  id: APP_IDS.journal,
  name: text('دفتر اليومية', 'Journal', 'Journal'),
  description: text(
    'تسجيل قيود اليومية ومراجعتها وترحيلها وإلغاؤها مع مراقبة التوازن',
    'Saisir, réviser, comptabiliser et annuler les écritures avec contrôle d’équilibre',
    'Record, review, post and void double-entry journals with live balance checks',
  ),
  category: 'accounting',
  icon: 'book-open',
  capabilities: ['ledger.read', 'ledger.post', 'fs.read', 'fs.write', 'clipboard', 'notify'],
  defaultSize: { w: 1200, h: 740 },
  minSize: { w: 760, h: 470 },
  pinned: true,
  desktopShortcut: true,
  keywords: [
    'journal',
    'entry',
    'entries',
    'posting',
    'double entry',
    'debit',
    'credit',
    'écriture',
    'comptabilisation',
    'débit',
    'crédit',
    'يومية',
    'قيد',
    'قيود',
    'ترحيل',
    'مدين',
    'دائن',
  ],
  fileAssociations: [{ contentType: 'application/vnd.financeos.journal', extensions: ['.fxjournal'] }],
  jumpList: [
    { id: 'new', title: text('قيد جديد', 'Nouvelle écriture', 'New entry') },
    { id: 'view:draft', title: text('المسودات', 'Brouillons', 'Drafts') },
    { id: 'view:pending', title: text('قيد الموافقة', 'En attente', 'Pending approval') },
  ],
  commands: [
    { id: 'new', title: text('قيد جديد', 'Nouvelle écriture', 'New entry'), accelerator: 'Ctrl+N' },
    { id: 'open', title: text('فتح مسودة…', 'Ouvrir un brouillon…', 'Open draft…'), accelerator: 'Ctrl+O' },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
    { id: 'view:draft', title: text('المسودات', 'Brouillons', 'Drafts') },
    { id: 'view:pending', title: text('قيد الموافقة', 'En attente', 'Pending approval') },
    { id: 'view:posted', title: text('المرحّلة', 'Comptabilisées', 'Posted') },
  ],
});
