/**
 * Journal — the command table.
 *
 * Every verb the app performs, named once, so the toolbar, the command palette,
 * the jump list, the accelerators and the context menu all dispatch through the
 * same function instead of four copies that drift apart.
 *
 * The input is read through a ref rather than closed over. A command is therefore
 * a stable function for the life of the window, which is what lets `useAppCommands`
 * subscribe once and what keeps a toolbar button from becoming a different button
 * because a different row got selected.
 */
import { type RefObject, useCallback, useMemo, useRef } from 'react';
import type { JournalEntry, JournalLine } from '../shared/ledger';
import type { JournalActions } from './actions';
import { type Draft, draftFromEntry, emptyDraft } from './draft';
import { type JournalFilter, VIEWS } from './entries';

export interface CommandInput {
  readonly actions: JournalActions;
  readonly today: string;
  /** The rows a CSV export would carry: what is on screen, not the whole page. */
  readonly visible: readonly JournalEntry[];
  readonly lines: readonly JournalLine[];
  readonly labelOf: (accountId: string | null) => string;
  readonly menuTarget: JournalEntry | null;
  readonly closeMenu: () => void;
  readonly voidTarget: JournalEntry | null;
  readonly voidReason: string;
  readonly draft: Draft | null;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly refetch: () => void;
  readonly setDraft: (next: Draft | null) => void;
  readonly setFilter: (update: (current: JournalFilter) => JournalFilter) => void;
  readonly setVoidTarget: (next: JournalEntry | null) => void;
  readonly setVoidReason: (next: string) => void;
}

export interface JournalCommands {
  /** Toolbar, palette, jump-list and accelerator ids, all through one door. */
  readonly command: (id: string) => void;
  readonly create: () => void;
  readonly duplicate: (entry: JournalEntry, source: readonly JournalLine[]) => void;
  readonly onMenuSelect: (id: string) => void;
  readonly confirmVoid: () => void;
}

export function useJournalCommands(input: CommandInput): JournalCommands {
  const latest = useRef(input);
  latest.current = input;

  const openDraftFile = useCallback(() => {
    const { actions, today, setDraft } = latest.current;
    void actions.openDraft(today).then((opened) => {
      if (opened !== null) setDraft(opened);
    });
  }, []);

  const command = useCallback(
    (id: string): void => {
      const { actions, today, visible, searchRef, refetch, setDraft, setFilter } = latest.current;
      if (id === 'new') {
        setDraft(emptyDraft(today));
      } else if (id === 'open') {
        openDraftFile();
      } else if (id === 'refresh') {
        refetch();
      } else if (id === 'find') {
        searchRef.current?.focus();
      } else if (id === 'export') {
        actions.exportCsv(visible, today);
      } else if (id.startsWith('view:')) {
        const wanted = id.slice('view:'.length);
        const view = VIEWS.find((candidate) => candidate === wanted);
        if (view !== undefined) setFilter((current) => ({ ...current, view }));
      }
    },
    [openDraftFile],
  );

  const create = useCallback(() => {
    const { actions, draft, setDraft } = latest.current;
    if (draft === null) return;
    void actions.create(draft).then((ok) => {
      if (ok) setDraft(null);
    });
  }, []);

  // `draftFromEntry` clears the reference and re-dates to today; the lines come
  // over as they were booked, so a duplicate of a balanced entry balances.
  const duplicate = useCallback((entry: JournalEntry, source: readonly JournalLine[]) => {
    const { today, setDraft } = latest.current;
    setDraft(draftFromEntry(entry, source, today));
  }, []);

  const onMenuSelect = useCallback(
    (id: string) => {
      const { actions, lines, labelOf, menuTarget, closeMenu, setVoidReason, setVoidTarget } = latest.current;
      closeMenu();
      if (menuTarget === null) return;
      if (id === 'post') actions.post(menuTarget);
      else if (id === 'void') {
        setVoidReason('');
        setVoidTarget(menuTarget);
      } else if (id === 'duplicate') duplicate(menuTarget, lines);
      else if (id === 'copy') actions.copy(menuTarget, lines, labelOf);
    },
    [duplicate],
  );

  const confirmVoid = useCallback(() => {
    const { actions, voidReason, voidTarget, setVoidReason, setVoidTarget } = latest.current;
    if (voidTarget === null) return;
    actions.voidEntry(voidTarget, voidReason);
    setVoidTarget(null);
    setVoidReason('');
  }, []);

  return useMemo(
    () => ({ command, create, duplicate, onMenuSelect, confirmVoid }),
    [command, create, duplicate, onMenuSelect, confirmVoid],
  );
}

