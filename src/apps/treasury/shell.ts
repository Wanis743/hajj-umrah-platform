/**
 * Treasury — what a press means.
 *
 * One object is the question and the model takes it as an argument, so the lens named in
 * the toolbar and the lens the figures were summed over have no way to disagree. None of
 * the four fields is a setting: `useSetting` writes through the registry, which is a
 * privileged capability and therefore a consent prompt, and a horizon toggled twice while
 * somebody thinks about a payment run would raise two.
 *
 * A change of lens drops the selection and nothing else does. A bank account key means
 * nothing in a list of supplier bills, and a pane left describing a row that is no longer
 * in the table is worse than an empty one — while a change of horizon, of ranking or of
 * the find box leaves the reader on the row they were already reading.
 *
 * Nothing here writes to the book. Four things leave the window — a CSV, a paragraph and
 * two hand-offs — and each was asked for by name, so not one of them asks for
 * confirmation. The controls that grey out are protecting nobody: they are dark because
 * the row in hand has nowhere to send them.
 */
import {
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocale } from '@/platform/sdk';
import { hotkey, type TreasuryBusy, useTreasuryActions } from './actions';
import { type CashRow, type Horizon, largest, latest, type Lens, type Sort } from './cash';
import { type TreasuryModel, useTreasuryModel } from './model';
import { DEFAULT_QUESTION, lensOf, type Question, sortOf } from './question';
import {
  type Provenance,
  rowClipboardText,
  rowsCsv,
  suggestedFileName,
  summaryClipboardText,
} from './report';

/** Where a right-click landed, and on which row. */
export interface RowAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: CashRow;
}

/**
 * The question, and the five ways of asking a different one.
 *
 * Each setter writes one field and leaves the rest alone, which is what lets a find box
 * survive a change of lens and a horizon survive a change of ranking. There is no `apply`
 * that replaces the lot: nothing in this window hands it a whole question, every control
 * is one field, and the only other way in is that control's own accelerator.
 */
interface QuestionControls {
  readonly question: Question;
  setLens: (next: Lens) => void;
  setHorizon: (next: Horizon) => void;
  setSort: (next: Sort) => void;
  setBeyond: (next: boolean) => void;
  setSearch: (next: string) => void;
}

function useQuestion(): QuestionControls {
  const [question, setQuestion] = useState<Question>(DEFAULT_QUESTION);

  const setLens = useCallback((lens: Lens) => setQuestion((current) => ({ ...current, lens })), []);
  const setHorizon = useCallback(
    (horizon: Horizon) => setQuestion((current) => ({ ...current, horizon })),
    [],
  );
  const setSort = useCallback((sort: Sort) => setQuestion((current) => ({ ...current, sort })), []);
  const setBeyond = useCallback(
    (beyond: boolean) => setQuestion((current) => ({ ...current, beyond })),
    [],
  );
  const setSearch = useCallback(
    (search: string) => setQuestion((current) => ({ ...current, search })),
    [],
  );

  return { question, setLens, setHorizon, setSort, setBeyond, setSearch };
}

