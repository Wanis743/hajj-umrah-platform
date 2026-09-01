/**
 * Quartiles, a fitted trend, and a schedule span: three shapes the query compiler does
 * not return, derived here rather than read off column order.
 *
 * Each of these charts had an obvious wrong implementation, and the reason each was
 * rejected matters more than the code that replaced it:
 *
 *   BOX_PLOT       could have read five measures as min/q1/median/q3/max. That is
 *                  positional magic -- swap two shelves and the chart lies without
 *                  saying so. Instead a box is a *series*, and its quartiles come from
 *                  that series' values across the categories: the distribution of one
 *                  metric over the dimension it was grouped by, which is the question
 *                  a box plot answers.
 *   FORECAST_BAND  could have read three measures as value/lower/upper -- the same
 *                  trap, and worse, because then the "forecast" is whatever someone
 *                  dropped on the third shelf. Instead the band is fitted here by
 *                  least squares and reported with its own R² and standard error: a
 *                  projection the reader cannot audit is decoration.
 *   GANTT          could have read two date-formatted measures as start and end.
 *                  BiMetricFormat has no DATE member, so a metric cannot carry a date
 *                  at all and no arrangement of measures can produce a span. It has
 *                  to come from a date, timestamp or time-grain *dimension*, which is
 *                  what ganttModel looks for and what it refuses without.
 *
 * Plain functions in a .ts file, like biChartData.ts and for the same reason: this is
 * where a chart could start inventing arithmetic, and keeping it out of the JSX is
 * what makes it reviewable.
 */
import type { BiQuerySuccess, BiResultColumn, BiScalar, BiTimeGrain } from '@/types/bi';
import { formatCell, numericCell, type MetricDisplay } from './biFormat';
import {
  bandX, colorAt, isTemporal, plotHeight, splitColumns, valueX, valueY, visibleOf,
  type FrameBox, type PlotDomain, type PlotModel, type PlotSeries,
} from './biChartData';

/** The print instructions a metric column carries; a dimension carries none. */
const displayOf = (column: BiResultColumn | null): MetricDisplay =>
  (column && column.kind === 'METRIC'
    ? { format: column.format, decimals: column.decimals, unit: column.unit }
    : {});

/* -------------------------------------------------------------------------- */
/* BOX_PLOT                                                                   */
/* -------------------------------------------------------------------------- */

/** A value far enough from the box to be drawn on its own. It keeps the category it
 *  came from, because the useful thing about an outlier is *which* one it is -- and it
 *  is why a click on an outlier drills that category while a click on a box does not:
 *  a box is a distribution, and there is no single row underneath it to open. */
export interface BoxOutlier { value: number; index: number; label: string; raw: BiScalar }

export interface BoxSummary {
  label: string;
  color: string;
  display: MetricDisplay;
  /** How many categories had a value. Printed next to the box: a box over four points
   *  and a box over four hundred look identical and mean very different things. */
  n: number;
  q1: number;
  median: number;
  q3: number;
  /** The whisker ends: the most extreme values still inside the 1.5·IQR fences, not
   *  the fences themselves. A whisker drawn to a fence claims a value nobody
   *  measured. */
  low: number;
  high: number;
  mean: number;
  outliers: BoxOutlier[];
}

/**
 * The p-th quantile by linear interpolation between order statistics.
 *
 * R's type 7, which is what every spreadsheet's PERCENTILE computes -- so a reader who
 * checks the median in Excel gets this number back rather than an argument about which
 * of the nine definitions a BI tool picked.
 */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** One box per visible series. Hiding a series in the legend removes its box and
 *  rescales the axis, which is the whole reason this family keeps a legend. */
export function boxSummaries(model: PlotModel, hidden: ReadonlySet<string>): BoxSummary[] {
  return visibleOf(model, hidden)
    .map((series) => summarizeSeries(series, model))
    .filter((box): box is BoxSummary => box !== null);
}

