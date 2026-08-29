/**
 * Modeling — what a press means.
 *
 * The scenario is state, not a setting. `useSetting` writes through the registry, which is a
 * privileged capability, and a slider that raises a consent prompt every time it moves is a
 * slider nobody will move. So the hypothesis lives in this window and dies with it, and
 * everything that leaves carries its assumptions in the file or the paragraph itself.
 *
 * Overrides sit in the same object as the drivers on purpose. An override is part of the
 * hypothesis — "assume this line is 400k a month, whatever the trend says" — so Reset takes
 * them with it, and their count is on screen in three places rather than none.
 *
 * One command does not act immediately: `override` opens the dialog, because a typed number
 * is a number somebody has to type. Nothing here writes to the book, so nothing here asks
 * for confirmation — `release` is destructive of an assumption and of nothing else.
 */
import { type KeyboardEvent, type MouseEvent, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { fmt, useLocale } from '@/platform/sdk';
import { hotkey, type ModelingBusy, useAccountFocus, useModelingActions } from './actions';
import {
  type CompareRow,
  DEFAULT_SCENARIO,
  type ForecastRow,
  type Method,
  type Scenario,
  type TimelineRow,
} from './forecast';
import { type ModelingModel, type ModelingSelection, type ModelingView, useModelingModel } from './model';
import {
  compareCsv,
  forecastCsv,
  groupClipboardText,
  monthClipboardText,
  rowClipboardText,
  suggestedFileName,
  summaryClipboardText,
  timelineCsv,
} from './report';

/** Nothing chosen: no plan to compare against, and nothing in the right-hand pane. */
const EMPTY_SELECTION: ModelingSelection = { budgetId: null, accountId: null };

/** The jump list's three entries, which are view switches and nothing else. */
const VIEW_COMMAND: Readonly<Record<string, ModelingView | undefined>> = {
  'view:forecast': 'forecast',
  'view:timeline': 'timeline',
  'view:compare': 'compare',
};

/** Where a right-click landed, and on which row. */
export interface RowAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: ForecastRow;
}

/**
 * The hypothesis, and the five ways of changing it.
 *
 * Kept apart from the rest of the window's state because it is the only state a reader of
 * the export would need told: everything else here decides what is on screen, and this
 * decides what the numbers are.
 */
interface ScenarioControls {
  readonly scenario: Scenario;
  setMethod: (next: Method) => void;
  setHorizon: (next: number) => void;
  setLookback: (next: number) => void;
  setGrowth: (next: number) => void;
  setUplift: (next: number) => void;
  /** Replace one account's monthly number, whatever the driver said. */
  override: (accountId: string, monthly: number) => void;
  release: (accountId: string) => void;
  reset: () => void;
}

function useScenario(): ScenarioControls {
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);

  const setMethod = useCallback((method: Method) => setScenario((current) => ({ ...current, method })), []);
  const setHorizon = useCallback((horizon: number) => setScenario((current) => ({ ...current, horizon })), []);
  const setLookback = useCallback((lookback: number) => setScenario((current) => ({ ...current, lookback })), []);
  const setGrowth = useCallback((growth: number) => setScenario((current) => ({ ...current, growth })), []);
  const setUplift = useCallback((uplift: number) => setScenario((current) => ({ ...current, uplift })), []);

  const override = useCallback((accountId: string, monthly: number) => {
    setScenario((current) => {
      const overrides = new Map(current.overrides);
      overrides.set(accountId, monthly);
      return { ...current, overrides };
    });
  }, []);

  // Returning `current` untouched matters: the projection is memoised on the scenario, so a
  // release of something that was never overridden must not look like a change.
  const release = useCallback((accountId: string) => {
    setScenario((current) => {
      if (!current.overrides.has(accountId)) return current;
      const overrides = new Map(current.overrides);
      overrides.delete(accountId);
      return { ...current, overrides };
    });
  }, []);

  const reset = useCallback(() => setScenario(DEFAULT_SCENARIO), []);

  return { scenario, setMethod, setHorizon, setLookback, setGrowth, setUplift, override, release, reset };
}

