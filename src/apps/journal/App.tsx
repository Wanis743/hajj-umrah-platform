/**
 * Journal — the shell.
 *
 * What is left here is state, window chrome and layout. The four reads and
 * everything derived from them live in `page.ts`; every verb lives in
 * `commands.ts`; the markup lives in `chrome.tsx`, `grid.tsx` and `compose.tsx`.
 *
 * The window is a ribbon over a split. The ribbon is the command surface, in
 * Office's shape and for Office's reason: posting is not one task, and a flat row
 * of a dozen buttons says nothing about which task a given button belongs to. The
 * split below it is the book over the open entry's register — a list of documents
 * and, under it, the one that is open, drawn as the double entry it is. The grip
 * between them is there because which half matters more is a thing only the person
 * reading knows.
 *
 * The frame carries no command bar of its own. `AppFrame` still draws its bar when
 * a rail folds, so the drawers stay reachable on a narrow window; it simply has no
 * commands to put in it, because they are all upstairs.
 *
 * One writer, and it is not this file: everything that changes the books goes
 * through `useJournalActions`, one syscall per act, and the kernel raises its own
 * consent for the privileged ones — so there is no confirmation dialog here for
 * posting or closing, only for the void reason the ledger itself requires.
 */
import { type Dispatch, type MouseEvent, type SetStateAction, useMemo, useRef, useState } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  SplitPane,
  useAppCommands,
  useContextMenu,
  useDirtyState,
  useWindowBadge,
  useWindowTitle,
} from '@/platform/sdk';
import { ENTRY_STATUS_LABEL, type JournalEntry } from '../shared/ledger';
import { hotkey, useDraftAssociation, useJournalActions } from './actions';
import { EntryMenu, FilterBar, JournalRibbon, JournalStatus, ViewRail } from './chrome';
import { useJournalCommands } from './commands';
import { ComposeDialog, VoidDialog } from './compose';
import { type Draft, emptyDraft, hasContent } from './draft';
import { DEFAULT_FILTER, type JournalFilter, type ViewId, isFiltered } from './entries';
import { EntryDetail, EntryGrid, EntryOverview, EntryRegister } from './grid';
import { BOOK_CURRENCY, useJournalPage } from './page';

interface JournalBookProps {
  readonly filter: JournalFilter;
  readonly onFilter: Dispatch<SetStateAction<JournalFilter>>;
  readonly sources: readonly string[];
  readonly unbalanced: number;
  readonly entries: readonly JournalEntry[];
  readonly loading: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onContextMenu: (entry: JournalEntry, event: MouseEvent) => void;
}

/** The upper half of the split: what narrows the book, and the book. */
function JournalBook({
  filter,
  onFilter,
  sources,
  unbalanced,
  entries,
  loading,
  selectedId,
  onSelect,
  onContextMenu,
}: JournalBookProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <FilterBar filter={filter} onFilter={onFilter} sources={sources} unbalanced={unbalanced} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <EntryGrid
          entries={entries}
          loading={loading}
          selectedId={selectedId}
          onSelect={onSelect}
          onActivate={(entry) => onSelect(entry.id)}
          onContextMenu={onContextMenu}
          filtered={isFiltered(filter)}
        />
      </div>
    </div>
  );
}

