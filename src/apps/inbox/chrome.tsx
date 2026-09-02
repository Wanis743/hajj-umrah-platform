/**
 * Inbox — command bar, queue rail, status bar and the row menu.
 *
 * Stateless chrome: each piece takes what it shows and reports what was pressed.
 *
 * The command bar changes with the queue, because the queues are not four views of
 * one list — they are four different acts. Approvals get Approve and Reject and the
 * sweep; the checklist gets Certify; handoffs get Accept, Complete and Decline,
 * which is the whole vocabulary of work passed between desks; the decided queue gets
 * nothing to press, which is correct, since nothing in it is still a decision.
 *
 * The sweep's label always states its count, and states whether a selection scoped
 * it. "Approve all ready (12)" and "Approve 3 selected" are different promises, and
 * a button that makes twelve changes should say twelve before it is pressed.
 */
import {
  ArrowLeftRight,
  Ban,
  BadgeCheck,
  Check,
  CheckCheck,
  ClipboardCopy,
  Clock,
  FileDown,
  History,
  Inbox,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  StickyNote,
  Wallet,
} from 'lucide-react';
import type { Ref } from 'react';
import {
  Button,
  Checkbox,
  fmt,
  type MenuEntry,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  Select,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useApp,
} from '@/platform/sdk';
import type { Currency } from '../shared/ledger';
import type { InboxBusy } from './actions';
import {
  AGE_CHOICES,
  AGE_DANGER,
  handoffActs,
  type InboxFilter,
  type InboxTally,
  type QueueId,
  type WorkItem,
} from './queue';

/* ------------------------------------------------------------------ *
 * Command bar
 * ------------------------------------------------------------------ */

export interface InboxToolbarProps {
  readonly queue: QueueId;
  readonly search: string;
  readonly onSearch: (next: string) => void;
  /** Held by the shell so Ctrl+F can put the caret here. */
  readonly searchRef: Ref<HTMLInputElement>;
  readonly onCommand: (id: string) => void;
  readonly busy: InboxBusy;
  readonly loading: boolean;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canCertify: boolean;
  /**
   * The three handoff acts, computed by the caller with `handoffActs` — the one
   * mirror of the server guard's status rule. Passed in rather than read off the row
   * here so the toolbar and the row menu cannot drift into disagreeing about which
   * of accept, complete and decline a handoff is currently open to.
   */
  readonly canAccept: boolean;
  readonly canComplete: boolean;
  readonly canDecline: boolean;
  readonly canCopy: boolean;
  readonly canExport: boolean;
  /** How many entries the sweep would post. */
  readonly sweepCount: number;
  /** True when a multi-selection scoped the sweep to itself. */
  readonly sweepScoped: boolean;
}

