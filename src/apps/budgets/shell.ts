/**
 * Budgets — what a press means.
 *
 * `App.tsx` decides what the window looks like; this decides what happens when something
 * in it is pressed. Two ids make up the selection — a budget and an account — and unlike
 * the close checklist the account survives a change of budget on purpose: the chart is the
 * same chart, and "what did we plan for travel last quarter" is a question asked by moving
 * along the rail with one row held.
 *
 * One command does not act immediately. `set` and `seed` both open the amount dialog,
 * because an amount is a number somebody has to type — or read, when it was taken from the
 * actual. The write behind both is privileged, so the kernel asks; this window does not
 * ask a second time.
 */
import { type KeyboardEvent, type MouseEvent, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { fmt, useLocale } from '@/platform/sdk';
import {
  type BudgetBusy,
  hotkey,
  type PlanAmounts,
  type PlanIntent,
  useAccountFocus,
  useBudgetActions,
} from './actions';
import { type BudgetModel, type BudgetSelection, type BudgetView, useBudgetModel } from './model';
import {
  groupClipboardText,
  rollupCsv,
  rowClipboardText,
  suggestedFileName,
  summaryClipboardText,
  varianceCsv,
} from './report';
import type { RollupRow, VarianceRow } from './variance';

/** Nothing chosen: the model then derives a budget that is still open to editing. */
const EMPTY_SELECTION: BudgetSelection = { budgetId: null, accountId: null };

/** The jump list's three entries, which are view switches and nothing else. */
const VIEW_COMMAND: Readonly<Record<string, BudgetView | undefined>> = {
  'view:variance': 'variance',
  'view:plan': 'plan',
  'view:rollup': 'rollup',
};

/** Where a right-click landed, and on which row. */
export interface RowAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: VarianceRow;
}

