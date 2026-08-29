/**
 * Dashboard — manifest.
 *
 * The first window of the morning. Everything it shows belongs to another app: the
 * balances are Ledger's, the drafts are Journal's, the queue is Inbox's, the
 * checklist is the close. What this app adds is the one view where they sit side by
 * side, and a way through to whichever one needs a person.
 *
 * Read-only by construction. It declares no `ledger.post`, which means the kernel
 * will refuse it a privileged command even if a future edit here asked for one — an
 * overview that could post would be an overview nobody could safely leave open. Its
 * `shell.launch` is the whole interaction model instead: a tile does not act, it
 * hands the work to the app that owns it, on the view that shows it.
 *
 * `eventlog.read` is for the audit trail, which is what makes the activity feed a
 * record of decisions rather than a list of changed rows. `fs.write` and `clipboard`
 * exist for the two things anybody does with a dashboard at 9am: paste the numbers
 * into a message, or take the CSV to a meeting.
 *
 * No file association. A dashboard is a view of the book, not a document; there is
 * nothing here to open from the desktop.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const dashboardManifest = defineApp({
  id: APP_IDS.dashboard,
  name: text('لوحة المعلومات', 'Tableau de bord', 'Dashboard'),
  description: text(
    'نظرة واحدة على الدفاتر: الأرصدة والحركة وما ينتظر قرارًا',
    'Une seule vue des livres : soldes, activité et ce qui attend une décision',
    'One view of the book: balances, activity, and whatever is waiting on a decision',
  ),
  category: 'analysis',
  icon: 'layout',
  capabilities: ['ledger.read', 'eventlog.read', 'fs.write', 'clipboard', 'shell.launch'],
  defaultSize: { w: 1280, h: 800 },
  minSize: { w: 900, h: 560 },
  pinned: true,
  desktopShortcut: true,
  keywords: [
    'dashboard',
    'overview',
    'summary',
    'kpi',
    'position',
    'balance sheet',
    'performance',
    'margin',
    'activity',
    'close',
    'tableau',
    'bord',
    'aperçu',
    'résumé',
    'situation',
    'marge',
    'activité',
    'clôture',
    'لوحة',
    'معلومات',
    'نظرة',
    'ملخص',
    'المركز',
    'الأداء',
    'الحركة',
    'الإقفال',
  ],
  jumpList: [
    { id: 'page:overview', title: text('نظرة عامة', 'Vue d’ensemble', 'Overview') },
    { id: 'page:position', title: text('المركز المالي', 'Situation', 'Position') },
    { id: 'page:close', title: text('الإقفال', 'Clôture', 'Close') },
  ],
  // Every accelerator listed here is one `hotkey()` in `actions.ts` really binds. A
  // displayed shortcut that does nothing is worse than none, so the two lists move
  // together. `Ctrl+C` is absent on purpose: it belongs to the selected text, and
  // copying the summary is `Ctrl+Shift+C`.
  commands: [
    { id: 'page:overview', title: text('نظرة عامة', 'Vue d’ensemble', 'Overview'), accelerator: 'Ctrl+1' },
    { id: 'page:position', title: text('المركز المالي', 'Situation', 'Position'), accelerator: 'Ctrl+2' },
    { id: 'page:performance', title: text('الأداء', 'Performance', 'Performance'), accelerator: 'Ctrl+3' },
    { id: 'page:activity', title: text('الحركة', 'Activité', 'Activity'), accelerator: 'Ctrl+4' },
    { id: 'page:close', title: text('الإقفال', 'Clôture', 'Close'), accelerator: 'Ctrl+5' },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    {
      id: 'copy',
      title: text('نسخ الملخص', 'Copier le résumé', 'Copy summary'),
      accelerator: 'Ctrl+Shift+C',
    },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
  ],
});
