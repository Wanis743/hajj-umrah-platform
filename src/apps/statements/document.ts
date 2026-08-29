/**
 * Statements — the saved report.
 *
 * `.fxreport` holds a question, not an answer. Which statement, on which basis, over which
 * period, against what comparison — and none of the numbers. Opening one next quarter
 * re-runs it against the book as it stands, which is the only behaviour that cannot go
 * quietly stale: a file full of figures looks exactly as trustworthy on the day the ledger
 * moves under it as it did the day it was written.
 *
 * It is JSON with a `kind` marker, because the extension is a hint and the marker is a
 * fact. A `.fxreport` that turns out to be somebody's notes gets refused by name rather
 * than half-applied, and a report saved by a later version that adds a field is still
 * readable by this one — every field is read through a guard and falls back to the default,
 * so a missing key is a default and never a crash.
 *
 * Nothing here touches the filesystem. `actions.ts` owns the dialogs and the syscalls; this
 * module only turns one object into text and text back into one object.
 */
import { asBoolean, asString } from '../shared/guards';
import type { Basis } from './balances';
import type { StatementView } from './statement';

/** The question a saved report asks. Every field is one control in the window. */
export interface SavedReport {
  readonly view: StatementView;
  readonly basis: Basis;
  /** The period it was run over, by id; `null` means "whichever is newest at open time". */
  readonly periodId: string | null;
  readonly compare: boolean;
  readonly showZero: boolean;
  readonly search: string;
}

/** What the window opens on with nothing saved: the whole book, as it stands. */
export const DEFAULT_REPORT: SavedReport = {
  view: 'income',
  basis: 'book',
  periodId: null,
  compare: false,
  showZero: false,
  search: '',
};

/** The marker that makes this a report rather than a file that happens to be JSON. */
const KIND = 'financeos.report';
const VERSION = 1;

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * The report as text, ready for `fs.writeText`.
 *
 * Indented, because a saved report is a file somebody may well open in Notepad to see what
 * it asks for, and two spaces cost nothing next to a document that cannot be read without
 * this window. `savedAt` is written for that reader alone — the app never reads it back,
 * since the whole point of saving a question is that its age does not change what it means.
 */
export function serialiseReport(report: SavedReport, savedAt: string): string {
  return `${JSON.stringify({ kind: KIND, version: VERSION, savedAt, ...report }, null, 2)}\n`;
}

/** The name a save dialog opens on: which statement, and the day it was asked for. */
export const reportFileName = (view: StatementView, today: string): string =>
  `${view}-${today}.fxreport`;

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const VIEWS: readonly StatementView[] = ['income', 'balance', 'trial'];
const BASES: readonly Basis[] = ['book', 'period'];

/**
 * One of a known set, or the default.
 *
 * An unrecognised view is a typo or a newer build, not a fourth statement, so it falls back
 * to the default rather than being carried through to a grid that has no rows for it.
 */
const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => {
  const text = asString(value);
  return text !== null && (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
};

/**
 * Text back into a question, or `null` when the file is not one.
 *
 * Two failures land here and both return `null`: text that is not JSON at all, and JSON
 * that is somebody else's document. `actions.ts` names the refusal for the user; what
 * matters at this layer is that neither one yields a half-applied report, because a report
 * that adopted three of its six controls would be a question nobody had asked.
 */
export function parseReport(text: string): SavedReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const row = parsed as Readonly<Record<string, unknown>>;
  if (asString(row.kind) !== KIND) return null;
  const periodId = asString(row.periodId);
  return {
    view: oneOf(VIEWS, row.view, DEFAULT_REPORT.view),
    basis: oneOf(BASES, row.basis, DEFAULT_REPORT.basis),
    // An empty string and a missing key mean the same thing here — nobody named a period —
    // and `null` is the form the rest of the app reads that as.
    periodId: periodId === null || periodId === '' ? null : periodId,
    compare: asBoolean(row.compare) ?? DEFAULT_REPORT.compare,
    showZero: asBoolean(row.showZero) ?? DEFAULT_REPORT.showZero,
    search: asString(row.search) ?? DEFAULT_REPORT.search,
  };
}

