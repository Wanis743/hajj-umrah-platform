/**
 * The plot model: one compiled result turned into categories and series, once, so
 * every renderer in this folder measures the same numbers the same way.
 *
 * Plain functions in a .ts file for two reasons. The 600-line limit on components is
 * one; the other is that this is where a chart could start inventing arithmetic, and
 * keeping it out of the JSX makes it reviewable. The rules it does apply are stated
 * where they are made -- a null group is a gap and never a zero, a second dimension
 * becomes the series axis rather than a second row of bars, and nothing is summed
 * that the semantic layer marked non-additive.
 */
import type {
  BiChartType, BiQuerySuccess, BiResultColumn, BiResultRow, BiScalar,
} from '@/types/bi';
import { CHART_FAMILY, formatCell, formatMetricValue, numericCell, type MetricDisplay } from './biFormat';

/** The dashboard's existing accents, in the same order, so a BI tile and an ops chart
 *  on the same screen do not disagree about what the third series looks like. */
export const SERIES_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#d4af37', '#0ea5e9', '#84cc16', '#ec4899',
] as const;

export const colorAt = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length];

export interface PlotCategory {
  /** The raw cells joined, and the only thing rows are matched on: two timestamps in
   *  the same day print identically, and indexing on the printed label would silently
   *  merge them. */
  key: string;
  /** The cell as printed. */
  label: string;
  /** The cell as it came back, for a drill-through that must send the value the
   *  server grouped on rather than the string a screen rendered. */
  raw: BiScalar;
}

export interface PlotSeries {
  label: string;
  color: string;
  /** One entry per category, aligned by index. Null is a group with no row, which
   *  draws as a gap in a line and nothing in a bar -- not as zero. */
  values: (number | null)[];
  /** How to print a value of this series. */
  display: MetricDisplay;
  /** False for a metric the registry marked non-additive, which must not be stacked
   *  or totalled: a stacked average is a number nobody asked for. */
  additive: boolean;
}

export interface PlotModel {
  categories: PlotCategory[];
  series: PlotSeries[];
  /** The dimension the categories came from, and what a click on one drills into. */
  categoryColumn: BiResultColumn | null;
  /** Set when a second dimension became the series axis. */
  splitColumn: BiResultColumn | null;
  measures: BiResultColumn[];
  dimensions: BiResultColumn[];
  /** True when every series is additive, i.e. when stacking is honest. */
  stackable: boolean;
}

const displayOf = (c: BiResultColumn): MetricDisplay => ({
  format: c.format, decimals: c.decimals, unit: c.unit,
});

export function splitColumns(columns: readonly BiResultColumn[]): {
  dimensions: BiResultColumn[]; measures: BiResultColumn[];
} {
  const dimensions = columns.filter((c) => c.kind === 'DIMENSION');
  const measures = columns.filter((c) => c.kind === 'METRIC');
  return { dimensions, measures };
}

/**
 * The whole translation, in one pass.
 *
 * Two dimensions and one measure is read as a split: the second dimension becomes the
 * series and the chart gains a legend. Two dimensions and two measures is not -- that
 * is a cross-tab, and drawing it as either one would drop a fact -- so the second
 * dimension is left in the categories as a composite label and the measures become
 * the series. The pivot table is the honest rendering of that case, which is why
 * PIVOT exists as its own chart type.
 */
export function buildPlotModel(result: BiQuerySuccess): PlotModel {
  const { dimensions, measures } = splitColumns(result.columns);
  const split = dimensions.length >= 2 && measures.length === 1 ? dimensions[1] : null;
  const catCols = split ? [dimensions[0]] : dimensions;
  const categories = collectCategories(result.rows, catCols);
  const series = split
    ? seriesBySplit(result.rows, catCols, split, measures[0], categories)
    : seriesByMeasure(result.rows, catCols, measures, categories);

  return {
    categories,
    series,
    categoryColumn: dimensions[0] ?? null,
    splitColumn: split,
    measures,
    dimensions,
    stackable: series.every((s) => s.additive),
  };
}

/** A row's category identity: every category column joined. The raw value kept is
 *  the first column's, because that is the dimension a drill-through names. */
function categoryKey(row: BiResultRow, cols: readonly BiResultColumn[]): string {
  return cols.map((c) => String(row[c.alias] ?? '')).join(' • ');
}

