/**
 * Statements — what a press means.
 *
 * The question is state, not a setting. `useSetting` writes through the registry, which is a
 * privileged capability, and a window that raised a consent prompt every time somebody moved
 * from the income statement to the balance sheet is a window nobody would move. So the report
 * lives here and dies with the window — and because that makes it cheap to lose, `.fxreport`
 * exists: a question is kept by saving it to a file, deliberately and by name, or not at all.
 *
 * One object is the entire state of this app. Every control writes one field of it, the model
 * takes it as its only argument, and a saved report is that same object read back off disk.
 * Setting the controls by hand and opening a file therefore cannot disagree about anything,
 * because there is nothing for them to disagree about.
 *
 * Nothing here writes to the book. The four things that leave — a CSV, a paragraph, a saved
 * question and a launch of the ledger — were each asked for by name, so none of them asks for
 * confirmation, and none of the disabled controls in this window is protecting anything.
 */
import { type KeyboardEvent, type MouseEvent, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/platform/sdk';
import { hotkey, type StatementsBusy, useReportAssociation, useStatementsActions } from './actions';
import type { Basis } from './balances';
import { DEFAULT_REPORT, type SavedReport } from './document';
import { type StatementsModel, useStatementsModel } from './model';
import {
  accountClipboardText,
  type Provenance,
  rowClipboardText,
  statementCsv,
  suggestedFileName,
  summaryClipboardText,
  trialCsv,
} from './report';
import type { StatementRow, StatementView } from './statement';

/** The jump list's three entries, which are statements rather than settings. */
const VIEW_COMMAND: Readonly<Record<string, StatementView | undefined>> = {
  'view:income': 'income',
  'view:balance': 'balance',
  'view:trial': 'trial',
};

/** Where a right-click landed, and on which row. */
export interface RowAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: StatementRow;
}
/**
 * The question, and the seven ways of asking a different one.
 *
 * Each setter writes one field and leaves the rest alone, which is what lets the basis change
 * under a search that is still typed and a period survive a change of statement. `apply`
 * replaces the lot, because that is what opening a file means: a report that adopted three of
 * its six fields would be a question nobody had asked.
 */
interface ReportControls {
  readonly report: SavedReport;
  setView: (next: StatementView) => void;
  setBasis: (next: Basis) => void;
  setPeriod: (id: string | null) => void;
  setCompare: (next: boolean) => void;
  setZero: (next: boolean) => void;
  setSearch: (next: string) => void;
  /** A comparison is a question about a window, so asking for one asks for the period basis. */
  toggleCompare: () => void;
  apply: (next: SavedReport) => void;
}

function useReport(): ReportControls {
  const [report, setReport] = useState<SavedReport>(DEFAULT_REPORT);

  const setView = useCallback((view: StatementView) => setReport((current) => ({ ...current, view })), []);
  const setBasis = useCallback((basis: Basis) => setReport((current) => ({ ...current, basis })), []);
  const setPeriod = useCallback(
    (periodId: string | null) => setReport((current) => ({ ...current, periodId })),
    [],
  );
  const setCompare = useCallback(
    (compare: boolean) => setReport((current) => ({ ...current, compare })),
    [],
  );
  const setZero = useCallback(
    (showZero: boolean) => setReport((current) => ({ ...current, showZero })),
    [],
  );
  const setSearch = useCallback((search: string) => setReport((current) => ({ ...current, search })), []);

  // The comparison column belongs to the period basis alone, so the command that switches it on
  // takes the basis with it. Turning it on where it cannot be read would be a toggle that moves
  // and changes nothing on screen.
  const toggleCompare = useCallback(() => {
    setReport((current) =>
      current.compare ? { ...current, compare: false } : { ...current, compare: true, basis: 'period' },
    );
  }, []);

  const apply = useCallback((next: SavedReport) => setReport(next), []);

  return { report, setView, setBasis, setPeriod, setCompare, setZero, setSearch, toggleCompare, apply };
}
export interface StatementsShell {
  readonly model: StatementsModel;
  /** The question every figure on screen answers, and the only argument the model took. */
  readonly report: SavedReport;
  /** What each export and each paste carries with it. */
  readonly source: Provenance;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: StatementsBusy;
  readonly menu: RowAnchor | null;
  /** An account is selected, so the ledger has something to open. */
  readonly canDrill: boolean;
  setBasis: (next: Basis) => void;
  setPeriod: (id: string | null) => void;
  setCompare: (next: boolean) => void;
  setZero: (next: boolean) => void;
  setSearch: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the account selected. */
  perform: (id: string, row: StatementRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickAccount: (id: string | null) => void;
  openMenu: (row: StatementRow, event: MouseEvent) => void;
  closeMenu: () => void;
}
export function useStatementsShell(): StatementsShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const controls = useReport();
  const { report } = controls;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<RowAnchor | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useStatementsActions();
  const model = useStatementsModel(report, selectedId);

