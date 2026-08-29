/**
 * Statements — the acts.
 *
 * Nothing here writes to the book, and that is the whole security posture of the window: no
 * `ledger.post`, no privileged capability, no consent prompt. Four things leave this app — a
 * CSV, a paragraph, a saved question and a launch of the ledger — and every one of them was
 * asked for by name.
 *
 * `busy` therefore has one job: to spin the control while a file dialog and a write are in
 * flight, and to stop a second press starting a second write to the same path. It names
 * which act is in flight rather than being a boolean, because three of them can be started
 * from three different buttons and only one control should be spinning.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { APP_IDS, CHANNEL_ACTIVATED, useApp, useIpc } from '@/platform/sdk';
import { REPORTS, STATEMENTS } from '../shared/paths';
import { parseReport, reportFileName, type SavedReport, serialiseReport } from './document';

/** The content type the manifest associates `.fxreport` with. */
const REPORT_TYPE = 'application/vnd.financeos.report';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+S` saves the question and `Ctrl+O` opens one, which are the two the muscle memory of
 * every other document app expects — and here they cost nothing, because neither one touches
 * the ledger. The number keys pick a statement, in the order a set of accounts is read.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'c' ? 'copy' : null;
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  if (key === 's') return 'save';
  if (key === 'o') return 'open';
  if (key === '1') return 'view:income';
  if (key === '2') return 'view:balance';
  if (key === '3') return 'view:trial';
  return null;
}

/** Which act is in flight. Only one can be, so exactly one control spins. */
export type StatementsBusy = 'export' | 'save' | 'open' | null;

export interface StatementsActions {
  readonly busy: StatementsBusy;
  copy: (text: string) => void;
  exportCsv: (content: string, suggestedName: string) => void;
  /** Writes the question, never the figures. Resolves once the dialog is done with. */
  saveReport: (report: SavedReport, today: string) => void;
  /** `null` when the dialog was cancelled or the file was not a report. */
  openReport: () => Promise<SavedReport | null>;
  /** Hand-off: the Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useStatementsActions(): StatementsActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const [busy, setBusy] = useState<StatementsBusy>(null);

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

  /**
   * Saves the question.
   *
   * `savedAt` is the day the window was told it was, not a clock read here: the app has no
   * business owning a second source of time, and the field is written for a human reading the
   * file rather than for anything that will compute with it.
   */
  const saveReport = useCallback(
    (report: SavedReport, today: string) => {
      const run = async () => {
        setBusy('save');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('حفظ التقرير', 'Enregistrer le rapport', 'Save the report'),
          startPath: STATEMENTS,
          suggestedName: reportFileName(report.view, today),
          contentTypes: [REPORT_TYPE],
        });
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) {
          setBusy(null);
          return;
        }
        const written = await runtime.invoke('fs.writeText', {
          path,
          content: serialiseReport(report, today),
          contentType: REPORT_TYPE,
        });
        setBusy(null);
        await runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم الحفظ.', 'Enregistré.', 'Saved.'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر الحفظ.', 'Enregistrement impossible.', 'Could not save.'),
                body: written.error.message,
              },
        );
      };
      void run();
    },
    [runtime, tr],
  );

  const openReport = useCallback(async (): Promise<SavedReport | null> => {
    setBusy('open');
    const chosen = await runtime.invoke('shell.fileDialog', {
      mode: 'open',
      title: tr('فتح تقرير', 'Ouvrir un rapport', 'Open a report'),
      startPath: STATEMENTS,
      contentTypes: [REPORT_TYPE],
    });
    const path = chosen.ok ? chosen.value.path : null;
    if (path === null) {
      setBusy(null);
      return null;
    }
    const report = await readReport(runtime, path);
    setBusy(null);
    return report;
  }, [runtime, tr]);

  const openAccount = useCallback(
    (accountId: string) => {
      void runtime.launch(APP_IDS.ledger, { accountId });
    },
    [runtime],
  );

  return { busy, copy, exportCsv, saveReport, openReport, openAccount };
}

/**
 * Reads one path as a report, complaining once if it is not one.
 *
 * Shared by the Open dialog and the file association, because a `.fxreport` that Explorer
 * hands over is read exactly the way one the user picked is. The two failures are told apart
 * in the words: a file the OS could not read is the OS's problem, and a file that is not a
 * report is the file's — and a window that says "could not open" to both teaches nobody
 * anything.
 */
async function readReport(
  runtime: ReturnType<typeof useApp>,
  path: string,
): Promise<SavedReport | null> {
  const { tr } = runtime.locale;
  const read = await runtime.invoke('fs.readText', { path });
  if (!read.ok) {
    await runtime.toast({
      kind: 'error',
      title: tr('تعذّر فتح الملف.', 'Ouverture impossible.', 'Could not open the file.'),
      body: read.error.message,
    });
    return null;
  }

  const report = parseReport(read.value.content);
  if (report === null) {
    await runtime.toast({
      kind: 'warning',
      title: tr('هذا ليس تقريرًا.', 'Ce n’est pas un rapport.', 'That is not a report.'),
      body: path,
    });
    return null;
  }
  return report;
}

/**
 * The report a launch is about, both ways in.
 *
 * A cold launch carries the path in `runtime.args`; a launch of an already-running window
 * arrives on `CHANNEL_ACTIVATED` instead, because the kernel re-activates the process rather
 * than spawning a second one. Both land on the same applied report, which is what lets
 * double-clicking a `.fxreport` in Explorer mean the same thing either way.
 */
export function useReportAssociation(onReport: (report: SavedReport) => void): void {
  const runtime = useApp();
  // Held in a ref so a new closure per render cannot re-open the file on its own.
  const sink = useRef(onReport);
  sink.current = onReport;

  const open = useCallback(
    (path: string) => {
      void readReport(runtime, path).then((report) => {
        if (report !== null) sink.current(report);
      });
    },
    [runtime],
  );

  const launched = useRef(false);
  useEffect(() => {
    const path = runtime.args.path;
    if (launched.current || path === undefined || path === '') return;
    launched.current = true;
    open(path);
  }, [runtime, open]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const path = payload?.args?.path;
    if (path !== undefined && path !== '') open(path);
  });
}

