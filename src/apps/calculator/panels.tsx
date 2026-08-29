/**
 * Calculator — the finance panels.
 *
 * The five-key solver and the cash-flow sheet. Views again: the arithmetic is in
 * `finance.ts` and the form state in `analysis.ts`, so what is left here is
 * labelling — which, for a finance calculator, is most of the correctness the user
 * can see. `PV`, `PMT` and `FV` are shown with the sign convention spelled out in
 * the hint under each field, because a payment that comes back negative is the
 * calculator working, and a person who does not know that will assume it is not.
 */
import { ArrowRight, Copy, Plus, RotateCcw, Sigma, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataGrid,
  Field,
  IconButton,
  InfoBar,
  Input,
  KpiTile,
  LineChart,
  Segmented,
  fmt,
  useApp,
} from '@/platform/sdk';
import type { Column } from '@/platform/sdk';
import type { CashflowModel, TvmField, TvmModel, TvmTarget } from './analysis';
import type { AmortRow, Solve, SolveReason } from './finance';

/** The five keys, in the order a business calculator prints them on the case. */
const TVM_FIELDS: readonly (readonly [TvmField, TvmTarget])[] = [
  ['n', 'n'],
  ['rate', 'rate'],
  ['pv', 'pv'],
  ['pmt', 'pmt'],
  ['fv', 'fv'],
];

export interface TvmPanelProps {
  readonly model: TvmModel;
  readonly onCopy: (text: string) => void;
}

/**
 * The solver.
 *
 * One of the five fields is the answer at any moment, and it is the field itself
 * that shows it — read-only, in place, where the question was asked. A separate
 * "result" box would let the form show four inputs and an answer that no longer
 * belongs to them.
 */
export function TvmPanel({ model, onCopy }: TvmPanelProps) {
  const { tr, lang } = useApp().locale;
  const { inputs, target, result } = model;

  const label = (field: TvmField): string => {
    if (field === 'n') return tr('عدد الفترات (N)', 'Nombre de périodes (N)', 'Periods (N)');
    if (field === 'rate') return tr('المعدل السنوي ٪ (I/Y)', 'Taux annuel % (I/Y)', 'Annual rate % (I/Y)');
    if (field === 'pv') return tr('القيمة الحالية (PV)', 'Valeur actuelle (PV)', 'Present value (PV)');
    if (field === 'pmt') return tr('الدفعة (PMT)', 'Paiement (PMT)', 'Payment (PMT)');
    if (field === 'fv') return tr('القيمة المستقبلية (FV)', 'Valeur future (FV)', 'Future value (FV)');
    return tr('فترات في السنة', 'Périodes par an', 'Periods per year');
  };

  const hint = (field: TvmField): string | undefined => {
    if (field === 'pv') return tr('المقبوض موجب', 'Encaissement positif', 'Cash received is positive');
    if (field === 'pmt') return tr('المدفوع سالب', 'Décaissement négatif', 'Cash paid is negative');
    if (field === 'rate') return tr('اسمي، قبل التقسيم على الفترات', 'Nominal, avant division', 'Nominal, before dividing');
    return undefined;
  };

  const failure = (reason: SolveReason): string => {
    if (reason === 'needsSignChange') return tr('يلزم مبالغ بإشارتين', 'Signes opposés requis', 'Needs opposite signs');
    if (reason === 'degenerate') return tr('أكمل القيم الأربع', 'Complétez les quatre valeurs', 'Fill the other four');
    if (reason === 'notConverged') return tr('لم يتقارب الحل', 'Pas de convergence', 'Did not converge');
    return tr('لا حل بهذه القيم', 'Aucune solution', 'No solution');
  };

  const answer = (): string => (result.ok ? fmt.amount(result.value, lang) : '—');

  return (
    <div className="fx-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 14, padding: 14, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <Field label={tr('احسب', 'Calculer', 'Solve for')}>
          <Segmented
            value={target}
            onChange={model.setTarget}
            options={[
              { value: 'n', label: 'N' },
              { value: 'rate', label: 'I/Y' },
              { value: 'pv', label: 'PV' },
              { value: 'pmt', label: 'PMT' },
              { value: 'fv', label: 'FV' },
            ]}
          />
        </Field>
        <Field label={tr('توقيت الدفعة', 'Échéance', 'Payment timing')}>
          <Segmented
            value={model.timing}
            onChange={model.setTiming}
            size="sm"
            options={[
              { value: 'end', label: tr('آخر الفترة', 'Fin', 'End') },
              { value: 'begin', label: tr('أول الفترة', 'Début', 'Begin') },
            ]}
          />
        </Field>
        <div style={{ width: 130 }}>
          <Field label={label('perYear')}>
            <Input value={inputs.perYear} onChange={(next) => model.set('perYear', next)} mono inputMode="numeric" />
          </Field>
        </div>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
          <Button size="sm" variant="subtle" icon={Copy} onClick={() => onCopy(answer())} disabled={!result.ok}>
            {tr('نسخ', 'Copier', 'Copy')}
          </Button>
          <Button size="sm" variant="subtle" icon={RotateCcw} onClick={model.reset}>
            {tr('استعادة', 'Réinitialiser', 'Reset')}
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {TVM_FIELDS.map(([field, key]) => {
          const computed = key === target;
          return (
            <Field
              key={field}
              label={label(field)}
              hint={computed ? tr('محسوب', 'Calculé', 'Computed') : hint(field)}
              error={computed && !result.ok ? failure(result.reason) : undefined}
            >
              <Input
                value={computed ? answer() : inputs[field]}
                onChange={(next) => model.set(field, next)}
                readOnly={computed}
                mono
                inputMode="decimal"
                style={computed ? { fontWeight: 700, color: 'var(--fx-accent-text)' } : undefined}
              />
            </Field>
          );
        })}
      </div>

      <TvmSummary model={model} />
      <AmortCard rows={model.schedule} />
    </div>
  );
}

