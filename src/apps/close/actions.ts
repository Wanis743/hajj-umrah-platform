/**
 * Period close — the acts.
 *
 * Six commands and none of them are cheap. `period.close`, `period.reopen` and all
 * three `controls.*` commands carry `ledger.close`; `closeTask.complete` carries
 * `ledger.post`. Every one is privileged, so the kernel raises its own consent and
 * nothing here asks first. The reopen dialog is not a confirmation:
 * `reopen_fiscal_period` refuses to run without a reason, and a required field is the
 * app's business. The retire dialog is there for the same reason, and for no other.
 *
 * A close is announced rather than toasted. Everybody else's numbers just became
 * final, and a notification is what survives the window being behind something else;
 * a toast on the closer's screen is not news to the person who reads the statements.
 *
 * A failed control test is announced too. It is the one act here that produces a
 * finding somebody else has to answer, and the register is not a window people keep
 * open.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type AppId, APP_IDS, CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import type { CloseTask, FiscalPeriod } from '../shared/ledger';
import { REPORTS } from '../shared/paths';
import type { CheckId } from './checks';
import type { ControlFrequency, ControlResult } from './controls';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * The two irreversible acts carry Shift, which is the only convention this OS has for
 * "not by accident": `Ctrl+Shift+L` locks the month, `Ctrl+Shift+O` opens it again.
 * `Ctrl+Shift+T` records a control test, which is signing an assurance and belongs on
 * the same side of that line.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) {
    const combo = event.key.toLowerCase();
    if (combo === 'l') return 'close';
    if (combo === 'o') return 'reopen';
    if (combo === 't') return 'control:test';
    return null;
  }
  if (event.key === 'Enter') return 'certify';
  const key = event.key.toLowerCase();
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one button spins rather than all of them. */
export type CloseBusy = 'close' | 'reopen' | 'certify' | 'export' | 'control' | 'test' | 'retire' | null;

/**
 * Which app answers each finding.
 *
 * `earlier` and `tasks` are answered in this window — one by selecting the period
 * that is holding things up, the other by working the checklist — so they name no app
 * and the shell handles them.
 */
export const CHECK_APP: Readonly<Record<CheckId, AppId | null>> = {
  earlier: null,
  unposted: APP_IDS.journal,
  orphans: APP_IDS.journal,
  balance: APP_IDS.ledger,
  book: APP_IDS.ledger,
  statements: APP_IDS.reconcile,
  tasks: null,
};

/**
 * What `controls.upsert` writes — all of it, every time.
 *
 * The command is a PUT: it sets all four columns from what arrives, so a caller that
 * omitted `description` would blank it. `controlId` is `null` for a control that does
 * not exist yet, and the broker's `asString` turns both that and an empty `ownerRole`
 * into SQL NULL, which is why nothing here is conditional.
 */
export interface ControlInput {
  readonly controlId: string | null;
  readonly code: string;
  readonly description: string;
  readonly ownerRole: string;
  readonly frequency: ControlFrequency;
}

/** One recorded test. `code` is for the notification, not for the command. */
export interface TestInput {
  readonly controlId: string;
  readonly code: string;
  readonly result: ControlResult;
  readonly population: string;
  readonly exceptions: string;
  readonly note: string;
}

export interface CloseActions {
  readonly busy: CloseBusy;
  closePeriod: (period: FiscalPeriod) => Promise<boolean>;
  reopenPeriod: (period: FiscalPeriod, reason: string) => Promise<boolean>;
  /** `status` is the table's own spelling: `certified`, `in_progress`, `blocked`. */
  setTaskStatus: (task: CloseTask, status: string) => Promise<boolean>;
  saveControl: (input: ControlInput) => Promise<boolean>;
  recordTest: (input: TestInput) => Promise<boolean>;
  retireControl: (controlId: string, reason: string) => Promise<boolean>;
  copy: (text: string) => void;
  exportCsv: (content: string, suggestedName: string) => void;
  open: (app: AppId) => void;
}