function summarizeSeries(series: PlotSeries, model: PlotModel): BoxSummary | null {
  const points = series.values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value !== null);
  if (points.length === 0) return null;

  const sorted = points.map((point) => point.value).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  // Tukey's 1.5·IQR, the definition the box plot was published with. Stated as a
  // constant here rather than a setting, because a chart whose outlier rule is
  // configurable is a chart whose outliers mean nothing across two screens.
  const fence = (q3 - q1) * 1.5;
  const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence);

  return {
    label: series.label,
    color: series.color,
    display: series.display,
    n: points.length,
    q1,
    median,
    q3,
    low: inside[0] ?? sorted[0],
    high: inside[inside.length - 1] ?? sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    outliers: points
      .filter((point) => point.value < q1 - fence || point.value > q3 + fence)
      .map((point) => ({
        value: point.value,
        index: point.index,
        label: model.categories[point.index]?.label ?? '',
        raw: model.categories[point.index]?.raw ?? null,
      })),
  };
}

/**
 * The value range a set of boxes is drawn over.
 *
 * Zero is not forced in, and this is the one place in the folder that departs from
 * plotDomain's rule. That rule exists because a bar encodes its value as a length from
 * a baseline, so a baseline that is not zero exaggerates every difference. A box plot
 * encodes intervals by position: a distribution between 900 and 1,000 drawn from zero
 * is a flat smear at the top of the frame, which hides precisely what the chart is for.
 */