/** The three numbers a loan is actually judged on, once the fifth key is known. */
function TvmSummary({ model }: { readonly model: TvmModel }) {
  const { tr, lang } = useApp().locale;
  const { totals, resolved, result } = model;
  if (!result.ok || resolved === null) {
    return (
      <InfoBar tone="warning" title={tr('لا يمكن الحل', 'Résolution impossible', 'Cannot solve')}>
        {tr(
          'راجع القيم الأربع الأخرى: القيمة الحالية والدفعة يجب أن تحملا إشارتين مختلفتين.',
          'Vérifiez les quatre autres valeurs : la valeur actuelle et le paiement doivent être de signes opposés.',
          'Check the other four values — present value and payment must carry opposite signs.',
        )}
      </InfoBar>
    );
  }
  const unit = model.target === 'rate' ? '%' : model.target === 'n' ? tr('فترة', 'périodes', 'periods') : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      <KpiTile
        icon={Sigma}
        label={tr('النتيجة', 'Résultat', 'Result')}
        value={`${fmt.amount(result.value, lang)} ${unit}`.trim()}
        secondary={model.target.toUpperCase()}
      />
      <KpiTile
        tone="info"
        label={tr('إجمالي المدفوع', 'Total payé', 'Total paid')}
        value={totals === null ? '—' : fmt.amount(totals.paid, lang)}
        secondary={tr('على مدى الجدول', 'sur l’échéancier', 'over the schedule')}
      />
      <KpiTile
        tone="warning"
        label={tr('إجمالي الفوائد', 'Total des intérêts', 'Total interest')}
        value={totals === null ? '—' : fmt.amount(totals.interest, lang)}
        secondary={
          totals === null || totals.paid === 0
            ? undefined
            : fmt.percent(totals.interest / totals.paid, lang, 1)
        }
      />
    </div>
  );
}

/**
 * The schedule.
 *
 * Shown because an amortisation table is the only way to see *why* the total
 * interest is what it is — the first payment being almost all interest is the fact
 * that surprises people, and no summary figure conveys it.
 */
