/**
 * Ledger — the shell.
 *
 * Two views over one page of accounts. The reads and the derivation live in
 * `model.ts`; what is left here is state, the command path, and the frame.
 *
 * The frame is a tree and a drill, not a grid with a gutter. The chart of accounts is
 * navigation — a thing a person walks down — and what they walk down it *for* is one
 * account's general ledger. So the chart takes a resizable column and the account
 * takes the rest of the window, which is the opposite of how this app used to be
 * arranged: a table of every account's roll-ups had the page and the general ledger
 * had a 336-pixel aside. The table of roll-ups is still a press away under the trial
 * balance, which is what a table of every account's totals actually is.
 *
 * Two writes, both `upsert_chart_account`, both bound to `ledger.post`. The kernel
 * counts that as privileged and raises its own consent, so nothing in this app asks
 * "are you sure?" first — including the deactivation, which is the one act with
 * consequences outside this window and is therefore announced afterwards, with a
 * notification that carries the account id back.
 *
 * The chart's expansion is honoured only while nothing is narrowing the list. A
 * filtered tree opens itself, because expanding five levels by hand to reach the row
 * you just searched for is the behaviour that makes people stop using tree views.
 */
import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppFrame,
  type AppEntryProps,
  SplitPane,
  useAppCommands,
  useContextMenu,
  useDirtyState,
  useWindowTitle,
} from '@/platform/sdk';
import { type Account, type Currency, toCurrency } from '../shared/ledger';
import type { ExportFormat } from '../shared/export';
import { parseExportCommand } from '../shared/export/commands';
import {
  autoExpands,
  branchIds,
  chartTable,
  DEFAULT_FILTER,
  isFiltered,
  type LedgerFilter,
  type LedgerView,
  rollupOf,
  suggestedFileName,
  trialTable,
} from './accounts';
import { hotkey, type LedgerActions, useAccountFocus, useLedgerActions } from './actions';
import { AccountMenu, LedgerStatus, LedgerToolbar, ViewRail } from './chrome';
import { AccountDetail, ChartOverview } from './detail';
import { AccountDialog } from './dialogs';
import { type AccountDraft, draftFromAccount, emptyDraft, hasContent, patchDraft, suggestCode } from './form';
import { type ChartModel, useChartModel } from './model';
import { ChartTree, TrialGrid } from './tree';

/**
 * The currency the page totals are shown in.
 *
 * `trialBalance` carries a currency per row, but a column of mixed symbols added
 * down is a wrong number however it is labelled. So the status bar states the book's
 * currency, and the detail pane, which is about one account, states that account's.
 */
const BOOK_CURRENCY: Currency = 'DZD';

interface LedgerDrillProps {
  readonly model: ChartModel;
  readonly actions: LedgerActions;
  readonly currency: Currency;
  readonly onEdit: (account: Account) => void;
  readonly onNewChild: (account: Account) => void;
}

/**
 * One account in full, or the chart in summary.
 *
 * This is the drill half of the window, and it carries its own scroller. It used to
 * be the frame's aside — a 336-pixel column with `overflow: auto` on it — which meant
 * the general ledger of an account, the longest thing this app ever shows, had the
 * least room of anything on screen. Moving it beside the tree gave it the width; the
 * scroller had to come with it, because the column that was providing one is gone.
 */
function LedgerDrill({ model, actions, currency, onEdit, onNewChild }: LedgerDrillProps) {
  const account = model.selected;
  if (account === null) {
    return (
      <div className="fx-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        <ChartOverview
          tally={model.tally}
          slices={model.slices}
          totals={model.totals}
          currency={currency}
        />
      </div>
    );
  }
  return (
    <div
      className="fx-scroll"
      style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}
    >
      <AccountDetail
        account={account}
        totals={model.selectedTotals}
        parent={model.parent}
        childCount={model.childCount}
        postings={model.postings}
        loading={model.postingsLoading}
        currency={toCurrency(account.currency)}
        busy={actions.busy}
        onEdit={() => onEdit(account)}
        onToggleActive={() => actions.setActive(account, !account.active)}
        onNewChild={() => onNewChild(account)}
        onCopy={() => actions.copy(account, model.selectedTotals, model.postings)}
      />
    </div>
  );
}

