/**
 * Reconciliation — what a press means.
 *
 * The window's state machine, lifted out of the frame. `App.tsx` decides what the
 * window looks like; this decides what happens when something in it is pressed, and
 * keeping the two apart is what stops either from becoming three hundred lines of
 * mixed layout and consequence.
 *
 * The selection is four ids, and the cascade between them is the design. Choosing
 * another bank drops the statement, because the model derives "the newest statement of
 * this bank" and holding the old id would show an empty grid until an effect caught up.
 * Choosing another statement drops the line. Choosing a line drops the candidate.
 *
 * The fourth id — the candidate — is the one that is easy to leave out and the one
 * that makes the keyboard honest. `Ctrl+Enter` acts on the ledger row a person has
 * picked out of the ranked list, so the accelerator and the pane always agree about
 * which pairing is on the table; without it, a press would take "the best one" while
 * somebody was reading the third.
 *
 * After any act the line selection is dropped. A matched line has left the open view
 * and an unmatched one has left the matched view, so keeping it would leave the pane
 * arguing about a row nobody can see — and the fallback, the statement's four numbers
 * with the difference at the top, is exactly what somebody wants after pressing Match.
 */
import { type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { type BankTransaction, type Currency, toCurrency } from '../shared/ledger';
import { type ReconcileBusy, type SweepReport, useBankFocus, useReconcileActions } from './actions';
import { type Candidate, candidatesFor } from './match';
import {
  type ReconcileModel,
  type ReconcileSelection,
  type ReconcileView,
  useReconcileModel,
} from './model';

/** Nothing chosen: the model then derives the first bank and its newest statement. */
const EMPTY_SELECTION: ReconcileSelection = {
  accountId: null,
  statementId: null,
  transactionId: null,
  candidateId: null,
};

/** The jump list's three entries, which are view switches and nothing else. */
const VIEW_COMMAND: Readonly<Record<string, ReconcileView | undefined>> = {
  'view:open': 'open',
  'view:matched': 'matched',
  'view:ledger': 'ledger',
};

export interface ReconcileShell {
  readonly model: ReconcileModel;
  readonly view: ReconcileView;
  readonly search: string;
  /** The ledger row picked out of the ranked list, if any. */
  readonly candidateId: string | null;
  readonly report: SweepReport | null;
  readonly busy: ReconcileBusy;
  readonly currency: Currency;
  /** The statement has been signed off: the server refuses to reverse a match on it. */
  readonly locked: boolean;
  /** Line ids the sweep would take, so the grid can tint the batch before it runs. */
  readonly planned: ReadonlySet<string>;
  readonly filtered: boolean;
  readonly canMatch: boolean;
  readonly canUnmatch: boolean;
  readonly searchRef: Ref<HTMLInputElement>;
  setSearch: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the palette. */
  command: (id: string) => void;
  /** The same path, on a row the menu names rather than the one selected. */
  perform: (id: string, transaction: BankTransaction | null) => void;
  pickAccount: (accountId: string) => void;
  pickStatement: (statementId: string) => void;
  pickLine: (row: BankTransaction | null) => void;
  pickCandidate: (lineId: string) => void;
  changeView: (next: ReconcileView) => void;
  matchWith: (candidate: Candidate) => void;
  unmatchSelected: () => void;
  openAccount: (accountId: string) => void;
  /** What a matched line points at, named the way the ledger names it. */
  counterpartOf: (row: BankTransaction) => string;
  dismissReport: () => void;
}

export function useReconcileShell(): ReconcileShell {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [view, setView] = useState<ReconcileView>('open');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<ReconcileSelection>(EMPTY_SELECTION);
  const [report, setReport] = useState<SweepReport | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useReconcileActions();
  const model = useReconcileModel(view, search, selection);
  const currency = toCurrency(model.account?.currency);
  const locked = model.statement !== null && model.statement.status === 'locked';

  /* ---- selection --------------------------------------------------- */

  const pickAccount = useCallback((accountId: string) => {
    setSelection({ accountId, statementId: null, transactionId: null, candidateId: null });
  }, []);
  useBankFocus(pickAccount);

  const pickStatement = useCallback((statementId: string) => {
    setSelection((current) => ({ ...current, statementId, transactionId: null, candidateId: null }));
  }, []);

  const pickLine = useCallback((row: BankTransaction | null) => {
    setSelection((current) => ({ ...current, transactionId: row?.id ?? null, candidateId: null }));
  }, []);

  const pickCandidate = useCallback((lineId: string) => {
    setSelection((current) => ({ ...current, candidateId: lineId }));
  }, []);

  const changeView = useCallback((next: ReconcileView) => {
    // The selected line is rarely in the view being switched to, and a pane arguing
    // about a row that is not on screen is worse than an empty one.
    setSelection((current) => ({ ...current, transactionId: null, candidateId: null }));
    setView(next);
  }, []);

  /** Every act ends the same way: the row it named has left this view. */
  const settle = useCallback((promise: Promise<boolean>) => {
    void promise.then((ok) => {
      if (ok) setSelection((current) => ({ ...current, transactionId: null, candidateId: null }));
    });
  }, []);

  /* ---- the command path -------------------------------------------- */

  /**
   * The pairing a press means.
   *
   * The picked candidate when there is one, the best otherwise. Recomputed for the row
   * in hand when that row is not the selected one — the row menu acts on whatever was
   * right-clicked, and reusing the selection's ranked list would occasionally match the
   * wrong pair of lines, which is the one bug this app must not have.
   */
  const chosenFor = useCallback(
    (transaction: BankTransaction): Candidate | null => {
      const set =
        transaction.id === model.selected?.id ? model.candidates : candidatesFor(transaction, model.ledgerRows);
      return set.matches.find((item) => item.row.line.id === selection.candidateId) ?? set.matches[0] ?? null;
    },
    [model.candidates, model.ledgerRows, model.selected, selection.candidateId],
  );

  const runSweep = useCallback(() => {
    void actions.sweep(model.plan).then((result) => {
      setSelection((current) => ({ ...current, transactionId: null, candidateId: null }));
      setReport(result);
    });
  }, [actions, model.plan]);

  const actOn = useCallback(
    (id: string, transaction: BankTransaction) => {
      if (id === 'copy') {
        actions.copy(transaction, chosenFor(transaction));
        return;
      }
      if (id === 'match' && transaction.state === 'unmatched') {
        const candidate = chosenFor(transaction);
        if (candidate !== null) settle(actions.match(transaction, candidate));
        return;
      }
      if (id === 'unmatch' && transaction.state === 'matched' && !locked) {
        settle(actions.unmatch(transaction));
      }
    },
    [actions, chosenFor, locked, settle],
  );

  const perform = useCallback(
    (id: string, transaction: BankTransaction | null) => {
      const next = VIEW_COMMAND[id];
      if (next !== undefined) changeView(next);
      else if (id === 'refresh') model.refresh();
      else if (id === 'find') searchRef.current?.focus();
      else if (id === 'auto') runSweep();
      else if (id === 'export') {
        actions.exportCsv(model.transactions, model.ledgerRows, model.statement, today);
      } else if (id === 'open-account') {
        const accountId = model.account?.ledgerAccountId ?? null;
        if (accountId !== null) actions.openLedgerAccount(accountId);
      } else if (transaction !== null) actOn(id, transaction);
    },
    [actOn, actions, changeView, model, runSweep, today],
  );

  const command = useCallback((id: string) => perform(id, model.selected), [model.selected, perform]);

  /* ---- what the chrome needs ready-made ---------------------------- */

  const planned = useMemo(() => new Set(model.plan.map((pair) => pair.transaction.id)), [model.plan]);

  const counterpartOf = useCallback(
    (row: BankTransaction): string => {
      const id = row.matchedLineId;
      if (id === null) return '—';
      const found = model.ledgerById.get(id);
      if (found === undefined) return '—';
      return found.reference !== '' ? found.reference : found.line.memo === '' ? '—' : found.line.memo;
    },
    [model.ledgerById],
  );

  const matchWith = useCallback(
    (candidate: Candidate) => {
      if (model.selected !== null) settle(actions.match(model.selected, candidate));
    },
    [actions, model.selected, settle],
  );

  const unmatchSelected = useCallback(() => {
    if (model.selected !== null && !locked) settle(actions.unmatch(model.selected));
  }, [actions, locked, model.selected, settle]);

  const dismissReport = useCallback(() => setReport(null), []);

  return {
    model,
    view,
    search,
    candidateId: selection.candidateId,
    report,
    busy: actions.busy,
    currency,
    locked,
    planned,
    filtered: search.trim() !== '',
    canMatch:
      model.selected !== null && model.selected.state === 'unmatched' && model.candidates.matches.length > 0,
    canUnmatch: model.selected !== null && model.selected.state === 'matched' && !locked,
    searchRef,
    setSearch,
    command,
    perform,
    pickAccount,
    pickStatement,
    pickLine,
    pickCandidate,
    changeView,
    matchWith,
    unmatchSelected,
    openAccount: actions.openLedgerAccount,
    counterpartOf,
    dismissReport,
  };
}
