/**
 * Profitability — what a press means.
 *
 * The question is state and not a setting. `useSetting` writes through the registry, which is
 * a privileged capability, and a window that raised a consent prompt every time somebody
 * re-ranked a table is a window nobody would re-rank. There is no saved-report file here
 * either, unlike the statements window: this app owns no document, because the question is two
 * clicks to restate and a copy of it kept on disk would only go stale against a book that
 * moves every day.
 *
 * One object is the whole state of the app. Every control writes exactly one field of it and
 * the model takes it as its only argument, so the dimension named in the toolbar and the
 * dimension the figures were summed over have no way to disagree.
 *
 * Nothing here writes to the book. The three things that leave — a CSV, a paragraph and a
 * launch of the ledger — were each asked for by name, so none of them asks for confirmation,
 * and the one disabled control in this window is protecting nothing.
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
import type { Basis } from '../shared/ledger';
import { hotkey, type ProfitabilityBusy, useProfitabilityActions } from './actions';
import { type Dimension, laggard, leader, type MemberFigure, type Sort } from './figures';
import { type ProfitabilityModel, useProfitabilityModel } from './model';
import { DEFAULT_QUESTION, dimensionOf, type Question } from './question';
import {
  memberClipboardText,
  type Provenance,
  sliceClipboardText,
  sliceCsv,
  suggestedFileName,
} from './report';

/** The rankings the jump list and the toolbar can ask for by name. */
const SORT_COMMAND: Readonly<Record<string, Sort | undefined>> = {
  'sort:margin': 'margin',
  'sort:revenue': 'revenue',
  'sort:name': 'name',
};

/** Where a right-click landed, and on which member. */
export interface RowAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: MemberFigure;
}
/**
 * The question, and the seven ways of asking a different one.
 *
 * Each setter writes one field and leaves the rest alone, which is what lets a search survive
 * a change of dimension and a period survive a change of ranking. There is no `apply` that
 * replaces the lot, because nothing in this app hands the window a whole question — every
 * control is one field, and the only other way in is the accelerator for that same control.
 */
interface QuestionControls {
  readonly question: Question;
  setDimension: (next: Dimension) => void;
  setBasis: (next: Basis) => void;
  setPeriod: (id: string | null) => void;
  setCompare: (next: boolean) => void;
  setSort: (next: Sort) => void;
  setSilent: (next: boolean) => void;
  setSearch: (next: string) => void;
  /** A comparison is a question about a window, so asking for one asks for the period basis. */
  toggleCompare: () => void;
}