function collectCategories(
  rows: readonly BiResultRow[], cols: readonly BiResultColumn[],
): PlotCategory[] {
  if (cols.length === 0) return [{ key: '', label: '', raw: null }];
  const seen = new Map<string, PlotCategory>();
  for (const row of rows) {
    const key = categoryKey(row, cols);
    if (seen.has(key)) continue;
    seen.set(key, {
      key,
      label: cols.map((c) => formatCell(row[c.alias] ?? null, c)).join(' • '),
      raw: row[cols[0].alias] ?? null,
    });
  }
  return [...seen.values()];
}

/** One series per measure. The common case: a time grain on the x axis and two or
 *  three numbers over it. */
function seriesByMeasure(
  rows: readonly BiResultRow[], cols: readonly BiResultColumn[],
  measures: readonly BiResultColumn[], categories: readonly PlotCategory[],
): PlotSeries[] {
  const index = new Map(categories.map((c, i) => [c.key, i]));
  return measures.map((m, i) => {
    const values: (number | null)[] = categories.map(() => null);
    for (const row of rows) {
      const at = index.get(categoryKey(row, cols));
      if (at === undefined) continue;
      values[at] = numericCell(row[m.alias] ?? null);
    }
    return {
      label: m.label, color: colorAt(i), values,
      display: displayOf(m), additive: m.is_additive !== false,
    };
  });
}

/** One series per distinct value of the second dimension: "revenue by month, split by
 *  branch". The split's values are taken in the order the server returned them, which
 *  is the order the ORDER BY asked for -- re-sorting here would quietly overrule it. */
