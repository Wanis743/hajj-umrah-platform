/**
 * Period close — the gate.
 *
 * Everything somebody checks before drawing the line under a month, computed from
 * what the book already says. Seven questions, in the order a closer asks them: is
 * an earlier month still open, is anything in this one still in draft, is anything
 * dated inside it not assigned to it at all, do the period's control totals agree,
 * does the whole book still balance, is every bank statement reconciled, and has
 * every task been signed off.
 *
 * None of it is enforced here. `close_fiscal_period` owns the rules, and this module
 * cannot see its body — so a `fail` means "somebody will ask you about this", not
 * "the server will refuse". The window states the finding and leaves the press to
 * the person; the only thing it actually disables is closing what is already closed.
 *
 * Dependencies are the subtle part. `close_tasks.dependencies` holds task *names*,
 * not ids, and `complete_close_task` certifies a task only when every name it lists
 * belongs to a task that is already certified. A name matching no task at all can
 * therefore never be satisfied — which makes it a data problem worth showing rather
 * than a sequence to work through.
 */
import {
  type BankStatement,
  type CloseTask,
  EPSILON,
  type FiscalPeriod,
  type JournalEntry,
  type TrialRow,
  withinPeriod,
} from '../shared/ledger';
import { text } from '../shared/manifest';
import type { Localized } from '@/platform/sdk';

/** Names are matched the way people type them, not the way they were stored. */
const normalise = (name: string): string => name.trim().toLowerCase();

/** The month's tasks, keyed by the name other tasks would refer to them by. */
export function taskIndex(tasks: readonly CloseTask[]): ReadonlyMap<string, CloseTask> {
  const out = new Map<string, CloseTask>();
  for (const task of tasks) out.set(normalise(task.name), task);
  return out;
}

export interface ChecklistRow {
  readonly task: CloseTask;
  /** How far down the dependency chain, so the list reads in the order it is worked. */
  readonly depth: number;
  /** Names that are not certified yet — the reason this row cannot be signed. */
  readonly unmet: readonly string[];
  /** Names matching no task at all: unsatisfiable, so worth saying out loud. */
  readonly missing: readonly string[];
  readonly actionable: boolean;
}

/**
 * Longest chain of certifications standing in front of this task.
 *
 * `seen` is not an optimisation — a checklist that names itself, directly or around a
 * loop, is data somebody can enter, and the recursion has to come back from it. A
 * back-edge counts as depth zero, which puts the cycle at the top of the list where
 * it will be noticed.
 */
function depthOf(
  name: string,
  index: ReadonlyMap<string, CloseTask>,
  memo: Map<string, number>,
  seen: Set<string>,
): number {
  const cached = memo.get(name);
  if (cached !== undefined) return cached;
  const task = index.get(name);
  if (task === undefined || seen.has(name)) return 0;
  seen.add(name);
  let deepest = 0;
  for (const dependency of task.dependencies) {
    const below = depthOf(normalise(dependency), index, memo, seen) + 1;
    if (below > deepest) deepest = below;
  }
  seen.delete(name);
  memo.set(name, deepest);
  return deepest;
}

/** The checklist, in dependency order, each row carrying why it is or is not ready. */
export function checklist(tasks: readonly CloseTask[]): readonly ChecklistRow[] {
  const index = taskIndex(tasks);
  const memo = new Map<string, number>();
  const rows = tasks.map((task): ChecklistRow => {
    const unmet: string[] = [];
    const missing: string[] = [];
    for (const dependency of task.dependencies) {
      const key = normalise(dependency);
      if (key === '') continue;
      const found = index.get(key);
      if (found === undefined) {
        missing.push(dependency);
        unmet.push(dependency);
      } else if (found.status !== 'certified') {
        unmet.push(dependency);
      }
    }
    return {
      task,
      depth: depthOf(normalise(task.name), index, memo, new Set<string>()),
      unmet,
      missing,
      actionable: task.status !== 'certified' && unmet.length === 0,
    };
  });
  return rows.sort((a, b) => a.depth - b.depth || a.task.name.localeCompare(b.task.name));
}

/* ------------------------------------------------------------------ *
 * The seven questions
 * ------------------------------------------------------------------ */

export type CheckId = 'earlier' | 'unposted' | 'orphans' | 'balance' | 'book' | 'statements' | 'tasks';

/** `fail` is "somebody will ask about this", never "the server will refuse". */
export type CheckState = 'pass' | 'warn' | 'fail' | 'skip';

export interface CloseCheck {
  readonly id: CheckId;
  readonly state: CheckState;
  /** Rows standing in the way — zero when the answer is yes. */
  readonly count: number;
  /** The gap, for the two control totals; `null` for the counting questions. */
  readonly amount: number | null;
}