function AmortCard({ rows }: { readonly rows: readonly AmortRow[] }) {
  const { tr, lang } = useApp().locale;
  if (rows.length === 0) return null;
  const money = (value: number): string => fmt.amount(value, lang);
  const columns: readonly Column<AmortRow>[] = [
    {
      id: 'period',
      header: tr('#', '#', '#'),
      render: (row) => fmt.integer(row.period, lang),
      width: 64,
      align: 'end',
      mono: true,
    },
    { id: 'opening', header: tr('الرصيد', 'Solde', 'Opening'), render: (row) => money(row.opening), align: 'end', mono: true },
    {
      id: 'payment',
      header: tr('الدفعة', 'Paiement', 'Payment'),
      render: (row) => money(row.payment),
      align: 'end',
      mono: true,
      footer: money(rows.reduce((sum, row) => sum + row.payment, 0)),
    },
    {
      id: 'interest',
      header: tr('الفائدة', 'Intérêts', 'Interest'),
      render: (row) => money(row.interest),
      align: 'end',
      mono: true,
      footer: money(rows.reduce((sum, row) => sum + row.interest, 0)),
    },
    {
      id: 'principal',
      header: tr('أصل الدين', 'Capital', 'Principal'),
      render: (row) => money(row.principal),
      align: 'end',
      mono: true,
      footer: money(rows.reduce((sum, row) => sum + row.principal, 0)),
    },
    { id: 'closing', header: tr('المتبقي', 'Restant', 'Closing'), render: (row) => money(row.closing), align: 'end', mono: true },
  ];
  return (
    <Card title={tr('جدول السداد', 'Tableau d’amortissement', 'Amortisation schedule')} padded={false}>
      <div style={{ height: 300, display: 'flex', flexDirection: 'column' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(row) => String(row.period)}
          density="compact"
          showFooter
          virtualized={rows.length > 80}
          rowHeight={27}
          style={{ overflow: 'auto' }}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Cash flow
 * ------------------------------------------------------------------ */

/** A discounted-cash-flow measure that may legitimately have no answer. */
const shown = (solve: Solve, format: (value: number) => string): string => (solve.ok ? format(solve.value) : '—');

export interface CashflowPanelProps {
  readonly model: CashflowModel;
  readonly onCopy: (text: string) => void;
}

/**
 * The appraisal sheet.
 *
 * NPV is the number that decides, so it leads; IRR sits beside it because it is
 * the number people quote, and MIRR beside that because IRR overstates whenever
 * interim cash cannot really be reinvested at the IRR itself. The curve underneath
 * is what a single IRR figure hides — a project crossing zero steeply is a
 * different proposition from one that grazes it.
 */
export function CashflowPanel({ model, onCopy }: CashflowPanelProps) {
  const { tr, lang } = useApp().locale;
  return (
    <div className="fx-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 14, padding: 14, alignContent: 'start' }}>
      <CashflowRates model={model} onCopy={() => onCopy(fmt.amount(model.metrics.npv, lang))} />
      <CashflowTiles model={model} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }}>
        <FlowEditor model={model} />
        <ProfileCard model={model} />
      </div>
      <InfoBar
        tone={model.metrics.npv >= 0 ? 'success' : 'warning'}
        title={
          model.metrics.npv >= 0
            ? tr('يستحق التنفيذ عند هذا المعدل', 'Rentable à ce taux', 'Worth doing at this rate')
            : tr('لا يستحق عند هذا المعدل', 'Non rentable à ce taux', 'Not worth doing at this rate')
        }
      >
        {tr(
          'صافي القيمة الحالية هو الحكم؛ معدل العائد الداخلي يخبرك بمقدار الهامش قبل أن ينقلب.',
          'La VAN décide ; le TRI indique la marge avant que le signe ne s’inverse.',
          'Net present value is the verdict — the IRR tells you how much room there is before it flips.',
        )}
      </InfoBar>
    </div>
  );
}

/**
 * The three rates. Only the first one is used by NPV; the other two exist because
 * MIRR asks a question plain IRR does not — what the money actually costs and what
 * it actually earns while it waits.
 */
function CashflowRates({ model, onCopy }: { readonly model: CashflowModel; readonly onCopy: () => void }) {
  const { tr } = useApp().locale;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 150 }}>
        <Field label={tr('معدل الخصم ٪', 'Taux d’actualisation %', 'Discount rate %')}>
          <Input value={model.rate} onChange={model.setRate} mono inputMode="decimal" />
        </Field>
      </div>
      <div style={{ width: 150 }}>
        <Field label={tr('تكلفة التمويل ٪', 'Coût du financement %', 'Finance rate %')} hint={tr('للمدفوعات', 'des sorties', 'on outflows')}>
          <Input value={model.financeRate} onChange={model.setFinanceRate} mono inputMode="decimal" />
        </Field>
      </div>
      <div style={{ width: 150 }}>
        <Field label={tr('معدل إعادة الاستثمار ٪', 'Taux de réinvestissement %', 'Reinvestment rate %')} hint={tr('للمقبوضات', 'des entrées', 'on inflows')}>
          <Input value={model.reinvestRate} onChange={model.setReinvestRate} mono inputMode="decimal" />
        </Field>
      </div>
      <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
        <Button size="sm" variant="subtle" icon={Copy} onClick={onCopy}>
          {tr('نسخ صافي القيمة', 'Copier la VAN', 'Copy NPV')}
        </Button>
        <Button size="sm" variant="subtle" icon={RotateCcw} onClick={model.reset}>
          {tr('استعادة', 'Réinitialiser', 'Reset')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The six measures. Each is shown even when it has no answer, because a blank
 * "IRR" tile with the reason under it says something true about the cash flows,
 * whereas hiding the tile lets the reader assume the metric was never asked for.
 */
function CashflowTiles({ model }: { readonly model: CashflowModel }) {
  const { tr, lang } = useApp().locale;
  const { metrics } = model;
  const rate = (value: number): string => fmt.percent(value, lang, 2);
  const periods = (value: number): string => `${fmt.amount(value, lang)} ${tr('فترة', 'périodes', 'periods')}`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
      <KpiTile
        icon={Sigma}
        tone={metrics.npv >= 0 ? 'success' : 'danger'}
        label={tr('صافي القيمة الحالية', 'VAN', 'Net present value')}
        value={fmt.amount(metrics.npv, lang)}
        secondary={tr('عند معدل الخصم', 'au taux d’actualisation', 'at the discount rate')}
      />
      <KpiTile
        tone="info"
        label={tr('معدل العائد الداخلي', 'TRI', 'IRR')}
        value={shown(metrics.irr, rate)}
        secondary={tr('حيث يساوي الصافي صفرًا', 'où la VAN est nulle', 'where NPV is zero')}
      />
      <KpiTile
        tone="info"
        label={tr('معدل العائد المعدّل', 'TRI modifié', 'MIRR')}
        value={shown(metrics.mirr, rate)}
        secondary={tr('بمعدلي التمويل وإعادة الاستثمار', 'avec financement et réinvestissement', 'with finance and reinvestment rates')}
      />
      <KpiTile
        icon={ArrowRight}
        tone="neutral"
        label={tr('فترة الاسترداد', 'Délai de récupération', 'Payback')}
        value={shown(metrics.payback, periods)}
        secondary={tr('غير مخصومة', 'non actualisé', 'undiscounted')}
      />
      <KpiTile
        tone="neutral"
        label={tr('الاسترداد المخصوم', 'Récupération actualisée', 'Discounted payback')}
        value={shown(metrics.discounted, periods)}
        secondary={tr('بعد الخصم', 'après actualisation', 'after discounting')}
      />
      <KpiTile
        tone="accent"
        label={tr('مؤشر الربحية', 'Indice de rentabilité', 'Profitability index')}
        value={shown(metrics.index, (value) => fmt.amount(value, lang))}
        secondary={tr('أعلى من ١ يستحق', 'supérieur à 1 = rentable', 'above 1 is worth doing')}
      />
    </div>
  );
}

