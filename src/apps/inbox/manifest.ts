/**
 * Inbox — manifest.
 *
 * The one place in the suite that answers "what is waiting on me?". Journal writes
 * entries as drafts and the close checklist accumulates steps nobody has signed;
 * both sit in somebody's way until a person decides. This app is that queue, and
 * the archive of decisions already taken.
 *
 * It reads two subsystems, so it declares two read capabilities. `ledger.read`
 * covers the entries, their lines, the periods and the checklist. `eventlog.read`
 * covers the audit trail, which is where a decision *record* lives — the actor, the
 * moment and the stated reason. Without it the Decided queue could only guess from
 * a changed status, and "who approved this" is the question this app exists to
 * answer.
 *
 * `ledger.post` carries three commands: `journal.post`, `journal.void` and
 * `closeTask.complete`. All three are privileged, so the kernel raises its own
 * consent and nothing here asks first. The reject dialog is not a confirmation —
 * `void_journal_entry` requires a reason and refuses without one.
 *
 * No file association. An approval is not a document; it is a decision about
 * somebody else's document, so the only thing written to disk is a CSV of the queue
 * for the meeting where it gets discussed.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const inboxManifest = defineApp({
  id: APP_IDS.inbox,
  name: text('صندوق الموافقات', 'Approbations', 'Inbox'),
  description: text(
    'القيود المنتظرة للموافقة وخطوات الإقفال وسجل القرارات',
    'Écritures en attente d’approbation, étapes de clôture et journal des décisions',
    'Entries waiting on approval, close-checklist steps, and the record of what was decided',
  ),
  category: 'productivity',
  icon: 'inbox',
  capabilities: [
    'ledger.read',
    'eventlog.read',
    'ledger.post',
    'fs.write',
    'clipboard',
    'notify',
    'shell.launch',
  ],
  defaultSize: { w: 1240, h: 760 },
  minSize: { w: 840, h: 500 },
  pinned: true,
  keywords: [
    'inbox',
    'approvals',
    'approve',
    'reject',
    'pending',
    'queue',
    'close',
    'checklist',
    'certify',
    'audit',
    'approbations',
    'attente',
    'valider',
    'refuser',
    'clôture',
    'موافقات',
    'صندوق',
    'اعتماد',
    'رفض',
    'إقفال',
    'تصديق',
  ],
  jumpList: [
    { id: 'queue:approvals', title: text('في انتظار الموافقة', 'À approuver', 'Waiting on approval') },
    { id: 'queue:checklist', title: text('قائمة الإقفال', 'Liste de clôture', 'Close checklist') },
    { id: 'queue:decided', title: text('القرارات', 'Décisions', 'Decided') },
  ],
  commands: [
    {
      id: 'approve',
      title: text('اعتماد القيد', 'Approuver l’écriture', 'Approve entry'),
      accelerator: 'Ctrl+Enter',
    },
    {
      id: 'reject',
      title: text('رفض القيد…', 'Refuser l’écriture…', 'Reject entry…'),
      accelerator: 'Ctrl+Backspace',
    },
    {
      id: 'certify',
      title: text('تصديق الخطوة', 'Certifier l’étape', 'Certify step'),
      accelerator: 'Ctrl+Shift+C',
    },
    { id: 'sweep', title: text('اعتماد كل الجاهز', 'Approuver tout ce qui est prêt', 'Approve everything ready') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
    { id: 'queue:approvals', title: text('في انتظار الموافقة', 'À approuver', 'Waiting on approval') },
    { id: 'queue:checklist', title: text('قائمة الإقفال', 'Liste de clôture', 'Close checklist') },
    { id: 'queue:decided', title: text('القرارات', 'Décisions', 'Decided') },
  ],
});