interface LedgerCanvasProps {
  readonly model: ChartModel;
  readonly actions: LedgerActions;
  readonly filter: LedgerFilter;
  readonly selectedId: string | null;
  readonly setSelectedId: (id: string | null) => void;
  readonly setExpanded: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly setView: (view: LedgerView) => void;
  readonly onEdit: (account: Account) => void;
  readonly onNewChild: (account: Account) => void;
  readonly onContextMenu: (account: Account, event: MouseEvent) => void;
}

/**
 * The centre: a chart to walk and an account to read, or the trial balance.
 *
 * Under the chart view the window is a splitter, because the two halves are a
 * navigation and the thing it navigates to — a person dragging the grip is saying
 * "my codes are short, give the ledger the room", and that is a judgement only they
 * can make. Under the trial balance there is no splitter and no tree: a trial balance
 * is a report about every account at once, so there is nothing to select *within* it
 * that the other half would react to, and a report gets the whole page.
 *
 * Double-click in the trial balance goes back to the chart with the row selected,
 * because a balance line answers "how much" and only the tree answers "where". The
 * chart has no double-click of its own any more — it used to open the account for
 * editing, and the Edit button is now permanently on screen beside the account rather
 * than three hundred pixels away in a gutter.
 */
function LedgerCanvas({
  model,
  actions,
  filter,
  selectedId,
  setSelectedId,
  setExpanded,
  setView,
  onEdit,
  onNewChild,
  onContextMenu,
}: LedgerCanvasProps) {
  if (filter.view === 'trial') {
    return (
      <TrialGrid
        rows={model.trialRows}
        totals={model.totals}
        loading={model.loading && model.trialRows.length === 0}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onActivate={(accountId) => {
          setView('chart');
          setSelectedId(accountId);
        }}
        filtered={isFiltered(filter)}
      />
    );
  }
  return (
    <SplitPane
      // 300 and a 220 floor: the splitter stacks below 440, and the narrowest window
      // the manifest allows leaves 544 of content, where the clamp hands the tree 300
      // and the account 239. Wider than that and every extra pixel goes to the
      // account, which is the half with a table in it.
      initial={300}
      min={220}
      max={560}
      first={
        <ChartTree
          rows={model.rows}
          rollups={model.rollups}
          loading={model.loading && model.accounts.length === 0}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={(accountId) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (!next.delete(accountId)) next.add(accountId);
              return next;
            })
          }
          onContextMenu={onContextMenu}
          filtered={isFiltered(filter)}
          autoExpanded={autoExpands(filter)}
        />
      }
      second={
        <LedgerDrill
          model={model}
          actions={actions}
          currency={BOOK_CURRENCY}
          onEdit={onEdit}
          onNewChild={onNewChild}
        />
      }
    />
  );
}