export interface CloseInputs {
  readonly period: FiscalPeriod | null;
  readonly periods: readonly FiscalPeriod[];
  /** Entries assigned to the period, whatever their status. */
  readonly entries: readonly JournalEntry[];
  /** Entries assigned to no period at all; filtered to this window here. */
  readonly orphans: readonly JournalEntry[];
  /** Statements across all banks; filtered to this window here. */
  readonly statements: readonly BankStatement[];
  readonly tasks: readonly CloseTask[];
  readonly trial: readonly TrialRow[];
  /**
   * False when the trial balance came back at the broker's page ceiling.
   *
   * A control total computed over part of the book is not a weaker control total, it
   * is a wrong one — so the whole-book test is skipped rather than answered badly.
   */
  readonly trialComplete: boolean;
}

interface EntryTotals {
  readonly posted: number;
  readonly unposted: number;
  readonly voided: number;
  readonly debit: number;
  readonly credit: number;
}

/** Control totals over posted entries only: a draft is not part of the month yet. */
function entryTotals(entries: readonly JournalEntry[]): EntryTotals {
  let posted = 0;
  let unposted = 0;
  let voided = 0;
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    if (entry.status === 'void') {
      voided += 1;
    } else if (entry.status === 'posted') {
      posted += 1;
      debit += entry.debit;
      credit += entry.credit;
    } else {
      unposted += 1;
    }
  }
  return { posted, unposted, voided, debit, credit };
}

interface TaskTotals {
  readonly total: number;
  readonly certified: number;
  readonly blocked: number;
  readonly open: number;
}

function taskTotals(tasks: readonly CloseTask[]): TaskTotals {
  let certified = 0;
  let blocked = 0;
  for (const task of tasks) {
    if (task.status === 'certified') certified += 1;
    else if (task.status === 'blocked') blocked += 1;
  }
  return { total: tasks.length, certified, blocked, open: tasks.length - certified };
}

/** Debits against credits, across whatever slice of the book was handed over. */
function gap(rows: readonly TrialRow[]): number {
  let debit = 0;
  let credit = 0;
  for (const row of rows) {
    debit += row.debit;
    credit += row.credit;
  }
  return debit - credit;
}

export interface CloseAssessment {
  readonly checks: readonly CloseCheck[];
  readonly failures: number;
  readonly warnings: number;
  /** No failures — which is an opinion, not a permission. */
  readonly ready: boolean;
  readonly debit: number;
  readonly credit: number;
  readonly difference: number;
  readonly bookDifference: number;
  readonly posted: number;
  readonly unposted: number;
  readonly voided: number;
  readonly orphans: number;
  readonly openStatements: number;
  readonly earlierOpen: number;
  readonly taskTotal: number;
  readonly certified: number;
  readonly blocked: number;
  readonly openTasks: number;
  readonly sealed: boolean;
  /** The one hard gate: a closed period is not closed twice. */
  readonly closable: boolean;
}

const verdict = (bad: boolean, severity: 'warn' | 'fail'): CheckState => (bad ? severity : 'pass');

interface WindowCounts {
  readonly orphans: number;
  readonly openStatements: number;
  readonly earlierOpen: number;
}

/**
 * The three questions that need the period's dates rather than its id.
 *
 * The broker's `where` speaks equality, `in` and `is null` — there is no
 * `between` — so a date window is always narrowed here, over a page the server
 * already ordered. An orphan entry is the one that matters: dated inside the month,
 * assigned to no period, and therefore about to end up on the wrong side of a line
 * that has already been drawn.
 */
function windowCounts(inputs: CloseInputs): WindowCounts {
  const period = inputs.period;
  if (period === null) return { orphans: 0, openStatements: 0, earlierOpen: 0 };
  return {
    orphans: inputs.orphans.filter((row) => row.status !== 'void' && withinPeriod(period, row.date)).length,
    openStatements: inputs.statements.filter((row) => row.status === 'draft' && withinPeriod(period, row.date)).length,
    earlierOpen: inputs.periods.filter(
      (row) => row.id !== period.id && row.end < period.start && row.status !== 'closed',
    ).length,
  };
}