export interface TreasuryShell {
  readonly model: TreasuryModel;
  /** The question every figure on screen answers, and the only argument the model took. */
  readonly question: Question;
  /** What each export and each paste carries with it. */
  readonly source: Provenance;
  /** The day every age and every bucket in the window is measured from. Fixed once. */
  readonly today: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: TreasuryBusy;
  readonly menu: RowAnchor | null;
  readonly selectedKey: string | null;
  /** The lens holds both currencies, so the dinar restatement earns a column. */
  readonly mixed: boolean;
  /** Rows the horizon leaves out — the later and the undated — however the find box stands. */
  readonly outside: number;
  /** A row is selected *and* names a ledger account, so the ledger has something to open. */
  readonly canDrill: boolean;
  /** A row is selected *and* is a bank account, so reconciliation has something to open. */
  readonly canReconcile: boolean;
  setHorizon: (next: Horizon) => void;
  setSort: (next: Sort) => void;
  setBeyond: (next: boolean) => void;
  setSearch: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the one the pane describes. */
  perform: (id: string, row: CashRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickRow: (key: string | null) => void;
  openMenu: (row: CashRow, event: MouseEvent) => void;
  closeMenu: () => void;
}

export function useTreasuryShell(): TreasuryShell {
  const { t, tr } = useLocale();
  // Fixed when the window opens. A due date compared against a clock that moves on every
  // re-render is a bucket that changes colour while somebody is reading it.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const controls = useQuestion();
  const { question } = controls;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<RowAnchor | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useTreasuryActions();
  const model = useTreasuryModel(question, today, selectedKey);

  /**
   * The provenance every export and every paste carries.
   *
   * Three of its seven fields are read off the model rather than off the question, because
   * they are facts about what came back and not about what was asked for: which rate was
   * on record, how much of the paper had to be counted whole, and whether a page ran out.
   */
  const source = useMemo<Provenance>(
    () => ({
      lens: question.lens,
      horizon: question.horizon,
      today,
      rates: model.rates,
      whole: model.figures.whole,
      setAside: model.figures.setAside,
      bounded: model.bounded,
    }),
    [model.bounded, model.figures.setAside, model.figures.whole, model.rates, question.horizon, question.lens, today],
  );

  /**
   * Whether the lens in force actually holds two currencies.
   *
   * The dinar column appears on the answer to this and on nothing else. It is read off the
   * rows rather than off the rate book, because a rate on record does not mean there is
   * anything to convert — an agency with dinar accounts only has one currency whatever
   * `exchange_rates` says.
   */
  const mixed = useMemo(() => {
    let dinars = false;
    let riyals = false;
    for (const row of model.all) {
      if (row.currency === 'SAR') riyals = true;
      else dinars = true;
      if (dinars && riyals) return true;
    }
    return false;
  }, [model.all]);

  // What the horizon excludes, whatever the find box is doing: the toolbar's eye names this
  // number, and it has to mean the same thing while somebody is typing in the box beside it.
  const outside = model.buckets.later + model.buckets.undated;

  const pickRow = useCallback((key: string | null) => setSelectedKey(key), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: CashRow, event: MouseEvent) => {
    event.preventDefault();
    // The menu acts on the row it names, so the selection follows the right-click: a menu
    // whose entries described one row while the pane described another would be a trap.
    setSelectedKey(row.key);
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);

  /* ---- the command path -------------------------------------------- */

  /** "Export" is the table in front of the person, filtered exactly as it is filtered. */
  const exportTable = useCallback(() => {
    actions.exportCsv(rowsCsv(model.rows, source, t, tr), suggestedFileName(question.lens, today));
  }, [actions, model.rows, question.lens, source, t, today, tr]);

  /**
   * The whole position as a paragraph, with the two rows a treasurer always names in it.
   *
   * Summed over `all` rather than over what the grid shows, so a paragraph pasted into a
   * message says what the agency holds and not what somebody had typed in a find box.
   */
  const copySummary = useCallback(() => {
    actions.copy(
      summaryClipboardText(
        {
          figures: model.figures,
          outlook: model.outlook,
          source,
          rows: model.all,
          biggest: largest(model.all),
          worst: latest(model.all),
        },
        t,
        tr,
      ),
    );
  }, [actions, model.all, model.figures, model.outlook, source, t, tr]);
  /**
   * The three acts that need a row, on whichever row was named.
   *
   * It takes the row rather than reading the selection, because a right-click on a row
   * somebody had not selected must act on the row under the cursor and not on the one they
   * left selected a minute ago. The menu passes its own row; everything else passes none
   * and gets the selected one.
   *
   * Each of the three is dark when its field is null, so a null arriving here means an
   * accelerator got in past a disabled control rather than that anything is wrong: the
   * quiet return is the whole handling it needs.
   */
  const actOnRow = useCallback(
    (id: string, row: CashRow) => {
      if (id === 'ledger') {
        if (row.accountId !== null) actions.openAccount(row.accountId);
        return;
      }
      if (id === 'reconcile') {
        if (row.position !== null) actions.openReconcile(row.position.account.id);
        return;
      }
      if (id === 'copyRow') actions.copy(rowClipboardText(row, source, t, tr));
    },
    [actions, source, t, tr],
  );

  /**
   * Every command in the manifest, in one place, on the row it was given.
   *
   * A change of lens drops the selection because a bank account key means nothing in a
   * list of supplier bills. A change of ranking does not, and neither does the horizon or
   * the find box — those rearrange or hide rows, they do not change what a row *is*.
   *
   * `find` focuses the box rather than opening anything: there is no search dialog in this
   * window, and Ctrl+F landing in the box beside the lens buttons is what the accelerator
   * means everywhere else.
   */
  const perform = useCallback(
    (id: string, row: CashRow | null) => {
      const lens = lensOf(id);
      if (lens !== null) {
        controls.setLens(lens);
        setSelectedKey(null);
        return;
      }
      const sort = sortOf(id);
      if (sort !== null) {
        controls.setSort(sort);
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
        exportTable();
        return;
      }
      if (id === 'copy') {
        copySummary();
        return;
      }
      const target = row ?? model.selected;
      if (target !== null) actOnRow(id, target);
    },
    [actOnRow, controls, copySummary, exportTable, model],
  );
  /** The toolbar, the rail and the panes all name a command and no row: the pane's row. */
  const command = useCallback((id: string) => perform(id, null), [perform]);

  /**
   * The accelerators, which are the manifest's set and nothing else.
   *
   * `preventDefault` only once a key has actually been claimed — Ctrl+A, Ctrl+C and the
   * arrows belong to the grid, and a window that swallowed them to do nothing would be a
   * window where copy stopped working.
   */
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
    question,
    source,
    today,
    searchRef,
    busy: actions.busy,
    menu,
    selectedKey,
    mixed,
    outside,
    // Not "is a row selected" but "has this row anywhere to send us". A bill names no
    // ledger account and a trial-balance row is not a bank account, so each hand-off is
    // dark on the lenses that cannot reach it — the row in hand decides, not the lens.
    canDrill: model.selected !== null && model.selected.accountId !== null,
    canReconcile: model.selected !== null && model.selected.position !== null,
    setHorizon: controls.setHorizon,
    setSort: controls.setSort,
    setBeyond: controls.setBeyond,
    setSearch: controls.setSearch,
    command,
    perform,
    keyDown,
    pickRow,
    openMenu,
    closeMenu,
  };
}



