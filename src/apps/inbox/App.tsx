/**
 * Inbox — the shell.
 *
 * State, the command path, and the frame; every read and every derivation lives in
 * `model.ts` and `queue.ts`.
 *
 * One selection set does three jobs, which is why it is held here rather than in the
 * grid. One row selected is the reading pane's subject; several rows are the sweep's
 * scope; the checkboxes are how a person turns the first into the second. The model
 * is only ever told about a single selection — `selectedKey` is handed over only when
 * the set holds exactly one key — because loading an entry's lines and the chart of
 * accounts for eleven rows would be twenty-two queries nobody reads.
 *
 * Nothing here confirms anything. All three acts are privileged, so the kernel raises
 * its own consent, and every dataset refetches itself when the broker invalidates it
 * — an approved entry leaves the queue without being asked to. What this file does
 * after an act is drop the selection, because the row it named is gone.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useContextMenu,
  usePrincipal,
  useWindowTitle,
} from '@/platform/sdk';
import type { Currency, JournalEntry } from '../shared/ledger';
import { hotkey, type InboxBusy, type SweepReport, useInboxActions } from './actions';
import { InboxStatus, InboxToolbar, ItemMenu, QueueRail } from './chrome';
import { DetailPane } from './detail';
import { NoteDialog, RejectDialog, SweepDialog } from './dialogs';
import { QueueGrid } from './list';
import { type InboxModel, useInboxModel } from './model';
import {
  DEFAULT_FILTER,
  type InboxFilter,
  isFiltered,
  type QueueId,
  type SweepPlan,
  sweepPlan,
  type Viewer,
  type WorkItem,
} from './queue';

/**
 * The currency the queue's totals are shown in.
 *
 * `journal_entries` carries `total_debit` and `total_credit` but no currency column,
 * so the book's currency is the only honest label for a column of them added down.
 */
const BOOK_CURRENCY: Currency = 'DZD';

/** One empty set, so "nothing selected" is the same object every render. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/** The jump list's three entries, which are queue switches and nothing else. */
const QUEUE_COMMAND: Readonly<Record<string, QueueId | undefined>> = {
  'queue:approvals': 'approvals',
  'queue:checklist': 'checklist',
  'queue:decided': 'decided',
};

/** Reject needs a reason, a note is optional, and the sweep reports afterwards. */
type Modal =
  | { readonly kind: 'reject'; readonly item: WorkItem }
  | { readonly kind: 'note'; readonly item: WorkItem }
  | { readonly kind: 'sweep'; readonly report: SweepReport };

/** The one selected key, or null when nothing is selected and when a batch is. */
function soleKey(keys: ReadonlySet<string>): string | null {
  if (keys.size !== 1) return null;
  for (const key of keys) return key;
  return null;
}

/**
 * Who is looking.
 *
 * "Only mine" is exact rather than approximate: the sid is what `created_by` and
 * `owner_id` hold, and the e-mail is what the audit trail records as the actor.
 */
function useViewer(): Viewer {
  const principal = usePrincipal();
  const sid = principal?.sid ?? '';
  const email = principal?.email ?? '';
  return useMemo(() => ({ sid, email }), [sid, email]);
}

/**
 * The window's title, which is the queue and how much is in it.
 *
 * The count belongs there for the reason a mail client puts it there: the taskbar is
 * where a person looks while the window is behind something else.
 */
function windowTitle(queue: QueueId, total: number, locale: AppLocale): string {
  const name = locale.tr('صندوق الموافقات', 'Approbations', 'Inbox');
  const label =
    queue === 'approvals'
      ? locale.tr('في انتظار الاعتماد', 'À approuver', 'Waiting on you')
      : queue === 'checklist'
        ? locale.tr('خطوات الإقفال', 'Étapes de clôture', 'Close checklist')
        : locale.tr('قرارات سابقة', 'Décisions passées', 'Decided');
  return total === 0 ? `${name} — ${label}` : `${name} — ${label} (${fmt.integer(total, locale.lang)})`;
}

interface InboxAsideProps {
  readonly model: InboxModel;
  readonly plan: SweepPlan;
  readonly selectionSize: number;
  readonly queue: QueueId;
  readonly currency: Currency;
  readonly busy: InboxBusy;
  onOpenAccount: (accountId: string) => void;
  onSweep: () => void;
  onCommand: (id: string) => void;
}