export function assess(inputs: CloseInputs): CloseAssessment {
  const period = inputs.period;
  const entries = entryTotals(inputs.entries);
  const tasks = taskTotals(inputs.tasks);
  const window = windowCounts(inputs);
  const difference = entries.debit - entries.credit;
  const bookDifference = gap(inputs.trial);

  const checks: readonly CloseCheck[] = [
    { id: 'earlier', state: verdict(window.earlierOpen > 0, 'fail'), count: window.earlierOpen, amount: null },
    { id: 'unposted', state: verdict(entries.unposted > 0, 'fail'), count: entries.unposted, amount: null },
    { id: 'orphans', state: verdict(window.orphans > 0, 'warn'), count: window.orphans, amount: null },
    {
      id: 'balance',
      state: verdict(Math.abs(difference) > EPSILON, 'fail'),
      count: entries.posted,
      amount: difference,
    },
    {
      id: 'book',
      state: inputs.trialComplete ? verdict(Math.abs(bookDifference) > EPSILON, 'fail') : 'skip',
      count: inputs.trial.length,
      amount: inputs.trialComplete ? bookDifference : null,
    },
    { id: 'statements', state: verdict(window.openStatements > 0, 'warn'), count: window.openStatements, amount: null },
    { id: 'tasks', state: verdict(tasks.open > 0, 'fail'), count: tasks.open, amount: null },
  ];

  const failures = checks.filter((check) => check.state === 'fail').length;
  return {
    checks,
    failures,
    warnings: checks.filter((check) => check.state === 'warn').length,
    ready: failures === 0,
    debit: entries.debit,
    credit: entries.credit,
    difference,
    bookDifference,
    posted: entries.posted,
    unposted: entries.unposted,
    voided: entries.voided,
    orphans: window.orphans,
    openStatements: window.openStatements,
    earlierOpen: window.earlierOpen,
    taskTotal: tasks.total,
    certified: tasks.certified,
    blocked: tasks.blocked,
    openTasks: tasks.open,
    sealed: period !== null && period.status === 'closed',
    closable: period !== null && period.status !== 'closed',
  };
}

/* ------------------------------------------------------------------ *
 * How the seven questions are worded
 * ------------------------------------------------------------------ *
 * One source for the grid, the summary pane and the exported CSV — three places a
 * closing checklist gets read, and three chances for the same test to be called
 * something slightly different.
 */

/** The four verdicts, worded once for the grid, the summary pane and the export. */
export const CHECK_STATE_LABEL: Readonly<Record<CheckState, Localized>> = {
  pass: text('مطابق', 'Conforme', 'Pass'),
  warn: text('تحذير', 'Avertissement', 'Warning'),
  fail: text('عائق', 'Obstacle', 'Blocker'),
  skip: text('لم يُنفَّذ', 'Non exécuté', 'Not run'),
};

export const CHECK_LABEL: Readonly<Record<CheckId, Localized>> = {
  earlier: text('فترات سابقة مفتوحة', 'Périodes antérieures ouvertes', 'Earlier periods still open'),
  unposted: text('قيود غير مرحّلة', 'Écritures non comptabilisées', 'Entries not posted'),
  orphans: text('قيود بلا فترة', 'Écritures sans période', 'Entries assigned to no period'),
  balance: text('مدين الفترة = دائنها', 'Débit = crédit sur la période', 'The period’s debits equal its credits'),
  book: text('ميزان المراجعة العام', 'Balance générale', 'The book still balances'),
  statements: text('كشوف غير مطابقة', 'Relevés non rapprochés', 'Statements not reconciled'),
  tasks: text('مهام غير مصدّقة', 'Tâches non certifiées', 'Tasks not signed off'),
};

export const CHECK_HINT: Readonly<Record<CheckId, Localized>> = {
  earlier: text(
    'إقفال شهر قبل الذي يسبقه يترك ثغرة في التتبّع.',
    "Clôturer un mois avant celui qui le précède laisse un trou dans la piste d'audit.",
    'Closing a month before the one before it leaves a hole in the audit trail.',
  ),
  unposted: text(
    'المسوّدة ليست جزءًا من الشهر بعد، وبعد الإقفال لن تصبح كذلك.',
    "Un brouillon ne fait pas encore partie du mois — et après la clôture, il n'en fera jamais partie.",
    'A draft is not part of the month yet, and after the close it never will be.',
  ),
  orphans: text(
    'قيد بتاريخ داخل الشهر وغير مرتبط بأي فترة يبقى خارج كل إقفال.',
    'Une écriture datée dans le mois mais rattachée à aucune période échappe à toutes les clôtures.',
    'An entry dated inside the month but attached to no period escapes every close.',
  ),
  balance: text(
    'مجموع المدين ومجموع الدائن للقيود المرحّلة في هذه الفترة.',
    'Le total débit et le total crédit des écritures comptabilisées de la période.',
    'Total debits against total credits, over this period’s posted entries.',
  ),
  book: text(
    'نفس الاختبار على الدفتر بأكمله؛ فرق هنا يسبق هذه الفترة.',
    'Le même test sur tout le livre : un écart ici est antérieur à cette période.',
    'The same test across the whole book: a gap here predates this period.',
  ),
  statements: text(
    'كشف ما زال مسوّدة يعني نقدية لم يؤكّدها البنك.',
    "Un relevé encore en brouillon, c'est de la trésorerie que la banque n'a pas confirmée.",
    'A statement still in draft is cash the bank has not confirmed.',
  ),
  tasks: text(
    'قائمة الإقفال هي ما يوقّعه شخص؛ المهمة غير المصدّقة هي سؤال بلا جواب.',
    "La checklist est ce que quelqu'un signe : une tâche non certifiée est une question sans réponse.",
    'The checklist is what somebody signs; an uncertified task is an unanswered question.',
  ),
};