  /**
   * The provenance every export and every paste carries.
   *
   * Read off the model rather than off the report, because three of its four fields are facts
   * about what came back and not about what was asked for: the window may be a month the app
   * synthesised, the comparison may not exist, and whether a page hit its ceiling is only
   * known once it has.
   */
  const source = useMemo<Provenance>(
    () => ({
      basis: report.basis,
      period: report.basis === 'period' ? model.period : null,
      comparison: model.comparison,
      bounded: model.bounded,
    }),
    [model.bounded, model.comparison, model.period, report.basis],
  );

  const pickAccount = useCallback((id: string | null) => setSelectedId(id), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: StatementRow, event: MouseEvent) => {
    event.preventDefault();
    // A right-click on a subtotal leaves the selection where it was: the menu acts on the row
    // it names, and emptying the pane to open a menu would cost the reader the account they
    // were already looking at.
    if (row.figure !== null) setSelectedId(row.figure.accountId);
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  /** A file, opened or double-clicked: the question is replaced whole and the pane forgets. */
  const applyReport = useCallback(
    (next: SavedReport) => {
      controls.apply(next);
      setSelectedId(null);
      setMenu(null);
    },
    [controls],
  );
  useReportAssociation(applyReport);

  /* ---- the command path -------------------------------------------- */

  /** "Export" is the statement in front of the person, filtered exactly as it is filtered. */
  const exportView = useCallback(() => {
    const csv =
      report.view === 'trial'
        ? trialCsv(model.rows, source, t, tr)
        : statementCsv(model.rows, source, t, tr);
    actions.exportCsv(csv, suggestedFileName(report.view, today));
  }, [actions, model.rows, report.view, source, t, today, tr]);

  const openSaved = useCallback(() => {
    void actions.openReport().then((next) => {
      if (next !== null) applyReport(next);
    });
  }, [actions, applyReport]);

  /**
   * The two row-level acts, on the row a menu named.
   *
   * A row with no account behind it — a section total, the balance check — can be copied and
   * cannot be opened, which is why the menu greys that entry rather than dropping it.
   */
  const actOnRow = useCallback(
    (id: string, row: StatementRow) => {
      if (id === 'ledger') {
        if (row.figure !== null) actions.openAccount(row.figure.accountId);
        return;
      }
      if (id === 'copyRow') actions.copy(rowClipboardText(row, source, t, tr));
    },
    [actions, source, t, tr],
  );

  /**
   * The same two acts on the account the pane is describing.
   *
   * The pane holds a figure rather than a row, and the figure is the better of the two to
   * paste: an account's own numbers do not depend on which statement happened to be open when
   * somebody clicked it.
   */
  const actOnAccount = useCallback(
    (id: string) => {
      const figure = model.selected;
      if (figure === null) return;
      if (id === 'ledger') {
        actions.openAccount(figure.accountId);
        return;
      }
      if (id === 'copyRow') actions.copy(accountClipboardText(figure, source, t, tr));
    },
    [actions, model.selected, source, t, tr],
  );

  const perform = useCallback(
    (id: string, row: StatementRow | null) => {
      const next = VIEW_COMMAND[id];
      if (next !== undefined) {
        controls.setView(next);
        return;
      }
      if (id === 'refresh') {
        model.refresh();
        return;
      }
      if (id === 'find') {
        searchRef.current?.focus();
        return;
      }
      if (id === 'export') {
        exportView();
        return;
      }
      if (id === 'copy') {
        actions.copy(summaryClipboardText(report.view, model.set.summary, source, t, tr));
        return;
      }
      if (id === 'compare') {
        controls.toggleCompare();
        return;
      }
      if (id === 'save') {
        actions.saveReport(report, today);
        return;
      }
      if (id === 'open') {
        openSaved();
        return;
      }
      if (row === null) actOnAccount(id);
      else actOnRow(id, row);
    },
    [actOnAccount, actOnRow, actions, controls, exportView, model, openSaved, report, source, t, today, tr],
  );

  /** The toolbar, the accelerators and the panes all act on the selection, never on a row. */
  const command = useCallback((id: string) => perform(id, null), [perform]);

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const id = hotkey(event);
      if (id === null) return;
      event.preventDefault();
      command(id);
    },
    [command],
  );
  return {
    model,
    report,
    source,
    searchRef,
    busy: actions.busy,
    menu,
    canDrill: model.selected !== null,
    setBasis: controls.setBasis,
    setPeriod: controls.setPeriod,
    setCompare: controls.setCompare,
    setZero: controls.setZero,
    setSearch: controls.setSearch,
    command,
    perform,
    keyDown,
    pickAccount,
    openMenu,
    closeMenu,
  };
}
