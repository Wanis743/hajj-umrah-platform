/**
 * Treasury — the question the window is set to.
 *
 * Four settings, and every figure on screen is a function of them: which of the three
 * lenses is in force, how far ahead the flow lenses look, what order the table prints
 * in, and whether the rows the horizon excludes are shown underneath the ones it
 * includes.
 *
 * All four live in window state and none of them is a setting. `useSetting` writes
 * through `registry.set`, which is a privileged capability and therefore a consent
 * prompt; a horizon toggled while somebody thinks about a payment run would raise one
 * per click. The same reasoning the statements and profitability windows arrived at,
 * for the same reason.
 */
import type { Horizon, Lens, Sort } from './cash';

export interface Question {
  readonly lens: Lens;
  readonly horizon: Horizon;
  readonly sort: Sort;
  /**
   * Show what the horizon leaves out — the later and the undated.
   *
   * Off by default, and the rows it hides are counted in no total either, so the list
   * and the rail agree. The count of what is hidden sits on the toolbar rather than in
   * a tooltip, because a list that silently ends early is a list somebody will quote.
   */
  readonly beyond: boolean;
  readonly search: string;
}

/**
 * Cash, thirty days, biggest first.
 *
 * The cash lens opens because "what do we hold" is the question that needs no
 * qualification, and the two that follow are only meaningful once it is answered. A
 * month is the cash cycle, and the largest row is the one worth an argument.
 */
export const DEFAULT_QUESTION: Question = {
  lens: 'cash',
  horizon: 30,
  sort: 'amount',
  beyond: false,
  search: '',
};

/** `lens:payable` → `payable`. The command ids the manifest declares, read back. */
export function lensOf(commandId: string): Lens | null {
  if (commandId === 'lens:cash') return 'cash';
  if (commandId === 'lens:payable') return 'payable';
  if (commandId === 'lens:receivable') return 'receivable';
  return null;
}

/** `sort:due` → `due`. */
export function sortOf(commandId: string): Sort | null {
  if (commandId === 'sort:amount') return 'amount';
  if (commandId === 'sort:due') return 'due';
  if (commandId === 'sort:name') return 'name';
  return null;
}

/** The horizon has no meaning on the cash lens: a balance is not due on a date. */
export const timed = (lens: Lens): boolean => lens !== 'cash';
