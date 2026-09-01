/**
 * Formatters, tone tokens and the read hook for the BI Studio screens. Plain
 * functions only -- the components live in ./atoms, because a .tsx file that exports
 * a component may not also export plain functions
 * (react-refresh/only-export-components).
 *
 * The one rule worth stating: nothing here computes a business number. A metric's
 * value arrives folded and its `format`, `decimals` and `unit` arrive with it, so
 * this file decides how many digits to print and never what to print. A percent that
 * looked like 0.42 in one screen and 42% in another would be the semantic layer
 * failing at the only thing it exists to do.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { safeBiRead, type BiReadResult } from '@/services/biAnalytics';
import { BI_OPERATOR_ARITY } from '@/types/bi';
import type {
  BiAggregate, BiChartType, BiDrillThroughKind, BiFilter, BiFilterOperator, BiMetricFormat,
  BiQueryOutcome, BiResultColumn, BiScalar, BiStatus, BiTimeGrain,
} from '@/types/bi';

/** ar/dz -> Arabic, fr -> French, everything else English. */
export function useBiI18n() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = useCallback(
    (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en),
    [isAr, isFr],
  );
  return { isAr, t };
}

export const DASH = '—';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
  good: 'bg-[var(--success-soft)] text-[var(--success)]',
  warn: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  bad: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
};

/** DRAFT is work in progress, PUBLISHED is a promise to every reader, DEPRECATED is
 *  a number that still exists but should not be built on. */
export const STATUS_TONE: Record<BiStatus, Tone> = {
  DRAFT: 'neutral', PUBLISHED: 'good', DEPRECATED: 'warn',
};

export const OUTCOME_TONE: Record<BiQueryOutcome, Tone> = {
  OK: 'good', DENIED: 'warn', ERROR: 'bad',
};

/* -------------------------------------------------------------------------- */
/* Formatting. Null means "not known" and prints as an em dash, never as 0.     */
/* -------------------------------------------------------------------------- */

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString();
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? DASH
    : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Query durations. Sub-second stays in milliseconds because that is the range the
 *  ledger's p95 lives in and rounding it to "0.1s" hides which of two queries is
 *  the slow one. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const min = Math.floor(ms / 60_000);
  return `${min}m ${Math.round((ms - min * 60_000) / 1000)}s`;
}

/** staff_profiles carries no name column, so an actor is the first segment of its
 *  uuid and the caller puts the whole value in a title attribute. Inventing a
 *  display name here would mean guessing at a join that does not exist. */
export function actorLabel(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : DASH;
}

/* -------------------------------------------------------------------------- */
/* Metric and cell values                                                     */
/* -------------------------------------------------------------------------- */

/** The presentation half of a metric, as bi_metrics stores it and every result
 *  column carries it. Optional because a DIMENSION column has none of it. */
export interface MetricDisplay {
  format?: BiMetricFormat;
  decimals?: number;
  unit?: string | null;
}

const DEFAULT_DECIMALS: Record<BiMetricFormat, number> = {
  NUMBER: 2, INTEGER: 0, CURRENCY: 2, PERCENT: 1, DURATION_HOURS: 1,
};

function decimalsFor(display: MetricDisplay): number {
  const fmt = display.format ?? 'NUMBER';
  const d = display.decimals;
  if (d === undefined || d === null || Number.isNaN(d)) return DEFAULT_DECIMALS[fmt];
  return Math.min(6, Math.max(0, Math.trunc(d)));
}

function fixed(value: number, decimals: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * One folded metric value, printed.
 *
 * PERCENT means a fraction: the compiler emits a RATIO as `sum(n) / nullif(sum(d), 0)`
 * and never multiplies, so 0.42 is what arrives and 42.0% is what shows. A metric
 * over a column that already stores 0..100 must declare NUMBER with `unit: '%'`
 * instead -- one rule, applied everywhere, rather than a guess per screen.
 *
 * A metric that is not a number is a metric definition that is wrong, so it prints
 * as itself rather than as NaN: seeing the raw value is how the author finds it.
 */
export function formatMetricValue(value: BiScalar, display: MetricDisplay = {}): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'boolean') return value ? '1' : '0';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);

  const decimals = decimalsFor(display);
  const unit = display.unit ? ` ${display.unit}` : '';
  switch (display.format ?? 'NUMBER') {
    case 'INTEGER': return fixed(Math.round(n), 0) + unit;
    case 'CURRENCY': return fixed(n, decimals) + unit;
    case 'PERCENT': return `${fixed(n * 100, decimals)}%`;
    case 'DURATION_HOURS': return fmtHours(n, decimals);
    default: return fixed(n, decimals) + unit;
  }
}

