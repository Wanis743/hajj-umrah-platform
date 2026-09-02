/**
 * Inbox — the reading pane.
 *
 * Four things can be on the right: one item, several items, a queue with nothing
 * open, or a queue with nothing in it. Each gets its own component, and the pane
 * picks between them, because "one entry" and "eleven entries" are genuinely
 * different questions — the first wants every fact about one thing, the second
 * wants one fact about every thing.
 *
 * The act lives here as well as in the command bar. A person reading an entry's
 * lines to decide whether to approve it should not have to travel back to the top
 * of the window to say yes, and the button sitting under what it acts on is the
 * clearest statement of scope an interface can make.
 */
import { AlertTriangle, Ban, BadgeCheck, Check, CircleDot, ExternalLink, ShieldAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Badge, Button, EmptyState, fmt, InfoBar, KpiTile, PropertyRow, Section, useApp } from '@/platform/sdk';
import {
  type CloseTask,
  type Currency,
  ENTRY_STATUS_LABEL,
  type FiscalPeriod,
  type JournalEntry,
  type JournalLine,
  PERIOD_STATUS_LABEL,
  periodTone,
  TASK_STATUS_LABEL,
  taskTone,
} from '../shared/ledger';
import type { SpineChainDoc } from '../shared/spine';
import type { InboxBusy } from './actions';
import { HandoffDetail } from './handoff';
import {
  DECISION_LABEL,
  decisionTone,
  type Decision,
  type DependencyState,
  type InboxTally,
  lineTotals,
  headerMatchesLines,
  type QueueId,
  type SweepPlan,
  type WorkItem,
} from './queue';

/** The pane's own gutter, matched to the aside's padding in `AppFrame`. */
const PANE: CSSProperties = { display: 'grid', gap: 14, alignContent: 'start' };

/** Three columns: what the line hits, and the two sides it moves. */
const LINE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 88px 88px',
  gap: '3px 10px',
  fontSize: 'var(--fx-caption)',
  alignItems: 'center',
};

/** A cell that names an account and opens the ledger at it. */
const LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'var(--fx-accent-text)',
  cursor: 'default',
  textAlign: 'start',
  minWidth: 0,
};

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

interface HeadProps {
  readonly item: WorkItem;
}

