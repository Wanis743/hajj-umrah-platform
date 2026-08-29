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
 * `closeTask.complete`. Both are privileged, so the kernel raises its own consent and
 * nothing here asks first. The one dialog this app owns is the reopen reason, which
 * is not a confirmation — it is a required field the RPC refuses to run without.
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
    'قائمة تحقّق الإقفال الشهري: العوائق والمهام وإقفال الفترة',
    'La checklist de clôture mensuelle : obstacles, tâches et clôture de la période',
    'The month-end checklist: blockers, tasks, and closing the period',
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
    'clôture',
    'période',
    'exercice',
    'checklist',
    'certifier',
    'verrouiller',
    'réouvrir',
    'إقفال',
    'فترة',
    'شهر',
    'مهام',
    'تصديق',
    'إعادة فتح',
  ],
  jumpList: [
    { id: 'view:checks', title: text('العوائق', 'Obstacles', 'Blockers') },
    { id: 'view:tasks', title: text('المهام', 'Tâches', 'Tasks') },
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
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    {
      id: 'export',
      title: text('تصدير قائمة التحقّق', 'Exporter la checklist', 'Export the checklist'),
      accelerator: 'Ctrl+E',
    },
    { id: 'view:checks', title: text('العوائق', 'Obstacles', 'Blockers') },
    { id: 'view:tasks', title: text('المهام', 'Tâches', 'Tasks') },
    { id: 'view:trail', title: text('السجل', 'Journal des actions', 'Audit trail') },
  ],
});