export function boxDomain(boxes: readonly BoxSummary[]): PlotDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const box of boxes) {
    for (const value of [box.low, box.high, ...box.outliers.map((o) => o.value)]) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** One box placed in the frame: a row centre, a thickness, and the five summary values
 *  as x pixels. Computed here rather than in the renderer for the reason the rest of this
 *  folder is arranged that way -- once pixels are being worked out inside JSX, nobody
 *  reviews the arithmetic. */
export interface BoxGeometry {
  summary: BoxSummary;
  /** Row centre. Boxes lie horizontally, one per row, because their labels are series
   *  names and a series name does not fit under a vertical box. */
  cy: number;
  thick: number;
  q1: number;
  q3: number;
  median: number;
  low: number;
  high: number;
  mean: number;
  outliers: Array<{ x: number; outlier: BoxOutlier }>;
}

/**
 * The boxes, laid out across the value axis.
 *
 * Thickness is capped and then shrunk to fit: eleven series in a 240px frame get thin
 * boxes rather than a chart that runs off the bottom, and two series do not get boxes so
 * fat that the median line reads as a band of its own.
 */
export function boxLayout(
  boxes: readonly BoxSummary[], domain: PlotDomain, frame: FrameBox,
): BoxGeometry[] {
  const rowH = boxes.length > 0 ? plotHeight(frame) / boxes.length : 0;
  const thick = Math.max(4, Math.min(26, rowH * 0.55));
  const at = (value: number): number => valueX(value, domain, frame);
  return boxes.map((summary, index) => ({
    summary,
    cy: frame.top + rowH * (index + 0.5),
    thick,
    q1: at(summary.q1),
    q3: at(summary.q3),
    median: at(summary.median),
    low: at(summary.low),
    high: at(summary.high),
    mean: at(summary.mean),
    outliers: summary.outliers.map((outlier) => ({ x: at(outlier.value), outlier })),
  }));
}


export interface ForecastPoint {
  label: string;
  /** The observed value, or null for a projected period. */
  actual: number | null;
  fit: number;
  low: number;
  high: number;
  projected: boolean;
  /** The category's raw value, so a click on an observed point still drills. Null on a
   *  projected period: the server never grouped it, so no filter can name it. */
  raw: BiScalar | null;
  index: number;
}

export interface ForecastFit {
  series: PlotSeries;
  points: ForecastPoint[];
  /** Points the fit was computed from, which is not the number of categories drawn:
   *  a null group is a gap, and a gap contributes nothing to a regression. */
  observed: number;
  horizon: number;
  slope: number;
  intercept: number;
  /** Share of variance the straight line explains. Printed on the chart, because a
   *  band over an R² of 0.04 is a straight line through noise and the reader is
   *  entitled to know that before quoting it. */
  r2: number;
  /** Residual standard error, in the metric's own units. */
  se: number;
  confidence: number;
}

/** Why no band could be fitted, so the frame can say which rather than draw nothing. */
export type ForecastRefusal = 'NO_SERIES' | 'TOO_FEW_POINTS' | 'NO_VARIATION';

export type ForecastResult =
  | { ok: true; fit: ForecastFit }
  | { ok: false; reason: ForecastRefusal };

/**
 * The 97.5th percentile of Student's t by degrees of freedom, i.e. the two-sided 95%
 * multiplier.
 *
 * A table, not an inverted CDF. Below about thirty degrees of freedom the normal
 * approximation genuinely misleads -- at df = 3 the multiplier is 3.18, not 1.96, and a
 * band drawn 1.96 wide over five points understates itself by forty per cent -- and
 * above it the two agree to two decimals. A table can be checked against any statistics
 * text in a minute, which an incomplete beta function implemented here could not be.
 */
const T95: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export const tCritical95 = (df: number): number => {
  if (df < 1) return T95[0];
  // The row a printed table calls ∞, used past the point where the difference stops
  // being visible on a chart.
  return df > T95.length ? 1.96 : T95[df - 1];
};

/**
 * Ordinary least squares over the first visible series, extended forward.
 *
 * Three deliberate choices, all of them about not overclaiming:
 *
 *   The interval is a *prediction* interval, not a confidence interval on the fitted
 *   line. It carries the ±t·se·√(1 + 1/n + (x-x̄)²/Sxx) term, so it widens with distance
 *   from the centre of the observed range -- which is the entire visual argument of a
 *   forecast band: the further out it goes, the less it claims.
 *
 *   The horizon is a quarter of the observed span, capped. A model fitted on eight
 *   points does not get to speak about the next twenty-four.
 *
 *   The fit is over one series, the first the legend has left visible. Fitting several
 *   at once produces a picture nobody can read; switching series is what the legend is
 *   for, and the chart names the one it fitted.
 */
export function forecastBand(
  model: PlotModel, hidden: ReadonlySet<string>,
  grain: BiTimeGrain | null, maxHorizon = 12,
): ForecastResult {
  const series = visibleOf(model, hidden)[0];
  if (!series) return { ok: false, reason: 'NO_SERIES' };

  const points = series.values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value !== null);
  // Three is a floor, not a preference: the residual standard error divides by n - 2,
  // so two points fit a line through themselves with no error left over and produce a
  // band of width zero -- a claim of certainty from a sample of two.
  if (points.length < 3) return { ok: false, reason: 'TOO_FEW_POINTS' };

  const n = points.length;
  const xbar = points.reduce((sum, p) => sum + p.index, 0) / n;
  const ybar = points.reduce((sum, p) => sum + p.value, 0) / n;
  const sxx = points.reduce((sum, p) => sum + (p.index - xbar) ** 2, 0);
  if (sxx === 0) return { ok: false, reason: 'NO_VARIATION' };

  const sxy = points.reduce((sum, p) => sum + (p.index - xbar) * (p.value - ybar), 0);
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  const sse = points.reduce((sum, p) => sum + (p.value - (intercept + slope * p.index)) ** 2, 0);
  const sst = points.reduce((sum, p) => sum + (p.value - ybar) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2));
  const r2 = sst === 0 ? 1 : Math.max(0, 1 - sse / sst);
  const t = tCritical95(n - 2);
  const halfWidth = (x: number): number =>
    t * se * Math.sqrt(1 + 1 / n + ((x - xbar) ** 2) / sxx);

  const horizon = Math.min(maxHorizon, Math.max(1, Math.round(n * 0.25)));
  const last = model.categories.length - 1;
  const pointAt = (index: number, label: string, actual: number | null, raw: BiScalar | null,
    projected: boolean): ForecastPoint => {
    const fit = intercept + slope * index;
    const half = halfWidth(index);
    return { label, actual, fit, low: fit - half, high: fit + half, projected, raw, index };
  };

  return {
    ok: true,
    fit: {
      series,
      points: [
        ...model.categories.map((cat, index) =>
          pointAt(index, cat.label, series.values[index], cat.raw, false)),
        ...Array.from({ length: horizon }, (_, k) =>
          pointAt(last + 1 + k, projectedLabel(model, grain, k + 1), null, null, true)),
      ],
      observed: n,
      horizon,
      slope,
      intercept,
      r2,
      se,
      confidence: 0.95,
    },
  };
}

