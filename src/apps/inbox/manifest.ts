/**
 * Inbox — manifest.
 *
 * The one place in the suite that answers "what is waiting on me?". Journal writes
 * entries as drafts, the close checklist accumulates steps nobody has signed, and
 * the spine leaves handoffs open on whichever desk was asked; all three sit in
 * somebody's way until a person decides. This app is those three queues, and the
 * archive of decisions already taken.
 *
 * It reads three subsystems over two read capabilities. `ledger.read` covers the
 * entries, their lines, the periods and the checklist — and the handoffs too,
 * because the broker binds `spineInbox` and `spineChain` to it rather than to a
 * capability of their own: what one department is asking another about a book is
 * not a wider secret than the book. `eventlog.read` covers the audit trail, which
 * is where a decision *record* lives — the actor, the moment and the stated reason.
 * Without it the Decided queue could only guess from a changed status, and "who
 * approved this" is the question this app exists to answer.
 *
 * Two write capabilities, because there are two kinds of consequence. `ledger.post`
 * carries `journal.post`, `journal.void` and `closeTask.complete`; all three are
 * privileged, so the kernel raises its own consent and nothing here asks first.
 * `spine.handoff` carries the three handoff acts — accept, complete, decline — and
 * is not privileged: answering a question already addressed to this desk moves
 * nothing in the books, so it prompts for nothing. It is declared apart from
 * `ledger.post` all the same, because settling an entry inside this book and telling
 * another department it will not get what it asked for are not one permission.
 *
 * Neither refusal dialog is a confirmation. `void_journal_entry` refuses without a
 * reason and `decline_spine_handoff_command` refuses without a note, and that note
 * is not bookkeeping: it is the answer the department that asked will read.
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
    'القيود المنتظرة للموافقة وخطوات الإقفال والتحويلات الواردة وسجل القرارات',
    'Écritures en attente d’approbation, étapes de clôture, transmissions reçues et journal des décisions',
    'Entries waiting on approval, close-checklist steps, handoffs from other departments, and the record of what was decided',
  ),
  category: 'productivity',
  icon: 'inbox',
  capabilities: [
    'ledger.read',
    'eventlog.read',
    'ledger.post',
    'spine.handoff',
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
    // Plural, because the ranker treats the keyword as the haystack and what was
    // typed as the needle: `handoffs` answers a search for "handoff" and for
    // "handoffs", while the singular answers only the first. Same for
    // `transmissions` and «تحويلات» below.
    'handoffs',
    'approbations',
    'attente',
    'valider',
    'refuser',
    'clôture',
    'transmissions',
    'موافقات',
    'صندوق',
    'اعتماد',
    'رفض',
    'إقفال',
    'تصديق',
    'تحويلات',
  ],
  jumpList: [
    { id: 'queue:approvals', title: text('في انتظار الموافقة', 'À approuver', 'Waiting on approval') },
    { id: 'queue:checklist', title: text('قائمة الإقفال', 'Liste de clôture', 'Close checklist') },
    { id: 'queue:handoffs', title: text('تحويلات', 'Transmissions', 'Handoffs') },
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
    // The three handoff acts carry no accelerator, and that is a decision rather
    // than an omission. `Ctrl+Enter` already means "the affirmative act" and
    // `Ctrl+Backspace` "the refusal", and the window resolves both against the
    // selected row: on a handoff they become accept-or-complete and decline. A
    // second pair would be four keys for two intentions, and a person moving
    // between queues would have to remember which pair the row under the cursor
    // answers to.
    { id: 'accept', title: text('قبول التحويل', 'Accepter la transmission', 'Accept handoff') },
    { id: 'complete', title: text('إنجاز التحويل', 'Terminer la transmission', 'Complete handoff') },
    { id: 'decline', title: text('رفض التحويل…', 'Refuser la transmission…', 'Decline handoff…') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
    // All four, in the rail's order. The jump list and the palette answer the same
    // question from different places — the taskbar and the keyboard — so a queue
    // reachable from one and not the other is a queue a person finds by accident.
    { id: 'queue:approvals', title: text('في انتظار الموافقة', 'À approuver', 'Waiting on approval') },
    { id: 'queue:checklist', title: text('قائمة الإقفال', 'Liste de clôture', 'Close checklist') },
    { id: 'queue:handoffs', title: text('تحويلات', 'Transmissions', 'Handoffs') },
    { id: 'queue:decided', title: text('القرارات', 'Décisions', 'Decided') },
  ],
});
