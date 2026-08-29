/**
 * Modeling — the two panes.
 *
 * The scenario pane is the argument written out: the driver, the window it read, the months
 * it drew, and then the chart where the seam between the two is visible. The line is drawn
 * twice on purpose — once solid over the months that happened, once dashed over the whole
 * axis. Where the dashes sit on top of the solid line the model is only repeating the book;
 * where they carry on alone it is guessing, and the eye can see exactly where that starts.
 *
 * The account pane is the same idea for one row, plus the two numbers that say how much to
 * trust it: how many months of the window the account actually moved in, and how many
 * postings that was. A projection from one active month out of six is a different claim from
 * the same number drawn from six, and nothing in the total says which one you have.
 */
import {
  AlertTriangle,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileDown,
  Gauge,
  LineChart as LineChartIcon,
  Pencil,
  Target,
  TrendingDown,
  TrendingUp,
  Undo2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  fmt,
  InfoBar,
  KpiTile,
  LineChart,
  type LineSeries,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL, type Budget } from '../shared/ledger';
import type { ModelingBusy } from './actions';
import { adverseGap, type ForecastRow, METHOD_LABEL, type Projection, type Scenario } from './forecast';
import type { Month } from './history';

interface SeamProps {
  readonly categories: readonly string[];
  /** The months that happened. Solid, and the only series with an area beneath it. */
  readonly actual: readonly number[];
  /** The whole axis, actual then projected. Dashed, so the seam is where it leaves the solid. */
  readonly whole: readonly number[];
  readonly height?: number;
}

/**
 * One line drawn twice.
 *
 * The chart plots each series from its own index zero, so a short series simply stops. The
 * actual is the short one; the model line runs the length of the axis and is dashed for all
 * of it, including the part where it is only repeating the book. That overlap is the point:
 * the dashes leaving the solid line is the moment the numbers stop being measurements.
 */
function SeamChart({ categories, actual, whole, height = 200 }: SeamProps) {
  const { tr, lang } = useLocale();
  const series: readonly LineSeries[] = [
    { label: tr('منفَّذ', 'Réalisé', 'Actual'), values: actual, color: 'var(--fx-text-tertiary)' },
    { label: tr('متوقّع', 'Projeté', 'Projected'), values: whole, color: 'var(--fx-accent)', dashed: true },
  ];
  return (
    <LineChart
      categories={categories}
      series={series}
      height={height}
      format={(value) => fmt.compact(value, lang)}
    />
  );
}

interface ScenarioPaneProps {
  readonly projection: Projection;
  readonly scenario: Scenario;
  readonly budget: Budget | null;
  readonly coveredFrom: Month | null;
  readonly busy: ModelingBusy;
  onCommand: (id: string) => void;
}