function seriesBySplit(
  rows: readonly BiResultRow[], catCols: readonly BiResultColumn[],
  split: BiResultColumn, measure: BiResultColumn, categories: readonly PlotCategory[],
): PlotSeries[] {
  const index = new Map(categories.map((c, i) => [c.key, i]));
  const order: string[] = [];
  const byKey = new Map<string, { label: string; values: (number | null)[] }>();

  for (const row of rows) {
    const at = index.get(categoryKey(row, catCols));
    if (at === undefined) continue;
    const key = String(row[split.alias] ?? '');
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        label: formatCell(row[split.alias] ?? null, split),
        values: categories.map(() => null),
      };
      byKey.set(key, entry);
      order.push(key);
    }
    entry.values[at] = numericCell(row[measure.alias] ?? null);
  }

  return order.map((key, i) => {
    const entry = byKey.get(key);
    return {
      label: entry?.label ?? key,
      color: colorAt(i),
      values: entry?.values ?? categories.map(() => null),
      display: displayOf(measure),
      additive: measure.is_additive !== false,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */

export interface PlotDomain { min: number; max: number }

/**
 * The value range to draw over.
 *
 * Zero is included whenever the data does not cross it, because a bar that starts at
 * the smallest value in the set exaggerates every difference in it -- the single most
 * common way an honest number becomes a misleading picture. A series that does cross
 * zero keeps both signs.
 */
export function plotDomain(series: readonly PlotSeries[], stacked: boolean): PlotDomain {
  let min = 0;
  let max = 0;
  if (stacked) {
    const count = series[0]?.values.length ?? 0;
    for (let i = 0; i < count; i += 1) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v === null) continue;
        if (v >= 0) pos += v; else neg += v;
      }
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    }
  } else {
    for (const s of series) {
      for (const v of s.values) {
        if (v === null) continue;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
  }
  if (min === 0 && max === 0) return { min: 0, max: 1 };
  return { min, max };
}

/** Evenly spaced gridline values across a domain. Not "nice" numbers on purpose: a
 *  rounded axis top invites reading a value off the grid, and these charts label the
 *  points themselves. */
export function domainTicks(domain: PlotDomain, count = 4): number[] {
  const step = (domain.max - domain.min) / count;
  return Array.from({ length: count + 1 }, (_, i) => domain.min + step * i);
}

/* -------------------------------------------------------------------------- */
/* Shapes that are not a category-and-series grid                              */
/* -------------------------------------------------------------------------- */

export interface ScatterPoint {
  x: number; y: number; size: number | null; label: string; raw: BiScalar;
}

/** SCATTER and BUBBLE plot two measures against each other, with the dimension as the
 *  point's identity rather than an axis. A third measure sizes a bubble. */
export function scatterPoints(result: BiQuerySuccess): {
  points: ScatterPoint[]; x: BiResultColumn | null; y: BiResultColumn | null; size: BiResultColumn | null;
} {
  const { dimensions, measures } = splitColumns(result.columns);
  const [x, y, size] = measures;
  if (!x || !y) return { points: [], x: x ?? null, y: y ?? null, size: null };
  const points: ScatterPoint[] = [];
  for (const row of result.rows) {
    const xv = numericCell(row[x.alias] ?? null);
    const yv = numericCell(row[y.alias] ?? null);
    if (xv === null || yv === null) continue;
    points.push({
      x: xv,
      y: yv,
      size: size ? numericCell(row[size.alias] ?? null) : null,
      label: dimensions.map((c) => formatCell(row[c.alias] ?? null, c)).join(' • '),
      raw: dimensions[0] ? row[dimensions[0].alias] ?? null : null,
    });
  }
  return { points, x, y, size: size ?? null };
}

/** Running totals for WATERFALL and BRIDGE: each bar starts where the last one ended,
 *  so the picture is how the total was arrived at rather than what the parts were. */
export interface WaterfallStep {
  label: string; raw: BiScalar; delta: number; start: number; end: number;
}

export function waterfallSteps(model: PlotModel): WaterfallStep[] {
  const series = model.series[0];
  if (!series) return [];
  let running = 0;
  return model.categories.map((cat, i) => {
    const delta = series.values[i] ?? 0;
    const start = running;
    running += delta;
    return { label: cat.label, raw: cat.raw, delta, start, end: running };
  });
}

/** PARETO: the bars sorted by size with the cumulative share as a line. Sorting here
 *  is the point of the chart, so it overrules the query's ORDER BY -- the one place in
 *  this file that reorders anything, and it is why it is a chart type of its own. */
export interface ParetoBar {
  label: string; raw: BiScalar; value: number; cumulative: number;
  /** Where this bar was before the sort. A click drills the category the server
   *  grouped on, and after reordering the position on screen is no longer it. */
  index: number;
}

export function paretoBars(model: PlotModel): ParetoBar[] {
  const series = model.series[0];
  if (!series) return [];
  const rows = model.categories
    .map((cat, i) => ({ label: cat.label, raw: cat.raw, value: series.values[i] ?? 0, index: i }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  let running = 0;
  return rows.map((r) => {
    running += r.value;
    return { ...r, cumulative: total > 0 ? running / total : 0 };
  });
}

export interface TreemapRect {
  x: number; y: number; w: number; h: number;
  label: string; raw: BiScalar; value: number; color: string;
  /** The category's position in the model, kept through the sort for the same reason
   *  a Pareto bar keeps it: the drill names a value, not a rectangle. */
  index: number;
}

/**
 * Slice-and-dice treemap: split along the longer side at each step, so cells stay
 * closer to square than a single-direction split without needing a full squarify.
 * Negative and null values are dropped -- an area cannot be negative, and drawing one
 * as though it were small is worse than leaving it out and saying so.
 */
export function treemapRects(model: PlotModel, width: number, height: number): TreemapRect[] {
  const series = model.series[0];
  if (!series || width <= 0 || height <= 0) return [];
  const items = model.categories
    .map((cat, i) => ({ label: cat.label, raw: cat.raw, value: series.values[i] ?? 0, index: i }))
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value);
  const out: TreemapRect[] = [];
  layout(items, 0, 0, width, height, out);
  return out.map((r, i) => ({ ...r, color: colorAt(i) }));
}

type TreemapItem = { label: string; raw: BiScalar; value: number; index: number };

/** Recursive halving: take items off the front until they fill about half the weight,
 *  give them half the box along its longer side, recurse on both halves. */
function layout(
  items: readonly TreemapItem[], x: number, y: number, w: number, h: number,
  out: Omit<TreemapRect, 'color'>[],
): void {
  if (items.length === 0 || w <= 0 || h <= 0) return;
  if (items.length === 1) {
    out.push({
      x, y, w, h,
      label: items[0].label, raw: items[0].raw, value: items[0].value, index: items[0].index,
    });
    return;
  }
  const total = items.reduce((sum, it) => sum + it.value, 0);
  let taken = 0;
  let cut = 0;
  while (cut < items.length - 1 && taken + items[cut].value <= total / 2) {
    taken += items[cut].value;
    cut += 1;
  }
  if (cut === 0) cut = 1;
  const share = total > 0 ? taken / total : 0.5;
  if (w >= h) {
    const left = w * share;
    layout(items.slice(0, cut), x, y, left, h, out);
    layout(items.slice(cut), x + left, y, w - left, h, out);
  } else {
    const top = h * share;
    layout(items.slice(0, cut), x, y, w, top, out);
    layout(items.slice(cut), x, y + top, w, h - top, out);
  }
}

/* -------------------------------------------------------------------------- */
/* The plot box                                                               */
/* -------------------------------------------------------------------------- */

export interface FrameBox {
  width: number; height: number;
  left: number; top: number; right: number; bottom: number;
}

/** Room for value labels on the value axis and one line of category labels on the
 *  other. Fixed rather than measured from the text: a chart that reflows as its own
 *  labels change length jitters on every hover. */
export const frameBox = (width: number, height: number, horizontal = false): FrameBox => ({
  width, height,
  left: horizontal ? 104 : 56,
  right: 14,
  top: 14,
  bottom: horizontal ? 26 : 46,
});

export const plotWidth = (b: FrameBox): number => Math.max(0, b.width - b.left - b.right);
export const plotHeight = (b: FrameBox): number => Math.max(0, b.height - b.top - b.bottom);

/** Where a value sits inside the plot, as a fraction from the domain's floor. Returns
 *  0 for a degenerate domain rather than dividing by zero. */
export function fraction(value: number, domain: PlotDomain): number {
  const span = domain.max - domain.min;
  return span === 0 ? 0 : (value - domain.min) / span;
}

/** What a click on a chart hands back: the dimension column that was grouped on and
 *  the value of the cell. The caller decides what that means -- `drill_to_key` is a
 *  drill-down into the next level, `drill_through_kind` is a drill-through to records
 *  -- because a chart should not have to know which screens exist. */
export interface BiChartSelection {
  column: BiResultColumn;
  value: BiScalar;
  label: string;
}

/* -------------------------------------------------------------------------- */
/* What a chart type wants, and what it got                                    */
/* -------------------------------------------------------------------------- */

export const isStacked = (type: BiChartType): boolean =>
  type === 'STACKED_BAR' || type === 'STACKED_COLUMN';

/** BAR is horizontal and COLUMN is vertical. The two words are used the other way
 *  round often enough to be worth stating once here rather than guessing per file. */
export const isHorizontal = (type: BiChartType): boolean =>
  type === 'BAR' || type === 'STACKED_BAR' || type === 'FUNNEL' || type === 'BULLET';

/**
 * Every reason a chart will not draw what its author expected, as data.
 *
 * Returned as codes rather than sentences because this file has no translator, and
 * kept exhaustive because the alternative -- rendering an empty frame -- is the
 * failure mode that makes a BI tool untrustworthy: the reader cannot tell an empty
 * result from a broken chart.
 */
export type ChartIssue =
  | { kind: 'PENDING'; chartType: BiChartType }
  | { kind: 'EMPTY' }
  | { kind: 'NEEDS_DIMENSION'; need: number; have: number }
  | { kind: 'NEEDS_MEASURE'; need: number; have: number }
  | { kind: 'NOT_ADDITIVE'; label: string };

export function chartIssues(
  type: BiChartType, model: PlotModel, rowCount: number,
): ChartIssue[] {
  const family = CHART_FAMILY[type];
  if (family === 'PENDING') return [{ kind: 'PENDING', chartType: type }];
  const issues: ChartIssue[] = [];
  if (rowCount === 0) issues.push({ kind: 'EMPTY' });

  const dims = model.dimensions.length;
  const measures = model.measures.length;
  if (family === 'HEATMAP' && dims < 2) {
    issues.push({ kind: 'NEEDS_DIMENSION', need: 2, have: dims });
  } else if (dims < 1 && family !== 'KPI' && family !== 'GAUGE' && family !== 'TABLE') {
    issues.push({ kind: 'NEEDS_DIMENSION', need: 1, have: dims });
  }
  if (family === 'SCATTER' && measures < 2) {
    issues.push({ kind: 'NEEDS_MEASURE', need: 2, have: measures });
  } else if (family === 'GAUGE' && measures < 2) {
    // The value and the target. Stated here rather than in the renderer, so a gauge
    // with one metric says what it is missing instead of drawing a full dial.
    issues.push({ kind: 'NEEDS_MEASURE', need: 2, have: measures });
  } else if (measures < 1 && family !== 'TABLE') {
    issues.push({ kind: 'NEEDS_MEASURE', need: 1, have: measures });
  }
  if (isStacked(type)) {
    const bad = model.series.find((s) => !s.additive);
    if (bad) issues.push({ kind: 'NOT_ADDITIVE', label: bad.label });
  }
  return issues;
}

/** Whether an issue stops the drawing or only qualifies it. A non-additive series
 *  under a stack still draws -- with the warning next to it -- because the author is
 *  the person who can fix it and hiding the picture does not help them see why. */
export const blocksDrawing = (issue: ChartIssue): boolean => issue.kind !== 'NOT_ADDITIVE';

/* -------------------------------------------------------------------------- */
/* What the renderers share                                                   */
/* -------------------------------------------------------------------------- */

/** Series the reader switched off in the legend, dropped before the domain is measured
 *  so that hiding the outlier actually rescales the axis. */
export const visibleOf = (model: PlotModel, hidden: ReadonlySet<string>): PlotSeries[] =>
  model.series.filter((s) => !hidden.has(s.label));

/** The value axis reads the first visible series' format. Two metrics with different
 *  formats on one axis is a chart the author should not have built, and labelling the
 *  axis in the first one is at least consistent with what the tooltip says. */
export const axisDisplay = (series: readonly PlotSeries[]): MetricDisplay =>
  series[0]?.display ?? {};

/** One line of a tooltip. The value arrives formatted, because the tooltip is not
 *  allowed to be the second place a number gets rounded. */
export interface HoverRow { label: string; value: string; color?: string }

/** Every series' value at one category, formatted, for the tooltip. */
export function hoverRows(series: readonly PlotSeries[], index: number): HoverRow[] {
  return series.map((s) => ({
    label: s.label,
    value: formatMetricValue(s.values[index] ?? null, s.display),
    color: s.color,
  }));
}

/** What a screen reader gets for a mark: the same sentence the tooltip shows, because
 *  a chart that is only legible by hovering has a smaller audience than its data. */
export const markLabel = (
  title: string, series: readonly PlotSeries[], index: number,
): string => [title, ...hoverRows(series, index).map((r) => `${r.label}: ${r.value}`)].join(', ');

/**
 * Categories sit on bands and every mark draws at the band's centre, lines included.
 *
 * COMBO puts bars and a line in one frame and the two have to agree about where March
 * is, and CategoryAxisX labels band centres -- so this is the one placement rule, and a
 * line chart keeps half a band of air at each end rather than touching the axis.
 */
export const bandOf = (count: number, box: FrameBox): number =>
  (count > 0 ? plotWidth(box) / count : 0);

export const bandX = (i: number, count: number, box: FrameBox): number =>
  box.left + bandOf(count, box) * (i + 0.5);

/** A value's pixel on a vertical and on a horizontal value axis. Both measure from the
 *  domain's floor rather than from the edge of the frame, so a domain that includes
 *  negatives puts zero inside the plot and a bar drawn from zero goes the right way. */
export const valueY = (v: number, domain: PlotDomain, box: FrameBox): number =>
  box.top + plotHeight(box) - fraction(v, domain) * plotHeight(box);

export const valueX = (v: number, domain: PlotDomain, box: FrameBox): number =>
  box.left + fraction(v, domain) * plotWidth(box);

/** A null is a gap: the path breaks and resumes rather than joining across it, because
 *  a straight segment over a month with no data is a claim about that month. */
export function linePath(
  values: readonly (number | null)[], domain: PlotDomain, box: FrameBox,
): string {
  let out = '';
  let open = false;
  values.forEach((v, i) => {
    if (v === null) { open = false; return; }
    const x = bandX(i, values.length, box);
    out += `${open ? 'L' : 'M'}${x.toFixed(2)} ${valueY(v, domain, box).toFixed(2)} `;
    open = true;
  });
  return out.trim();
}

/** The same path closed down to the zero line, for AREA. The fill spans the drawn run
 *  only, so a gap does not become a filled wedge under nothing. */
export function areaPath(
  values: readonly (number | null)[], domain: PlotDomain, box: FrameBox,
): string {
  const line = linePath(values, domain, box);
  if (!line) return '';
  const drawn: number[] = [];
  values.forEach((v, i) => { if (v !== null) drawn.push(i); });
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  if (first === undefined || last === undefined) return '';
  const zero = valueY(0, domain, box).toFixed(2);
  const x0 = bandX(first, values.length, box).toFixed(2);
  const x1 = bandX(last, values.length, box).toFixed(2);
  return `${line} L${x1} ${zero} L${x0} ${zero} Z`;
}

export interface BarRect {
  x: number; y: number; w: number; h: number; color: string;
  /** Which series and which category this rectangle is, so a click can drill and a
   *  key can be stable across a re-render that reorders nothing. */
  si: number; ci: number;
}

/**
 * Every bar in one pass, for grouped and stacked, vertical and horizontal.
 *
 * Bars are measured from the zero line rather than from the edge of the frame, so a
 * negative value draws the other way instead of drawing as a short positive one.
 * A stacked segment accumulates upward from zero for positives and downward for
 * negatives, which is the only arrangement in which a mixed-sign stack is readable.
 */
export function barRects(
  series: readonly PlotSeries[], count: number, domain: PlotDomain, box: FrameBox,
  opts: { stacked: boolean; horizontal: boolean; tight?: boolean },
): BarRect[] {
  const { stacked, horizontal, tight = false } = opts;
  const span = horizontal ? plotHeight(box) : plotWidth(box);
  const band = count > 0 ? span / count : 0;
  const inner = band * (tight ? 1 : 0.74);
  const pad = (band - inner) / 2;
  const slot = stacked || series.length === 0 ? inner : inner / series.length;
  const out: BarRect[] = [];
  for (let ci = 0; ci < count; ci += 1) {
    let pos = 0;
    let neg = 0;
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null || v === undefined) return;
      const from = stacked ? (v >= 0 ? pos : neg) : 0;
      const to = from + v;
      if (stacked) { if (v >= 0) pos = to; else neg = to; }
      const a = horizontal ? valueX(from, domain, box) : valueY(from, domain, box);
      const b = horizontal ? valueX(to, domain, box) : valueY(to, domain, box);
      const off = (horizontal ? box.top : box.left) + band * ci + pad + (stacked ? 0 : slot * si);
      out.push(horizontal
        ? { x: Math.min(a, b), y: off, w: Math.abs(b - a), h: slot, color: s.color, si, ci }
        : { x: off, y: Math.min(a, b), w: slot, h: Math.abs(b - a), color: s.color, si, ci });
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Radial geometry                                                            */
/* -------------------------------------------------------------------------- */

/** A point on a circle. Angles are radians, zero at three o'clock and growing clockwise
 *  because SVG's y grows downward; callers that want to start at the top pass -PI/2,
 *  and every arc in this folder does, so two donuts share a starting edge. */
export const polar = (
  cx: number, cy: number, r: number, angle: number,
): { x: number; y: number } => ({
  x: cx + r * Math.cos(angle),
  y: cy + r * Math.sin(angle),
});

/**
 * A pie slice, or a ring segment when rInner is positive.
 *
 * The large-arc flag comes from the swept angle rather than from a guess, and a full
 * circle is drawn a hair short of 360 degrees: an arc whose start and end coincide is
 * degenerate in SVG and draws nothing, which would make a single-category pie vanish at
 * exactly the moment it should read as "all of it".
 */
export function arcPath(
  cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number,
): string {
  const end = a1 - a0 >= Math.PI * 2 - 1e-6 ? a1 - 1e-3 : a1;
  const large = end - a0 > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, rOuter, a0);
  const p1 = polar(cx, cy, rOuter, end);
  const arc = (r: number, x: number, y: number, dir: number) =>
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${dir} ${x.toFixed(2)} ${y.toFixed(2)}`;
  if (rInner <= 0) {
    return `M${cx.toFixed(2)} ${cy.toFixed(2)} L${p0.x.toFixed(2)} ${p0.y.toFixed(2)} `
      + `${arc(rOuter, p1.x, p1.y, 1)} Z`;
  }
  const q1 = polar(cx, cy, rInner, end);
  const q0 = polar(cx, cy, rInner, a0);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${arc(rOuter, p1.x, p1.y, 1)} `
    + `L${q1.x.toFixed(2)} ${q1.y.toFixed(2)} ${arc(rInner, q0.x, q0.y, 0)} Z`;
}

export interface PieSlice {
  index: number; label: string; raw: BiScalar; value: number;
  /** Share of what is drawn, which is not the same as share of the result when
   *  something was dropped -- hence `dropped` alongside. */
  share: number;
  a0: number; a1: number; color: string;
}

/**
 * PIE and DONUT: one slice per category of one measure.
 *
 * Negatives are dropped and counted rather than drawn, because an angle cannot be
 * negative and a pie containing one adds up to a total nobody asked for. The count goes
 * back to the caller so the tile can say so; absorbing it silently is how a pie ends up
 * summing to 130% of itself.
 */
export function pieSlices(model: PlotModel, series: PlotSeries | undefined): {
  slices: PieSlice[]; dropped: number;
} {
  if (!series) return { slices: [], dropped: 0 };
  const items: Array<{ index: number; label: string; raw: BiScalar; value: number }> = [];
  let dropped = 0;
  model.categories.forEach((cat, i) => {
    const v = series.values[i];
    if (v === null || v === undefined || v === 0) return;
    if (v < 0) { dropped += 1; return; }
    items.push({ index: i, label: cat.label, raw: cat.raw, value: v });
  });
  const total = items.reduce((sum, it) => sum + it.value, 0);
  let angle = -Math.PI / 2;
  const slices = items.map((it) => {
    const share = total > 0 ? it.value / total : 0;
    const a0 = angle;
    angle += share * Math.PI * 2;
    return { ...it, share, a0, a1: angle, color: colorAt(it.index) };
  });
  return { slices, dropped };
}

export interface FunnelStage {
  index: number; label: string; raw: BiScalar; value: number;
  /** Share of the first stage and of the one before it. A funnel's whole subject is
   *  where people left, and "62% of the previous step" is the number that says it. */
  ofFirst: number; ofPrev: number;
}

/** FUNNEL: the stages in the order the query returned them, never re-sorted. A funnel is
 *  a sequence, and sorting it by size would invent a process that does not exist. */
export function funnelStages(
  model: PlotModel, series: PlotSeries | undefined,
): FunnelStage[] {
  if (!series) return [];
  const out: FunnelStage[] = [];
  let first: number | null = null;
  let prev: number | null = null;
  model.categories.forEach((cat, i) => {
    const v = series.values[i];
    if (v === null || v === undefined) return;
    const base = first ?? v;
    const previous = prev;
    if (first === null) first = v;
    out.push({
      index: i, label: cat.label, raw: cat.raw, value: v,
      ofFirst: base > 0 ? v / base : 0,
      ofPrev: previous !== null && previous > 0 ? v / previous : 1,
    });
    prev = v;
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Matrix geometry                                                            */
/* -------------------------------------------------------------------------- */

export interface HeatCell {
  x: number; y: number; w: number; h: number;
  value: number | null;
  /** Where the value sits on the ramp. 0..1 for a one-sided grid, -1..1 when the grid
   *  crosses zero. Null for a cell the query returned no row for, which is drawn as
   *  empty rather than as the ramp's floor. */
  t: number | null;
  ci: number; si: number;
  colLabel: string; rowLabel: string;
}

export interface HeatGrid {
  cells: HeatCell[];
  min: number; max: number;
  /** True when the values cross zero, so the ramp has to diverge. A correlation matrix
   *  of -1..1 read on a one-sided ramp puts the strongest inverse relationship in the
   *  same colour as no relationship at all, which is the one reading that matters. */
  diverging: boolean;
  display: MetricDisplay;
  /** Cells with no value, counted so the tile can say so. */
  blanks: number;
}

/**
 * HEATMAP, CORRELATION_MATRIX and SENSITIVITY_MATRIX: one cell per (category, series).
 *
 * The grid is already what `buildPlotModel` produces for two dimensions and one measure
 * -- categories across, split values down -- so this only assigns geometry and a ramp
 * position. Nothing is re-ordered: a sensitivity matrix's axes are the values the author
 * asked for in the order they asked for them.
 */
export function heatGrid(model: PlotModel, box: FrameBox): HeatGrid {
  const cols = model.categories.length;
  const rows = model.series.length;
  const w = cols > 0 ? plotWidth(box) / cols : 0;
  const h = rows > 0 ? plotHeight(box) / rows : 0;
  let min = Infinity;
  let max = -Infinity;
  let blanks = 0;
  for (const s of model.series) {
    for (let i = 0; i < cols; i += 1) {
      const v = s.values[i];
      if (v === null || v === undefined) { blanks += 1; continue; }
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 0; }
  const diverging = min < 0 && max > 0;
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const span = max - min;
  const cells: HeatCell[] = [];
  model.series.forEach((s, si) => {
    model.categories.forEach((cat, ci) => {
      const raw = s.values[ci];
      const value = raw === null || raw === undefined ? null : raw;
      let t: number | null = null;
      if (value !== null) {
        if (diverging) t = absMax > 0 ? value / absMax : 0;
        else t = span > 0 ? (value - min) / span : 1;
      }
      cells.push({
        x: box.left + w * ci, y: box.top + h * si, w, h,
        value, t, ci, si, colLabel: cat.label, rowLabel: s.label,
      });
    });
  });
  return { cells, min, max, diverging, display: axisDisplay(model.series), blanks };
}

/** The two ends of a diverging ramp: cool for above zero, warm for below. Indigo and
 *  amber rather than green and rose, because a correlation of -1 is a strong finding and
 *  not a bad one, and the palette's green already means "went up" everywhere else. */
export const HEAT_UP = SERIES_COLORS[0];
export const HEAT_DOWN = SERIES_COLORS[3];

/** A cell's fill. Opacity carries the magnitude and never drops to zero for a value that
 *  exists, so the weakest cell still reads as measured rather than as missing. */
export function heatFill(t: number | null, diverging: boolean): {
  color: string; opacity: number;
} {
  if (t === null) return { color: 'transparent', opacity: 0 };
  const mag = Math.min(1, Math.abs(t));
  if (!diverging) return { color: HEAT_UP, opacity: 0.1 + 0.85 * mag };
  return { color: t < 0 ? HEAT_DOWN : HEAT_UP, opacity: 0.1 + 0.85 * mag };
}

export interface ScatterScales {
  x: PlotDomain; y: PlotDomain;
  /** A bubble's radius in pixels, area-proportional: a radius taken straight from the
   *  value overstates the largest bubble by its square, which is the classic way a
   *  bubble chart exaggerates. Null size falls back to the smallest dot. */
  radius: (size: number | null) => number;
}

/**
 * The two measure axes of a scatter, padded but not zeroed.
 *
 * Forcing zero onto both axes is right for bars and wrong here: the subject is where the
 * cloud sits and how it leans, and a cloud between 90 and 110 pushed against the top of
 * a 0..110 frame has been flattened into a line.
 */
export function scatterScales(points: readonly ScatterPoint[]): ScatterScales {
  const pad = (lo: number, hi: number): PlotDomain => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
    if (lo === hi) {
      const step = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
      return { min: lo - step, max: hi + step };
    }
    const room = (hi - lo) * 0.06;
    return { min: lo - room, max: hi + room };
  };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const sizes = points.map((p) => Math.abs(p.size ?? 0));
  const biggest = sizes.reduce((m, s) => Math.max(m, s), 0);
  return {
    x: pad(Math.min(...xs), Math.max(...xs)),
    y: pad(Math.min(...ys), Math.max(...ys)),
    radius: (size) => (size === null || biggest <= 0
      ? 4
      : 4 + 14 * Math.sqrt(Math.min(1, Math.abs(size) / biggest))),
  };
}

export interface GaugeReading {
  actual: PlotSeries | undefined;
  target: PlotSeries | undefined;
  value: number | null;
  goal: number | null;
  /** value / goal, or null when there is no target to divide by. Left unclamped, because
   *  an overshoot is a real reading -- it is the arc that has to stop at the end of the
   *  dial, not the number. */
  frac: number | null;
  /** The share of the sweep to fill, clamped to it. */
  drawn: number;
}

/** GAUGE: the first visible series is the value, the second is its target. Resolved here
 *  rather than in the renderer so the arc, the centre number and the tooltip cannot end
 *  up reading different rows. */
export function gaugeReading(model: PlotModel, hidden: ReadonlySet<string>): GaugeReading {
  const series = visibleOf(model, hidden);
  const actual = series[0] ?? model.series[0];
  const target = series[1] ?? model.series[1];
  const value = actual?.values[0] ?? null;
  const goal = target?.values[0] ?? null;
  const frac = value !== null && goal !== null && goal !== 0 ? value / goal : null;
  return {
    actual, target, value, goal, frac,
    drawn: frac === null ? 0 : Math.max(0, Math.min(frac, 1)),
  };
}
