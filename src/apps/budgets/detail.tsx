/**
 * Budgets — the pane on the right.
 *
 * Two panes, one slot. The budget is the default: the plan's own totals, the scope its
 * actuals were read over, and the mix of states behind the grid. When an account row is
 * selected the pane becomes that account, because the question then is "what should this
 * number be", and the answer is one amount and two ways to arrive at it.
 *
 * The riyal amount is shown and never added to anything. The book is kept in dinars and
 * the variance is a dinar figure; a pane that summed the two currencies would be
 * inventing a rate nobody entered.
 */
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileDown,
  Lock,
  Pencil,
  ShieldAlert,
  Target,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  fmt,
  InfoBar,
  ProgressBar,
  PropertyRow,
  Section,
  StackedBar,
  useLocale,
} from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL, type Budget, type BudgetLine, type FiscalPeriod } from '../shared/ledger';
import type { BudgetBusy } from './actions';
import type { Translate } from './report';
import { type BudgetAssessment, VARIANCE_STATE_LABEL, type VarianceRow, varianceTone } from './variance';

/** The two states the book writes as words; anything else is shown as the book wrote it. */
function statusLabel(budget: Budget, tr: Translate): string {
  if (budget.status === 'locked') return tr('مقفلة', 'Verrouillé', 'Locked');
  if (budget.status === 'draft') return tr('مسوّدة', 'Brouillon', 'Draft');
  return budget.status === '' ? tr('غير محدَّدة', 'Non défini', 'Unset') : budget.status;
}

interface BudgetPaneProps {
  readonly budget: Budget | null;
  readonly period: FiscalPeriod | null;
  readonly assessment: BudgetAssessment;
  readonly busy: BudgetBusy;
  onCommand: (id: string) => void;
}

