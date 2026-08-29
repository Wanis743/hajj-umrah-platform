/**
 * Period close — what a press means.
 *
 * `App.tsx` decides what the window looks like; this decides what happens when
 * something in it is pressed. Two ids make up the selection — a period and a checklist
 * row — and the cascade between them is small but load-bearing: choosing another period
 * drops the row, because the checklist is global and a row selected against March says
 * nothing useful while April is on screen.
 *
 * Two commands do not act immediately. `reopen` opens the reason dialog, because the
 * server refuses the call without one. `export` asks the shell for a path. Everything
 * else runs straight through, and the kernel raises its own consent for the two acts
 * that carry `ledger.close`.
 */
import { type KeyboardEvent, type MouseEvent, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/platform/sdk';
import type { FiscalPeriod } from '../shared/ledger';
import { type CloseBusy, CHECK_APP, hotkey, useCloseActions, usePeriodFocus } from './actions';
import type { CheckId, ChecklistRow } from './checks';
import { type AuditRow, type CloseModel, type CloseSelection, type CloseView, useCloseModel } from './model';
import {
  checkCsv,
  checklistCsv,
  suggestedFileName,
  summaryClipboardText,
  taskClipboardText,
  trailCsv,
} from './report';

/** Nothing chosen: the model then derives the newest period that is still open. */
const EMPTY_SELECTION: CloseSelection = { periodId: null, taskId: null };

/** The jump list's three entries, which are view switches and nothing else. */
const VIEW_COMMAND: Readonly<Record<string, CloseView | undefined>> = {
  'view:checks': 'checks',
  'view:tasks': 'tasks',
  'view:trail': 'trail',
};

/** Where a right-click landed, and on which row. */
export interface TaskAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: ChecklistRow;
}

/** The three statuses `complete_close_task` accepts, in the table's own spelling. */
const TASK_COMMAND: Readonly<Record<string, string | undefined>> = {
  certify: 'certified',
  start: 'in_progress',
  block: 'blocked',
};