export function InboxToolbar({
  queue,
  search,
  onSearch,
  searchRef,
  onCommand,
  busy,
  loading,
  canApprove,
  canReject,
  canCertify,
  canAccept,
  canComplete,
  canDecline,
  canCopy,
  canExport,
  sweepCount,
  sweepScoped,
}: InboxToolbarProps) {
  const { tr, lang } = useApp().locale;
  const count = fmt.integer(sweepCount, lang);
  return (
    <>
      {queue === 'approvals' ? (
        <>
          <Button
            size="sm"
            variant="accent"
            icon={Check}
            busy={busy === 'approve'}
            disabled={!canApprove}
            onClick={() => onCommand('approve')}
            title={tr('اعتماد القيد (Ctrl+Enter)', 'Approuver (Ctrl+Entrée)', 'Approve (Ctrl+Enter)')}
          >
            {tr('اعتماد', 'Approuver', 'Approve')}
          </Button>
          <Button
            size="sm"
            icon={Ban}
            busy={busy === 'reject'}
            disabled={!canReject}
            onClick={() => onCommand('reject')}
            title={tr(
              'رفض القيد بسبب (Ctrl+Backspace)',
              'Refuser avec un motif (Ctrl+Retour arrière)',
              'Reject with a reason (Ctrl+Backspace)',
            )}
          >
            {tr('رفض…', 'Refuser…', 'Reject…')}
          </Button>
          <ToolbarSeparator />
          <Button
            size="sm"
            icon={CheckCheck}
            busy={busy === 'sweep'}
            disabled={sweepCount === 0}
            onClick={() => onCommand('sweep')}
            title={tr(
              'موافقة واحدة من النظام، ثم الدفعة كلها.',
              'Un seul consentement du système, puis tout le lot.',
              'One consent from the system, then the whole batch.',
            )}
          >
            {sweepScoped
              ? tr(`اعتماد ${count} محددًا`, `Approuver ${count} sélectionnés`, `Approve ${count} selected`)
              : tr(`اعتماد الجاهز (${count})`, `Approuver le prêt (${count})`, `Approve all ready (${count})`)}
          </Button>
        </>
      ) : null}
      {queue === 'checklist' ? (
        <Button
          size="sm"
          variant="accent"
          icon={BadgeCheck}
          busy={busy === 'certify'}
          disabled={!canCertify}
          onClick={() => onCommand('certify')}
          title={tr('تصديق الخطوة (Ctrl+Shift+C)', 'Certifier (Ctrl+Maj+C)', 'Certify (Ctrl+Shift+C)')}
        >
          {tr('تصديق', 'Certifier', 'Certify')}
        </Button>
      ) : null}
      {queue === 'handoffs' ? (
        <>
          <Button
            size="sm"
            variant="accent"
            icon={Check}
            busy={busy === 'accept'}
            disabled={!canAccept}
            onClick={() => onCommand('accept')}
            title={tr(
              'تولّي التحويل: يصير باسمك، ويرى القسم المُحوِّل ذلك.',
              'Prendre en charge : la transmission passe à votre nom, et le service émetteur le voit.',
              'Take the handoff: it moves to your name, and the sending desk sees that.',
            )}
          >
            {tr('قبول', 'Prendre en charge', 'Accept')}
          </Button>
          <Button
            size="sm"
            icon={CheckCheck}
            busy={busy === 'complete'}
            disabled={!canComplete}
            onClick={() => onCommand('complete')}
            title={tr(
              'إنجاز التحويل وإعادته إلى السلسلة.',
              'Terminer la transmission et la rendre à la chaîne.',
              'Finish the handoff and hand it back to the chain.',
            )}
          >
            {tr('إنجاز', 'Terminer', 'Complete')}
          </Button>
          {/* No separator before this one. On the approvals bar a separator means "a
              different kind of act" — the bulk sweep, not the single decision — and
              declining one handoff is the same kind of act as accepting it. */}
          <Button
            size="sm"
            icon={Ban}
            busy={busy === 'decline'}
            disabled={!canDecline}
            onClick={() => onCommand('decline')}
            title={tr(
              'رفض التحويل بسبب يقرأه القسم المُحوِّل.',
              'Refuser avec un motif que le service émetteur lira.',
              'Decline with a reason the sending desk will read.',
            )}
          >
            {tr('رفض…', 'Refuser…', 'Decline…')}
          </Button>
        </>
      ) : null}
      {queue === 'decided' ? (
        <Button size="sm" icon={ClipboardCopy} disabled={!canCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ', 'Copier', 'Copy')}
        </Button>
      ) : null}
      <ToolbarSeparator />
      <Button size="sm" icon={RefreshCw} busy={loading} onClick={() => onCommand('refresh')}>
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <ToolbarSeparator />
      <SearchBox
        ref={searchRef}
        value={search}
        onChange={onSearch}
        width={236}
        placeholder={tr('المرجع أو الوصف أو الشخص', 'Référence, libellé ou personne', 'Reference, detail or person')}
      />
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={FileDown}
        busy={busy === 'export'}
        disabled={!canExport}
        onClick={() => onCommand('export')}
        title={tr('تصدير المعروض إلى CSV', 'Exporter l’affichage en CSV', 'Export what is on screen as CSV')}
      >
        {tr('تصدير CSV', 'Exporter CSV', 'Export CSV')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Queue rail
 * ------------------------------------------------------------------ */

export interface QueueRailProps {
  readonly filter: InboxFilter;
  readonly onFilter: (next: InboxFilter) => void;
  readonly tally: InboxTally;
}

/**
 * The four queues and the three narrowings.
 *
 * Handoffs sit third, between this desk's own work and the archive of what it has
 * already settled, because that is the order of obligation: what only you can
 * approve, what the close is waiting on, what another desk is waiting on, and then
 * what is over.
 *
 * The badges count the whole queue, not the filtered view, so switching queues
 * always tells the truth about what is over there — a rail that counted the filter
 * would read zero on every queue the search does not match, which is the one moment
 * a person needs to know the other queues are not empty.
 */
export function QueueRail({ filter, onFilter, tally }: QueueRailProps) {
  const { tr, lang } = useApp().locale;
  const patch = (next: Partial<InboxFilter>) => onFilter({ ...filter, ...next });
  const badge = (count: number): number | null => (count === 0 ? null : count);
  const suffix = (count: number): string => (count === 0 ? '' : ` (${fmt.integer(count, lang)})`);
  return (
    <>
      <NavGroupLabel>{tr('القوائم', 'Files', 'Queues')}</NavGroupLabel>
      <NavItem
        icon={Inbox}
        label={tr('في انتظار الاعتماد', 'À approuver', 'Waiting on you')}
        selected={filter.queue === 'approvals'}
        badge={badge(tally.byQueue.approvals)}
        onClick={() => patch({ queue: 'approvals' })}
      />
      <NavItem
        icon={ListChecks}
        label={tr('خطوات الإقفال', 'Étapes de clôture', 'Close checklist')}
        selected={filter.queue === 'checklist'}
        badge={badge(tally.byQueue.checklist)}
        onClick={() => patch({ queue: 'checklist' })}
      />
      <NavItem
        icon={ArrowLeftRight}
        label={tr('تحويلات', 'Transmissions', 'Handoffs')}
        selected={filter.queue === 'handoffs'}
        badge={badge(tally.byQueue.handoffs)}
        onClick={() => patch({ queue: 'handoffs' })}
      />
      <NavItem
        icon={History}
        label={tr('قرارات سابقة', 'Décisions passées', 'Decided')}
        selected={filter.queue === 'decided'}
        badge={badge(tally.byQueue.decided)}
        onClick={() => patch({ queue: 'decided' })}
      />
      <NavGroupLabel>{tr('التصفية', 'Filtres', 'Narrow')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 8, padding: '2px 10px 10px' }}>
        <Checkbox
          checked={filter.mineOnly}
          onChange={(next) => patch({ mineOnly: next })}
          label={`${tr('ما يخصّني فقط', 'Seulement les miens', 'Only mine')}${suffix(tally.mine)}`}
        />
        <Checkbox
          checked={filter.hideBlocked}
          onChange={(next) => patch({ hideBlocked: next })}
          label={`${tr('إخفاء المعلّق', 'Masquer les bloqués', 'Hide blocked')}${suffix(tally.blocked)}`}
        />
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fx-text-secondary)' }}>
          {tr('انتظر على الأقل', 'En attente depuis', 'Waiting at least')}
          <Select
            value={String(filter.minAge)}
            onChange={(next) => patch({ minAge: Number(next) })}
            options={AGE_CHOICES.map((days) => ({
              value: String(days),
              label:
                days === 0
                  ? tr('أي مدة', 'Peu importe', 'Any age')
                  : tr(
                      `${fmt.integer(days, lang)} يوم أو أكثر`,
                      `${fmt.integer(days, lang)} jour(s) ou plus`,
                      `${fmt.integer(days, lang)} day${days === 1 ? '' : 's'} or more`,
                    ),
            }))}
          />
        </label>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

export interface InboxStatusProps {
  readonly shown: number;
  readonly queueTotal: number;
  readonly tally: InboxTally;
  readonly currency: Currency;
  /** One of the three sources came back at its ceiling. */
  readonly truncated: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function InboxStatus({
  shown,
  queueTotal,
  tally,
  currency,
  truncated,
  error,
  fetchedAt,
}: InboxStatusProps) {
  const { tr, lang } = useApp().locale;
  const counts = `${fmt.integer(shown, lang)} / ${fmt.integer(queueTotal, lang)}`;
  return (
    <>
      <StatusItem icon={Inbox} title={tr('المعروض من القائمة', 'Affichés sur la file', 'Shown of queue')}>
        {tr(`${counts} بند`, `${counts} éléments`, `${counts} items`)}
      </StatusItem>
      {tally.ready === 0 ? null : (
        <StatusItem
          tone="success"
          icon={Check}
          title={tr(
            'بنود ينتظر أحد قرارك فيها ولا يمنعها شيء.',
            'Éléments décidables immédiatement.',
            'Items a decision can be taken on right now.',
          )}
        >
          {tr(
            `${fmt.integer(tally.ready, lang)} جاهز`,
            `${fmt.integer(tally.ready, lang)} prêts`,
            `${fmt.integer(tally.ready, lang)} ready`,
          )}
        </StatusItem>
      )}
      {tally.blocked === 0 ? null : (
        <StatusItem
          tone="warning"
          icon={ShieldAlert}
          title={tr(
            'سيرفض الخادم هذه البنود؛ كل سطر يقول السبب.',
            'Le serveur refuserait ces éléments ; chaque ligne dit pourquoi.',
            'The server would refuse these; each row says why.',
          )}
        >
          {tr(
            `${fmt.integer(tally.blocked, lang)} معلّق`,
            `${fmt.integer(tally.blocked, lang)} bloqués`,
            `${fmt.integer(tally.blocked, lang)} blocked`,
          )}
        </StatusItem>
      )}
      {tally.stale === 0 ? null : (
        <StatusItem
          tone="danger"
          title={tr(
            `بنود انتظرت ${String(AGE_DANGER)} أيام أو أكثر.`,
            `Éléments en attente depuis ${String(AGE_DANGER)} jours ou plus.`,
            `Items that have waited ${String(AGE_DANGER)} days or more.`,
          )}
        >
          {tr(
            `${fmt.integer(tally.stale, lang)} متأخر`,
            `${fmt.integer(tally.stale, lang)} en retard`,
            `${fmt.integer(tally.stale, lang)} overdue`,
          )}
        </StatusItem>
      )}
      {truncated ? (
        <StatusItem
          tone="warning"
          title={tr(
            'الوسيط يحمّل صفحة واحدة لكل مصدر. ضيّق التصفية لرؤية الباقي.',
            'Le courtier charge une page par source. Affinez les filtres pour voir le reste.',
            'The broker loads one page per source. Narrow the filters to see the rest.',
          )}
        >
          {tr('صفحة مقتطعة', 'Page tronquée', 'Page truncated')}
        </StatusItem>
      ) : null}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      {tally.oldest === 0 ? null : (
        <StatusItem icon={Clock} title={tr('أطول انتظار', 'Attente la plus longue', 'Longest wait')}>
          {tr(
            `${fmt.integer(tally.oldest, lang)} يوم`,
            `${fmt.integer(tally.oldest, lang)} j`,
            `${fmt.integer(tally.oldest, lang)} d`,
          )}
        </StatusItem>
      )}
      <StatusItem
        icon={Wallet}
        title={tr(
          'مجموع القيود المنتظرة، بالجانب الأكبر من كل قيد.',
          'Total des écritures en attente, au plus grand côté de chacune.',
          'What the waiting entries add up to, at the larger side of each.',
        )}
      >
        {fmt.money(tally.amount, currency, lang)}
      </StatusItem>
      {fetchedAt === null ? null : (
        <StatusItem title={fmt.dateTime(fetchedAt, lang)}>{fmt.time(fetchedAt, lang)}</StatusItem>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Row menu
 * ------------------------------------------------------------------ */

export interface ItemMenuProps {
  readonly x: number;
  readonly y: number;
  readonly item: WorkItem;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Right-click on a row.
 *
 * A blocked item repeats its reason here as a disabled line above the act it cannot
 * take. The alternative — a greyed-out Approve with no explanation next to it — is
 * the single most common way an application makes a person feel they have done
 * something wrong.
 */
export function ItemMenu({ x, y, item, onSelect, onDismiss }: ItemMenuProps) {
  const { t, tr } = useApp().locale;
  // The same mirror of the guard the toolbar is disabled from, asked here about the
  // row that was right-clicked rather than the row that is selected. A menu that
  // offered what the toolbar refuses would be two answers to one question.
  const gate = handoffActs(item);
  const acts: MenuEntry[] =
    item.kind === 'entry'
      ? [
          {
            id: 'approve',
            label: tr('اعتماد', 'Approuver', 'Approve'),
            icon: Check,
            accelerator: 'Ctrl+Enter',
            disabled: !item.canApprove,
          },
          {
            id: 'approve-note',
            label: tr('اعتماد مع ملاحظة…', 'Approuver avec une note…', 'Approve with a note…'),
            icon: StickyNote,
            disabled: !item.canApprove,
          },
          {
            id: 'reject',
            label: tr('رفض…', 'Refuser…', 'Reject…'),
            icon: Ban,
            accelerator: 'Ctrl+Backspace',
            danger: true,
            disabled: !item.canReject,
          },
        ]
      : item.kind === 'task'
        ? [
            {
              id: 'certify',
              label: tr('تصديق', 'Certifier', 'Certify'),
              icon: BadgeCheck,
              accelerator: 'Ctrl+Shift+C',
              disabled: !item.canCertify,
            },
          ]
        : item.kind === 'handoff'
          ? [
              {
                id: 'accept',
                label: tr('قبول', 'Prendre en charge', 'Accept'),
                icon: Check,
                disabled: !gate.accept,
              },
              {
                id: 'complete',
                label: tr('إنجاز', 'Terminer', 'Complete'),
                icon: CheckCheck,
                disabled: !gate.complete,
              },
              {
                id: 'decline',
                label: tr('رفض…', 'Refuser…', 'Decline…'),
                icon: Ban,
                danger: true,
                disabled: !gate.decline,
              },
            ]
          : [];
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onDismiss={onDismiss}
      onSelect={onSelect}
      minWidth={252}
      entries={[
        { id: 'head', kind: 'header', label: item.title },
        ...(item.block === null
          ? []
          : [{ id: 'why', label: t(item.block), icon: ShieldAlert, disabled: true }]),
        ...acts,
        ...(acts.length === 0 ? [] : [{ id: 'sep1', kind: 'separator' as const }]),
        { id: 'copy', label: tr('نسخ البند', 'Copier l’élément', 'Copy item'), icon: ClipboardCopy },
        {
          id: 'export',
          label: tr('تصدير القائمة…', 'Exporter la file…', 'Export the queue…'),
          icon: FileDown,
          accelerator: 'Ctrl+E',
        },
      ]}
    />
  );
}