export default function JournalApp({ runtime }: AppEntryProps) {
  const { t, tr } = runtime.locale;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [filter, setFilter] = useState<JournalFilter>(DEFAULT_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voidTarget, setVoidTarget] = useState<JournalEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu<JournalEntry>();
  const actions = useJournalActions();
  const page = useJournalPage(filter, selectedId, tr);

  const commands = useJournalCommands({
    actions,
    today,
    visible: page.visible,
    filter,
    tr,
    lines: page.lines,
    labelOf: page.labelOf,
    menuTarget: menu.menu?.target ?? null,
    closeMenu: menu.close,
    voidTarget,
    voidReason,
    draft,
    searchRef,
    refetch: page.refetch,
    setDraft,
    setFilter,
    setVoidTarget,
    setVoidReason,
  });

  // Jump list, command palette and accelerators are one path in and one out.
  useAppCommands(commands.command);
  useDraftAssociation(today, setDraft);

  // The title says where you are, because the taskbar and Alt+Tab show it and
  // "Journal" alone does not distinguish a window on Drafts from one on the book.
  const viewLabel =
    filter.view === 'all' ? tr('كل القيود', 'Toutes les écritures', 'All entries') : t(ENTRY_STATUS_LABEL[filter.view]);
  useWindowTitle(`${tr('دفتر اليومية', 'Journal', 'Journal')} — ${viewLabel}`);

  // The badge is what is waiting on a person: drafts to finish, entries to approve.
  const waiting = page.counts.counts.draft + page.counts.counts.pending;
  useWindowBadge(waiting === 0 ? null : waiting);
  useDirtyState(draft !== null && hasContent(draft));

  const openVoid = (entry: JournalEntry) => {
    setVoidReason('');
    setVoidTarget(entry);
  };

  // The ribbon's four entry verbs all act on the held entry, and all four must do
  // nothing when none is held. Stated once rather than four times, because four
  // copies of a null check are four chances for one of them to be wrong.
  const onSelected = (act: (entry: JournalEntry) => void) => () => {
    if (page.selected !== null) act(page.selected);
  };

  const aside =
    page.selected === null ? (
      <div style={{ padding: 12 }}>
        <EntryOverview entries={page.entries} tally={page.counts} currency={BOOK_CURRENCY} today={today} />
      </div>
    ) : (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <EntryDetail
          entry={page.selected}
          lines={page.lines}
          currency={page.detailCurrency}
        />
      </div>
    );

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        const id = hotkey(event);
        if (id === null) return;
        event.preventDefault();
        commands.command(id);
      }}
    >
      <JournalRibbon
        search={filter.search}
        onSearch={(next) => setFilter((current) => ({ ...current, search: next }))}
        searchRef={searchRef}
        onCommand={commands.command}
        busy={actions.busy}
        loading={page.loading}
        canExport={page.visible.length > 0}
        selected={page.selected}
        onPost={onSelected((entry) => actions.post(entry))}
        onVoid={onSelected(openVoid)}
        onDuplicate={onSelected((entry) => commands.duplicate(entry, page.lines))}
        onCopy={onSelected((entry) => actions.copy(entry, page.lines, page.labelOf))}
      />
      <AppFrame
        scroll={false}
        navWidth={236}
        asideWidth={324}
        nav={
          <ViewRail
            view={filter.view}
            onView={(next: ViewId) => setFilter((current) => ({ ...current, view: next }))}
            counts={page.counts.counts}
            periods={page.periods}
            periodId={filter.periodId}
            onPeriod={(next) => setFilter((current) => ({ ...current, periodId: next }))}
          />
        }
        aside={aside}
        status={
          <JournalStatus
            shown={page.visible.length}
            loaded={page.entries.length}
            debit={page.footer.debit}
            credit={page.footer.credit}
            unbalanced={page.footer.unbalanced}
            currency={BOOK_CURRENCY}
            error={page.error}
            fetchedAt={page.fetchedAt}
          />
        }
      >
        <SplitPane
          direction="vertical"
          // The book opens tall enough to read a dozen entries, and the register
          // below it tall enough for a four-line posting without scrolling. The
          // grip is there because which of the two a person needs more is a thing
          // only they know — a bookkeeper hunting one entry wants the book, and a
          // reviewer checking a posting wants the lines.
          initial={300}
          min={140}
          max={560}
          first={
            <JournalBook
              filter={filter}
              onFilter={setFilter}
              sources={page.sources}
              unbalanced={page.counts.unbalanced}
              entries={page.visible}
              loading={page.loading && page.entries.length === 0}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onContextMenu={(entry, event) => menu.open(event, entry)}
            />
          }
          second={
            <EntryRegister
              entry={page.selected}
              lines={page.lines}
              loading={page.linesLoading}
              labelOf={page.labelOf}
              currency={page.detailCurrency}
            />
          }
        />
      </AppFrame>

      {menu.menu !== null ? (
        <EntryMenu
          x={menu.menu.x}
          y={menu.menu.y}
          entry={menu.menu.target}
          linesLoaded={menu.menu.target.id === selectedId && page.lines.length > 0}
          onSelect={commands.onMenuSelect}
          onDismiss={menu.close}
        />
      ) : null}

      {/* The compose dialog is controlled: `draft` is the document, and an empty
          one stands in while it is closed so the markup has no null branch. */}
      <ComposeDialog
        open={draft !== null}
        draft={draft ?? emptyDraft(today)}
        onDraft={setDraft}
        accounts={page.accounts}
        busy={actions.busy}
        onClose={() => setDraft(null)}
        onCreate={commands.create}
        onSaveFile={() => {
          if (draft !== null) void actions.saveDraft(draft);
        }}
      />

      <VoidDialog
        entry={voidTarget}
        reason={voidReason}
        onReason={setVoidReason}
        busy={actions.busy === 'void'}
        onClose={() => setVoidTarget(null)}
        onConfirm={commands.confirmVoid}
      />
    </div>
  );
}