/** Hours as a span. Under a day keeps the decimals the metric asked for; past a day
 *  the day count is the useful number and the fraction is noise. */
export function fmtHours(hours: number, decimals = 1): string {
  if (Math.abs(hours) < 24) return `${fixed(hours, decimals)} h`;
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const days = Math.floor(abs / 24);
  const rest = Math.round(abs - days * 24);
  return rest > 0 ? `${sign}${days}d ${rest}h` : `${sign}${days}d`;
}

/**
 * One cell of a compiled result, printed according to the column that described it.
 *
 * A METRIC column carries its own format; a DIMENSION column carries a data type,
 * and a date dimension is the one case worth special-casing, because a time grain
 * arrives as a timestamp and `2026-08-31T00:00:00+00:00` in a table cell is a wall.
 */
export function formatCell(value: BiScalar, column: BiResultColumn): string {
  if (value === null || value === undefined) return DASH;
  if (column.kind === 'METRIC') {
    return formatMetricValue(value, {
      format: column.format, decimals: column.decimals, unit: column.unit,
    });
  }
  if (column.data_type === 'timestamp' || column.data_type === 'date') {
    return column.grain === 'DAY' || column.data_type === 'date'
      ? fmtDate(String(value))
      : fmtDateTime(String(value));
  }
  if (column.data_type === 'number' && typeof value === 'number') return fmtInt(value);
  return String(value);
}

/** Reads a cell as a number for plotting: a null group is a gap in a line, not a
 *  zero, so this returns null rather than coercing. */
export function numericCell(value: BiScalar): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Operators as the tokens they compile to, not as translated words.
 *
 * A filter is read beside the statement it produced -- `SqlBlock` shows that statement
 * verbatim -- and `status = CONFIRMED` matches what a reader will find in it, where
 * "status equals CONFIRMED" would send them looking for a phrase that is not there.
 */
export const OPERATOR_SQL: Readonly<Record<BiFilterOperator, string>> = {
  EQ: '=', NE: '<>', GT: '>', GTE: '>=', LT: '<', LTE: '<=',
  IN: 'IN', NOT_IN: 'NOT IN', BETWEEN: 'BETWEEN',
  CONTAINS: 'CONTAINS', STARTS_WITH: 'STARTS WITH',
  IS_NULL: 'IS NULL', IS_NOT_NULL: 'IS NOT NULL',
};

/** How many values a chip prints before it counts the rest. An IN over forty branch
 *  ids is a filter nobody reads; the count is the useful part. */
const FILTER_VALUES_SHOWN = 4;

const scalarText = (value: BiScalar | undefined): string =>
  (value === null || value === undefined ? DASH : String(value));

/**
 * One filter, as one line.
 *
 * The arity table decides the shape rather than the operator name, which is the same
 * table the compiler enforces -- so a BETWEEN that somehow arrived with one bound prints
 * an em dash for the missing one instead of silently reading as an equality.
 */