/** The reading pane, in the aside's own gutter. */
function InboxAside({
  model,
  plan,
  selectionSize,
  queue,
  currency,
  busy,
  onOpenAccount,
  onSweep,
  onCommand,
}: InboxAsideProps) {
  return (
    <div style={{ padding: 12 }}>
      <DetailPane
        item={model.selected}
        selectionSize={selectionSize}
        plan={plan}
        queue={queue}
        tally={model.tally}
        lines={model.lines}
        linesLoading={model.linesLoading}
        period={model.period}
        dependencies={model.dependencies}
        tasks={model.tasks}
        currency={currency}
        busy={busy}
        accountLabelOf={model.accountLabelOf}
        onOpenAccount={onOpenAccount}
        onSweep={onSweep}
        onCommand={onCommand}
      />
    </div>
  );
}

interface InboxModalsProps {
  readonly modal: Modal | null;
  readonly busy: InboxBusy;
  onClose: () => void;
  onReject: (item: WorkItem, reason: string) => void;
  onApprove: (item: WorkItem, note: string) => void;
}

/**
 * Whichever dialog is open, and at most one ever is.
 *
 * Each keeps its own text, so mounting them conditionally is what discards a
 * half-typed reason when the dialog is dismissed — which is the behaviour a person
 * expects from Cancel.
 */
function InboxModals({ modal, busy, onClose, onReject, onApprove }: InboxModalsProps) {
  if (modal === null) return null;
  if (modal.kind === 'sweep') return <SweepDialog report={modal.report} onClose={onClose} />;
  if (modal.kind === 'reject') {
    return (
      <RejectDialog
        item={modal.item}
        busy={busy === 'reject'}
        onCancel={onClose}
        onConfirm={(reason) => onReject(modal.item, reason)}
      />
    );
  }
  return (
    <NoteDialog
      item={modal.item}
      busy={busy === 'approve'}
      onCancel={onClose}
      onConfirm={(note) => onApprove(modal.item, note)}
    />
  );
}