/**
 * What is chosen, what is typed, and what is on screen.
 *
 * The account survives a change of plan. The chart of accounts does not move when the budget
 * does, so "what would this line look like against last year's plan" is a question asked by
 * clicking down the rail with one row held — the same gesture the budgets window allows.
 */
interface ModelingUi {
  readonly view: ModelingView;
  readonly search: string;
  readonly selection: ModelingSelection;
  readonly menu: RowAnchor | null;
  /** The override dialog is open, which is the only modal this window has. */
  readonly editing: boolean;
  readonly draft: string;
  /** Accounts the lookback never saw move are in the grid. */
  readonly showQuiet: boolean;
  setSearch: (next: string) => void;
  setDraft: (next: string) => void;
  setQuiet: (next: boolean) => void;
  pickBudget: (id: string | null) => void;
  pickAccount: (id: string | null) => void;
  changeView: (next: ModelingView) => void;
  openMenu: (row: ForecastRow, event: MouseEvent) => void;
  closeMenu: () => void;
  /** Opens the dialog with the number the pane is already showing. */
  startOverride: (value: string) => void;
  endOverride: () => void;
}

function useModelingUi(): ModelingUi {
  const [view, setView] = useState<ModelingView>('forecast');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<ModelingSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<RowAnchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showQuiet, setQuiet] = useState(false);

  const pickBudget = useCallback((budgetId: string | null) => {
    setSelection((current) => ({ ...current, budgetId }));
  }, []);

  const pickAccount = useCallback((accountId: string | null) => {
    setSelection((current) => ({ ...current, accountId }));
  }, []);
  useAccountFocus(pickAccount);

  // The search is kept across views, like the budgets window: all three views read the same
  // projection, and clearing the box on a view switch throws away what was just typed.
  const changeView = useCallback((next: ModelingView) => setView(next), []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: ForecastRow, event: MouseEvent) => {
    event.preventDefault();
    setSelection((current) => ({ ...current, accountId: row.account.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  const startOverride = useCallback((value: string) => {
    setDraft(value);
    setEditing(true);
  }, []);

  const endOverride = useCallback(() => setEditing(false), []);

  return {
    view,
    search,
    selection,
    menu,
    editing,
    draft,
    showQuiet,
    setSearch,
    setDraft,
    setQuiet,
    pickBudget,
    pickAccount,
    changeView,
    openMenu,
    closeMenu,
    startOverride,
    endOverride,
  };
}

export interface ModelingShell {
  readonly model: ModelingModel;
  readonly view: ModelingView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly scenario: Scenario;
  readonly busy: ModelingBusy;
  readonly menu: RowAnchor | null;
  readonly editing: boolean;
  readonly draft: string;
  readonly showQuiet: boolean;
  /** A row is selected, so a typed number has somewhere to land. */
  readonly canOverride: boolean;
  /** That row already carries one. */
  readonly canRelease: boolean;
  /** Rows the active view is showing, for the status bar. */
  readonly shown: number;
  setSearch: (next: string) => void;
  setDraft: (next: string) => void;
  setQuiet: (next: boolean) => void;
  setMethod: (next: Method) => void;
  setHorizon: (next: number) => void;
  setLookback: (next: number) => void;
  setGrowth: (next: number) => void;
  setUplift: (next: number) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the one selected. */
  perform: (id: string, row: ForecastRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickBudget: (id: string | null) => void;
  pickAccount: (id: string | null) => void;
  changeView: (next: ModelingView) => void;
  openMenu: (row: ForecastRow, event: MouseEvent) => void;
  closeMenu: () => void;
  confirmOverride: () => void;
  cancelOverride: () => void;
  copyMonth: (row: TimelineRow) => void;
  copyGroup: (row: CompareRow) => void;
}

/** What the status bar counts, which is whatever the active view is showing. */
function shownCount(view: ModelingView, model: ModelingModel): number {
  if (view === 'timeline') return model.projection.timeline.length;
  if (view === 'compare') return model.projection.compare.length;
  return model.rows.length;
}

/**
 * The number the dialog opens on: the first projected month.
 *
 * That is the unit an override replaces and the number the pane is showing, and because
 * `values` already carries an override when one is in force, an edit starts from the number
 * being edited without the caller having to know which case it is in.
 */
function draftOf(row: ForecastRow): string {
  return (row.values[0] ?? row.average).toFixed(2);
}

export function useModelingShell(): ModelingShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const ui = useModelingUi();
  const { view, search, selection, menu, editing, draft, showQuiet } = ui;
  const { setSearch, setDraft, setQuiet, pickBudget, pickAccount, changeView, openMenu, closeMenu } = ui;
  const { startOverride, endOverride } = ui;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const controls = useScenario();
  const { scenario } = controls;
  const actions = useModelingActions();
  const model = useModelingModel(view, search, selection, scenario, showQuiet);
  const { projection } = model;

  /* ---- the command path -------------------------------------------- */

  /** "Export" means the view in front of the person, filtered exactly as it is filtered. */
  const exportView = useCallback(() => {
    const name = suggestedFileName(view, today);
    if (view === 'timeline') actions.exportCsv(timelineCsv(projection.timeline, tr), name);
    else if (view === 'compare') actions.exportCsv(compareCsv(projection.compare, t, tr), name);
    else actions.exportCsv(forecastCsv(model.rows, projection.futureMonths, scenario, t, tr), name);
  }, [actions, model.rows, projection, scenario, t, today, tr, view]);

  const actOn = useCallback(
    (id: string, row: ForecastRow) => {
      if (id === 'override') {
        startOverride(draftOf(row));
        return;
      }
      if (id === 'release') {
        controls.release(row.account.id);
        return;
      }
      if (id === 'ledger') {
        actions.openAccount(row.account.id);
        return;
      }
      if (id === 'copyRow') actions.copy(rowClipboardText(row, scenario, t, tr));
    },
    [actions, controls, scenario, startOverride, t, tr],
  );

  const perform = useCallback(
    (id: string, row: ForecastRow | null) => {
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
      if (id === 'reset') {
        controls.reset();
        return;
      }
      if (id === 'copy') {
        actions.copy(summaryClipboardText(projection, scenario, model.budget, t, tr));
        return;
      }
      if (row !== null) actOn(id, row);
    },
    [actOn, actions, changeView, controls, exportView, model, projection, scenario, t, tr],
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

  /** The typed number, once. An unreadable one keeps the dialog and the typing. */
  const confirmOverride = useCallback(() => {
    const monthly = fmt.parseAmount(draft);
    const row = model.selected;
    if (monthly === null || row === null) return;
    controls.override(row.account.id, monthly);
    endOverride();
  }, [controls, draft, endOverride, model.selected]);

  const cancelOverride = useCallback(() => endOverride(), [endOverride]);

  const copyMonth = useCallback(
    (row: TimelineRow) => actions.copy(monthClipboardText(row, tr)),
    [actions, tr],
  );

  const copyGroup = useCallback(
    (row: CompareRow) => actions.copy(groupClipboardText(row, t, tr)),
    [actions, t, tr],
  );

  const selected = model.selected;

  return {
    model,
    view,
    search,
    searchRef,
    scenario,
    busy: actions.busy,
    menu,
    editing,
    draft,
    showQuiet,
    canOverride: selected !== null,
    canRelease: selected !== null && selected.overridden,
    shown: shownCount(view, model),
    setSearch,
    setDraft,
    setQuiet,
    setMethod: controls.setMethod,
    setHorizon: controls.setHorizon,
    setLookback: controls.setLookback,
    setGrowth: controls.setGrowth,
    setUplift: controls.setUplift,
    command,
    perform,
    keyDown,
    pickBudget,
    pickAccount,
    changeView,
    openMenu,
    closeMenu,
    confirmOverride,
    cancelOverride,
    copyMonth,
    copyGroup,
  };
}