export default function LedgerApp({ runtime }: AppEntryProps) {
  const { tr } = runtime.locale;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [filter, setFilter] = useState<LedgerFilter>(DEFAULT_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu<Account>();
  const actions = useLedgerActions();
  const model = useChartModel(filter, expanded, selectedId);

  /* ---- drafts ----------------------------------------------------- */

  // Own lines, not the branch's: `upsert_chart_account` refuses a retype when *this*
  // account has been posted to, and a parent's children are not its postings.
  const openEdit = useCallback(
    (account: Account) => {
      setDraft(draftFromAccount(account, (model.trial.get(account.id)?.lines ?? 0) > 0));
    },
    [model.trial],
  );

  const openNew = useCallback(
    (parent: Account | null) => {
      setDraft(emptyDraft(parent, suggestCode(model.accounts, parent?.type ?? 'ASSET', parent)));
    },
    [model.accounts],
  );

  const save = useCallback(() => {
    if (draft === null) return;
    void actions.save(draft).then((ok) => {
      if (ok) setDraft(null);
    });
  }, [actions, draft]);

  /* ---- commands --------------------------------------------------- */

  const exportNow = useCallback(
    (format: ExportFormat) => {
      const doc =
        filter.view === 'trial'
          ? trialTable(model.trialRows, tr)
          : chartTable(model.rows, model.rollups, model.index.byId, tr);
      actions.exportTable(doc, suggestedFileName(filter.view, today), format);
    },
    [actions, filter.view, model.index.byId, model.rollups, model.rows, model.trialRows, today, tr],
  );

  const command = useCallback(
    (id: string) => {
      // A new account files itself beside the selection, because that is where a
      // chart grows. "New child" on the aside is the one that files underneath.
      if (id === 'new') openNew(model.selected === null ? null : model.parent);
      else if (id === 'edit') {
        if (model.selected !== null) openEdit(model.selected);
      } else if (id === 'refresh') model.refresh();
      else if (id === 'find') searchRef.current?.focus();
      else if (id === 'expand') setExpanded(new Set(branchIds(model.accounts)));
      else if (id === 'collapse') setExpanded(new Set<string>());
      else if (id === 'view:chart') setFilter((current) => ({ ...current, view: 'chart' }));
      else if (id === 'view:trial') setFilter((current) => ({ ...current, view: 'trial' }));
      else {
        const format = parseExportCommand(id);
        if (format !== null) exportNow(format);
      }
    },
    [exportNow, model, openEdit, openNew],
  );

  // Accelerator, jump list and command palette are one path in and one out.
  useAppCommands((commandId) => command(commandId));
  useAccountFocus((accountId) => {
    // The only launch that names an account is the deactivation notice, so the page
    // is widened to include inactive rows before the selection lands on one.
    setFilter((current) => ({ ...current, view: 'chart', showInactive: true }));
    setSelectedId(accountId);
  });

  const onMenuSelect = useCallback(
    (id: string) => {
      const account = menu.menu?.target ?? null;
      menu.close();
      if (account === null) return;
      if (id === 'edit') openEdit(account);
      else if (id === 'child') openNew(account);
      else if (id === 'toggle') actions.setActive(account, !account.active);
      else if (id === 'trial') {
        setFilter((current) => ({ ...current, view: 'trial' }));
        setSelectedId(account.id);
      } else if (id === 'copy') {
        // Postings are only loaded for the selection, and a clipboard entry that
        // silently omits the ledger it promised is worse than one without it.
        const postings = account.id === selectedId ? model.postings : [];
        actions.copy(account, rollupOf(model.rollups, account.id), postings);
      }
    },
    [actions, menu, model.postings, model.rollups, openEdit, openNew, selectedId],
  );

  /* ---- window chrome ---------------------------------------------- */

  const viewLabel =
    filter.view === 'trial'
      ? tr('ميزان المراجعة', 'Balance générale', 'Trial balance')
      : tr('دليل الحسابات', 'Plan comptable', 'Chart of accounts');
  useWindowTitle(`${tr('دليل الحسابات', 'Plan comptable', 'Ledger')} — ${viewLabel}`);
  useDirtyState(draft !== null && hasContent(draft));

  const shown = filter.view === 'trial' ? model.trialRows.length : model.rows.length;

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
      <AppFrame
        scroll={false}
        navWidth={236}
        commands={
          <LedgerToolbar
            view={filter.view}
            search={filter.search}
            onSearch={(next) => setFilter((current) => ({ ...current, search: next }))}
            searchRef={searchRef}
            onCommand={command}
            busy={actions.busy}
            loading={model.loading}
            canEdit={model.selected !== null}
            canExport={shown > 0}
          />
        }
        nav={<ViewRail filter={filter} onFilter={setFilter} tally={model.tally} />}
        status={
          <LedgerStatus
            shown={shown}
            loaded={model.tally.loaded}
            orphans={model.tally.orphans}
            debit={model.totals.debit}
            credit={model.totals.credit}
            difference={model.totals.difference}
            lines={model.totals.lines}
            currency={BOOK_CURRENCY}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <LedgerCanvas
          model={model}
          actions={actions}
          filter={filter}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          setExpanded={setExpanded}
          setView={(view) => setFilter((current) => ({ ...current, view }))}
          onEdit={openEdit}
          onNewChild={openNew}
          onContextMenu={(account, event) => {
            setSelectedId(account.id);
            menu.open(event, account);
          }}
        />
      </AppFrame>

      {menu.menu === null ? null : (
        <AccountMenu
          x={menu.menu.x}
          y={menu.menu.y}
          account={menu.menu.target}
          activeChildren={
            (model.index.children.get(menu.menu.target.id) ?? []).filter((child) => child.active).length
          }
          onSelect={onMenuSelect}
          onDismiss={menu.close}
        />
      )}

      {draft === null ? null : (
        <AccountDialog
          open
          draft={draft}
          original={draft.id === null ? null : model.index.byId.get(draft.id) ?? null}
          accounts={model.accounts}
          busy={actions.busy === 'save'}
          onPatch={(patch) => setDraft((current) => (current === null ? null : patchDraft(current, patch)))}
          onSubmit={save}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
}