/** Title, badge and — when there is one — the sentence that stops the act. */
function Head({ item }: HeadProps) {
  const { t } = useApp().locale;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="fx-mono" style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600 }}>
          {item.title}
        </span>
        <Badge tone={item.tone}>{t(item.badge)}</Badge>
      </div>
      {item.block === null ? null : (
        <InfoBar tone="warning" icon={ShieldAlert}>
          {t(item.block)}
        </InfoBar>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One journal entry
 * ------------------------------------------------------------------ */

interface EntryDetailProps {
  readonly item: WorkItem;
  readonly entry: JournalEntry;
  readonly lines: readonly JournalLine[];
  readonly linesLoading: boolean;
  readonly period: FiscalPeriod | null;
  readonly currency: Currency;
  readonly busy: InboxBusy;
  accountLabelOf: (accountId: string | null) => string;
  onOpenAccount: (accountId: string) => void;
  onCommand: (id: string) => void;
}

/**
 * An entry, its period, and the lines it would post.
 *
 * The header's stored totals and the lines' own sum are compared, and a
 * disagreement is stated rather than resolved: the trigger that maintains
 * `total_debit` may not have fired, or this page may simply be stale, and either
 * way the person about to approve it should know the two numbers differ before they
 * decide which one they are approving.
 */
export function EntryDetail({
  item,
  entry,
  lines,
  linesLoading,
  period,
  currency,
  busy,
  accountLabelOf,
  onOpenAccount,
  onCommand,
}: EntryDetailProps) {
  const { t, tr, lang } = useApp().locale;
  const totals = lineTotals(lines);
  const agrees = headerMatchesLines(entry, lines);
  return (
    <div style={PANE}>
      <Head item={item} />
      <div>
        <PropertyRow label={tr('التاريخ', 'Date', 'Date')}>{fmt.date(entry.date, lang)}</PropertyRow>
        <PropertyRow label={tr('الحالة', 'État', 'Status')}>{t(ENTRY_STATUS_LABEL[entry.status])}</PropertyRow>
        <PropertyRow label={tr('الوصف', 'Libellé', 'Description')}>
          {entry.description === '' ? '—' : entry.description}
        </PropertyRow>
        <PropertyRow label={tr('الفترة', 'Période', 'Period')}>
          {period === null ? (
            <span style={{ color: 'var(--fx-warning)' }}>
              {tr('لا فترة تغطي التاريخ', 'Aucune période couvrante', 'No period covers this date')}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {period.label}
              <Badge tone={periodTone(period.status)}>{t(PERIOD_STATUS_LABEL[period.status])}</Badge>
            </span>
          )}
        </PropertyRow>
        <PropertyRow label={tr('المصدر', 'Origine', 'Source')}>
          {entry.sourceType === '' ? tr('يدوي', 'Manuelle', 'Manual') : entry.sourceType}
        </PropertyRow>
        <PropertyRow label={tr('الكاتب', 'Auteur', 'Author')} mono>
          {item.who === '' ? '—' : item.who}
          {item.mine ? ` · ${tr('أنت', 'vous', 'you')}` : ''}
        </PropertyRow>
        <PropertyRow label={tr('المعرّف', 'Identifiant', 'Identifier')} mono>
          {entry.id}
        </PropertyRow>
      </div>
      {agrees ? null : (
        <InfoBar tone="warning" icon={AlertTriangle} title={tr('الرأس لا يطابق الأسطر', 'En-tête ≠ lignes', 'Header and lines disagree')}>
          {tr(
            `الرأس يقول ${fmt.money(entry.debit, currency, lang)} والأسطر تجمع ${fmt.money(totals.debit, currency, lang)}.`,
            `L’en-tête indique ${fmt.money(entry.debit, currency, lang)}, les lignes totalisent ${fmt.money(totals.debit, currency, lang)}.`,
            `The header says ${fmt.money(entry.debit, currency, lang)}; the lines add up to ${fmt.money(totals.debit, currency, lang)}.`,
          )}
        </InfoBar>
      )}
      <Section
        title={tr('الأسطر', 'Lignes', 'Lines')}
        action={
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {linesLoading
              ? tr('جارٍ التحميل…', 'Chargement…', 'Loading…')
              : tr(
                  `${fmt.integer(lines.length, lang)} سطر`,
                  `${fmt.integer(lines.length, lang)} lignes`,
                  `${fmt.integer(lines.length, lang)} lines`,
                )}
          </span>
        }
      >
        <LineTable
          lines={lines}
          currency={currency}
          accountLabelOf={accountLabelOf}
          onOpenAccount={onOpenAccount}
        />
      </Section>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="accent"
          icon={Check}
          busy={busy === 'approve'}
          disabled={!item.canApprove}
          onClick={() => onCommand('approve')}
        >
          {tr('اعتماد', 'Approuver', 'Approve')}
        </Button>
        <Button icon={Ban} busy={busy === 'reject'} disabled={!item.canReject} onClick={() => onCommand('reject')}>
          {tr('رفض…', 'Refuser…', 'Reject…')}
        </Button>
      </div>
    </div>
  );
}

interface LineTableProps {
  readonly lines: readonly JournalLine[];
  readonly currency: Currency;
  accountLabelOf: (accountId: string | null) => string;
  onOpenAccount: (accountId: string) => void;
}

/**
 * The lines, and a total under them.
 *
 * Each account is a link into the ledger rather than a label, because the question
 * an approver asks about an unfamiliar line — "what else has been posted there?" —
 * is answered in another window, and the hand-off already exists.
 */
function LineTable({ lines, currency, accountLabelOf, onOpenAccount }: LineTableProps) {
  const { tr, lang } = useApp().locale;
  const totals = lineTotals(lines);
  if (lines.length === 0) {
    return (
      <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
        {tr('لا أسطر على هذه الصفحة.', 'Aucune ligne sur cette page.', 'No lines on this page.')}
      </span>
    );
  }
  return (
    <div style={LINE_GRID}>
      <span style={{ color: 'var(--fx-text-tertiary)' }}>{tr('الحساب', 'Compte', 'Account')}</span>
      <span style={{ color: 'var(--fx-text-tertiary)', textAlign: 'end' }}>{tr('مدين', 'Débit', 'Debit')}</span>
      <span style={{ color: 'var(--fx-text-tertiary)', textAlign: 'end' }}>{tr('دائن', 'Crédit', 'Credit')}</span>
      {lines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          currency={currency}
          label={accountLabelOf(line.accountId)}
          onOpenAccount={onOpenAccount}
        />
      ))}
      <span style={{ borderTop: '1px solid var(--fx-divider)', paddingTop: 4, fontWeight: 600 }}>
        {tr('المجموع', 'Total', 'Total')}
      </span>
      <span className="fx-num" style={{ borderTop: '1px solid var(--fx-divider)', paddingTop: 4, textAlign: 'end', fontWeight: 600 }}>
        {fmt.amount(totals.debit, lang)}
      </span>
      <span className="fx-num" style={{ borderTop: '1px solid var(--fx-divider)', paddingTop: 4, textAlign: 'end', fontWeight: 600 }}>
        {fmt.amount(totals.credit, lang)}
      </span>
    </div>
  );
}

