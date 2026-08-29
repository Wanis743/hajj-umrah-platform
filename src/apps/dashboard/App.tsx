/**
 * Dashboard — the shell.
 *
 * Two pieces of state, and both of them belong to the person rather than to the data:
 * which page is open, and how wide the window is. Everything else is derived — one
 * `useDashboardModel` call reads the book, one `snapshot` turns it into numbers, and
 * every card on every page reads from that value.
 *
 * The range lives here rather than in the model because it means different things on
 * different pages, and the chrome says so: `RANGED_PAGES` is the list the toolbar
 * checks before it draws a range selector at all. Position and performance come from
 * the trial balance, which the broker aggregates over the whole book with no date
 * dimension — so on those pages there is nothing for a range to scope, and a control
 * that silently does nothing is worse than no control.
 *
 * Nothing in this app acts. There is no dialog, no confirmation and no busy state
 * except the one the CSV export owns, because the manifest declares no privileged
 * capability: the kernel would refuse a post from this window even if a future edit
 * here asked for one. Every button that looks like it does something launches the app
 * that really can, on the view that shows the work.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import type { Currency } from '../shared/ledger';
import { type DashboardActions, hotkey, useDashboardActions } from './actions';
import { ActivityPage } from './activity';
import { AttentionPane } from './attention';
import { OverviewPage, PerformancePage, PositionPage } from './cards';
import { DashboardStatus, DashboardToolbar, PageRail } from './chrome';
import { ClosePage } from './close';
import {
  type Destination,
  type FeedRow,
  type Formatters,
  PAGE_LABEL,
  type PageId,
  type RangeId,
  type Snapshot,
  windowLabel,
} from './metrics';
import { type DashboardModel, useDashboardModel } from './model';

/**
 * The currency every added-up figure on this window is labelled in.
 *
 * `trial_balance` carries one `currency_code` per account and the journal carries none
 * at all, so a total of either can only honestly be called the book's. Where a page
 * holds more than one code it says so, and each account row is written in its own.
 */
const BOOK_CURRENCY: Currency = 'DZD';

/** The five page verbs, which the jump list, the palette and Ctrl+1…5 all speak. */
const PAGE_COMMAND: Readonly<Record<string, PageId | undefined>> = {
  'page:overview': 'overview',
  'page:position': 'position',
  'page:performance': 'performance',
  'page:activity': 'activity',
  'page:close': 'close',
};

/**
 * The taskbar's version of this window.
 *
 * The page is in the title because five pages of one app are five different things to
 * be looking at, and the count of what needs a person is in it for the reason a mail
 * client puts unread in the title: that is where somebody looks while the window is
 * behind something else.
 */
function windowTitle(page: PageId, snap: Snapshot, locale: AppLocale): string {
  const name = locale.tr('لوحة المعلومات', 'Tableau de bord', 'Dashboard');
  const label = locale.t(PAGE_LABEL[page]);
  const waiting = snap.attention.length;
  return waiting === 0
    ? `${name} — ${label}`
    : `${name} — ${label} (${fmt.integer(waiting, locale.lang)})`;
}

interface PagesProps {
  readonly page: PageId;
  readonly snap: Snapshot;
  readonly f: Formatters;
  readonly feed: readonly FeedRow[];
  onOpen: (destination: Destination) => void;
}

/** Whichever page is open. The overview is the fallback, not a special case. */
function DashboardPages({ page, snap, f, feed, onOpen }: PagesProps) {
  if (page === 'position') return <PositionPage snap={snap} f={f} onOpen={onOpen} />;
  if (page === 'performance') return <PerformancePage snap={snap} f={f} onOpen={onOpen} />;
  if (page === 'activity') return <ActivityPage snap={snap} f={f} feed={feed} onOpen={onOpen} />;
  if (page === 'close') return <ClosePage snap={snap} f={f} onOpen={onOpen} />;
  return <OverviewPage snap={snap} f={f} onOpen={onOpen} />;
}

interface FrameProps {
  readonly page: PageId;
  readonly range: RangeId;
  onPage: (next: PageId) => void;
  onRange: (next: RangeId) => void;
  onCommand: (id: string) => void;
  readonly model: DashboardModel;
  readonly actions: DashboardActions;
  readonly windowText: string;
}

/** Rail, command bar, aside, status bar, and whichever page is open in the middle. */
function DashboardFrame({ page, range, onPage, onRange, onCommand, model, actions, windowText }: FrameProps) {
  const snap = model.snap;
  return (
    <AppFrame
      navWidth={240}
      asideWidth={328}
      padded
      commands={
        <DashboardToolbar
          page={page}
          range={range}
          onRange={onRange}
          onCommand={onCommand}
          busy={actions.busy}
          loading={model.loading}
          windowText={windowText}
        />
      }
      nav={<PageRail page={page} onPage={onPage} snap={snap} windowText={windowText} />}
      aside={<AttentionPane snap={snap} onOpen={actions.open} />}
      status={
        <DashboardStatus
          snap={snap}
          currency={BOOK_CURRENCY}
          truncated={model.truncated}
          error={model.error}
          fetchedAt={model.fetchedAt}
        />
      }
    >
      <DashboardPages
        page={page}
        snap={snap}
        f={actions.formatters}
        feed={model.feed}
        onOpen={actions.open}
      />
    </AppFrame>
  );
}

export default function DashboardApp({ runtime }: AppEntryProps) {
  // One day, fixed for the life of the window: a dashboard whose "today" moved under a
  // person mid-morning would recompute every window it had already shown them.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [page, setPage] = useState<PageId>('overview');
  const [range, setRange] = useState<RangeId>('quarter');

  const model = useDashboardModel(range, BOOK_CURRENCY, today);
  const actions = useDashboardActions(BOOK_CURRENCY);
  const snap = model.snap;
  const locale = runtime.locale;
  const windowText = useMemo(() => windowLabel(snap.window, locale.t), [snap.window, locale.t]);

  /**
   * The one way in.
   *
   * The toolbar, the accelerators, the jump list and the palette all arrive here, and
   * `useAppCommands` also replays whatever verb this process was launched with — which
   * is what makes `page:position` in the jump list open on the position page rather
   * than on the overview and then jump.
   */
  const command = useCallback(
    (id: string) => {
      const next = PAGE_COMMAND[id];
      if (next !== undefined) setPage(next);
      else if (id === 'refresh') model.refresh();
      else if (id === 'copy') actions.copySummary(snap);
      else if (id === 'export') actions.exportCsv(snap, page);
    },
    [actions, model, page, snap],
  );
  useAppCommands(command);

  useWindowTitle(windowTitle(page, snap, locale));

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        const id = hotkey(event);
        if (id === null) return;
        event.preventDefault();
        command(id);
      }}
    >
      <DashboardFrame
        page={page}
        range={range}
        onPage={setPage}
        onRange={setRange}
        onCommand={command}
        model={model}
        actions={actions}
        windowText={windowText}
      />
    </div>
  );
}