export function BudgetPane({ budget, period, assessment, busy, onCommand }: BudgetPaneProps) {
  const { tr, lang } = useLocale();
  if (budget === null) {
    return (
      <InfoBar icon={Target} title={tr('لا موازنة', 'Aucun budget', 'No budget')}>
        {tr(
          'لا موازنة في الدفتر بعد: لا شيء يُقارَن به المنفَّذ.',
          'Aucun budget dans le livre : rien à quoi comparer le réalisé.',
          'The book carries no budget yet, so there is nothing to compare the actual against.',
        )}
      </InfoBar>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={assessment.locked ? Lock : Target}
        title={budget.name === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : budget.name}
      >
        <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>
          <Badge tone={assessment.locked ? 'info' : 'neutral'}>{statusLabel(budget, tr)}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('الفترة', 'Période', 'Period')}>
          {period === null ? tr('غير مربوطة بفترة', 'Sans période', 'No period') : period.label}
        </PropertyRow>
        {budget.lockedAt === null ? null : (
          <PropertyRow label={tr('أُقفلت في', 'Verrouillé le', 'Locked at')} mono>
            {fmt.dateTime(budget.lockedAt, lang)}
          </PropertyRow>
        )}
      </Card>

      <PlanTotals assessment={assessment} period={period} />
      <StateMix assessment={assessment} />
      <PlanNotice assessment={assessment} />

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ الملخّص', 'Copier le résumé', 'Copy summary')}
        </Button>
        <Button
          block
          icon={FileDown}
          busy={busy === 'export'}
          disabled={busy !== null}
          onClick={() => onCommand('export')}
        >
          {tr('تصدير المعروض', 'Exporter la vue', 'Export this view')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The four numbers, then the sentence that says what the actual covers.
 *
 * The scope row is not decoration: the same plan compared against one month and against
 * the whole book gives two different variances, and only one of them answers the question
 * being asked.
 */
function PlanTotals({
  assessment,
  period,
}: {
  readonly assessment: BudgetAssessment;
  readonly period: FiscalPeriod | null;
}) {
  const { tr, lang } = useLocale();
  const used = assessment.planned === 0 ? null : assessment.actual / assessment.planned;
  return (
    <Section title={tr('الخطة والمنفَّذ', 'Budget et réalisé', 'Plan and actual')}>
      <PropertyRow label={tr('الخطة', 'Budget', 'Planned')} mono>
        {fmt.money(assessment.planned, 'DZD', lang)}
      </PropertyRow>
      <PropertyRow label={tr('المنفَّذ', 'Réalisé', 'Actual')} mono>
        {fmt.money(assessment.actual, 'DZD', lang)}
      </PropertyRow>
      <PropertyRow label={tr('الفرق', 'Écart', 'Variance')} mono>
        <span style={{ color: assessment.adverse > 0 ? 'var(--fx-danger)' : undefined, fontWeight: 600 }}>
          {fmt.money(assessment.variance, 'DZD', lang)}
        </span>
      </PropertyRow>
      <PropertyRow label={tr('سطور الخطة', 'Lignes', 'Plan lines')} mono>
        {`${fmt.integer(assessment.lines, lang)} / ${fmt.integer(assessment.accounts, lang)}`}
      </PropertyRow>
      <PropertyRow label={tr('نطاق المنفَّذ', 'Périmètre du réalisé', 'Actual scope')}>
        {assessment.basis === 'period' && period !== null
          ? period.label
          : tr('الدفتر كاملًا', 'Tout le livre', 'Whole book')}
      </PropertyRow>
      <div style={{ display: 'grid', gap: 4, paddingTop: 6 }}>
        <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>
            {tr('المنفَّذ من الخطة', 'Consommé du budget', 'Used of plan')}
          </span>
          <span className="fx-num" style={{ fontWeight: 600 }}>
            {used === null ? '—' : fmt.percent(used, lang, 1)}
          </span>
        </div>
        <ProgressBar value={used ?? 0} tone={assessment.adverse > 0 ? 'danger' : 'accent'} height={6} />
      </div>
    </Section>
  );
}

/** The grid in one bar: how many accounts landed in each state. Idle accounts are not in it. */
function StateMix({ assessment }: { readonly assessment: BudgetAssessment }) {
  const { t, tr, lang } = useLocale();
  if (assessment.rows.length === 0) return null;
  let on = 0;
  let favourable = 0;
  for (const row of assessment.rows) {
    if (row.state === 'on') on += 1;
    else if (row.state === 'favourable') favourable += 1;
  }
  return (
    <Section title={tr('توزيع الحالات', 'Répartition des états', 'State mix')}>
      <StackedBar
        height={12}
        format={(value) => fmt.integer(value, lang)}
        segments={[
          { label: t(VARIANCE_STATE_LABEL.adverse), value: assessment.adverse, color: 'var(--fx-danger)' },
          { label: t(VARIANCE_STATE_LABEL.unplanned), value: assessment.unplanned, color: 'var(--fx-warning)' },
          { label: t(VARIANCE_STATE_LABEL.on), value: on, color: 'var(--fx-success)' },
          { label: t(VARIANCE_STATE_LABEL.favourable), value: favourable, color: 'var(--fx-accent)' },
        ]}
      />
    </Section>
  );
}

/**
 * What the plan adds up to, in one sentence.
 *
 * The worst account is named rather than counted. "Three accounts are adverse" sends
 * somebody back to the grid; naming the largest gap starts the conversation.
 */
function PlanNotice({ assessment }: { readonly assessment: BudgetAssessment }) {
  const { tr, lang } = useLocale();
  const worst = assessment.worst;
  if (worst !== null) {
    return (
      <InfoBar
        tone="warning"
        icon={AlertTriangle}
        title={tr('أكبر فرق غير مواتٍ', 'Écart défavorable le plus grand', 'Largest adverse gap')}
      >
        {`${worst.account.code} · ${worst.account.name} — ${fmt.money(worst.variance, 'DZD', lang)}`}
      </InfoBar>
    );
  }
  if (assessment.unplanned > 0) {
    const count = fmt.integer(assessment.unplanned, lang);
    return (
      <InfoBar
        tone="warning"
        icon={ShieldAlert}
        title={tr(`${count} حساب غير مخطَّط`, `${count} comptes hors plan`, `${count} unplanned accounts`)}
      >
        {tr(
          'فيها حركة ولا سطر خطة لها. اختر الحساب ثم خُذ المنفَّذ كخطة.',
          'Ils ont des mouvements sans ligne de budget. Sélectionnez le compte puis reprenez le réalisé.',
          'They carry activity with no plan line. Select the account, then take the actual as the plan.',
        )}
      </InfoBar>
    );
  }
  if (assessment.lines === 0) {
    return (
      <InfoBar icon={ClipboardList} title={tr('خطة فارغة', 'Budget vide', 'Nothing planned')}>
        {tr(
          'لا سطور في هذه الموازنة. انتقل إلى عرض الخطة وعيّن مبلغًا لحساب.',
          'Ce budget n’a aucune ligne. Passez à la vue Plan et saisissez un montant pour un compte.',
          'This budget has no lines. Switch to the plan view and set an amount on an account.',
        )}
      </InfoBar>
    );
  }
  return (
    <InfoBar tone="success" icon={BadgeCheck} title={tr('لا فروق مقلقة', 'Aucun écart défavorable', 'No adverse gap')}>
      {tr(
        'كل حساب مخطَّط إمّا مطابق أو في مصلحة النتيجة.',
        'Chaque compte budgété est conforme ou dans le bon sens.',
        'Every planned account is on plan or running in the book’s favour.',
      )}
    </InfoBar>
  );
}

/* ------------------------------------------------------------------ *
 * The selected account
 * ------------------------------------------------------------------ */

interface AccountPaneProps {
  readonly row: VarianceRow;
  /** The whole plan line, so the riyal amount survives a dinar-only write. */
  readonly line: BudgetLine | null;
  readonly busy: BudgetBusy;
  readonly locked: boolean;
  onCommand: (id: string) => void;
}

export function AccountPane({ row, line, busy, locked, onCommand }: AccountPaneProps) {
  const { t, tr, lang } = useLocale();
  const working = busy !== null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={Target} title={`${row.account.code} · ${row.account.name}`}>
        <PropertyRow label={tr('النوع', 'Type', 'Type')}>{t(ACCOUNT_TYPE_LABEL[row.account.type])}</PropertyRow>
        <PropertyRow label={tr('الحالة', 'État', 'State')}>
          <Badge tone={varianceTone(row.state)}>{t(VARIANCE_STATE_LABEL[row.state])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('عملة الحساب', 'Monnaie du compte', 'Account currency')} mono>
          {row.account.currency}
        </PropertyRow>
        <PropertyRow label={tr('قيود', 'Écritures', 'Postings')} mono>
          {fmt.integer(row.lines, lang)}
        </PropertyRow>
      </Card>

      <AccountTotals row={row} />
      {line === null || line.sar === 0 ? null : <RiyalPlan amount={line.sar} />}
      <AccountNotice row={row} locked={locked} />

      <div style={{ display: 'grid', gap: 8 }}>
        <Button
          block
          variant="accent"
          icon={Pencil}
          busy={busy === 'set'}
          disabled={working || locked}
          onClick={() => onCommand('set')}
        >
          {tr('تعيين المبلغ', 'Définir le montant', 'Set the amount')}
        </Button>
        <Button
          block
          icon={ArrowRight}
          busy={busy === 'seed'}
          disabled={working || locked || row.lines === 0}
          onClick={() => onCommand('seed')}
        >
          {tr('أخذ المنفَّذ كخطة', 'Reprendre le réalisé', 'Take the actual as the plan')}
        </Button>
        <Button block variant="subtle" icon={ExternalLink} onClick={() => onCommand('ledger')}>
          {tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyRow')}>
          {tr('نسخ السطر', 'Copier la ligne', 'Copy the row')}
        </Button>
      </div>
    </div>
  );
}

/** One account's three numbers, in the same order the grid puts them. */
function AccountTotals({ row }: { readonly row: VarianceRow }) {
  const { tr, lang } = useLocale();
  return (
    <Section title={tr('الخطة والمنفَّذ', 'Budget et réalisé', 'Plan and actual')}>
      <PropertyRow label={tr('الخطة', 'Budget', 'Planned')} mono>
        {row.lineId === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          fmt.money(row.planned, 'DZD', lang)
        )}
      </PropertyRow>
      <PropertyRow label={tr('المنفَّذ', 'Réalisé', 'Actual')} mono>
        {fmt.money(row.actual, 'DZD', lang)}
      </PropertyRow>
      <PropertyRow label={tr('الفرق', 'Écart', 'Variance')} mono>
        <span style={{ color: row.state === 'adverse' ? 'var(--fx-danger)' : undefined, fontWeight: 600 }}>
          {fmt.money(row.variance, 'DZD', lang)}
        </span>
      </PropertyRow>
      {row.used === null ? null : (
        <div style={{ display: 'grid', gap: 4, paddingTop: 6 }}>
          <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--fx-text-secondary)' }}>{tr('المنفَّذ', 'Consommé', 'Used')}</span>
            <span className="fx-num" style={{ fontWeight: 600 }}>
              {fmt.percent(row.used, lang, 1)}
            </span>
          </div>
          <ProgressBar value={row.used} tone={varianceTone(row.state)} height={6} />
        </div>
      )}
    </Section>
  );
}

/**
 * The riyal side of a plan line.
 *
 * `upsert_budget_line` writes both amounts on every call, so this window carries the
 * riyal figure back untouched whenever a dinar amount is set. It is shown here for the
 * same reason it is preserved: somebody entered it, and a field that vanishes from the
 * screen is a field that gets zeroed by the next write.
 */
function RiyalPlan({ amount }: { readonly amount: number }) {
  const { tr, lang } = useLocale();
  return (
    <Section title={tr('خطة بالريال', 'Budget en riyal', 'Riyal plan')}>
      <PropertyRow label={tr('المبلغ', 'Montant', 'Amount')} mono>
        {fmt.money(amount, 'SAR', lang)}
      </PropertyRow>
      <div style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)', paddingTop: 4 }}>
        {tr(
          'غير مُحوَّل ولا يدخل في الفرق: الأرقام أعلاه بالدينار.',
          'Non converti et hors écart : les montants ci-dessus sont en dinars.',
          'Not converted and not part of the variance: the figures above are in dinars.',
        )}
      </div>
    </Section>
  );
}

