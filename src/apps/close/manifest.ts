/**
 * Period close — manifest.
 *
 * The one act in accounting that cannot be undone quietly. Closing a period draws a
 * line under a month: entries dated inside it stop being editable, the numbers stop
 * moving, and everything downstream — statements, budgets, the year's comparatives —
 * starts quoting them as fact. Reopening is possible and is *supposed* to be
 * uncomfortable, which is why the server demands a reason in writing.
 *
 * So this window is not a button. It is the checklist somebody works before pressing
 * the button: which earlier period is still open, what is still sitting in draft
 * inside this one, whether the two control totals agree, which bank statements have
 * not been reconciled, and which of the month's tasks nobody has signed off. The
 * app states all of it and then lets the person decide — the *server* owns the rules,
 * and a client that refuses a close the server would have accepted is a client that
 * lies about who is in charge.
 *
 * `ledger.close` carries `period.close` and `period.reopen`; `ledger.post` carries
 * `closeTask.complete`. It also carries the controls register — a control is a standing
 * promise about how the books are kept, and writing, testing or retiring one is the same
 * privilege as drawing the line under a month. Both are privileged, so the kernel raises
 * its own consent and nothing here asks first.
 *
 * The four dialogs this app owns are all forms and none is a confirmation: two collect a
 * reason the RPC refuses to run without, one collects the code an upsert needs, and one
 * collects the conclusion a recorded test is.
 *
 * `eventlog.read` is for the trail: after a close, the only honest answer to "who
 * closed March and when" is the audit log, not this window's memory of it.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const closeManifest = defineApp({
  id: APP_IDS.close,
  name: text('إقفال الفترة', 'Clôture', 'Period Close'),
  description: text(
    'قائمة تحقّق الإقفال الشهري: العوائق والمهام والرقابات وإقفال الفترة',
    'La checklist de clôture mensuelle : obstacles, tâches, contrôles internes et clôture de la période',
    'The month-end checklist: blockers, tasks, controls, and closing the period',
  ),
  category: 'accounting',
  icon: 'calendar',
  capabilities: [
    'ledger.read',
    'ledger.post',
    'ledger.close',
    'eventlog.read',
    'fs.write',
    'clipboard',
    'notify',
    'shell.launch',
  ],
  defaultSize: { w: 1340, h: 820 },
  minSize: { w: 920, h: 560 },
  keywords: [
    'close',
    'closing',
    'period',
    'month-end',
    'checklist',
    'certify',
    'lock',
    'reopen',
    'cutoff',
    'control',
    'controls',
    'internal control',
    'test',
    'retire',
    'clôture',
    'période',
    'exercice',
    'checklist',
    'certifier',
    'verrouiller',
    'réouvrir',
    'contrôle',
    'contrôles internes',
    'tester',
    'retirer',
    'إقفال',
    'فترة',
    'شهر',
    'مهام',
    'تصديق',
    'إعادة فتح',
    'رقابة',
    'رقابات',
    'اختبار',
    'إيقاف',
  ],
  jumpList: [
    { id: 'view:checks', title: text('العوائق', 'Obstacles', 'Blockers') },
    { id: 'view:tasks', title: text('المهام', 'Tâches', 'Tasks') },
    { id: 'view:controls', title: text('الرقابات', 'Contrôles internes', 'Controls') },
    { id: 'view:trail', title: text('السجل', 'Journal des actions', 'Audit trail') },
  ],
  commands: [
    {
      id: 'close',
      title: text('إقفال الفترة', 'Clôturer la période', 'Close the period'),
      accelerator: 'Ctrl+Shift+L',
    },
    {
      id: 'reopen',
      title: text('إعادة فتح الفترة', 'Réouvrir la période', 'Reopen the period'),
      accelerator: 'Ctrl+Shift+O',
    },
    {
      id: 'certify',
      title: text('تصديق المهمة', 'Certifier la tâche', 'Certify the task'),
      accelerator: 'Ctrl+Enter',
    },
    // Only the test carries a stroke, because `hotkey` in `actions.ts` implements only that
    // one. A manifest that advertises an accelerator the keyboard does not honour is a
    // command palette that lies, and the palette is where people learn the strokes.
    {
      id: 'control:test',
      title: text('تسجيل اختبار', 'Enregistrer un test', 'Record a test'),
      accelerator: 'Ctrl+Shift+T',
    },
    { id: 'control:new', title: text('رقابة جديدة', 'Nouveau contrôle', 'New control') },
    { id: 'control:edit', title: text('تعديل الرقابة', 'Modifier le contrôle', 'Edit the control') },
    {
      id: 'control:retire',
      title: text('إيقاف الرقابة', 'Retirer le contrôle', 'Retire the control'),
    },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    {
      id: 'export',
      title: text('تصدير قائمة التحقّق', 'Exporter la checklist', 'Export the checklist'),
      accelerator: 'Ctrl+E',
    },
    { id: 'view:checks', title: text('العوائق', 'Obstacles', 'Blockers') },
    { id: 'view:tasks', title: text('المهام', 'Tâches', 'Tasks') },
    { id: 'view:controls', title: text('الرقابات', 'Contrôles internes', 'Controls') },
    { id: 'view:trail', title: text('السجل', 'Journal des actions', 'Audit trail') },
  ],
});