export interface CloseShell {
  readonly model: CloseModel;
  readonly view: CloseView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: CloseBusy;
  readonly selectedTask: ChecklistRow | null;
  readonly menu: TaskAnchor | null;
  /** The reason dialog is open, which is the only thing standing in front of a reopen. */
  readonly reopening: boolean;
  readonly reason: string;
  readonly filtered: boolean;
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly canCertify: boolean;
  /** Rows the active view is showing, for the status bar. */
  readonly shown: number;
  setSearch: (next: string) => void;
  setReason: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the one selected. */
  perform: (id: string, row: ChecklistRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickPeriod: (periodId: string) => void;
  pickTask: (taskId: string | null) => void;
  changeView: (next: CloseView) => void;
  /** Answer a finding: either in this window, or in the app that owns it. */
  fix: (id: CheckId) => void;
  openMenu: (row: ChecklistRow, event: MouseEvent) => void;
  closeMenu: () => void;
  confirmReopen: () => void;
  cancelReopen: () => void;
  copyTrail: (row: AuditRow) => void;
}

/** Periods arrive newest-first, so the oldest offender is the last of them. */
function oldestBlocking(periods: readonly FiscalPeriod[], current: FiscalPeriod | null): FiscalPeriod | null {
  if (current === null) return null;
  const blocking = periods.filter(
    (row) => row.id !== current.id && row.end < current.start && row.status !== 'closed',
  );
  return blocking.length === 0 ? null : blocking[blocking.length - 1];
}

/** What the status bar counts, which is whatever the active view is showing. */
function shownCount(view: CloseView, model: CloseModel): number {
  if (view === 'checks') return model.assessment.checks.length;
  return view === 'tasks' ? model.visibleTasks.length : model.visibleTrail.length;
}

/** One audit row on one line, in the order the grid reads it. */
function trailLine(row: AuditRow): string {
  return [row.at, row.action, row.resource, row.resourceId ?? '', row.email].filter((part) => part !== '').join(' · ');
}

/**
 * What is chosen and what is open: the state no server call can answer.
 *
 * It is separated from the command path because the cascade between the two ids is the
 * part worth reading on its own — a period carries its checklist row away with it.
 */
interface CloseUi {
  readonly view: CloseView;
  readonly search: string;
  readonly selection: CloseSelection;
  readonly menu: TaskAnchor | null;
  readonly reopening: boolean;
  readonly reason: string;
  setSearch: (next: string) => void;
  setReason: (next: string) => void;
  setReopening: (next: boolean) => void;
  pickPeriod: (periodId: string) => void;
  pickTask: (taskId: string | null) => void;
  changeView: (next: CloseView) => void;
  openMenu: (row: ChecklistRow, event: MouseEvent) => void;
  closeMenu: () => void;
}

function useCloseUi(): CloseUi {
  const [view, setView] = useState<CloseView>('checks');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<CloseSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<TaskAnchor | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  const pickPeriod = useCallback((periodId: string) => {
    // The checklist belongs to the book rather than to one month, so a row picked
    // against March is not wrong once April is on screen — it is just not the subject
    // any more, and the pane would go on arguing about it.
    setSelection({ periodId, taskId: null });
  }, []);
  usePeriodFocus(pickPeriod);

  const pickTask = useCallback((taskId: string | null) => {
    setSelection((current) => ({ ...current, taskId }));
  }, []);

  const changeView = useCallback((next: CloseView) => {
    // The two searches mean different things — a task name and an audit action — so
    // carrying one into the other view would filter against the wrong vocabulary.
    setSearch('');
    setView(next);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: ChecklistRow, event: MouseEvent) => {
    event.preventDefault();
    setSelection((current) => ({ ...current, taskId: row.task.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  return {
    view,
    search,
    selection,
    menu,
    reopening,
    reason,
    setSearch,
    setReason,
    setReopening,
    pickPeriod,
    pickTask,
    changeView,
    openMenu,
    closeMenu,
  };
}

export function useCloseShell(): CloseShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const ui = useCloseUi();
  const { view, search, menu, reopening, reason, selection } = ui;
  const { setSearch, setReason, setReopening, pickPeriod, pickTask, changeView, openMenu, closeMenu } = ui;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useCloseActions();
  const model = useCloseModel(view, search, selection);

  /* ---- the command path -------------------------------------------- */

  /** "Export" means the view in front of the person, and nothing else. */
  const exportView = useCallback(() => {
    const name = suggestedFileName(model.period, view, today);
    if (view === 'tasks') actions.exportCsv(checklistCsv(model.visibleTasks, t, tr), name);
    else if (view === 'trail') actions.exportCsv(trailCsv(model.visibleTrail, tr), name);
    else actions.exportCsv(checkCsv(model.assessment.checks, model.period, t, tr), name);
  }, [actions, model.assessment.checks, model.period, model.visibleTasks, model.visibleTrail, t, today, tr, view]);

  /**
   * Answering a finding.
   *
   * Two of the seven are answered in this window: the checklist by working it, and an
   * earlier open period by going there — the oldest one, because closing in order is
   * the entire point of that check. The rest belong to another app, and `CHECK_APP`
   * says which.
   */
  const fix = useCallback(
    (id: CheckId) => {
      if (id === 'tasks') {
        changeView('tasks');
        return;
      }
      if (id === 'earlier') {
        const oldest = oldestBlocking(model.periods, model.period);
        if (oldest !== null) pickPeriod(oldest.id);
        return;
      }
      const app = CHECK_APP[id];
      if (app !== null) actions.open(app);
    },
    [actions, changeView, model.period, model.periods, pickPeriod],
  );

  const actOn = useCallback(
    (id: string, row: ChecklistRow) => {
      if (id === 'copyTask') {
        actions.copy(taskClipboardText(row.task, row.unmet, t, tr));
        return;
      }
      const status = TASK_COMMAND[id];
      // A certification the server would refuse is not sent: its dependencies are
      // named on the row, which is a better answer than a failed command.
      if (status === undefined || (id === 'certify' && !row.actionable)) return;
      void actions.setTaskStatus(row.task, status);
    },
    [actions, t, tr],
  );

  const perform = useCallback(
    (id: string, row: ChecklistRow | null) => {
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
        actions.copy(summaryClipboardText(model.period, model.assessment, t, tr));
        return;
      }
      if (id === 'close') {
        // No confirmation here: `period.close` carries `ledger.close`, and the kernel
        // has already asked. A second prompt only teaches people to click through both.
        if (model.period !== null && model.assessment.closable) void actions.closePeriod(model.period);
        return;
      }
      if (id === 'reopen') {
        if (model.period !== null && model.assessment.sealed) {
          setReason('');
          setReopening(true);
        }
        return;
      }
      if (row !== null) actOn(id, row);
    },
    [actOn, actions, changeView, exportView, model, setReason, setReopening, t, tr],
  );

  const command = useCallback((id: string) => perform(id, model.selectedTask), [model.selectedTask, perform]);

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const id = hotkey(event);
      if (id === null) return;
      event.preventDefault();
      command(id);
    },
    [command],
  );

  const confirmReopen = useCallback(() => {
    const period = model.period;
    const text = reason.trim();
    if (period === null || text === '') return;
    void actions.reopenPeriod(period, text).then((ok) => {
      // A refused reopen keeps the dialog and the reason: the server's message says
      // what was wrong, and retyping it is not part of the answer.
      if (!ok) return;
      setReopening(false);
      setReason('');
    });
  }, [actions, model.period, reason, setReason, setReopening]);

  const cancelReopen = useCallback(() => setReopening(false), [setReopening]);

  const copyTrail = useCallback((row: AuditRow) => actions.copy(trailLine(row)), [actions]);

  return {
    model,
    view,
    search,
    searchRef,
    busy: actions.busy,
    selectedTask: model.selectedTask,
    menu,
    reopening,
    reason,
    filtered: search.trim() !== '',
    canClose: model.assessment.closable,
    canReopen: model.assessment.sealed,
    canCertify: model.selectedTask !== null && model.selectedTask.actionable,
    shown: shownCount(view, model),
    setSearch,
    setReason,
    command,
    perform,
    keyDown,
    pickPeriod,
    pickTask,
    changeView,
    fix,
    openMenu,
    closeMenu,
    confirmReopen,
    cancelReopen,
    copyTrail,
  };
}
