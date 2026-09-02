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
 * Nothing here confirms anything. The three ledger acts are privileged, so the kernel
 * raises its own consent in front of those; the three handoff acts are not, so they
 * run on a grant the role either holds or does not. Either way every dataset refetches
 * itself when the broker invalidates it — an approved entry leaves the queue without
 * being asked to, and an answered handoff leaves it too, because the projection behind
 * that queue returns live rows only. What this file does after an act is drop the
 * selection, because the row it named is gone.
 */
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  type ContextMenuController,
  fmt,
  useAppCommands,
  useContextMenu,
  usePrincipal,
  useWindowTitle,
} from '@/platform/sdk';
import type { Currency, JournalEntry } from '../shared/ledger';
import { hotkey, type InboxActions, type InboxBusy, type SweepReport, useInboxActions } from './actions';
import { InboxStatus, InboxToolbar, ItemMenu, QueueRail } from './chrome';
import { DetailPane } from './detail';
import { DeclineDialog, NoteDialog, RejectDialog, SweepDialog } from './dialogs';
import { QueueGrid } from './list';
import { type InboxModel, useInboxModel } from './model';
import {
  DEFAULT_FILTER,
  type HandoffActs,
  handoffActs,
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

/** The jump list's four entries, which are queue switches and nothing else. */
const QUEUE_COMMAND: Readonly<Record<string, QueueId | undefined>> = {
  'queue:approvals': 'approvals',
  'queue:checklist': 'checklist',
  'queue:handoffs': 'handoffs',
  'queue:decided': 'decided',
};

/**
 * Reject and decline both need a reason, a note is optional, and the sweep reports
 * afterwards.
 *
 * `reject` and `decline` are separate variants rather than one "reason" dialog because
 * they refuse different things to different audiences: a rejection voids an entry in
 * this book, a decline is an answer sent back to the department that asked.
 */
type Modal =
  | { readonly kind: 'reject'; readonly item: WorkItem }
  | { readonly kind: 'decline'; readonly item: WorkItem }
  | { readonly kind: 'note'; readonly item: WorkItem }
  | { readonly kind: 'sweep'; readonly report: SweepReport };

/** The one selected key, or null when nothing is selected and when a batch is. */
function soleKey(keys: ReadonlySet<string>): string | null {
  if (keys.size !== 1) return null;
  for (const key of keys) return key;
  return null;
}

/**
 * Which of the three handoff acts a command id means, or null when it means none.
 *
 * Two of the ids arrive as intentions rather than as names: `Ctrl+Enter` reaches this
 * window as `'approve'` and `Ctrl+Backspace` as `'reject'`, because those two keys mean
 * "the affirmative act" and "the refusal" on whatever is selected. Resolving them here,
 * against what the row permits rather than against its status, is what keeps the two
 * spellings of one intention from drifting apart.
 *
 * The affirmative tries accept before complete, and that ordering *is* the two-step:
 * `accept` holds only while the handoff is still OPEN, so the first press claims the
 * work and a second press finishes it. Both at once would put one name and one
 * timestamp against two facts that did not happen together.
 */
function handoffAct(id: string, acts: HandoffActs): 'accept' | 'complete' | 'decline' | null {
  if (id === 'accept') return acts.accept ? 'accept' : null;
  if (id === 'complete') return acts.complete ? 'complete' : null;
  if (id === 'decline' || id === 'reject') return acts.decline ? 'decline' : null;
  if (id !== 'approve') return null;
  if (acts.accept) return 'accept';
  return acts.complete ? 'complete' : null;
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
  // A record rather than a ternary chain. `Record<QueueId, string>` is checked for
  // exhaustiveness, so a fifth queue fails to compile here instead of quietly
  // inheriting whichever label happened to be written last.
  const labels: Readonly<Record<QueueId, string>> = {
    approvals: locale.tr('في انتظار الاعتماد', 'À approuver', 'Waiting on you'),
    checklist: locale.tr('خطوات الإقفال', 'Étapes de clôture', 'Close checklist'),
    handoffs: locale.tr('تحويلات بين الأقسام', 'Transmissions', 'Handoffs'),
    decided: locale.tr('قرارات سابقة', 'Décisions passées', 'Decided'),
  };
  const label = labels[queue];
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
        chain={model.chain}
        chainLoading={model.chainLoading}
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
  onDecline: (item: WorkItem, note: string) => void;
  onApprove: (item: WorkItem, note: string) => void;
}

/**
 * Whichever dialog is open, and at most one ever is.
 *
 * Each keeps its own text, so mounting them conditionally is what discards a
 * half-typed reason when the dialog is dismissed — which is the behaviour a person
 * expects from Cancel.
 *
 * The note dialog is last because by then `modal.kind` is narrowed to `'note'` and
 * nothing else remains — it is the last arm, not the default one.
 */
function InboxModals({ modal, busy, onClose, onReject, onDecline, onApprove }: InboxModalsProps) {
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
  if (modal.kind === 'decline') {
    return (
      <DeclineDialog
        item={modal.item}
        busy={busy === 'decline'}
        onCancel={onClose}
        onConfirm={(note) => onDecline(modal.item, note)}
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

/**
 * What the command path needs from the shell.
 *
 * Split by what it does with each: the first eight are read, the last three move
 * something. Passed as one object rather than eleven positional arguments because a
 * call site with eleven bare identifiers in a row is a call site nobody can check.
 */
interface CommandPathOptions {
  readonly actions: InboxActions;
  readonly model: InboxModel;
  readonly plan: SweepPlan;
  readonly filter: InboxFilter;
  readonly selected: WorkItem | null;
  readonly today: string;
  readonly searchRef: RefObject<HTMLInputElement>;
  readonly menu: ContextMenuController<WorkItem>;
  /** Takes the updater form: a queue switch edits one field of whatever is current. */
  readonly setFilter: Dispatch<SetStateAction<InboxFilter>>;
  readonly setSelection: (keys: ReadonlySet<string>) => void;
  readonly setModal: (modal: Modal | null) => void;
}

/**
 * What the frame renders against.
 *
 * `actOn`, `perform` and `setQueue` are deliberately not here. They are how an id
 * becomes an act, and nothing outside this path should be able to skip a step of that.
 */
interface CommandPath {
  /** Shared with the modal callbacks, which finish the same acts from a dialog. */
  settle: (done: Promise<boolean>) => void;
  runSweep: () => void;
  applyFilter: (next: InboxFilter) => void;
  /** One id in, whatever that id means for the row the selection currently names. */
  command: (id: string) => void;
  onMenuSelect: (id: string) => void;
}

/**
 * The command path: one function from a command id to an act.
 *
 * Five things reach it — the toolbar, the in-window accelerators, the taskbar jump
 * list, the row's context menu and the command palette — and all five arrive as a
 * string id. Resolving that id in one place is what stops them disagreeing: a palette
 * that approves a row the toolbar would have refused is worse than either being wrong
 * on its own, because nobody can see which of the two lied.
 *
 * It is a hook rather than a stretch of the component for the same reason
 * `useHandoffCommands` is one: the component was over this project's 180-line budget,
 * and this is the half of it that is about acts rather than about layout. The sibling
 * close app cut the identical seam at `useCloseCommandPath`, so this is a shape the OS
 * already has rather than a boundary invented here.
 *
 * Everything is handed in, nothing re-derived. A second `useInboxActions()` would give
 * the window two answers to "what is in flight", and a second `useState` would give it
 * two selections to clear.
 */
function useInboxCommandPath(options: CommandPathOptions): CommandPath {
  const { actions, model, plan, filter, selected, today, searchRef, menu } = options;
  const { setFilter, setSelection, setModal } = options;

  // Every act takes its row out of the queue, so the selection that named it goes
  // with it — and a dialog that got what it asked for closes itself.
  const settle = useCallback(
    (done: Promise<boolean>) => {
      void done.then((ok) => {
        if (!ok) return;
        setModal(null);
        setSelection(NO_KEYS);
      });
    },
    [setModal, setSelection],
  );

  const runSweep = useCallback(() => {
    const entries: JournalEntry[] = [];
    for (const item of plan.ready) if (item.entry !== null) entries.push(item.entry);
    if (entries.length === 0) return;
    void actions.sweep(entries).then((report) => {
      setSelection(NO_KEYS);
      setModal({ kind: 'sweep', report });
    });
  }, [actions, plan.ready, setModal, setSelection]);

  // Keys are queue-scoped. A selection carried across would aim the sweep at rows
  // nobody can see.
  const setQueue = useCallback(
    (queue: QueueId) => {
      setSelection(NO_KEYS);
      setFilter((current) => ({ ...current, queue }));
    },
    [setFilter, setSelection],
  );

  const applyFilter = useCallback(
    (next: InboxFilter) => {
      if (next.queue !== filter.queue) setSelection(NO_KEYS);
      setFilter(next);
    },
    [filter.queue, setFilter, setSelection],
  );

  /**
   * The acts that need a row, on the row they were asked about.
   *
   * The row is passed in rather than read from the selection, because the row menu
   * is opened on whatever was right-clicked and a menu that acted on something else
   * would be a menu nobody could trust.
   *
   * The payload is the discriminator, not `kind`: `WorkItem` holds all four sources in
   * one shape, so `handoff`/`task`/`entry` are what actually prove there is something
   * to act on — and each arm is gated a second time by what that row permits. Copy is
   * settled before any of them, because it is the one act every kind answers to.
   */
  const actOn = useCallback(
    (id: string, item: WorkItem) => {
      if (id === 'copy') {
        actions.copy(item, model.lines, model.accountLabelOf);
        return;
      }
      const handoff = item.handoff;
      if (handoff !== null) {
        const act = handoffAct(id, handoffActs(item));
        if (act === 'accept') settle(actions.accept(handoff));
        else if (act === 'complete') settle(actions.complete(handoff));
        // Only the refusal opens a dialog, because only the refusal has something that
        // has to be typed: the note is the answer sent back to the desk that asked.
        else if (act === 'decline') setModal({ kind: 'decline', item });
        return;
      }
      const task = item.task;
      if (task !== null) {
        if (id === 'certify' && item.canCertify) settle(actions.certify(task));
        return;
      }
      const entry = item.entry;
      if (entry === null) return;
      if (id === 'approve' && item.canApprove) settle(actions.approve(entry, ''));
      else if (id === 'approve-note' && item.canApprove) setModal({ kind: 'note', item });
      else if (id === 'reject' && item.canReject) setModal({ kind: 'reject', item });
    },
    [actions, model.accountLabelOf, model.lines, setModal, settle],
  );

  /**
   * The five window-level ids, then everything that needs a row.
   *
   * `item` is nullable because four of the five need no row at all: switching queues,
   * refreshing, focusing the search box and exporting the visible list are all about
   * the window, not about a selection. The sweep is the fifth, and it reads `plan`
   * rather than `item` for the same reason.
   */
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
    [actOn, actions, filter.queue, model, runSweep, searchRef, setQueue, today],
  );

  // The toolbar, the accelerators, the jump list and the palette all mean "the row the
  // selection names", so they share one entry point. `useAppCommands` is what puts the
  // last two of those four on it.
  const command = useCallback((id: string) => perform(id, selected), [perform, selected]);
  useAppCommands(command);

  // The row menu is the exception: it means the row that was right-clicked, which is
  // not always the row the selection names.
  const onMenuSelect = useCallback(
    (id: string) => {
      const target = menu.menu?.target ?? null;
      menu.close();
      if (target !== null) perform(id, target);
    },
    [menu, perform],
  );

  return { settle, runSweep, applyFilter, command, onMenuSelect };
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
  // Asked once about the selected row, not again at each button, so the three handoff
  // buttons cannot disagree with the row menu about the same handoff.
  const acts = useMemo(() => handoffActs(selected), [selected]);

  /* ---- the command path ------------------------------------------- */

  // Toolbar, accelerators, jump list, row menu and command palette are one path in,
  // and it is long enough to be its own hook. What comes back is only what the frame
  // below renders against: three handlers it hands to children, and `settle`, which
  // the modal callbacks share with the acts inside.
  const { settle, runSweep, applyFilter, command, onMenuSelect } = useInboxCommandPath({
    actions,
    model,
    plan,
    filter,
    selected,
    today,
    searchRef,
    menu,
    setFilter,
    setSelection,
    setModal,
  });

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
            canAccept={acts.accept}
            canComplete={acts.complete}
            canDecline={acts.decline}
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
        onDecline={(item, note) => {
          if (item.handoff !== null) settle(actions.decline(item.handoff, note));
        }}
        onApprove={(item, note) => {
          if (item.entry !== null) settle(actions.approve(item.entry, note));
        }}
      />
    </div>
  );
}