interface LineRowProps {
  readonly line: JournalLine;
  readonly currency: Currency;
  readonly label: string;
  onOpenAccount: (accountId: string) => void;
}

function LineRow({ line, currency, label, onOpenAccount }: LineRowProps) {
  const { lang } = useApp().locale;
  const accountId = line.accountId;
  return (
    <>
      <span style={{ display: 'grid', gap: 1, minWidth: 0 }}>
        {accountId === null ? (
          <span className="fx-title-ellipsis">{label}</span>
        ) : (
          <button type="button" style={LINK} onClick={() => onOpenAccount(accountId)} title={label}>
            <span className="fx-title-ellipsis">{label}</span>
            <ExternalLink size={11} aria-hidden />
          </button>
        )}
        {line.memo === '' ? null : (
          <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-tertiary)' }}>
            {line.memo}
          </span>
        )}
      </span>
      <span className="fx-num" style={{ textAlign: 'end' }}>
        {line.debit === 0 ? '—' : fmt.amount(line.debit, lang)}
      </span>
      <span className="fx-num" style={{ textAlign: 'end' }} title={line.currency === currency ? undefined : line.currency}>
        {line.credit === 0 ? '—' : fmt.amount(line.credit, lang)}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One close task
 * ------------------------------------------------------------------ */

interface TaskDetailProps {
  readonly item: WorkItem;
  readonly task: CloseTask;
  readonly dependencies: DependencyState;
  readonly tasks: ReadonlyMap<string, CloseTask>;
  readonly busy: InboxBusy;
  onCommand: (id: string) => void;
}

/**
 * A close step and what stands in front of it.
 *
 * Every dependency is listed with its own status, in the order the server sorts
 * them, so the blocker the RPC would name is the first uncertified one down the
 * list. A name with no task behind it is called out as unknown rather than shown as
 * incomplete: `dependencies` holds names, and a name nothing matches blocks nothing
 * — not here, and not on the server either.
 */
export function TaskDetail({ item, task, dependencies, tasks, busy, onCommand }: TaskDetailProps) {
  const { t, tr, lang } = useApp().locale;
  const names = [...task.dependencies].sort((a, b) => a.localeCompare(b));
  return (
    <div style={PANE}>
      <Head item={item} />
      <div>
        <PropertyRow label={tr('الحالة', 'État', 'Status')}>
          <Badge tone={taskTone(task.status)}>{t(TASK_STATUS_LABEL[task.status])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('المسؤول', 'Responsable', 'Owner')} mono>
          {item.who === '' ? '—' : item.who}
          {item.mine ? ` · ${tr('أنت', 'vous', 'you')}` : ''}
        </PropertyRow>
        <PropertyRow label={tr('آخر تحديث', 'Dernière mise à jour', 'Last updated')}>
          {task.updatedAt === null ? '—' : fmt.dateTime(task.updatedAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('المعرّف', 'Identifiant', 'Identifier')} mono>
          {task.id}
        </PropertyRow>
      </div>
      <Section title={tr('تعتمد على', 'Dépend de', 'Depends on')}>
        {names.length === 0 ? (
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {tr('لا شيء — يمكن تصديقها في أي وقت.', 'Rien — certifiable à tout moment.', 'Nothing — certifiable at any time.')}
          </span>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {names.map((name) => {
              const found = tasks.get(name);
              const done = found !== undefined && found.status === 'certified';
              const blocking = dependencies.blocker !== null && dependencies.blocker.name === name;
              return (
                <div
                  key={name}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fx-caption)', minWidth: 0 }}
                >
                  {done ? (
                    <Check size={12} aria-hidden style={{ color: 'var(--fx-success)', flex: 'none' }} />
                  ) : (
                    <CircleDot
                      size={12}
                      aria-hidden
                      style={{ color: blocking ? 'var(--fx-warning)' : 'var(--fx-text-tertiary)', flex: 'none' }}
                    />
                  )}
                  <span className="fx-title-ellipsis">{name}</span>
                  {found === undefined ? (
                    <Badge tone="neutral">{tr('غير معروفة', 'Inconnue', 'Unknown')}</Badge>
                  ) : (
                    <Badge tone={taskTone(found.status)}>{t(TASK_STATUS_LABEL[found.status])}</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      {dependencies.unknown.length === 0 ? null : (
        <InfoBar tone="info">
          {tr(
            'أسماء لا تطابق أي خطوة على هذه الصفحة، وهي لا تمنع التصديق.',
            'Des noms ne correspondent à aucune étape de cette page ; ils n’empêchent pas la certification.',
            'Names that match no step on this page. They do not block certification.',
          )}
        </InfoBar>
      )}
      <div>
        <Button
          variant="accent"
          icon={BadgeCheck}
          busy={busy === 'certify'}
          disabled={!item.canCertify}
          onClick={() => onCommand('certify')}
        >
          {tr('تصديق الخطوة', 'Certifier l’étape', 'Certify step')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One decision already taken
 * ------------------------------------------------------------------ */

interface DecisionDetailProps {
  readonly item: WorkItem;
  readonly decision: Decision;
}

/**
 * What was decided, by whom, and why.
 *
 * The reason is the reason it is worth keeping this queue at all. `details.reason`
 * is written by the RPC and read by nobody else in the suite, so a note somebody
 * left when they approved an odd-looking entry is legible here and nowhere else.
 */
export function DecisionDetail({ item, decision }: DecisionDetailProps) {
  const { t, tr, lang } = useApp().locale;
  return (
    <div style={PANE}>
      <Head item={item} />
      <div>
        <PropertyRow label={tr('القرار', 'Décision', 'Decision')}>
          <Badge tone={decisionTone(decision.kind)}>{t(DECISION_LABEL[decision.kind])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('الموضوع', 'Objet', 'Subject')} mono>
          {decision.subject === '' ? '—' : decision.subject}
        </PropertyRow>
        <PropertyRow label={tr('بواسطة', 'Par', 'By')} mono>
          {decision.actor === '' ? '—' : decision.actor}
          {item.mine ? ` · ${tr('أنت', 'vous', 'you')}` : ''}
        </PropertyRow>
        <PropertyRow label={tr('التاريخ', 'Date', 'When')}>
          {decision.at === null ? '—' : fmt.dateTime(decision.at, lang)}
        </PropertyRow>
        <PropertyRow label={tr('السبب', 'Motif', 'Reason')}>
          {decision.reason === '' ? (
            <span style={{ color: 'var(--fx-text-tertiary)' }}>
              {tr('لم يُذكر سبب.', 'Aucun motif consigné.', 'No reason recorded.')}
            </span>
          ) : (
            decision.reason
          )}
        </PropertyRow>
        <PropertyRow label={tr('السجل', 'Ressource', 'Resource')} mono>
          {decision.resource === '' ? '—' : decision.resource}
          {decision.resourceId === null ? '' : ` · ${decision.resourceId.slice(0, 8)}`}
        </PropertyRow>
        {decision.requestId === null ? null : (
          <PropertyRow label={tr('معرّف الطلب', 'Requête', 'Request')} mono>
            {decision.requestId}
          </PropertyRow>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Several items at once
 * ------------------------------------------------------------------ */

interface SelectionSummaryProps {
  readonly plan: SweepPlan;
  readonly selected: number;
  readonly currency: Currency;
  readonly busy: InboxBusy;
  onSweep: () => void;
}

/**
 * What the sweep would do to the selection, before it does it.
 *
 * This is the pre-flight, and it is the reason the bulk act is defensible: the
 * server's refusals are already known row by row, so the two numbers below are the
 * two numbers the run will report, and the skipped rows are named with the sentence
 * that will keep them out.
 */
export function SelectionSummary({ plan, selected, currency, busy, onSweep }: SelectionSummaryProps) {
  const { t, tr, lang } = useApp().locale;
  const total = plan.ready.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  return (
    <div style={PANE}>
      <div style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600 }}>
        {tr(
          `${fmt.integer(selected, lang)} بندًا محددًا`,
          `${fmt.integer(selected, lang)} éléments sélectionnés`,
          `${fmt.integer(selected, lang)} items selected`,
        )}
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        <KpiTile
          tone="success"
          icon={Check}
          label={tr('جاهز للاعتماد', 'Prêts', 'Ready to approve')}
          value={fmt.integer(plan.ready.length, lang)}
          secondary={fmt.money(total, currency, lang)}
        />
        <KpiTile
          tone="warning"
          icon={ShieldAlert}
          label={tr('سيُترك', 'Ignorés', 'Will be skipped')}
          value={fmt.integer(plan.skipped.length, lang)}
          secondary={
            plan.skipped.length === 0
              ? tr('لا شيء معلّق', 'Rien de bloqué', 'Nothing blocked')
              : tr('لأسباب مذكورة', 'Motifs ci-dessous', 'Reasons below')
          }
        />
      </div>
      {plan.skipped.length === 0 ? null : (
        <Section title={tr('ما سيُترك ولماذا', 'Ce qui sera ignoré', 'What will be left alone')}>
          <div style={{ display: 'grid', gap: 6 }}>
            {plan.skipped.map((item) => (
              <div key={item.key} style={{ display: 'grid', gap: 1, fontSize: 'var(--fx-caption)', minWidth: 0 }}>
                <span className="fx-mono fx-title-ellipsis">{item.title}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--fx-warning)' }}>
                  <AlertTriangle size={11} aria-hidden />
                  <span className="fx-title-ellipsis">
                    {item.block === null ? tr('غير قابل للاعتماد.', 'Non approuvable.', 'Not approvable.') : t(item.block)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <div>
        <Button
          variant="accent"
          icon={Check}
          busy={busy === 'sweep'}
          disabled={plan.ready.length === 0}
          onClick={onSweep}
        >
          {tr(
            `اعتماد ${fmt.integer(plan.ready.length, lang)}`,
            `Approuver ${fmt.integer(plan.ready.length, lang)}`,
            `Approve ${fmt.integer(plan.ready.length, lang)}`,
          )}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Nothing open
 * ------------------------------------------------------------------ */

interface QueueOverviewProps {
  readonly queue: QueueId;
  readonly tally: InboxTally;
  readonly currency: Currency;
}

/**
 * The pane with nothing selected: the whole inbox in four numbers.
 *
 * These count every queue, not the one on screen, and the heading says so. A person
 * who has just cleared the approvals queue wants to know whether anything else is
 * waiting, and the answer is more useful than a repeat of the count they can already
 * see in the rail.
 */
export function QueueOverview({ queue, tally, currency }: QueueOverviewProps) {
  const { tr, lang } = useApp().locale;
  if (tally.waiting === 0 && tally.byQueue.decided === 0) {
    return (
      <div style={PANE}>
        <EmptyState
          icon={Check}
          title={tr('لا شيء ينتظر', 'Rien en attente', 'Nothing is waiting')}
          description={tr(
            'كل ما يمكن اعتماده أو تصديقه قد سُوّي.',
            'Tout ce qui pouvait être approuvé ou certifié l’est.',
            'Everything that could be approved or certified has been.',
          )}
        />
      </div>
    );
  }
  return (
    <div style={PANE}>
      <div style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600 }}>
        {tr('صندوق الوارد كله', 'Toute la boîte', 'The whole inbox')}
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        <KpiTile
          icon={CircleDot}
          label={tr('ينتظر قرارًا', 'En attente', 'Waiting on a decision')}
          value={fmt.integer(tally.waiting, lang)}
          secondary={fmt.money(tally.amount, currency, lang)}
        />
        <KpiTile
          tone="success"
          icon={Check}
          label={tr('جاهز الآن', 'Prêts', 'Ready now')}
          value={fmt.integer(tally.ready, lang)}
        />
        <KpiTile
          tone="warning"
          icon={ShieldAlert}
          label={tr('معلّق', 'Bloqués', 'Blocked')}
          value={fmt.integer(tally.blocked, lang)}
        />
        <KpiTile
          tone={tally.stale === 0 ? 'neutral' : 'danger'}
          icon={AlertTriangle}
          label={tr('متأخر', 'En retard', 'Overdue')}
          value={fmt.integer(tally.stale, lang)}
          secondary={
            tally.oldest === 0
              ? undefined
              : tr(
                  `أطول انتظار ${fmt.integer(tally.oldest, lang)} يوم`,
                  `Plus long : ${fmt.integer(tally.oldest, lang)} j`,
                  `Longest ${fmt.integer(tally.oldest, lang)} d`,
                )
          }
        />
      </div>
      <InfoBar tone="info">
        {queue === 'approvals'
          ? tr(
              'اختر قيدًا لقراءة أسطره، أو حدّد عدة قيود لاعتمادها في دفعة واحدة.',
              'Sélectionnez une écriture pour lire ses lignes, ou plusieurs pour les approuver en lot.',
              'Open an entry to read its lines, or select several to approve them in one batch.',
            )
          : queue === 'checklist'
            ? tr(
                'تُصدَّق خطوات الإقفال بالترتيب: كل خطوة تنتظر ما تعتمد عليه.',
                'Les étapes se certifient dans l’ordre : chacune attend ses dépendances.',
                'Close steps certify in order: each one waits on what it depends on.',
              )
            : tr(
                'هذه القرارات مأخوذة من سجل التدقيق، وهي للقراءة فقط.',
                'Ces décisions viennent du journal d’audit : lecture seule.',
                'These come from the audit trail and are read-only.',
              )}
      </InfoBar>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export interface DetailPaneProps {
  readonly item: WorkItem | null;
  /** How many rows the grid has selected; more than one is the sweep's summary. */
  readonly selectionSize: number;
  readonly plan: SweepPlan;
  readonly queue: QueueId;
  readonly tally: InboxTally;
  readonly lines: readonly JournalLine[];
  readonly linesLoading: boolean;
  readonly period: FiscalPeriod | null;
  readonly dependencies: DependencyState | null;
  readonly tasks: ReadonlyMap<string, CloseTask>;
  readonly currency: Currency;
  readonly busy: InboxBusy;
  /**
   * The selected handoff's chain, or `null` while the read is in flight or was refused.
   *
   * One document for the whole pane rather than one per row: only the selected handoff's
   * history is ever on screen, and `private.spine_chain` returns a chain whole.
   */
  readonly chain: SpineChainDoc | null;
  readonly chainLoading: boolean;
  accountLabelOf: (accountId: string | null) => string;
  onOpenAccount: (accountId: string) => void;
  onSweep: () => void;
  onCommand: (id: string) => void;
}

export function DetailPane({
  item,
  selectionSize,
  plan,
  queue,
  tally,
  lines,
  linesLoading,
  period,
  dependencies,
  tasks,
  currency,
  busy,
  chain,
  chainLoading,
  accountLabelOf,
  onOpenAccount,
  onSweep,
  onCommand,
}: DetailPaneProps) {
  if (selectionSize > 1) {
    return (
      <SelectionSummary plan={plan} selected={selectionSize} currency={currency} busy={busy} onSweep={onSweep} />
    );
  }
  if (item !== null && item.entry !== null) {
    return (
      <EntryDetail
        item={item}
        entry={item.entry}
        lines={lines}
        linesLoading={linesLoading}
        period={period}
        currency={currency}
        busy={busy}
        accountLabelOf={accountLabelOf}
        onOpenAccount={onOpenAccount}
        onCommand={onCommand}
      />
    );
  }
  if (item !== null && item.task !== null) {
    return (
      <TaskDetail
        item={item}
        task={item.task}
        dependencies={dependencies ?? { blocker: null, unknown: [] }}
        tasks={tasks}
        busy={busy}
        onCommand={onCommand}
      />
    );
  }
  // Narrowed here rather than inside the pane: `WorkItem` carries a `kind` beside four
  // independently-nullable payloads, so `kind === 'handoff'` tells the compiler nothing
  // about `item.handoff`. The arm that reads the payload is the arm that proves it.
  if (item !== null && item.handoff !== null) {
    return (
      <HandoffDetail
        item={item}
        handoff={item.handoff}
        chain={chain}
        chainLoading={chainLoading}
        busy={busy}
        onCommand={onCommand}
      />
    );
  }
  if (item !== null && item.decision !== null) return <DecisionDetail item={item} decision={item.decision} />;
  return <QueueOverview queue={queue} tally={tally} currency={currency} />;
}