/**
 * The range a band is drawn over: the observations and both edges of the interval.
 *
 * Zero is not forced in, for the same reason boxDomain does not force it. A band is read
 * for its width relative to the movement it surrounds, and a level series between 900 and
 * 1,000 drawn from zero is a flat line with an invisible band -- which hides the one thing
 * the chart was built to show.
 */
export function forecastDomain(fit: ForecastFit): PlotDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const point of fit.points) {
    for (const value of [point.low, point.high, point.actual]) {
      if (value === null) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
}

/**
 * The three lines a forecast band draws, as null-gapped value arrays aligned to the
 * category bands.
 *
 * `ahead` keeps the last observed period's fitted value so the dashed continuation starts
 * on the solid line rather than a band away from it -- the join is where the reader stops
 * looking at measurements and starts looking at an extrapolation, and a gap there reads
 * as two unrelated lines.
 */
export function forecastLines(points: readonly ForecastPoint[]): {
  actual: (number | null)[]; fitted: (number | null)[]; ahead: (number | null)[];
} {
  const lastObserved = points.reduce(
    (found, point, index) => (point.projected ? found : index), -1);
  return {
    actual: points.map((point) => point.actual),
    fitted: points.map((point) => (point.projected ? null : point.fit)),
    ahead: points.map((point, index) =>
      (point.projected || index === lastObserved ? point.fit : null)),
  };
}

/** The interval as one closed path: the highs left to right, the lows back again. Drawn
 *  as a single shape rather than two lines and a fill rule, so the band is one hit target
 *  and one thing to paint. */
export function bandPath(
  points: readonly ForecastPoint[], domain: PlotDomain, frame: FrameBox,
): string {
  if (points.length === 0) return '';
  const count = points.length;
  const top = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'}${bandX(index, count, frame).toFixed(2)} ${valueY(point.high, domain, frame).toFixed(2)}`);
  const bottom = points.slice().reverse().map((point, back) =>
    `L${bandX(count - 1 - back, count, frame).toFixed(2)} ${valueY(point.low, domain, frame).toFixed(2)}`);
  return `${[...top, ...bottom].join(' ')} Z`;
}

/* -------------------------------------------------------------------------- */
/* Period arithmetic, shared by the forecast's labels and by GANTT             */
/* -------------------------------------------------------------------------- */

/**
 * A cell read as a moment. Strings only, and that is the point.
 *
 * A number on a date-ish column could be 2026 (a year), 1767225600 (an epoch in
 * seconds), 1767225600000 (the same epoch in milliseconds) or 45 (a count of days that
 * landed on the wrong shelf). Guessing which is how a chart starts lying about time.
 * A date, timestamp or time-grain dimension arrives from Postgres as ISO text, so the
 * case that exists is covered and every other case refuses.
 */
export function instantOf(value: BiScalar): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * One instant advanced by whole grains, in UTC.
 *
 * UTC throughout: the grain came from date_trunc on the server, and re-reading it in
 * the browser's zone would move a month boundary by a few hours and label the
 * projection with the month before it. The day of the month is carried across
 * unchanged, which is exact for the values this receives -- date_trunc('month', …) is
 * always the first of a month -- and is why this is not a general date library.
 */
function shiftPeriod(ms: number, grain: BiTimeGrain, steps: number): number {
  const at = new Date(ms);
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  switch (grain) {
    case 'DAY': return Date.UTC(y, m, d + steps);
    case 'WEEK': return Date.UTC(y, m, d + steps * 7);
    case 'MONTH': return Date.UTC(y, m + steps, d);
    case 'QUARTER': return Date.UTC(y, m + steps * 3, d);
    default: return Date.UTC(y + steps, m, d);
  }
}

/** A period printed by slicing its ISO text rather than through toLocaleDateString.
 *  The observed labels on this axis were printed by formatCell and the projected ones
 *  sit beside them, so both have to keep the same shape and roughly the same width. */
export function periodLabel(ms: number, grain: BiTimeGrain): string {
  const at = new Date(ms);
  const iso = at.toISOString();
  if (grain === 'YEAR') return iso.slice(0, 4);
  if (grain === 'QUARTER') return `${iso.slice(0, 4)}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
  return grain === 'MONTH' ? iso.slice(0, 7) : iso.slice(0, 10);
}

/**
 * The name of a period the query never returned.
 *
 * `+1`, `+2` unless there is both a time grain and a last category that parses as a
 * date. A projected label has to be tellable from an observed one, and printing
 * "April" over a dimension that was never a month claims the axis knows something it
 * does not.
 */
function projectedLabel(model: PlotModel, grain: BiTimeGrain | null, step: number): string {
  if (grain === null) return `+${step}`;
  const last = model.categories[model.categories.length - 1];
  const ms = last ? instantOf(last.raw) : null;
  return ms === null ? `+${step}` : periodLabel(shiftPeriod(ms, grain, step), grain);
}

/* -------------------------------------------------------------------------- */
/* GANTT                                                                      */
/* -------------------------------------------------------------------------- */

/** A dimension that can carry a moment: a time grain, or a date/timestamp column. Taken
 *  from biChartData rather than declared here, because the chart frame has to ask the
 *  same question to decide whether a schedule can draw at all -- and this file already
 *  imports from there, so the predicate has to sit on that side to keep the edge one-way. */

export interface GanttBar {
  label: string;
  /** The value a click drills. Null when the bar has no non-temporal dimension behind
   *  it, because then there is no field a filter could name. */
  raw: BiScalar;
  start: number;
  end: number;
  /** The measure, carried only for a bar that is exactly one row. */
  value: number | null;
  display: MetricDisplay;
  color: string;
  /** Position in the result rows -- the first row of the group, for a derived bar. */
  index: number;
  /** Result rows behind this bar. Printed when it is more than one, because a bar over
   *  four hundred rows and a bar over one look identical and are not the same claim. */
  rows: number;
}

export interface GanttModel {
  bars: GanttBar[];
  min: number;
  max: number;
  /** True when the spans were derived by grouping on the non-temporal dimensions and
   *  taking min..max of a single date column, rather than read from a start column and
   *  an end column. The chart prints it, because "when it was active" and "when it was
   *  scheduled" are different statements and only the second is a schedule. */
  derived: boolean;
  /** Null only when the result carried no temporal dimension at all, which is how the
   *  frame tells a missing shelf from an empty result. */
  startColumn: BiResultColumn | null;
  endColumn: BiResultColumn | null;
  /** The column a bar's `raw` came from, so a click can be turned into a filter. */
  labelColumn: BiResultColumn | null;
  /** Rows carrying no usable instant, counted so the frame can say what it dropped
   *  instead of quietly drawing a shorter chart. */
  skipped: number;
}

/** The label a bar carries: every non-temporal dimension on the row, joined. */
const joinLabels = (
  row: Readonly<Record<string, BiScalar>>, columns: readonly BiResultColumn[],
): string => columns.map((column) => formatCell(row[column.alias] ?? null, column)).join(' • ');

/**
 * One bar per row, from a start column and an end column -- which is what a schedule
 * table actually looks like when it reaches the browser.
 *
 * A row whose start is after its end is drawn from the earlier instant to the later
 * one rather than dropped. The span is real either way, and a chart that silently
 * discards reversed dates hides a data problem the reader is the only one who can fix.
 */
function rowBars(
  result: BiQuerySuccess, from: BiResultColumn, to: BiResultColumn,
  labels: readonly BiResultColumn[], measure: BiResultColumn | null,
): { bars: GanttBar[]; skipped: number } {
  const named = labels.length > 0 ? labels : [from];
  const bars: GanttBar[] = [];
  let skipped = 0;
  result.rows.forEach((row, index) => {
    const a = instantOf(row[from.alias] ?? null);
    const b = instantOf(row[to.alias] ?? null);
    if (a === null || b === null) { skipped += 1; return; }
    bars.push({
      label: joinLabels(row, named),
      raw: labels[0] ? (row[labels[0].alias] ?? null) : null,
      start: Math.min(a, b),
      end: Math.max(a, b),
      value: measure ? numericCell(row[measure.alias] ?? null) : null,
      display: displayOf(measure),
      color: '',
      index,
      rows: 1,
    });
  });
  return { bars, skipped };
}

/**
 * One bar per group of the non-temporal dimensions, spanning min..max of the single
 * date column the result carried.
 *
 * The measure is dropped as soon as a group holds more than one row. A span is not a
 * sum: adding a metric across the rows behind one bar would be this file computing a
 * business number, and for a non-additive metric it would compute the wrong one. The
 * row count is reported instead, which is the honest thing a grouped bar knows.
 */
/** Group keys are raw values joined, so the separator has to be something a dimension
 *  value cannot contain: U+0001. Built with fromCharCode rather than written as a
 *  literal, because a control byte pasted into source is a character no reviewer can
 *  see -- and if a value ever does contain it, two groups merge into one bar instead of
 *  the file throwing. */
const BAR_KEY_SEP = String.fromCharCode(1);

function groupedBars(
  result: BiQuerySuccess, when: BiResultColumn,
  labels: readonly BiResultColumn[], measure: BiResultColumn | null,
): { bars: GanttBar[]; skipped: number } {
  const named = labels.length > 0 ? labels : [when];
  const groups = new Map<string, GanttBar>();
  let skipped = 0;
  result.rows.forEach((row, index) => {
    const at = instantOf(row[when.alias] ?? null);
    if (at === null) { skipped += 1; return; }
    const key = named.map((column) => String(row[column.alias] ?? '')).join(BAR_KEY_SEP);
    const found = groups.get(key);
    if (found === undefined) {
      groups.set(key, {
        label: joinLabels(row, named),
        raw: labels[0] ? (row[labels[0].alias] ?? null) : null,
        start: at,
        end: at,
        value: measure ? numericCell(row[measure.alias] ?? null) : null,
        display: displayOf(measure),
        color: '',
        index,
        rows: 1,
      });
      return;
    }
    found.start = Math.min(found.start, at);
    found.end = Math.max(found.end, at);
    found.rows += 1;
    found.value = null;
  });
  return { bars: [...groups.values()], skipped };
}

/**
 * The schedule, from whatever temporal dimensions the result carries.
 *
 * Two or more give a start and an end per row. Exactly one gives a derived span per
 * group. None gives no bars and a null `startColumn`, which is how the frame knows to
 * ask for a date dimension rather than draw an empty grid -- and asking is the only
 * option, because a metric cannot carry a date and no arrangement of measures could
 * rescue it.
 *
 * Bars are sorted by start, which overrules the query's ORDER BY. That is the same
 * argument PARETO makes for sorting by size: a schedule read top to bottom in start
 * order *is* the chart, and a Gantt in alphabetical order is a table with stripes.
 */
export function ganttModel(result: BiQuerySuccess): GanttModel {
  const { dimensions, measures } = splitColumns(result.columns);
  const temporal = dimensions.filter(isTemporal);
  const labels = dimensions.filter((column) => !isTemporal(column));
  const labelColumn = labels[0] ?? null;
  const frame = {
    derived: temporal.length < 2,
    startColumn: temporal[0] ?? null,
    endColumn: temporal[1] ?? null,
    labelColumn,
  };
  if (temporal.length === 0) {
    return { ...frame, bars: [], min: 0, max: 1, skipped: result.rows.length };
  }

  const measure = measures[0] ?? null;
  const { bars, skipped } = frame.derived
    ? groupedBars(result, temporal[0], labels, measure)
    : rowBars(result, temporal[0], temporal[1], labels, measure);
  if (bars.length === 0) return { ...frame, bars, min: 0, max: 1, skipped };

  bars.sort((a, b) => a.start - b.start || a.end - b.end);
  const lo = bars.reduce((min, bar) => Math.min(min, bar.start), bars[0].start);
  const hi = bars.reduce((max, bar) => Math.max(max, bar.end), bars[0].end);
  // Half a day of padding when every bar is a single instant, so a milestone-only
  // schedule still has an axis to sit on instead of collapsing to zero width.
  const pad = hi > lo ? (hi - lo) * 0.04 : 43_200_000;
  return {
    ...frame,
    // Colour follows the drawn order, assigned after the sort so the top bar is always
    // the first series colour and two screens of the same data look the same.
    bars: bars.map((bar, index) => ({ ...bar, color: colorAt(index) })),
    min: lo - pad,
    max: hi + pad,
    skipped,
  };
}

export interface GanttTick { at: number; label: string }

/**
 * Time-axis labels, evenly spaced and printed from ISO text.
 *
 * The format follows the span rather than the grain: four ticks reading `2026-08-31`
 * across three years are four strings that look identical, and four reading `2026`
 * across one month are four copies of the same year. Locale-free on purpose -- a tick
 * whose width changes with the interface language reflows the frame around it.
 */
export function ganttTicks(min: number, max: number, count = 4): GanttTick[] {
  const DAY = 86_400_000;
  const span = max - min;
  const cut = span > DAY * 900 ? 4 : span > DAY * 60 ? 7 : 10;
  return Array.from({ length: count + 1 }, (_, step) => {
    const at = min + (span / count) * step;
    return { at, label: new Date(at).toISOString().slice(0, cut) };
  });
}

export interface GanttGeometry {
  bar: GanttBar;
  /** Row centre, computed the same way CategoryAxisY places its labels, so a bar and its
   *  name cannot drift apart as the frame is resized. */
  cy: number;
  thick: number;
  x1: number;
  x2: number;
  /** A span of zero: one instant, not a duration. Drawn as a diamond rather than a
   *  one-pixel bar, because a bar too thin to see is indistinguishable from no bar. */
  milestone: boolean;
}

/**
 * The bars, laid out along the time axis.
 *
 * A non-zero span is floored at two pixels wide. That is a lie about the duration of
 * about a day in a three-year schedule -- and the honest alternative, a bar the reader
 * cannot see, is a lie about its existence, which is worse. A true instant keeps its
 * zero and changes shape instead.
 */
export function ganttLayout(model: GanttModel, frame: FrameBox): GanttGeometry[] {
  const domain: PlotDomain = { min: model.min, max: model.max };
  const rowH = model.bars.length > 0 ? plotHeight(frame) / model.bars.length : 0;
  const thick = Math.max(4, Math.min(22, rowH * 0.6));
  return model.bars.map((bar, index) => {
    const from = valueX(bar.start, domain, frame);
    const to = valueX(bar.end, domain, frame);
    const milestone = bar.end === bar.start;
    return {
      bar,
      cy: frame.top + rowH * (index + 0.5),
      thick,
      x1: from,
      x2: milestone ? from : Math.max(to, from + 2),
      milestone,
    };
  });
}