/**
 * Why the buttons look the way they do.
 *
 * The padlock comes first because it is the only thing on this pane that removes an
 * option, and a greyed button with no sentence beside it is the most common way a window
 * wastes somebody's afternoon.
 */
function AccountNotice({ row, locked }: { readonly row: VarianceRow; readonly locked: boolean }) {
  const { tr } = useLocale();
  if (locked) {
    return (
      <InfoBar tone="info" icon={Lock} title={tr('الموازنة مقفلة', 'Budget verrouillé', 'Budget locked')}>
        {tr(
          'لا تُعدَّل سطورها. اختر موازنة أخرى من الشريط لتعيين مبلغ.',
          'Ses lignes ne se modifient plus. Choisissez un autre budget dans le volet pour saisir un montant.',
          'Its lines no longer change. Pick another budget in the rail to set an amount.',
        )}
      </InfoBar>
    );
  }
  if (row.state === 'unplanned') {
    return (
      <InfoBar tone="warning" icon={ShieldAlert} title={tr('حركة بلا خطة', 'Mouvement hors plan', 'Activity with no plan')}>
        {tr(
          'الحساب فيه قيود ولا سطر خطة له: الفرق كله غير مخطَّط.',
          'Le compte a des écritures sans ligne de budget : tout l’écart est hors plan.',
          'The account has postings and no plan line, so the whole gap is unplanned.',
        )}
      </InfoBar>
    );
  }
  if (row.state === 'idle') {
    return (
      <InfoBar icon={ClipboardList} title={tr('لا خطة ولا حركة', 'Ni budget ni mouvement', 'No plan, no activity')}>
        {tr(
          'حساب ساكن في هذه الفترة. يظهر في عرض الخطة فقط.',
          'Compte sans activité sur ce périmètre. Il n’apparaît que dans la vue Plan.',
          'A quiet account over this scope. It appears in the plan view only.',
        )}
      </InfoBar>
    );
  }
  return null;
}