function useQuestion(): QuestionControls {
  const [question, setQuestion] = useState<Question>(DEFAULT_QUESTION);

  const setDimension = useCallback(
    (dimension: Dimension) => setQuestion((current) => ({ ...current, dimension })),
    [],
  );
  const setBasis = useCallback((basis: Basis) => setQuestion((current) => ({ ...current, basis })), []);
  const setPeriod = useCallback(
    (periodId: string | null) => setQuestion((current) => ({ ...current, periodId })),
    [],
  );
  const setCompare = useCallback(
    (compare: boolean) => setQuestion((current) => ({ ...current, compare })),
    [],
  );
  const setSort = useCallback((sort: Sort) => setQuestion((current) => ({ ...current, sort })), []);
  const setSilent = useCallback(
    (showSilent: boolean) => setQuestion((current) => ({ ...current, showSilent })),
    [],
  );
  const setSearch = useCallback(
    (search: string) => setQuestion((current) => ({ ...current, search })),
    [],
  );

  // The comparison column belongs to the period basis alone, so the command that switches it on
  // takes the basis with it: a toggle that moves and changes nothing on screen is a broken one.
  const toggleCompare = useCallback(() => {
    setQuestion((current) =>
      current.compare
        ? { ...current, compare: false }
        : { ...current, compare: true, basis: 'period' },
    );
  }, []);

  return {
    question,
    setDimension,
    setBasis,
    setPeriod,
    setCompare,
    setSort,
    setSilent,
    setSearch,
    toggleCompare,
  };
}
export interface ProfitabilityShell {
  readonly model: ProfitabilityModel;
  /** The question every figure on screen answers, and the only argument the model took. */
  readonly question: Question;
  /** What each export and each paste carries with it. */
  readonly source: Provenance;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: ProfitabilityBusy;
  readonly menu: RowAnchor | null;
  readonly selectedKey: string | null;
  /** A member is selected *and* has an account behind it, so the ledger has something to open. */
  readonly canDrill: boolean;
  setBasis: (next: Basis) => void;
  setPeriod: (id: string | null) => void;
  setCompare: (next: boolean) => void;
  setSort: (next: Sort) => void;
  setSilent: (next: boolean) => void;
  setSearch: (next: string) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the panes. */
  command: (id: string) => void;
  /** The same path, on the member a menu names rather than the one the pane describes. */
  perform: (id: string, row: MemberFigure | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pickMember: (key: string | null) => void;
  openMenu: (row: MemberFigure, event: MouseEvent) => void;
  closeMenu: () => void;
}
export function useProfitabilityShell(): ProfitabilityShell {
  const { t, tr } = useLocale();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const controls = useQuestion();
  const { question } = controls;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<RowAnchor | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useProfitabilityActions();
  const model = useProfitabilityModel(question, selectedKey);

  /**
   * The provenance every export and every paste carries.
   *
   * Read off the model rather than off the question, because four of its seven fields are facts
   * about what came back and not about what was asked for: the window may be a month the app
   * synthesised, the comparison may not exist, coverage is only known once the postings have
   * been walked, and whether a page hit its ceiling is only known once it has.
   */
  const source = useMemo<Provenance>(
    () => ({
      dimension: question.dimension,
      basis: question.basis,
      period: question.basis === 'period' ? model.period : null,
      comparison: model.comparison,
      coverage: model.slice.coverage,
      bounded: model.bounded,
      unnamed: model.unnamed,
    }),
    [
      model.bounded,
      model.comparison,
      model.period,
      model.slice.coverage,
      model.unnamed,
      question.basis,
      question.dimension,
    ],
  );

  const pickMember = useCallback((key: string | null) => setSelectedKey(key), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((row: MemberFigure, event: MouseEvent) => {
    event.preventDefault();
    // The menu acts on the row it names, so the selection follows the right-click: a menu whose
    // entries described one member while the pane described another would be a trap.
    setSelectedKey(row.key);
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, []);
  /* ---- the command path -------------------------------------------- */

  /** "Export" is the table in front of the person, filtered exactly as it is filtered. */
  const exportTable = useCallback(() => {
    actions.exportCsv(
      sliceCsv(model.rows, source, t, tr),
      suggestedFileName(question.dimension, today),
    );
  }, [actions, model.rows, question.dimension, source, t, today, tr]);

  /** The whole report as a paragraph, with the two ends of the ranking named in it. */
  const copySlice = useCallback(() => {
    actions.copy(
      sliceClipboardText(model.slice, source, t, tr, leader(model.slice), laggard(model.slice)),
    );
  }, [actions, model.slice, source, t, tr]);

  /**
   * The two member-level acts.
   *
   * "Open in the ledger" means the largest account behind the row, because that is what a reader
   * pointing at a margin is asking about — and a member with no accounts at all is the
   * unallocated remainder on a book that has nothing in it, which is why the entry greys rather
   * than opening the ledger on nothing.
   */
  const actOnRow = useCallback(
    (id: string, row: MemberFigure) => {
      if (id === 'ledger') {
        const [largest] = row.accounts;
        if (largest !== undefined) actions.openAccount(largest.accountId);
        return;
      }
      if (id === 'copyRow') actions.copy(memberClipboardText(row, source, t, tr));
    },
    [actions, source, t, tr],
  );
  /**
   * Every press in the window, in one place.
   *
   * A change of dimension drops the selection: a package key means nothing in a table of
   * branches, and a pane left describing a member that is no longer in the report is worse than
   * an empty one. Everything else leaves the selection alone, so re-ranking or searching keeps
   * the member a reader was already reading.
   */
  const perform = useCallback(
    (id: string, row: MemberFigure | null) => {
      const dimension = dimensionOf(id);
      if (dimension !== null) {
        controls.setDimension(dimension);
        setSelectedKey(null);
        return;
      }
      const sort = SORT_COMMAND[id];
      if (sort !== undefined) {
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
        copySlice();
        return;
      }
      if (id === 'compare') {
        controls.toggleCompare();
        return;
      }
      const target = row ?? model.selected;
      if (target !== null) actOnRow(id, target);
    },
    [actOnRow, controls, copySlice, exportTable, model],
  );

  /** The toolbar, the accelerators and the panes all act on the selection, never on a row. */
  const command = useCallback((id: string) => perform(id, null), [perform]);

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
    searchRef,
    busy: actions.busy,
    menu,
    selectedKey,
    canDrill: model.selected !== null && model.selected.accounts.length > 0,
    setBasis: controls.setBasis,
    setPeriod: controls.setPeriod,
    setCompare: controls.setCompare,
    setSort: controls.setSort,
    setSilent: controls.setSilent,
    setSearch: controls.setSearch,
    command,
    perform,
    keyDown,
    pickMember,
    openMenu,
    closeMenu,
  };
}