/**
 * The flows themselves.
 *
 * The row's position is its period — `t0` is today — so there is no period column
 * to get out of step with the arithmetic. Two rows is the floor: a single number is
 * not a cash flow, it is an amount.
 */
function FlowEditor({ model }: { readonly model: CashflowModel }) {
  const { tr } = useApp().locale;
  return (
    <Card
      title={tr('التدفقات النقدية', 'Flux de trésorerie', 'Cash flows')}
      subtitle={tr('السالب مدفوع، الموجب مقبوض', 'Négatif = payé, positif = reçu', 'Negative is paid out, positive is received')}
      actions={
        <Button size="sm" variant="subtle" icon={Plus} onClick={model.add}>
          {tr('فترة', 'Période', 'Period')}
        </Button>
      }
    >
      <div className="fx-scroll" style={{ display: 'grid', gap: 6, maxHeight: 264, overflowY: 'auto' }}>
        {model.rows.map((row, index) => (
          <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="fx-mono"
              style={{ width: 34, flex: 'none', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}
            >
              {`t${index}`}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Input value={row.amount} onChange={(next) => model.set(row.id, next)} mono inputMode="decimal" />
            </div>
            <IconButton
              icon={Trash2}
              label={tr('حذف الفترة', 'Supprimer la période', 'Remove period')}
              onClick={() => model.remove(row.id)}
              disabled={model.rows.length <= 2}
              size={14}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * The curve.
 *
 * Sixty-one points, but only every tenth is labelled — the chart draws one axis
 * label per category, and a rate axis with sixty labels on it is a grey smear.
 */
function ProfileCard({ model }: { readonly model: CashflowModel }) {
  const { tr, lang } = useApp().locale;
  const points = model.profile;
  const last = points.length - 1;
  return (
    <Card
      title={tr('منحنى صافي القيمة الحالية', 'Profil de la VAN', 'NPV profile')}
      subtitle={tr(
        'حيث يقطع المنحنى الصفر يكون معدل العائد الداخلي',
        'Le passage par zéro est le TRI',
        'Where it crosses zero is the IRR',
      )}
    >
      <LineChart
        categories={points.map((point, index) => (index % 10 === 0 || index === last ? fmt.percent(point.rate, lang, 0) : ''))}
        series={[{ label: tr('صافي القيمة الحالية', 'VAN', 'NPV'), values: points.map((point) => point.npv) }]}
        format={(value) => fmt.compact(value, lang)}
        height={200}
        legend={false}
      />
    </Card>
  );
}