export default function InboxApp({ runtime }: AppEntryProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [filter, setFilter] = useState<InboxFilter>(DEFAULT_FILTER);
  const [selection, setSelection] = useState<ReadonlySet<string>>(NO_KEYS);
  const [modal, setModal] = useState<Modal | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu<WorkItem>();
  const actions = useInboxActions();
  const viewer = useViewer();

  // One key or none: an entry's lines are loaded for what is open, not for a batch.
  const selectedKey = useMemo(() => soleKey(selection), [selection]);

  const model = useInboxModel(filter, selectedKey, viewer, BOOK_CURRENCY, today);
  const selected = model.selected;
  const plan = useMemo(
    () => sweepPlan(model.visible, selection.size > 1 ? selection : null),
    [model.visible, selection],
  );
  const queueTotal = model.tally.byQueue[filter.queue];

  /* ---- the acts --------------------------------------------------- */

  // Every act takes its row out of the queue, so the selection that named it goes
  // with it — and a dialog that got what it asked for closes itself.
  const settle = useCallback((done: Promise<boolean>) => {
    void done.then((ok) => {
      if (!ok) return;
      setModal(null);
      setSelection(NO_KEYS);
    });
  }, []);

  const runSweep = useCallback(() => {
    const entries: JournalEntry[] = [];
    for (const item of plan.ready) if (item.entry !== null) entries.push(item.entry);
    if (entries.length === 0) return;
    void actions.sweep(entries).then((report) => {
      setSelection(NO_KEYS);
      setModal({ kind: 'sweep', report });
    });
  }, [actions, plan.ready]);

  // Keys are queue-scoped. A selection carried across would aim the sweep at rows
  // nobody can see.
  const setQueue = useCallback((queue: QueueId) => {
    setSelection(NO_KEYS);
    setFilter((current) => ({ ...current, queue }));
  }, []);

  const applyFilter = useCallback(
    (next: InboxFilter) => {
      if (next.queue !== filter.queue) setSelection(NO_KEYS);
      setFilter(next);
    },
    [filter.queue],
  );

  /* ---- the command path ------------------------------------------- */

  /**
   * The acts that need a row, on the row they were asked about.
   *
   * The row is passed in rather than read from the selection, because the row menu
   * is opened on whatever was right-clicked and a menu that acted on something else
   * would be a menu nobody could trust.
   */
  const actOn = useCallback(
    (id: string, item: WorkItem) => {
      const entry = item.entry;
      const task = item.task;
      if (id === 'copy') actions.copy(item, model.lines, model.accountLabelOf);
      else if (entry === null) {
        if (id === 'certify' && task !== null && item.canCertify) settle(actions.certify(task));
      } else if (id === 'approve' && item.canApprove) settle(actions.approve(entry, ''));
      else if (id === 'approve-note' && item.canApprove) setModal({ kind: 'note', item });
      else if (id === 'reject' && item.canReject) setModal({ kind: 'reject', item });
    },
    [actions, model.accountLabelOf, model.lines, settle],
  );

  const perform = useCallback(
    (id: string, item: WorkItem | null) => {
      const queue = QUEUE_COMMAND[id];
      if (queue !== undefined) setQueue(queue);
      else if (id === 'refresh') model.refresh();
      else if (id === 'find') searchRef.current?.focus();
      else if (id === 'export') actions.exportCsv(model.visible, filter.queue, today);
      else if (id === 'sweep') runSweep();
      else if (item !== null) actOn(id, item);
    },
    [actOn, actions, filter.queue, model, runSweep, setQueue, today],
  );

  // Toolbar, accelerators, jump list and command palette are one path in.
  const command = useCallback((id: string) => perform(id, selected), [perform, selected]);
  useAppCommands(command);

  const onMenuSelect = useCallback(
    (id: string) => {
      const target = menu.menu?.target ?? null;
      menu.close();
      if (target !== null) perform(id, target);
    },
    [menu, perform],
  );

  /* ---- window chrome ---------------------------------------------- */

  useWindowTitle(windowTitle(filter.queue, queueTotal, runtime.locale));

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        // A dialog owns the keyboard while it is open: Ctrl+Enter typed into a reject
        // reason must not approve the entry that dialog is about to refuse.
        if (modal !== null) return;
        const id = hotkey(event);
        if (id === null) return;
        event.preventDefault();
        command(id);
      }}
    >
      <AppFrame
        scroll={false}
        navWidth={236}
        asideWidth={352}
        commands={
          <InboxToolbar
            queue={filter.queue}
            search={filter.search}
            onSearch={(next) => setFilter((current) => ({ ...current, search: next }))}
            searchRef={searchRef}
            onCommand={command}
            busy={actions.busy}
            loading={model.loading}
            canApprove={selected !== null && selected.canApprove}
            canReject={selected !== null && selected.canReject}
            canCertify={selected !== null && selected.canCertify}
            canCopy={selected !== null}
            canExport={model.visible.length > 0}
            sweepCount={plan.ready.length}
            sweepScoped={selection.size > 1}
          />
        }
        nav={<QueueRail filter={filter} onFilter={applyFilter} tally={model.tally} />}
        aside={
          <InboxAside
            model={model}
            plan={plan}
            selectionSize={selection.size}
            queue={filter.queue}
            currency={BOOK_CURRENCY}
            busy={actions.busy}
            onOpenAccount={actions.openAccount}
            onSweep={runSweep}
            onCommand={command}
          />
        }
        status={
          <InboxStatus
            shown={model.visible.length}
            queueTotal={queueTotal}
            tally={model.tally}
            currency={BOOK_CURRENCY}
            truncated={model.truncated}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <QueueGrid
          queue={filter.queue}
          items={model.visible}
          loading={model.loading && model.items.length === 0}
          selection={selection}
          onSelectionChange={setSelection}
          // Double-click narrows a batch back to the row under the pointer, which is
          // how a person reads one of eleven things they have just ticked.
          onActivate={(item) => setSelection(new Set([item.key]))}
          onContextMenu={(item, event) => {
            setSelection(new Set([item.key]));
            menu.open(event, item);
          }}
          filtered={isFiltered(filter)}
        />
      </AppFrame>

      {menu.menu === null ? null : (
        <ItemMenu
          x={menu.menu.x}
          y={menu.menu.y}
          item={menu.menu.target}
          onSelect={onMenuSelect}
          onDismiss={menu.close}
        />
      )}

      <InboxModals
        modal={modal}
        busy={actions.busy}
        onClose={() => setModal(null)}
        onReject={(item, reason) => {
          if (item.entry !== null) settle(actions.reject(item.entry, reason));
        }}
        onApprove={(item, note) => {
          if (item.entry !== null) settle(actions.approve(item.entry, note));
        }}
      />
    </div>
  );
}