export function ScenarioPane({ projection, scenario, budget, coveredFrom, busy, onCommand }: ScenarioPaneProps) {
  const { t, tr, lang } = useLocale();
  const categories = projection.timeline.map((row) => row.month);
  const whole = projection.timeline.map((row) => row.result);
  const actual = projection.timeline.filter((row) => !row.projected).map((row) => row.result);
  const gap = projection.planned === null ? null : projection.result - projection.planned;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={LineChartIcon} title={tr('الفرض', 'Hypothèse', 'The model')}>
        <PropertyRow label={tr('المحرّك', 'Moteur', 'Driver')}>{t(METHOD_LABEL[scenario.method])}</PropertyRow>
        <PropertyRow label={tr('أشهر النظر', 'Fenêtre', 'Lookback')} mono>
          {`${fmt.integer(scenario.lookback, lang)} ${tr('شهر', 'mois', 'mo')}`}
        </PropertyRow>
        <PropertyRow label={tr('الأفق', 'Horizon', 'Horizon')} mono>
          {`${fmt.integer(scenario.horizon, lang)} ${tr('شهر', 'mois', 'mo')}`}
        </PropertyRow>
        {scenario.method === 'growth' ? (
          <PropertyRow label={tr('النمو شهريًا', 'Croissance mensuelle', 'Growth per month')} mono>
            {fmt.percent(scenario.growth / 100, lang, 1)}
          </PropertyRow>
        ) : null}
        {scenario.uplift === 0 ? null : (
          <PropertyRow label={tr('زيادة التكاليف', 'Inflation des charges', 'Cost uplift')} mono>
            {`+${fmt.percent(scenario.uplift / 100, lang, 1)}`}
          </PropertyRow>
        )}
        <PropertyRow label={tr('المقارنة', 'Comparaison', 'Compared to')}>
          {budget === null
            ? tr('بلا خطة', 'Aucun plan', 'No plan')
            : budget.name === ''
              ? tr('بلا اسم', 'Sans nom', 'Untitled')
              : budget.name}
        </PropertyRow>
        {projection.overrides === 0 ? null : (
          <PropertyRow label={tr('تجاوزات', 'Dérogations', 'Overrides')}>
            <Badge tone="warning" icon={Pencil}>
              {fmt.integer(projection.overrides, lang)}
            </Badge>
          </PropertyRow>
        )}
      </Card>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <KpiTile
          label={tr('الإيرادات', 'Produits', 'Revenue')}
          value={fmt.money(projection.revenue, 'DZD', lang)}
          icon={TrendingUp}
        />
        <KpiTile
          label={tr('التكاليف', 'Charges', 'Expense')}
          value={fmt.money(projection.expense, 'DZD', lang)}
          icon={TrendingDown}
          tone="warning"
        />
        <KpiTile
          label={tr('النتيجة', 'Résultat', 'Result')}
          value={fmt.money(projection.result, 'DZD', lang)}
          tone={projection.result < 0 ? 'danger' : 'success'}
        />
        {gap === null ? null : (
          <KpiTile
            label={tr('الفرق عن الخطة', 'Écart au plan', 'Gap to plan')}
            value={fmt.money(gap, 'DZD', lang)}
            icon={Target}
            tone="neutral"
          />
        )}
      </div>

      <Section title={tr('النتيجة شهرًا بشهر', 'Résultat mois par mois', 'Result month by month')}>
        {categories.length === 0 ? (
          <InfoBar icon={AlertTriangle} title={tr('لا محور', 'Aucun axe', 'No axis')}>
            {tr(
              'لا قيود مُرحَّلة، فلا أشهر تُرسم.',
              'Aucune écriture comptabilisée : aucun mois à tracer.',
              'Nothing is posted, so there are no months to draw.',
            )}
          </InfoBar>
        ) : (
          <SeamChart categories={categories} actual={actual} whole={whole} />
        )}
      </Section>

      {projection.worst === null || projection.worst.gap === null ? null : (
        <Section title={tr('أبعد عن الخطة', 'Le plus loin du plan', 'Furthest from the plan')}>
          <PropertyRow
            label={`${projection.worst.account.code} · ${projection.worst.account.name}`}
            mono
          >
            <span style={{ color: 'var(--fx-danger)', fontWeight: 600 }}>
              {fmt.money(projection.worst.gap, 'DZD', lang)}
            </span>
          </PropertyRow>
        </Section>
      )}

      {coveredFrom === null ? null : (
        <InfoBar icon={Gauge} tone="warning" title={tr('تاريخ مُثبَت جزئيًا', 'Historique partiellement prouvé', 'History proven in part')}>
          {tr(
            `صفحة القيود وصلت إلى سقفها. ما قبل ${coveredFrom} لم يُقرأ، وهو ليس صفرًا.`,
            `La page d’écritures a atteint son plafond. Avant ${coveredFrom}, rien n’a été lu — ce n’est pas zéro.`,
            `The entry page came back at its ceiling. Before ${coveredFrom} nothing was read, which is not the same as zero.`,
          )}
        </InfoBar>
      )}
      {projection.complete ? null : (
        <InfoBar
          icon={AlertTriangle}
          tone="warning"
          title={tr('تاريخ جزئي', 'Historique partiel', 'Partial history')}
        >
          {tr(
            'صفحة قيود أو صفحة سطور وصلت إلى سقفها: الأشهر المعروضة حدّ أدنى، لا حصيلة.',
            'Une page d’écritures ou de lignes a atteint son plafond : les mois affichés sont un minimum, pas un total.',
            'An entry or posting page came back at its ceiling: the months shown are a lower bound, not a total.',
          )}
        </InfoBar>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ الملخّص', 'Copier la synthèse', 'Copy summary')}
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

/* ------------------------------------------------------------------ *
 * One account
 * ------------------------------------------------------------------ */

interface AccountPaneProps {
  readonly row: ForecastRow;
  readonly scenario: Scenario;
  /** The history axis, for the chart's left half. */
  readonly months: readonly Month[];
  readonly future: readonly Month[];
  onCommand: (id: string) => void;
}

/**
 * One account, argued the same way.
 *
 * The card is the row's own assumptions, the chart is its months, and the two tiles are the
 * evidence. A total drawn from one active month out of six reads on screen exactly like a
 * total drawn from six, so the count sits next to the number rather than behind a tooltip.
 */
export function AccountPane({ row, scenario, months, future, onCommand }: AccountPaneProps) {
  const { t, tr, lang } = useLocale();
  const categories = [...months, ...future];
  const whole = [...row.history, ...row.values];
  const thin = !row.overridden && row.activeMonths <= 1;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={LineChartIcon}
        title={`${row.account.code} · ${row.account.name}`}
        subtitle={t(ACCOUNT_TYPE_LABEL[row.account.type])}
      >
        <PropertyRow label={tr('المحرّك', 'Moteur', 'Driver')}>
          {row.overridden ? (
            <Badge tone="warning" icon={Pencil}>
              {tr('رقم مُدخل يدويًا', 'Saisi à la main', 'Hand-entered')}
            </Badge>
          ) : (
            t(METHOD_LABEL[scenario.method])
          )}
        </PropertyRow>
        <PropertyRow label={tr('متوسّط النظر', 'Moyenne fenêtre', 'Window average')} mono>
          {fmt.money(row.average, 'DZD', lang)}
        </PropertyRow>
        {scenario.method === 'trend' && !row.overridden ? (
          <PropertyRow label={tr('الانحدار الشهري', 'Dérive mensuelle', 'Monthly drift')} mono>
            {fmt.money(row.slope, 'DZD', lang)}
          </PropertyRow>
        ) : null}
        <PropertyRow label={tr('الإجمالي المتوقّع', 'Total projeté', 'Projected total')} mono>
          <span style={{ fontWeight: 600 }}>{fmt.money(row.total, 'DZD', lang)}</span>
        </PropertyRow>
        {row.planned === null ? null : (
          <PropertyRow label={tr('الموازنة', 'Budget', 'Planned')} mono>
            {fmt.money(row.planned, 'DZD', lang)}
          </PropertyRow>
        )}
        {row.gap === null ? null : (
          <PropertyRow label={tr('الفرق', 'Écart', 'Gap')} mono>
            <span
              style={{
                color: adverseGap(row.account.type, row.gap) > 0.005 ? 'var(--fx-danger)' : undefined,
              }}
            >
              {fmt.money(row.gap, 'DZD', lang)}
            </span>
          </PropertyRow>
        )}
      </Card>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <KpiTile
          label={tr('أشهر بحركة', 'Mois actifs', 'Active months')}
          value={`${fmt.integer(row.activeMonths, lang)}/${fmt.integer(scenario.lookback, lang)}`}
          icon={Gauge}
          tone={thin ? 'warning' : 'neutral'}
        />
        <KpiTile
          label={tr('قيود', 'Écritures', 'Postings')}
          value={fmt.integer(row.lines, lang)}
          icon={ClipboardList}
          tone="neutral"
        />
      </div>
      {thin ? (
        <InfoBar
          icon={AlertTriangle}
          tone="warning"
          title={tr('شهود قليلة', 'Peu d’observations', 'Thin evidence')}
        >
          {tr(
            'الحساب تحرّك في شهر واحد أو لم يتحرّك داخل النظر. الرقم امتداد لملاحظة واحدة.',
            'Le compte a bougé au plus un mois dans la fenêtre : le nombre prolonge une seule observation.',
            'The account moved in at most one month of the window, so the number extends a single observation.',
          )}
        </InfoBar>
      ) : null}

      <Section title={tr('شهرًا بشهر', 'Mois par mois', 'Month by month')}>
        {categories.length === 0 ? (
          <InfoBar icon={AlertTriangle} title={tr('لا محور', 'Aucun axe', 'No axis')}>
            {tr(
              'لا شهر في الدفتر يُرسم عليه.',
              'Aucun mois dans le livre à tracer.',
              'The book holds no month to draw on.',
            )}
          </InfoBar>
        ) : (
          <SeamChart categories={categories} actual={row.history} whole={whole} height={180} />
        )}
      </Section>

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="accent" icon={Pencil} onClick={() => onCommand('override')}>
          {tr('تعيين الرقم', 'Fixer le nombre', 'Set the number')}
        </Button>
        <Button
          block
          variant="subtle"
          icon={Undo2}
          disabled={!row.overridden}
          onClick={() => onCommand('release')}
        >
          {tr('إرجاع إلى المحرّك', 'Rendre au moteur', 'Give it back to the driver')}
        </Button>
        <Button block variant="subtle" icon={ExternalLink} onClick={() => onCommand('ledger')}>
          {tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyRow')}>
          {tr('نسخ الحساب', 'Copier le compte', 'Copy this account')}
        </Button>
      </div>
    </div>
  );
}
