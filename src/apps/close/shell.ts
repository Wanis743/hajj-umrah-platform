/**
 * Period close — what a press means.
 *
 * `App.tsx` decides what the window looks like; this decides what happens when
 * something in it is pressed. Three ids make up the selection — a period, a checklist
 * row and a control — and the cascade between them is small but load-bearing: choosing
 * another period drops the row, because the checklist is global and a row selected
 * against March says nothing useful while April is on screen. It keeps the control,
 * because the register is not a month's document: the same control is the subject in
 * every period, and its test history spans all of them.
 *
 * Five commands do not act immediately. `reopen` opens the reason dialog, because the
 * server refuses the call without one; the three `control:*` forms open for the same
 * kind of reason, which is that a code, a result or a reason has to be typed before
 * there is anything to send; `export` asks the shell for a path. Everything else runs
 * straight through, and the kernel raises its own consent for every act that carries
 * `ledger.close`.
 *
 * The command path is a hook of its own. It is a third of this file, and the alternative
 * was one function long enough that the wiring at the bottom — which is what somebody
 * opens this file to read — sat two hundred lines below the top.
 */
import { type KeyboardEvent, type MouseEvent, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/platform/sdk';
import type { FiscalPeriod } from '../shared/ledger';
import {
  type CloseActions,
  type CloseBusy,
  CHECK_APP,
  hotkey,
  useCloseActions,
  usePeriodFocus,
} from './actions';
import type { CheckId, ChecklistRow } from './checks';
import type { ControlFrequency, ControlResult, FinancialControl } from './controls';
import {
  type AuditRow,
  type CloseModel,
  type CloseSelection,
  type CloseView,
  useCloseModel,
} from './model';
import {
  type Label,
  type Translate,
  checkCsv,
  checklistCsv,
  controlClipboardText,
  controlCsv,
  suggestedFileName,
  summaryClipboardText,
  taskClipboardText,
  trailCsv,
} from './report';

/** Nothing chosen: the model then derives the newest period that is still open. */
const EMPTY_SELECTION: CloseSelection = { periodId: null, taskId: null, controlId: null };

/** The jump list's four entries, which are view switches and nothing else. */
const VIEW_COMMAND: Readonly<Record<string, CloseView | undefined>> = {
  'view:checks': 'checks',
  'view:tasks': 'tasks',
  'view:trail': 'trail',
  'view:controls': 'controls',
};

/** The register's three forms, keyed by the command that opens each one. */
const CONTROL_DIALOG: Readonly<Record<string, ControlDialog | undefined>> = {
  'control:new': 'edit',
  'control:edit': 'edit',
  'control:test': 'test',
  'control:retire': 'retire',
};

/** Where a right-click landed, and on which row. */
export interface TaskAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: ChecklistRow;
}

/**
 * The same, for a register row.
 *
 * A second anchor rather than one widened to both subjects, because a menu is drawn
 * from what it is about: the checklist's entries read a `ChecklistRow`, the register's
 * read a `FinancialControl`, and a union would make every entry test which it got.
 */
export interface ControlAnchor {
  readonly x: number;
  readonly y: number;
  readonly control: FinancialControl;
}

/** The three statuses `complete_close_task` accepts, in the table's own spelling. */
const TASK_COMMAND: Readonly<Record<string, string | undefined>> = {
  certify: 'certified',
  start: 'in_progress',
  block: 'blocked',
};

/* ------------------------------------------------------------------ *
 * The register's forms
 * ------------------------------------------------------------------ */

/** Which of the register's three forms is open. */
export type ControlDialog = 'edit' | 'test' | 'retire';

/**
 * Everything the three forms can hold, in one object.
 *
 * One draft rather than three because one form is open at a time, and three states
 * that must be cleared in step is three chances to leave a stale value behind — the
 * failure mode being a retire reason from an hour ago arriving with the next retire.
 */
export interface ControlDraft {
  readonly code: string;
  readonly description: string;
  readonly ownerRole: string;
  readonly frequency: ControlFrequency;
  readonly result: ControlResult;
  readonly population: string;
  readonly exceptions: string;
  readonly note: string;
  readonly reason: string;
}

const EMPTY_DRAFT: ControlDraft = {
  code: '',
  description: '',
  ownerRole: '',
  frequency: 'monthly',
  result: 'passed',
  population: '',
  exceptions: '',
  note: '',
  reason: '',
};

interface ControlUi {
  readonly dialog: ControlDialog | null;
  /**
   * The control the open form is about, held rather than looked up again.
   *
   * A commit that re-read `model.selectedControl` would be reading a list that may have
   * refetched while the form was open. The row that was pressed is the subject, and its
   * id is what the three commands take.
   */
  readonly target: FinancialControl | null;
  readonly draft: ControlDraft;
  setDraft: (patch: Partial<ControlDraft>) => void;
  openDialog: (which: ControlDialog, control: FinancialControl | null) => void;
  closeDialog: () => void;
}