export function filterText(filter: BiFilter): string {
  const op = OPERATOR_SQL[filter.op];
  switch (BI_OPERATOR_ARITY[filter.op]) {
    case 'none':
      return `${filter.field} ${op}`;
    case 'two':
      return `${filter.field} ${op} ${scalarText(filter.value)} AND ${scalarText(filter.value2)}`;
    case 'many': {
      const values = filter.values ?? [];
      const head = values.slice(0, FILTER_VALUES_SHOWN).map(scalarText).join(', ');
      const rest = values.length - FILTER_VALUES_SHOWN;
      return `${filter.field} ${op} (${rest > 0 ? `${head}, +${rest}` : head})`;
    }
    default:
      return `${filter.field} ${op} ${scalarText(filter.value)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Labels. Exhaustive Records, so a value added to a CHECK constraint and not    */
/* here fails typecheck instead of printing a raw SQL token to a user.           */
/* -------------------------------------------------------------------------- */

export function useBiLabels() {
  const { t } = useBiI18n();

  const status: Record<BiStatus, string> = {
    DRAFT: t('مسودة', 'Brouillon', 'Draft'),
    PUBLISHED: t('منشور', 'Publié', 'Published'),
    DEPRECATED: t('مُهمل', 'Déprécié', 'Deprecated'),
  };

  const outcome: Record<BiQueryOutcome, string> = {
    OK: t('نجح', 'Réussi', 'OK'),
    DENIED: t('مرفوض', 'Refusé', 'Denied'),
    ERROR: t('خطأ', 'Erreur', 'Error'),
  };

  const aggregate: Record<BiAggregate, string> = {
    SUM: t('مجموع', 'Somme', 'Sum'),
    COUNT: t('عدد', 'Nombre', 'Count'),
    COUNT_DISTINCT: t('عدد مميّز', 'Nombre distinct', 'Distinct count'),
    AVG: t('متوسط', 'Moyenne', 'Average'),
    MIN: t('أدنى', 'Minimum', 'Minimum'),
    MAX: t('أقصى', 'Maximum', 'Maximum'),
    RATIO: t('نسبة', 'Ratio', 'Ratio'),
  };

  const grain: Record<BiTimeGrain, string> = {
    DAY: t('يوم', 'Jour', 'Day'),
    WEEK: t('أسبوع', 'Semaine', 'Week'),
    MONTH: t('شهر', 'Mois', 'Month'),
    QUARTER: t('ربع', 'Trimestre', 'Quarter'),
    YEAR: t('سنة', 'Année', 'Year'),
  };

  const metricFormat: Record<BiMetricFormat, string> = {
    NUMBER: t('رقم', 'Nombre', 'Number'),
    INTEGER: t('عدد صحيح', 'Entier', 'Integer'),
    CURRENCY: t('عملة', 'Monnaie', 'Currency'),
    PERCENT: t('نسبة مئوية', 'Pourcentage', 'Percent'),
    DURATION_HOURS: t('مدة (ساعات)', 'Durée (heures)', 'Duration (hours)'),
  };

  /** What one cell of a chart opens. These name screens in this application rather
   *  than tables in the database, so the label is the screen's own name. */
  const drillThrough: Record<BiDrillThroughKind, string> = {
    BOOKING: t('حجز', 'Réservation', 'Booking'),
    PILGRIM: t('حاج', 'Pèlerin', 'Pilgrim'),
    PACKAGE: t('باقة', 'Forfait', 'Package'),
    INVOICE: t('فاتورة', 'Facture', 'Invoice'),
    PAYMENT: t('دفعة', 'Paiement', 'Payment'),
    JOURNAL_ENTRY: t('قيد يومية', 'Écriture comptable', 'Journal entry'),
    CRM_LEAD: t('عميل محتمل', 'Piste', 'Lead'),
    CRM_OPPORTUNITY: t('فرصة', 'Opportunité', 'Opportunity'),
    CRM_QUOTE: t('عرض سعر', 'Devis', 'Quote'),
    CRM_CUSTOMER: t('عميل', 'Client', 'Customer'),
    DOCUMENT: t('وثيقة', 'Document', 'Document'),
  };

  return { status, outcome, aggregate, grain, metricFormat, drillThrough };
}

/**
 * All thirty-three chart types, named. Separate from useBiLabels so the chart picker
 * can import the labels without pulling in every other vocabulary, and exhaustive so
 * a type added to the CHECK constraint cannot reach a user as `STACKED_COLUMN`.
 */
export function useBiChartLabels(): Record<BiChartType, string> {
  const { t } = useBiI18n();
  return {
    TABLE: t('جدول', 'Tableau', 'Table'),
    PIVOT: t('جدول محوري', 'Tableau croisé', 'Pivot table'),
    KPI: t('مؤشر', 'Indicateur', 'KPI'),
    LINE: t('خط', 'Courbe', 'Line'),
    AREA: t('مساحة', 'Aire', 'Area'),
    BAR: t('أعمدة أفقية', 'Barres', 'Bar'),
    COLUMN: t('أعمدة', 'Colonnes', 'Column'),
    STACKED_BAR: t('أعمدة أفقية مكدّسة', 'Barres empilées', 'Stacked bar'),
    STACKED_COLUMN: t('أعمدة مكدّسة', 'Colonnes empilées', 'Stacked column'),
    PIE: t('دائري', 'Camembert', 'Pie'),
    DONUT: t('حلقي', 'Anneau', 'Donut'),
    SCATTER: t('انتشار', 'Nuage de points', 'Scatter'),
    BUBBLE: t('فقاعات', 'Bulles', 'Bubble'),
    WATERFALL: t('شلال', 'Cascade', 'Waterfall'),
    BRIDGE: t('جسر', 'Pont', 'Bridge'),
    BULLET: t('هدف', 'Bullet', 'Bullet'),
    HISTOGRAM: t('مدرّج تكراري', 'Histogramme', 'Histogram'),
    BOX_PLOT: t('صندوقي', 'Boîte à moustaches', 'Box plot'),
    HEATMAP: t('خريطة حرارية', 'Carte de chaleur', 'Heatmap'),
    TREEMAP: t('خريطة شجرية', 'Treemap', 'Treemap'),
    DECOMPOSITION_TREE: t('شجرة تفكيك', 'Arbre de décomposition', 'Decomposition tree'),
    SANKEY: t('سانكي', 'Sankey', 'Sankey'),
    FUNNEL: t('قمع', 'Entonnoir', 'Funnel'),
    GANTT: t('غانت', 'Gantt', 'Gantt'),
    CORRELATION_MATRIX: t('مصفوفة ارتباط', 'Matrice de corrélation', 'Correlation matrix'),
    PARETO: t('باريتو', 'Pareto', 'Pareto'),
    FORECAST_BAND: t('نطاق تنبؤ', 'Bande de prévision', 'Forecast band'),
    SENSITIVITY_MATRIX: t('مصفوفة حساسية', 'Matrice de sensibilité', 'Sensitivity matrix'),
    DEPENDENCY_GRAPH: t('مخطط تبعيات', 'Graphe de dépendances', 'Dependency graph'),
    DRIVER_TREE: t('شجرة محرّكات', 'Arbre de facteurs', 'Driver tree'),
    RADAR: t('راداري', 'Radar', 'Radar'),
    GAUGE: t('مقياس', 'Jauge', 'Gauge'),
    COMBO: t('مركّب', 'Combiné', 'Combo'),
  };
}

/* -------------------------------------------------------------------------- */
/* What this build draws                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which renderer draws a chart type.
 *
 * A family is a shape, not a look: everything in one reads the compiler's result the same
 * way, which is why HISTOGRAM sits with BAR and SENSITIVITY_MATRIX with HEATMAP. It is
 * also why the visualization work added six families rather than one "advanced" bucket --
 * a quartile, a fitted interval, a rollup, a ribbon, a dependency and a span are six
 * different readings of the same rows:
 *
 *   BOX       quartiles per series, taken across the categories (BOX_PLOT)
 *   FORECAST  least squares over the first series, with a prediction interval
 *             (FORECAST_BAND)
 *   TREE      dimensions as nested levels, the measure rolled up along them
 *             (DECOMPOSITION_TREE, DRIVER_TREE)
 *   FLOW      consecutive dimension pairs read as a quantity moving (SANKEY)
 *   GRAPH     the same pairs read as a dependency, one node per value
 *             (DEPENDENCY_GRAPH)
 *   SCHEDULE  temporal dimensions read as spans (GANTT)
 *
 * `PENDING` stays, with no members. It is the branch that means "saveable but not drawn":
 * the check constraint accepts all thirty-three types, and a tile whose renderer is
 * missing has to say so by name instead of falling back to a table, which would look like
 * a rendering choice rather than an absence. An empty list is the honest way to record
 * that nothing is in that state today -- the same reason certify.mjs keeps `const
 * ABSENT = []` rather than deleting the machinery that reports it.
 */
export type ChartFamily =
  | 'TABLE' | 'KPI' | 'GAUGE' | 'LINE' | 'BAR' | 'PIE'
  | 'SCATTER' | 'HEATMAP' | 'TREEMAP' | 'FUNNEL' | 'RADAR'
  | 'BOX' | 'FORECAST' | 'TREE' | 'FLOW' | 'GRAPH' | 'SCHEDULE' | 'PENDING';

export const CHART_FAMILY: Record<BiChartType, ChartFamily> = {
  TABLE: 'TABLE', PIVOT: 'TABLE',
  KPI: 'KPI', GAUGE: 'GAUGE',
  LINE: 'LINE', AREA: 'LINE', COMBO: 'LINE', FORECAST_BAND: 'FORECAST',
  BAR: 'BAR', COLUMN: 'BAR', STACKED_BAR: 'BAR', STACKED_COLUMN: 'BAR',
  WATERFALL: 'BAR', BRIDGE: 'BAR', BULLET: 'BAR', HISTOGRAM: 'BAR', PARETO: 'BAR',
  PIE: 'PIE', DONUT: 'PIE',
  SCATTER: 'SCATTER', BUBBLE: 'SCATTER',
  HEATMAP: 'HEATMAP', CORRELATION_MATRIX: 'HEATMAP', SENSITIVITY_MATRIX: 'HEATMAP',
  TREEMAP: 'TREEMAP', FUNNEL: 'FUNNEL', RADAR: 'RADAR',
  BOX_PLOT: 'BOX', DECOMPOSITION_TREE: 'TREE', DRIVER_TREE: 'TREE',
  SANKEY: 'FLOW', DEPENDENCY_GRAPH: 'GRAPH', GANTT: 'SCHEDULE',
};

export const isChartDrawn = (type: BiChartType): boolean => CHART_FAMILY[type] !== 'PENDING';

/** The minimum a type needs to draw anything, so the builder can say "add a measure"
 *  before the save rather than render an empty frame after it. `dims` counts grouping
 *  columns, which includes the time grain -- the compiler returns it as one. */
export const CHART_SHAPE: Record<ChartFamily, { dims: number; measures: number }> = {
  TABLE: { dims: 0, measures: 0 },
  KPI: { dims: 0, measures: 1 },
  /** Two measures: the value, and the target it is read against. A gauge with no target
   *  is a dial whose full sweep means nothing, so the second measure is required rather
   *  than invented from the value itself. */
  GAUGE: { dims: 0, measures: 2 },
  LINE: { dims: 1, measures: 1 },
  BAR: { dims: 1, measures: 1 },
  PIE: { dims: 1, measures: 1 },
  SCATTER: { dims: 1, measures: 2 },
  HEATMAP: { dims: 2, measures: 1 },
  TREEMAP: { dims: 1, measures: 1 },
  FUNNEL: { dims: 1, measures: 1 },
  RADAR: { dims: 1, measures: 1 },
  /** One box per series, so the same one dimension and one measure a bar needs. The
   *  quartiles come from the categories inside each series, which means the shape a box
   *  plot needs is a shape the compiler already returns. */
  BOX: { dims: 1, measures: 1 },
  FORECAST: { dims: 1, measures: 1 },
  /** Levels come from the dimensions, so one is enough to draw a tree that is a total and
   *  its parts. A second and third deepen it rather than being required for it. */
  TREE: { dims: 1, measures: 1 },
  /** Two dimensions, because an edge needs a from and a to. One dimension is a list of
   *  nodes with nothing between them, which is not a flow. */
  FLOW: { dims: 2, measures: 1 },
  GRAPH: { dims: 2, measures: 1 },
  /** A schedule's real requirement is not a column count, it is that a dimension can
   *  carry a moment -- one date column gives spans grouped per label, two give a start
   *  and an end per row, and neither needs a measure to be a schedule. `chartIssues`
   *  raises NEEDS_TEMPORAL for the part that matters, because "add a column" and "one of
   *  them has to be a date" are two different sentences to say to the reader. */
  SCHEDULE: { dims: 1, measures: 0 },
  PENDING: { dims: 0, measures: 0 },
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface BiReadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one BI payload. Deliberately plain: each RPC already composes a whole
 * screen in one round trip, so there is nothing to cache or merge here. `deps` is
 * the argument list -- change it and the read reruns.
 *
 * Nothing is cached across mounts on purpose. A metric that was deprecated a minute
 * ago must not still be drawn from a stale result, and a query that was denied must
 * be re-denied rather than remembered as having succeeded.
 */
export function useBiRead<T>(
  run: () => Promise<BiReadResult<T>>,
  deps: readonly unknown[],
): BiReadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest-ref: the caller passes a fresh closure every render, so the effect keys
  // off the serialized arguments instead of the function identity.
  const runRef = useRef(run);
  runRef.current = run;
  const key = JSON.stringify(deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    safeBiRead(() => runRef.current()).then((res) => {
      if (!alive) return;
      setData(res.data);
      setError(res.error);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [key, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
