/**
 * Period close — the reads.
 *
 * Seven queries, and the shape of them is the gate itself: whatever the checklist
 * asks, something here has to have loaded. The period's own entries, the entries that
 * belong to *no* period, every bank statement, the whole-book trial balance, the
 * month's tasks, the periods themselves, and — only when somebody opens that view —
 * the audit trail.
 *
 * The orphan query is the one worth explaining. `where` speaks equality, `in` and
 * `is null`; there is no `between`. So "entries dated inside March but attached to no
 * period" is asked as `fiscal_period_id is null`, ordered by date, then narrowed here.
 * That query is cheap and the answer matters: those entries will sit outside every
 * close that ever runs.
 *
 * `useDataset` rather than `useMappedDataset` for the period's entries alone, because
 * the status bar says when the book was last read and only the raw hook carries
 * `fetchedAt`.
 */
import { useMemo } from 'react';
import { type DatasetRow, useDataset, useMappedDataset } from '@/platform/sdk';
import { asString, str } from '../shared/guards';
import {
  type ControlTest,
  type FinancialControl,
  toControlTest,
  toFinancialControl,
} from './controls';
import {
  type BankStatement,
  type CloseTask,
  type FiscalPeriod,
  type JournalEntry,
  toBankStatement,
  toCloseTask,
  toEntry,
  toPeriod,
  toTrialRow,
  type TrialRow,
} from '../shared/ledger';
import { assess, checklist, type ChecklistRow, type CloseAssessment } from './checks';

/** Ten years of monthly periods and room over. */
export const PERIOD_LIMIT = 120;
/** Tasks in one checklist. A close pack past this is a project, not a month. */
export const TASK_LIMIT = 300;
/** Entries of the selected period. The broker's own page ceiling. */
export const ENTRY_LIMIT = 500;
/** Candidate orphans: entries attached to no period at all, newest first. */
export const ORPHAN_LIMIT = 300;
/** Statements across every bank, newest first. */
export const STATEMENT_LIMIT = 200;
/** Accounts in the trial balance. Past this the whole-book test is skipped. */
export const TRIAL_LIMIT = 500;
/** Audit rows behind the trail view. */
export const TRAIL_LIMIT = 200;
/** Controls in one register. A register past this is a framework, not a register. */
export const CONTROL_LIMIT = 300;
/** Test history of the selected control, newest first. */
export const TEST_LIMIT = 100;

export type CloseView = 'checks' | 'tasks' | 'trail' | 'controls';

export interface CloseSelection {
  readonly periodId: string | null;
  readonly taskId: string | null;
  readonly controlId: string | null;
}

/**
 * One audit row, as the kernel's `auditTrail` projection hands it over.
 *
 * Mapped here rather than in `shared/ledger` because this is the only finance app
 * that reads the log directly — Event Viewer reads the *kernel's* log, which is a
 * different table with a different shape.
 */
export interface AuditRow {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly email: string;
  readonly requestId: string | null;
}

export function toAuditRow(row: DatasetRow): AuditRow | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    // `timestamp` is when it happened; `created_at` is when the row landed. The
    // first is the truth and the second is the fallback.
    at: str(row.timestamp) === '' ? str(row.created_at) : str(row.timestamp),
    action: str(row.action),
    resource: str(row.resource),
    resourceId: asString(row.resource_id),
    email: str(row.user_email),
    requestId: asString(row.request_id),
  };
}

/* ------------------------------------------------------------------ *
 * The controls register
 *
 * Its vocabulary — the row shapes, the mappers, and the `controlState`
 * judgement — lives in `./controls`, which holds no hooks, so the CSV
 * writer and the grid can read the same rules without importing a query.
 * What is left here is what needs a query: the two reads below.
 * ------------------------------------------------------------------ */

export interface CloseModel {
  readonly periods: readonly FiscalPeriod[];
  readonly period: FiscalPeriod | null;
  readonly tasks: readonly CloseTask[];
  /** The checklist in dependency order, each row carrying why it is or is not ready. */
  readonly checklist: readonly ChecklistRow[];
  readonly visibleTasks: readonly ChecklistRow[];
  readonly assessment: CloseAssessment;
  readonly trail: readonly AuditRow[];
  readonly visibleTrail: readonly AuditRow[];
  readonly selectedTask: ChecklistRow | null;
  readonly statements: readonly BankStatement[];
  readonly controls: readonly FinancialControl[];
  readonly visibleControls: readonly FinancialControl[];
  readonly selectedControl: FinancialControl | null;
  /** History of the selected control only. Loading every control's tests is a table scan. */
  readonly controlTests: readonly ControlTest[];
  readonly controlsLoading: boolean;
  readonly testsLoading: boolean;
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly trailLoading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

const matchesText = (needle: string, ...fields: readonly string[]): boolean =>
  fields.some((field) => field.toLowerCase().includes(needle));

function filterTasks(rows: readonly ChecklistRow[], search: string): readonly ChecklistRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) =>
    matchesText(needle, row.task.name, row.task.ownerId ?? '', row.task.dependencies.join(' ')),
  );
}

function filterTrail(rows: readonly AuditRow[], search: string): readonly AuditRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) => matchesText(needle, row.action, row.resource, row.email, row.at));
}

function filterControls(
  rows: readonly FinancialControl[],
  search: string,
): readonly FinancialControl[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) =>
    matchesText(needle, row.code, row.description, row.ownerRole ?? '', row.frequency),
  );
}