function useControlUi(): ControlUi {
  const [dialog, setDialog] = useState<ControlDialog | null>(null);
  const [target, setTarget] = useState<FinancialControl | null>(null);
  const [draft, setState] = useState<ControlDraft>(EMPTY_DRAFT);

  const setDraft = useCallback((patch: Partial<ControlDraft>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const openDialog = useCallback((which: ControlDialog, control: FinancialControl | null) => {
    // The edit form opens on the row, because `controls.upsert` is a PUT: it writes all
    // four fields every time, so a form that started blank would erase the description
    // of anyone who only meant to change the frequency.
    //
    // The test form deliberately does not prefill. Last month's population and
    // exceptions are evidence of last month's test, and carrying them forward invites
    // signing an assurance for work nobody did.
    setState(
      which === 'edit' && control !== null
        ? {
            ...EMPTY_DRAFT,
            code: control.code,
            description: control.description,
            ownerRole: control.ownerRole ?? '',
            frequency: control.frequency,
          }
        : EMPTY_DRAFT,
    );
    setTarget(control);
    setDialog(which);
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  return { dialog, target, draft, setDraft, openDialog, closeDialog };
}

/** The three commits, kept out of `useCloseShell` so that function stays readable. */
interface ControlCommits {
  saveControl: () => void;
  recordTest: () => void;
  confirmRetire: () => void;
}

function useControlCommits(actions: CloseActions, ui: ControlUi): ControlCommits {
  const { draft, target, closeDialog } = ui;

  const saveControl = useCallback(() => {
    // The broker requires a non-empty code, so a blank one is refused here rather than
    // sent to be refused there.
    if (draft.code.trim() === '') return;
    void actions
      .saveControl({
        controlId: target?.id ?? null,
        code: draft.code.trim(),
        description: draft.description.trim(),
        ownerRole: draft.ownerRole.trim(),
        frequency: draft.frequency,
      })
      .then((ok) => {
        if (ok) closeDialog();
      });
  }, [actions, closeDialog, draft, target]);

  const recordTest = useCallback(() => {
    if (target === null) return;
    void actions
      .recordTest({
        controlId: target.id,
        code: target.code,
        result: draft.result,
        population: draft.population.trim(),
        exceptions: draft.exceptions.trim(),
        note: draft.note.trim(),
      })
      .then((ok) => {
        if (ok) closeDialog();
      });
  }, [actions, closeDialog, draft, target]);

  const confirmRetire = useCallback(() => {
    const reason = draft.reason.trim();
    // `retire_financial_control_command` refuses to run without a reason, which is why
    // there is a form here at all — it is not a confirmation.
    if (target === null || reason === '') return;
    void actions.retireControl(target.id, reason).then((ok) => {
      // A refused retire keeps the form and the reason: the server's message says what
      // was wrong, and retyping it is not part of the answer.
      if (ok) closeDialog();
    });
  }, [actions, closeDialog, draft.reason, target]);

  return { saveControl, recordTest, confirmRetire };
}

export interface CloseShell {
  readonly model: CloseModel;
  readonly view: CloseView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: CloseBusy;
  readonly selectedTask: ChecklistRow | null;
  readonly menu: TaskAnchor | null;
  readonly controlMenu: ControlAnchor | null;
  /** The reason dialog is open, which is the only thing standing in front of a reopen. */
  readonly reopening: boolean;
  readonly reason: string;
  readonly filtered: boolean;
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly canCertify: boolean;
  /** Which of the register's three forms is open, and what it is about. */
  readonly controlDialog: ControlDialog | null;
  readonly controlTarget: FinancialControl | null;
  readonly draft: ControlDraft;
  /**
   * Testing a retired control is refused here rather than at the server, which would
   * take it: a control nobody runs any more has nothing to assure, and recording a test
   * against it puts evidence in the register for work that is out of scope.
   */
  readonly canTest: boolean;
  /** `retire_financial_control_command` refuses a second retire; the button agrees. */
  readonly canRetire: boolean;
  /**
   * The clock the register is read against, taken once at mount.
   *
   * `controlState` needs a `now` to say whether a test is overdue, and every surface
   * that shows a state — the grid, the pane, the CSV, the clipboard — has to be read
   * against the same one, or a row and its own export could disagree. Taken at mount
   * rather than per render so that drawing the grid stays pure; the cost is that a
   * window left open across a due date needs `F5`, which is what `F5` is for.
   */
  readonly now: number;
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
  openControlMenu: (control: FinancialControl, event: MouseEvent) => void;
  closeControlMenu: () => void;
  confirmReopen: () => void;
  cancelReopen: () => void;
  copyTrail: (row: AuditRow) => void;
  pickControl: (controlId: string | null) => void;
  setDraft: (patch: Partial<ControlDraft>) => void;
  openControl: (which: ControlDialog, control: FinancialControl | null) => void;
  closeControl: () => void;
  saveControl: () => void;
  recordTest: () => void;
  confirmRetire: () => void;
  copyControl: (control: FinancialControl) => void;
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
  if (view === 'tasks') return model.visibleTasks.length;
  return view === 'controls' ? model.visibleControls.length : model.visibleTrail.length;
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
  readonly controlMenu: ControlAnchor | null;
  readonly reopening: boolean;
  readonly reason: string;
  setSearch: (next: string) => void;
  setReason: (next: string) => void;
  setReopening: (next: boolean) => void;
  pickPeriod: (periodId: string) => void;
  pickTask: (taskId: string | null) => void;
  pickControl: (controlId: string | null) => void;
  changeView: (next: CloseView) => void;
  openMenu: (row: ChecklistRow, event: MouseEvent) => void;
  closeMenu: () => void;
  openControlMenu: (control: FinancialControl, event: MouseEvent) => void;
  closeControlMenu: () => void;
}

function useCloseUi(): CloseUi {
  const [view, setView] = useState<CloseView>('checks');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<CloseSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<TaskAnchor | null>(null);
  const [controlMenu, setControlMenu] = useState<ControlAnchor | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  const pickPeriod = useCallback((periodId: string) => {
    // The checklist belongs to the book rather than to one month, so a row picked
    // against March is not wrong once April is on screen — it is just not the subject
    // any more, and the pane would go on arguing about it.
    //
    // The control selection is kept, because the register and a control's test history
    // are period-independent: the same control is the subject in every month.
    setSelection((current) => ({ ...current, periodId, taskId: null }));
  }, []);
  usePeriodFocus(pickPeriod);

  const pickTask = useCallback((taskId: string | null) => {
    setSelection((current) => ({ ...current, taskId }));
  }, []);

  const pickControl = useCallback((controlId: string | null) => {
    setSelection((current) => ({ ...current, controlId }));
  }, []);

  const changeView = useCallback((next: CloseView) => {
    // The searches mean different things in each view — a task name, a control code, an
    // audit action — so carrying one across would filter against the wrong vocabulary.
    setSearch('');
    setView(next);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: ChecklistRow, event: MouseEvent) => {
    event.preventDefault();
    setSelection((current) => ({ ...current, taskId: row.task.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  const closeControlMenu = useCallback(() => setControlMenu(null), []);

  // Selecting as well as anchoring, the same as the checklist does: the toolbar's own
  // two acts read the selection, and a right-click that opened a menu without moving it
  // would leave the toolbar describing a different row than the menu in front of it.
  const openControlMenu = useCallback((control: FinancialControl, event: MouseEvent) => {
    event.preventDefault();
    setSelection((current) => ({ ...current, controlId: control.id }));
    setControlMenu({ x: event.clientX, y: event.clientY, control });
  }, []);

  return {
    view,
    search,
    selection,
    menu,
    controlMenu,
    reopening,
    reason,
    setSearch,
    setReason,
    setReopening,
    pickPeriod,
    pickTask,
    pickControl,
    changeView,
    openMenu,
    closeMenu,
    openControlMenu,
    closeControlMenu,
  };
}

/* ------------------------------------------------------------------ *
 * The command path
 *
 * One press, whatever raised it — a toolbar button, a menu item, a jump
 * list entry or an accelerator — arrives at `perform`. Everything below
 * is that one function and the things it needs.
 * ------------------------------------------------------------------ */

/**
 * What the command path needs, which is most of the app.
 *
 * A long parameter list rather than the whole shell, because the difference is the
 * point: this hook reads the model and calls the acts, and it does not own any state
 * of its own. Everything mutable arrives as a setter somebody else holds.
 */
interface CommandDeps {
  readonly view: CloseView;
  readonly model: CloseModel;
  readonly actions: CloseActions;
  readonly today: string;
  readonly now: number;
  readonly t: Label;
  readonly tr: Translate;
  /** Read, never written: `find` focuses the box and nothing here re-points it. */
  readonly searchRef: { readonly current: HTMLInputElement | null };
  readonly changeView: (next: CloseView) => void;
  readonly pickPeriod: (periodId: string) => void;
  readonly setReason: (reason: string) => void;
  readonly setReopening: (open: boolean) => void;
  readonly openDialog: (which: ControlDialog, control: FinancialControl | null) => void;
}

interface CloseCommands {
  /** Exposed because the checks pane calls it on a row, not through a command id. */
  fix: (id: CheckId) => void;
  /** A press with an explicit row — the context menu's path. */
  perform: (id: string, row: ChecklistRow | null) => void;
  /** A press without one, which means the selected task if there is one. */
  command: (id: string) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

function useCloseCommandPath(deps: CommandDeps): CloseCommands {
  const { view, model, actions, today, now, t, tr } = deps;
  const { searchRef, changeView, pickPeriod, setReason, setReopening, openDialog } = deps;

  /** "Export" means the view in front of the person, and nothing else. */
  const exportView = useCallback(() => {
    // The register is a snapshot rather than a month's artefact, so it is filed by the
    // day it was taken. Passing no period is what puts `today` in the name.
    const name = suggestedFileName(view === 'controls' ? null : model.period, view, today);
    if (view === 'tasks') actions.exportCsv(checklistCsv(model.visibleTasks, t, tr), name);
    else if (view === 'trail') actions.exportCsv(trailCsv(model.visibleTrail, tr), name);
    else if (view === 'controls') actions.exportCsv(controlCsv(model.visibleControls, now, t, tr), name);
    else actions.exportCsv(checkCsv(model.assessment.checks, model.period, t, tr), name);
  }, [
    actions,
    model.assessment.checks,
    model.period,
    model.visibleControls,
    model.visibleTasks,
    model.visibleTrail,
    now,
    t,
    today,
    tr,
    view,
  ]);

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
        // Copy means the thing in front of the person, the same as export does.
        const selected = model.selectedControl;
        actions.copy(
          view === 'controls' && selected !== null
            ? controlClipboardText(selected, now, t, tr)
            : summaryClipboardText(model.period, model.assessment, t, tr),
        );
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
      const form = CONTROL_DIALOG[id];
      if (form !== undefined) {
        // `control:new` is the one that opens on nothing. The other two are about the
        // selected row, and without one there is nothing to open them on — the toolbar
        // disables them, and the accelerator has to agree.
        const target = id === 'control:new' ? null : model.selectedControl;
        if (target === null && id !== 'control:new') return;
        openDialog(form, target);
        return;
      }
      if (row !== null) actOn(id, row);
    },
    [actOn, actions, changeView, exportView, model, now, openDialog, searchRef, setReason, setReopening, t, tr, view],
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

  return { fix, perform, command, keyDown };
}

export function useCloseShell(): CloseShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const now = useMemo(() => Date.now(), []);

  const ui = useCloseUi();
  const { view, search, menu, reopening, reason, selection } = ui;
  const { setSearch, setReason, setReopening, pickPeriod, pickTask, changeView, openMenu, closeMenu } = ui;
  const { pickControl, controlMenu, openControlMenu, closeControlMenu } = ui;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useCloseActions();
  const model = useCloseModel(view, search, selection);
  const control = useControlUi();
  const commits = useControlCommits(actions, control);
  const { openDialog } = control;

  const { fix, perform, command, keyDown } = useCloseCommandPath({
    view,
    model,
    actions,
    today,
    now,
    t,
    tr,
    searchRef,
    changeView,
    pickPeriod,
    setReason,
    setReopening,
    openDialog,
  });

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

  const copyControl = useCallback(
    (row: FinancialControl) => actions.copy(controlClipboardText(row, now, t, tr)),
    [actions, now, t, tr],
  );

  // Both register acts need the same thing — a selected control that is still live — but
  // they stay two fields because they are two judgements: the server refuses a second
  // retire, while refusing a test on a retired control is this app's own reading.
  const liveControl = model.selectedControl !== null && !model.selectedControl.retired;

  return {
    model,
    view,
    search,
    searchRef,
    busy: actions.busy,
    selectedTask: model.selectedTask,
    menu,
    controlMenu,
    reopening,
    reason,
    filtered: search.trim() !== '',
    canClose: model.assessment.closable,
    canReopen: model.assessment.sealed,
    canCertify: model.selectedTask !== null && model.selectedTask.actionable,
    controlDialog: control.dialog,
    controlTarget: control.target,
    draft: control.draft,
    canTest: liveControl,
    canRetire: liveControl,
    now,
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
    openControlMenu,
    closeControlMenu,
    confirmReopen,
    cancelReopen,
    copyTrail,
    pickControl,
    setDraft: control.setDraft,
    openControl: openDialog,
    closeControl: control.closeDialog,
    saveControl: commits.saveControl,
    recordTest: commits.recordTest,
    confirmRetire: commits.confirmRetire,
    copyControl,
  };
}