/** The register's three acts, as their own surface. */
interface ControlCommands {
  saveControl: (input: ControlInput) => Promise<boolean>;
  recordTest: (input: TestInput) => Promise<boolean>;
  retireControl: (controlId: string, reason: string) => Promise<boolean>;
}

/**
 * The register's three commands.
 *
 * Not a boundary anybody asked for: the hook below was over this project's 180-line
 * function budget, and the register is the half of it that is about controls rather
 * than about periods. The budget is a design input here rather than a lint nag —
 * a hook long enough that nobody reads to the end of it is where a second `setBusy`
 * gets added by accident.
 *
 * Both halves share one `ledger` and one `setBusy`, handed in rather than re-derived:
 * `useLedgerCommand` keeps its own `running` and `error`, so calling it twice would be
 * two answers to "is a command in flight", and two `useState` pairs would let the
 * toolbar spin in two places for one act.
 */
function useControlCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: CloseBusy) => void,
): ControlCommands {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const saveControl = useCallback(
    async (input: ControlInput): Promise<boolean> => {
      setBusy('control');
      const ok = await ledger.run(
        {
          command: 'controls.upsert',
          payload: {
            controlId: input.controlId,
            // `controlCode` is the payload's spelling for what the register calls
            // `code`; the broker requires it non-empty, and the form enforces that.
            controlCode: input.code,
            description: input.description,
            ownerRole: input.ownerRole,
            frequency: input.frequency,
          },
        },
        {
          success: tr('حُفظت الرقابة.', 'Contrôle enregistré.', 'Control saved.'),
          failure: tr('تعذّر الحفظ.', 'Enregistrement impossible.', 'Could not save the control.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const recordTest = useCallback(
    async (input: TestInput): Promise<boolean> => {
      setBusy('test');
      const ok = await ledger.run(
        {
          command: 'controls.test',
          payload: {
            controlId: input.controlId,
            result: input.result,
            population: input.population,
            exceptions: input.exceptions,
            note: input.note,
          },
        },
        {
          success: tr('سُجّل الاختبار.', 'Test enregistré.', 'Test recorded.'),
          failure: tr(
            'تعذّر تسجيل الاختبار.',
            'Enregistrement du test impossible.',
            'Could not record the test.',
          ),
        },
      );
      setBusy(null);
      // A pass is the expected outcome and stays a toast. Anything else is a finding
      // somebody has to answer, and it has to survive this window being closed.
      if (ok && input.result !== 'passed') {
        await runtime.notify({
          kind: input.result === 'failed' ? 'error' : 'warning',
          title: tr('نتيجة اختبار رقابة', 'Résultat de test de contrôle', 'Control test result'),
          body: input.exceptions === '' ? input.code : `${input.code} — ${input.exceptions}`,
        });
      }
      return ok;
    },
    [ledger, runtime, setBusy, tr],
  );

  const retireControl = useCallback(
    async (controlId: string, reason: string): Promise<boolean> => {
      setBusy('retire');
      const ok = await ledger.run(
        { command: 'controls.retire', payload: { controlId, reason } },
        {
          success: tr('أُوقفت الرقابة.', 'Contrôle retiré.', 'Control retired.'),
          failure: tr('تعذّر الإيقاف.', 'Retrait impossible.', 'Could not retire the control.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  return { saveControl, recordTest, retireControl };
}

export function useCloseActions(): CloseActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<CloseBusy>(null);

  const closePeriod = useCallback(
    async (period: FiscalPeriod): Promise<boolean> => {
      setBusy('close');
      const ok = await ledger.run(
        { command: 'period.close', payload: { periodId: period.id } },
        {
          success: tr('أُقفلت الفترة.', 'Période clôturée.', 'Period closed.'),
          failure: tr('تعذّر الإقفال.', 'Clôture impossible.', 'Could not close the period.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'success',
          title: tr('إقفال الفترة', 'Clôture de la période', 'Period closed'),
          body: period.label,
        });
      }
      return ok;
    },
    [ledger, runtime, tr],
  );

  const reopenPeriod = useCallback(
    async (period: FiscalPeriod, reason: string): Promise<boolean> => {
      setBusy('reopen');
      const ok = await ledger.run(
        { command: 'period.reopen', payload: { periodId: period.id, reason } },
        {
          success: tr('أُعيد فتح الفترة.', 'Période réouverte.', 'Period reopened.'),
          failure: tr('تعذّرت إعادة الفتح.', 'Réouverture impossible.', 'Could not reopen the period.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'warning',
          title: tr('إعادة فتح فترة', 'Réouverture de période', 'Period reopened'),
          body: `${period.label} — ${reason}`,
        });
      }
      return ok;
    },
    [ledger, runtime, tr],
  );

  const setTaskStatus = useCallback(
    async (task: CloseTask, status: string): Promise<boolean> => {
      setBusy('certify');
      const ok = await ledger.run(
        { command: 'closeTask.complete', payload: { taskId: task.id, status } },
        {
          success: tr('تم تحديث المهمة.', 'Tâche mise à jour.', 'Task updated.'),
          // The server refuses a certification whose dependencies are not certified,
          // and its message names the one that is missing — which is worth reading.
          failure: tr('تعذّر تحديث المهمة.', 'Mise à jour impossible.', 'Could not update the task.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

  // The register's three commands live in their own hook, and are handed this one's
  // `ledger` and `setBusy` so the toolbar cannot spin twice for a single act.
  const { saveControl, recordTest, retireControl } = useControlCommands(ledger, setBusy);

  const copy = useCallback(
    (text: string) => {
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) => {
        void runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم النسخ.', 'Copié.', 'Copied.') }
            : { kind: 'error', title: tr('تعذّر النسخ.', 'Copie impossible.', 'Could not copy.') },
        );
      });
    },
    [runtime, tr],
  );

  const exportCsv = useCallback(
    (content: string, suggestedName: string) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير', 'Exporter', 'Export'),
          startPath: REPORTS,
          suggestedName,
          contentTypes: ['text/csv'],
        });
        // A cancelled dialog is an answer, not a failure: nothing is said about it.
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) {
          setBusy(null);
          return;
        }
        const written = await runtime.invoke('fs.writeText', { path, content, contentType: 'text/csv' });
        setBusy(null);
        await runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم التصدير.', 'Export terminé.', 'Exported.'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر التصدير.', 'Export impossible.', 'Could not export.'),
                body: written.error.message,
              },
        );
      };
      void run();
    },
    [runtime, tr],
  );

  const open = useCallback((app: AppId) => void runtime.launch(app), [runtime]);

  return {
    busy,
    closePeriod,
    reopenPeriod,
    setTaskStatus,
    saveControl,
    recordTest,
    retireControl,
    copy,
    exportCsv,
    open,
  };
}

/**
 * The period a launch is about, both ways in.
 *
 * A cold launch carries it in `runtime.args`; a launch of an already-running window
 * arrives on `CHANNEL_ACTIVATED` instead, because the kernel re-activates the process
 * rather than spawning a second one. Both end on the same selection, which is what
 * lets the dashboard say "close March" and mean it.
 */
export function usePeriodFocus(onPeriod: (periodId: string) => void): void {
  const runtime = useApp();
  // Held in a ref so a new closure per render cannot re-select on its own.
  const sink = useRef(onPeriod);
  sink.current = onPeriod;

  const launched = useRef(false);
  useEffect(() => {
    const id = runtime.args.periodId;
    if (launched.current || id === undefined || id === '') return;
    launched.current = true;
    sink.current(id);
  }, [runtime]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const id = payload?.args?.periodId;
    if (id !== undefined && id !== '') sink.current(id);
  });
}