export function useCloseModel(view: CloseView, search: string, selection: CloseSelection): CloseModel {
  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, {
    limit: PERIOD_LIMIT,
    orderBy: { column: 'start_date', ascending: false },
  });
  const periods = periodQuery.rows;
  const period = useMemo(() => {
    const chosen = periods.find((row) => row.id === selection.periodId);
    if (chosen !== undefined) return chosen;
    // The month being closed is the newest one still open. A book with every period
    // closed opens on the newest anyway, because that is the one somebody reopens.
    return periods.find((row) => row.status !== 'closed') ?? periods[0] ?? null;
  }, [periods, selection.periodId]);

  const entryPage = useDataset('journalEntries', {
    where: { fiscal_period_id: period?.id ?? '' },
    limit: ENTRY_LIMIT,
    enabled: period !== null,
  });
  const entries = useMemo(() => {
    const out: JournalEntry[] = [];
    for (const row of entryPage.rows) {
      const mapped = toEntry(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [entryPage.rows]);

  const orphanQuery = useMappedDataset('journalEntries', toEntry, {
    where: { fiscal_period_id: null },
    limit: ORPHAN_LIMIT,
    enabled: period !== null,
  });

  const statementQuery = useMappedDataset('bankStatements', toBankStatement, {
    limit: STATEMENT_LIMIT,
    orderBy: { column: 'statement_date', ascending: false },
  });
  const taskQuery = useMappedDataset('closeTasks', toCloseTask, { limit: TASK_LIMIT });

  // Raw rather than mapped, because the completeness of this page decides whether the
  // whole-book control total is answered at all: a mapper that dropped a row would
  // make a full page look like a short one.
  const trialPage = useDataset('trialBalance', { limit: TRIAL_LIMIT });
  const trial = useMemo(() => {
    const out: TrialRow[] = [];
    for (const row of trialPage.rows) {
      const mapped = toTrialRow(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [trialPage.rows]);

  const trailPage = useDataset('auditTrail', { limit: TRAIL_LIMIT, enabled: view === 'trail' });
  const trail = useMemo(() => {
    const out: AuditRow[] = [];
    for (const row of trailPage.rows) {
      const mapped = toAuditRow(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [trailPage.rows]);

  const controlQuery = useMappedDataset('financialControls', toFinancialControl, {
    limit: CONTROL_LIMIT,
    enabled: view === 'controls',
  });
  const controls = controlQuery.rows;
  const selectedControl = useMemo(
    () => controls.find((row) => row.id === selection.controlId) ?? null,
    [controls, selection.controlId],
  );

  // The history follows the selection, not the view: nothing is loaded until a control is
  // open, and `where` reaching `control_id` is the whole reason this is a table
  // projection rather than an RPC.
  const testQuery = useMappedDataset('controlTests', toControlTest, {
    where: { control_id: selectedControl?.id ?? '' },
    limit: TEST_LIMIT,
    enabled: view === 'controls' && selectedControl !== null,
  });

  const rows = useMemo(() => checklist(taskQuery.rows), [taskQuery.rows]);
  const assessment = useMemo(
    () =>
      assess({
        period,
        periods,
        entries,
        orphans: orphanQuery.rows,
        statements: statementQuery.rows,
        tasks: taskQuery.rows,
        trial,
        trialComplete: trialPage.rows.length < TRIAL_LIMIT,
      }),
    [period, periods, entries, orphanQuery.rows, statementQuery.rows, taskQuery.rows, trial, trialPage.rows.length],
  );

  const visibleTasks = useMemo(() => filterTasks(rows, search), [rows, search]);
  const visibleTrail = useMemo(() => filterTrail(trail, search), [trail, search]);
  const visibleControls = useMemo(() => filterControls(controls, search), [controls, search]);
  const selectedTask = useMemo(
    () => rows.find((row) => row.task.id === selection.taskId) ?? null,
    [rows, selection.taskId],
  );

  const refresh = () => {
    periodQuery.refetch();
    entryPage.refetch();
    orphanQuery.refetch();
    statementQuery.refetch();
    taskQuery.refetch();
    trialPage.refetch();
    trailPage.refetch();
    controlQuery.refetch();
    testQuery.refetch();
  };

  return {
    periods,
    period,
    tasks: taskQuery.rows,
    checklist: rows,
    visibleTasks,
    assessment,
    trail,
    visibleTrail,
    selectedTask,
    statements: statementQuery.rows,
    controls,
    visibleControls,
    selectedControl,
    controlTests: testQuery.rows,
    controlsLoading: controlQuery.loading,
    testsLoading: testQuery.loading,
    truncated:
      entryPage.rows.length >= ENTRY_LIMIT ||
      orphanQuery.rows.length >= ORPHAN_LIMIT ||
      trialPage.rows.length >= TRIAL_LIMIT,
    loading: periodQuery.loading || entryPage.loading || taskQuery.loading,
    trailLoading: trailPage.loading,
    error:
      periodQuery.error ??
      entryPage.error ??
      taskQuery.error ??
      orphanQuery.error ??
      statementQuery.error ??
      trialPage.error ??
      trailPage.error ??
      controlQuery.error ??
      testQuery.error,
    fetchedAt: entryPage.fetchedAt,
    refresh,
  };
}
