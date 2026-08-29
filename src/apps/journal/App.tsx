/**
 * Journal — the shell.
 *
 * What is left here is state, window chrome and layout. The four reads and
 * everything derived from them live in `page.ts`; every verb lives in
 * `commands.ts`; the markup lives in `chrome.tsx`, `grid.tsx` and `compose.tsx`.
 *
 * One writer, and it is not this file: everything that changes the books goes
 * through `useJournalActions`, one syscall per act, and the kernel raises its own
 * consent for the privileged ones — so there is no confirmation dialog here for
 * posting or closing, only for the void reason the ledger itself requires.
 */
import { useMemo, useRef, useState } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  useAppCommands,
  useContextMenu,
  useDirtyState,
  useWindowBadge,
  useWindowTitle,
} from '@/platform/sdk';
import { ENTRY_STATUS_LABEL, type JournalEntry } from '../shared/ledger';
import { hotkey, useDraftAssociation, useJournalActions } from './actions';
import { EntryMenu, FilterBar, JournalStatus, JournalToolbar, ViewRail } from './chrome';
import { useJournalCommands } from './commands';
import { ComposeDialog, VoidDialog } from './compose';
import { type Draft, emptyDraft, hasContent } from './draft';
import { DEFAULT_FILTER, type JournalFilter, type ViewId, isFiltered } from './entries';
import { EntryDetail, EntryGrid, EntryOverview } from './grid';
import { BOOK_CURRENCY, useJournalPage } from './page';

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
          loading={page.linesLoading}
          labelOf={page.labelOf}
          currency={page.detailCurrency}
          busy={actions.busy}
          onPost={() => actions.post(page.selected as JournalEntry)}
          onVoid={() => openVoid(page.selected as JournalEntry)}
          onDuplicate={() => commands.duplicate(page.selected as JournalEntry, page.lines)}
          onCopy={() => actions.copy(page.selected as JournalEntry, page.lines, page.labelOf)}
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
      <AppFrame
        scroll={false}
        navWidth={236}
        asideWidth={324}
        commands={
          <JournalToolbar
            search={filter.search}
            onSearch={(next) => setFilter((current) => ({ ...current, search: next }))}
            searchRef={searchRef}
            onCommand={commands.command}
            busy={actions.busy}
            loading={page.loading}
            canExport={page.visible.length > 0}
          />
        }
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <FilterBar
            filter={filter}
            onFilter={setFilter}
            sources={page.sources}
            unbalanced={page.counts.unbalanced}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            <EntryGrid
              entries={page.visible}
              loading={page.loading && page.entries.length === 0}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onActivate={(entry) => setSelectedId(entry.id)}
              onContextMenu={(entry, event) => menu.open(event, entry)}
              filtered={isFiltered(filter)}
            />
          </div>
        </div>
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