export interface BudgetShell {
  readonly model: BudgetModel;
  readonly view: BudgetView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: BudgetBusy;
  readonly menu: RowAnchor | null;
  /** The amount dialog is open, which is the only thing standing in front of a write. */
  readonly editing: boolean;
  readonly intent: PlanIntent;
  readonly dzd: string;
  readonly sar: string;
  readonly filtered: boolean;
  readonly canSet: boolean;
  readonly canSeed: boolean;
  /** Rows the active view is showing, for the status bar. */
  readonly shown: number;
  setSearch: (next: string) => void;
  setDzd: (next: string) => void;
  setSar: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the one selected. */
  perform: (id: string, row: VarianceRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickBudget: (budgetId: string) => void;
  pickAccount: (accountId: string | null) => void;
  changeView: (next: BudgetView) => void;
  openMenu: (row: VarianceRow, event: MouseEvent) => void;
  closeMenu: () => void;
  confirmAmount: () => void;
  cancelAmount: () => void;
  copyGroup: (group: RollupRow) => void;
}

/** What the status bar counts, which is whatever the active view is showing. */
function shownCount(view: BudgetView, model: BudgetModel): number {
  return view === 'rollup' ? model.assessment.groups.length : model.rows.length;
}

/** The dialog holds text, not numbers. An empty riyal field is a zero, and says so. */
function amountsOf(dzd: string, sar: string): PlanAmounts | null {
  const planned = fmt.parseAmount(dzd);
  const riyal = sar.trim() === '' ? 0 : fmt.parseAmount(sar);
  return planned === null || riyal === null ? null : { dzd: planned, sar: riyal };
}

/**
 * What is chosen and what is typed: the state no server call can answer.
 *
 * Separated from the command path because the two cascades are the part worth reading on
 * its own — and because both of them are deliberately gentler than the close window's.
 */
interface BudgetUi {
  readonly view: BudgetView;
  readonly search: string;
  readonly selection: BudgetSelection;
  readonly menu: RowAnchor | null;
  readonly editing: boolean;
  readonly intent: PlanIntent;
  readonly dzd: string;
  readonly sar: string;
  setSearch: (next: string) => void;
  setDzd: (next: string) => void;
  setSar: (next: string) => void;
  pickBudget: (budgetId: string) => void;
  pickAccount: (accountId: string | null) => void;
  changeView: (next: BudgetView) => void;
  openMenu: (row: VarianceRow, event: MouseEvent) => void;
  closeMenu: () => void;
  /** Opens the dialog with both fields already filled, whatever they are filled from. */
  startAmount: (dzd: string, sar: string, intent: PlanIntent) => void;
  endAmount: () => void;
}

function useBudgetUi(): BudgetUi {
  const [view, setView] = useState<BudgetView>('variance');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<BudgetSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<RowAnchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [intent, setIntent] = useState<PlanIntent>('set');
  const [dzd, setDzd] = useState('');
  const [sar, setSar] = useState('');

  const pickBudget = useCallback((budgetId: string) => {
    // The account is kept. The chart does not change with the budget, so a row selected
    // against last quarter is the same account this quarter — which is the comparison
    // somebody is making when they move along the rail.
    setSelection((current) => ({ ...current, budgetId }));
  }, []);

  const pickAccount = useCallback((accountId: string | null) => {
    setSelection((current) => ({ ...current, accountId }));
  }, []);
  useAccountFocus(pickAccount);

  // The search is kept across views: both grids search the same chart of accounts, and
  // clearing it on a view switch would throw away the filter somebody just typed.
  const changeView = useCallback((next: BudgetView) => setView(next), []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: VarianceRow, event: MouseEvent) => {
    event.preventDefault();
    setSelection((current) => ({ ...current, accountId: row.account.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  const startAmount = useCallback((nextDzd: string, nextSar: string, nextIntent: PlanIntent) => {
    setDzd(nextDzd);
    setSar(nextSar);
    setIntent(nextIntent);
    setEditing(true);
  }, []);

  const endAmount = useCallback(() => setEditing(false), []);

  return {
    view,
    search,
    selection,
    menu,
    editing,
    intent,
    dzd,
    sar,
    setSearch,
    setDzd,
    setSar,
    pickBudget,
    pickAccount,
    changeView,
    openMenu,
    closeMenu,
    startAmount,
    endAmount,
  };
}

export function useBudgetShell(): BudgetShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const ui = useBudgetUi();
  const { view, search, menu, editing, intent, dzd, sar, selection } = ui;
  const { setSearch, setDzd, setSar, pickBudget, pickAccount, changeView, openMenu, closeMenu } = ui;
  const { startAmount, endAmount } = ui;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useBudgetActions();
  const model = useBudgetModel(view, search, selection);
  const locked = model.assessment.locked;

  /* ---- the command path -------------------------------------------- */

  /** "Export" means the view in front of the person, and nothing else. */
  const exportView = useCallback(() => {
    const name = suggestedFileName(model.budget, view, today);
    if (view === 'rollup') actions.exportCsv(rollupCsv(model.assessment.groups, t, tr), name);
    else actions.exportCsv(varianceCsv(model.rows, t, tr), name);
  }, [actions, model.assessment.groups, model.budget, model.rows, t, today, tr, view]);

  /**
   * The dialog's two fields, filled from wherever the press came from.
   *
   * `set` shows what is on the line already, so an edit starts from the number being
   * edited. `seed` shows the posted actual instead. The riyal amount comes from the line
   * either way — the upsert writes both currencies, and this is how the one nobody
   * touched survives the write.
   */
  const openAmount = useCallback(
    (row: VarianceRow, next: PlanIntent) => {
      if (model.budget === null || locked) return;
      const line = model.assessment.byAccount.get(row.account.id) ?? null;
      const planned = next === 'seed' ? row.actual.toFixed(2) : line === null ? '' : line.dzd.toFixed(2);
      startAmount(planned, line === null ? '' : line.sar.toFixed(2), next);
    },
    [locked, model.assessment.byAccount, model.budget, startAmount],
  );

  const actOn = useCallback(
    (id: string, row: VarianceRow) => {
      if (id === 'set' || id === 'seed') {
        // Seeding a zero is not a plan: an account with no postings has nothing to copy.
        if (id === 'seed' && row.lines === 0) return;
        openAmount(row, id);
        return;
      }
      if (id === 'ledger') {
        actions.openAccount(row.account.id);
        return;
      }
      if (id === 'copyRow') actions.copy(rowClipboardText(row, t, tr));
    },
    [actions, openAmount, t, tr],
  );

  const perform = useCallback(
    (id: string, row: VarianceRow | null) => {
      const next = VIEW_COMMAND[id];
      if (next !== undefined) {
        changeView(next);
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
        actions.copy(summaryClipboardText(model.budget, model.assessment, t, tr));
        return;
      }
      if (row !== null) actOn(id, row);
    },
    [actOn, actions, changeView, exportView, model, t, tr],
  );

  const command = useCallback((id: string) => perform(id, model.selected), [model.selected, perform]);

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const id = hotkey(event);
      if (id === null) return;
      event.preventDefault();
      command(id);
    },
    [command],
  );

  const confirmAmount = useCallback(() => {
    const amounts = amountsOf(dzd, sar);
    const row = model.selected;
    const budget = model.budget;
    if (amounts === null || row === null || budget === null) return;
    void actions.setAmount(budget.id, row.account.id, amounts, intent).then((ok) => {
      // A refused write keeps the dialog and the typing: the server's message says what
      // was wrong, and typing the amount again is not part of the answer.
      if (ok) endAmount();
    });
  }, [actions, dzd, endAmount, intent, model.budget, model.selected, sar]);

  const cancelAmount = useCallback(() => endAmount(), [endAmount]);

  const copyGroup = useCallback(
    (group: RollupRow) => actions.copy(groupClipboardText(group, t, tr)),
    [actions, t, tr],
  );

  const selected = model.selected;
  const canSet = selected !== null && model.budget !== null && !locked;

  return {
    model,
    view,
    search,
    searchRef,
    busy: actions.busy,
    menu,
    editing,
    intent,
    dzd,
    sar,
    filtered: search.trim() !== '',
    canSet,
    canSeed: canSet && (selected?.lines ?? 0) > 0,
    shown: shownCount(view, model),
    setSearch,
    setDzd,
    setSar,
    command,
    perform,
    keyDown,
    pickBudget,
    pickAccount,
    changeView,
    openMenu,
    closeMenu,
    confirmAmount,
    cancelAmount,
    copyGroup,
  };
}
