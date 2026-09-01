/**
 * The cartesian families: lines, areas, bars in four arrangements, waterfall, bridge,
 * bullet, histogram, Pareto and combo.
 *
 * Every mark carries its category index, and the dispatcher above turns that back into
 * the dimension value the server grouped on. That indirection is what makes these
 * charts interactive rather than decorative: a click is a drill, not a highlight, and
 * the value it drills on is the one in the result rather than the label on the axis.
 */
import { Fragment } from 'react';
import type { BiChartType } from '@/types/bi';
import { formatMetricValue, useBiI18n } from './biFormat';
import {
  SERIES_COLORS, areaPath, axisDisplay, bandOf, bandX, barRects, hoverRows, isHorizontal,
  isStacked, linePath, markLabel, paretoBars, plotDomain, plotHeight, plotWidth,
  valueX, valueY, visibleOf, waterfallSteps,
  type BarRect, type FrameBox, type PlotDomain, type PlotModel, type PlotSeries,
} from './biChartData';
import {
  CategoryAxisX, CategoryAxisY, Mark, ValueAxisX, ValueAxisY, type HoverInfo,
} from './BiChartFrame';

export interface CartesianProps {
  type: BiChartType;
  model: PlotModel;
  box: FrameBox;
  /** Series the reader switched off in the legend. Excluded from the domain too, so
   *  hiding the outlier actually rescales the axis. */
  hidden: ReadonlySet<string>;
  onHover: (info: HoverInfo | null) => void;
  /** Category index. Absent when the dimension has nowhere to drill. */
  onSelect?: (index: number) => void;
}

/** Rising and falling steps of a waterfall. The palette's own green and rose rather
 *  than new colours, so a step that falls looks like every other number that fell. */
const RISE = SERIES_COLORS[2];
const FALL = SERIES_COLORS[4];

export function BiChartCartesian(props: CartesianProps) {
  const { type } = props;
  if (type === 'WATERFALL' || type === 'BRIDGE') return <Waterfall {...props} />;
  if (type === 'PARETO') return <Pareto {...props} />;
  if (type === 'BULLET') return <Bullet {...props} />;
  if (type === 'LINE' || type === 'AREA') return <Lines {...props} />;
  if (type === 'COMBO') return <Combo {...props} />;
  return <Bars {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Lines and areas                                                            */
/* -------------------------------------------------------------------------- */

function Lines({ type, model, box, hidden, onHover, onSelect }: CartesianProps) {
  const series = visibleOf(model, hidden);
  const domain = plotDomain(series, false);

  return (
    <>
      <ValueAxisY box={box} domain={domain} display={axisDisplay(series)} />
      <CategoryAxisX box={box} labels={model.categories.map((c) => c.label)} />
      {type === 'AREA' && series.map((s) => (
        <path key={`a-${s.label}`} d={areaPath(s.values, domain, box)} fill={s.color} opacity={0.18} />
      ))}
      {series.map((s) => (
        <path
          key={`l-${s.label}`}
          d={linePath(s.values, domain, box)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      <HoverColumns
        model={model} series={series} box={box} domain={domain}
        onHover={onHover} onSelect={onSelect}
      />
    </>
  );
}

/**
 * One invisible full-height hit area per category, with a dot per visible series.
 *
 * A line hovered only on its two-pixel stroke is a chart nobody can read a value off,
 * and a drill that needs the pointer on the stroke is a drill most readers never find.
 * The column is the target; the dots say which row it is reporting.
 */
function HoverColumns({ model, series, box, domain, onHover, onSelect }: {
  model: PlotModel;
  series: readonly PlotSeries[];
  box: FrameBox;
  domain: PlotDomain;
  onHover: (info: HoverInfo | null) => void;
  onSelect?: (index: number) => void;
}) {
  const count = model.categories.length;
  const band = bandOf(count, box);
  const h = plotHeight(box);
  return (
    <>
      {model.categories.map((cat, i) => {
        const cx = bandX(i, count, box);
        let top = box.top + h;
        for (const s of series) {
          const v = s.values[i];
          if (v === null || v === undefined) continue;
          top = Math.min(top, valueY(v, domain, box));
        }
        return (
          <Mark
            key={cat.key || `c-${i}`}
            label={markLabel(cat.label, series, i)}
            onSelect={onSelect ? () => onSelect(i) : undefined}
            onHover={() => onHover({ x: cx, y: top, title: cat.label, rows: hoverRows(series, i) })}
            onLeave={() => onHover(null)}
          >
            <rect x={box.left + band * i} y={box.top} width={band} height={h} fill="transparent" />
            {series.map((s) => {
              const v = s.values[i];
              if (v === null || v === undefined) return null;
              return (
                <circle key={s.label} cx={cx} cy={valueY(v, domain, box)} r={3} fill={s.color} />
              );
            })}
          </Mark>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Bars in four arrangements                                                  */
/* -------------------------------------------------------------------------- */

/** A bar. A zero draws as a hairline rather than as nothing, so it stays hoverable and
 *  reads as "zero here" instead of "no data here" -- a null is what draws nothing. */
const BarShape = ({ r }: { r: BarRect }) => (
  <rect x={r.x} y={r.y} width={Math.max(r.w, 1)} height={Math.max(r.h, 1)} fill={r.color} rx={2} />
);

/** The zero line, drawn only when the domain crosses it: without it, the bars of a
 *  chart with negatives hang from nothing and the eye reads the frame's edge as zero. */
function ZeroLine({ box, domain, horizontal }: {
  box: FrameBox; domain: PlotDomain; horizontal: boolean;
}) {
  if (domain.min >= 0) return null;
  const x = valueX(0, domain, box);
  const y = valueY(0, domain, box);
  return horizontal ? (
    <line
      x1={x} x2={x} y1={box.top} y2={box.top + plotHeight(box)}
      className="stroke-[var(--text-muted)]" strokeWidth={1}
    />
  ) : (
    <line
      x1={box.left} x2={box.left + plotWidth(box)} y1={y} y2={y}
      className="stroke-[var(--text-muted)]" strokeWidth={1}
    />
  );
}

/**
 * BAR, COLUMN, STACKED_BAR, STACKED_COLUMN and HISTOGRAM.
 *
 * One component for all five because the only differences are which axis carries the
 * categories and whether segments accumulate -- both of which are already answers
 * `isHorizontal` and `isStacked` give. HISTOGRAM drops the gap between bars, since
 * adjacent bins are adjacent ranges and a gap between them suggests they are not.
 */
function Bars({ type, model, box, hidden, onHover, onSelect }: CartesianProps) {
  const series = visibleOf(model, hidden);
  const stacked = isStacked(type);
  const horizontal = isHorizontal(type);
  const domain = plotDomain(series, stacked);
  const labels = model.categories.map((c) => c.label);
  const rects = barRects(series, model.categories.length, domain, box, {
    stacked, horizontal, tight: type === 'HISTOGRAM',
  });

  return (
    <>
      {horizontal ? (
        <>
          <ValueAxisX box={box} domain={domain} display={axisDisplay(series)} />
          <CategoryAxisY box={box} labels={labels} />
        </>
      ) : (
        <>
          <ValueAxisY box={box} domain={domain} display={axisDisplay(series)} />
          <CategoryAxisX box={box} labels={labels} />
        </>
      )}
      <ZeroLine box={box} domain={domain} horizontal={horizontal} />
      {rects.map((r) => {
        const cat = model.categories[r.ci];
        if (!cat) return null;
        return (
          <Mark
            key={`${r.si}-${r.ci}`}
            label={markLabel(cat.label, series, r.ci)}
            onSelect={onSelect ? () => onSelect(r.ci) : undefined}
            onHover={() => onHover({
              x: r.x + r.w / 2, y: r.y, title: cat.label, rows: hoverRows(series, r.ci),
            })}
            onLeave={() => onHover(null)}
          >
            <BarShape r={r} />
          </Mark>
        );
      })}
    </>
  );
}

/**
 * COMBO: the first measure as bars, every other measure as a line over them.
 *
 * One value axis, not two. A second axis lets the author slide any line above any bar
 * until the picture says what they wanted, which is the chart that can prove anything;
 * with one axis the reader can see when a line is flat because it is small.
 */
function Combo({ model, box, hidden, onHover, onSelect }: CartesianProps) {
  const series = visibleOf(model, hidden);
  const domain = plotDomain(series, false);
  const rects = barRects(series.slice(0, 1), model.categories.length, domain, box, {
    stacked: false, horizontal: false,
  });

  return (
    <>
      <ValueAxisY box={box} domain={domain} display={axisDisplay(series)} />
      <CategoryAxisX box={box} labels={model.categories.map((c) => c.label)} />
      <ZeroLine box={box} domain={domain} horizontal={false} />
      {rects.map((r) => <BarShape key={`${r.si}-${r.ci}`} r={r} />)}
      {series.slice(1).map((s) => (
        <path
          key={`l-${s.label}`}
          d={linePath(s.values, domain, box)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      <HoverColumns
        model={model} series={series} box={box} domain={domain}
        onHover={onHover} onSelect={onSelect}
      />
    </>
  );
}

/**
 * BULLET: the value as a bar against the target it is measured on.
 *
 * Two measures are what make it a bullet chart -- the first is what happened, the
 * second is what was promised. With one measure it draws as a bar rather than inventing
 * a target of zero, because a target every row beats is not a target.
 */
function Bullet(props: CartesianProps) {
  const { model, box, hidden, onHover, onSelect } = props;
  const series = visibleOf(model, hidden);
  const actual = series[0];
  const target = series[1];
  if (!actual || !target) return <Bars {...props} />;
  const domain = plotDomain(series, false);
  const count = model.categories.length;
  const band = count > 0 ? plotHeight(box) / count : 0;
  const x0 = valueX(0, domain, box);

  return (
    <>
      <ValueAxisX box={box} domain={domain} display={axisDisplay(series)} />
      <CategoryAxisY box={box} labels={model.categories.map((c) => c.label)} />
      {model.categories.map((cat, i) => {
        const v = actual.values[i];
        const t = target.values[i];
        const mid = box.top + band * i + band / 2;
        const xv = v === null || v === undefined ? x0 : valueX(v, domain, box);
        return (
          <Mark
            key={cat.key || `bl-${i}`}
            label={markLabel(cat.label, series, i)}
            onSelect={onSelect ? () => onSelect(i) : undefined}
            onHover={() => onHover({
              x: xv, y: mid - band * 0.3, title: cat.label, rows: hoverRows(series, i),
            })}
            onLeave={() => onHover(null)}
          >
            <rect
              x={box.left} y={mid - band * 0.28} width={plotWidth(box)} height={band * 0.56}
              className="fill-[var(--bg-hover)]"
            />
            <rect
              x={Math.min(x0, xv)} y={mid - band * 0.15} width={Math.max(Math.abs(xv - x0), 1)}
              height={band * 0.3} fill={actual.color} rx={2}
            />
            {t !== null && t !== undefined && (
              <line
                x1={valueX(t, domain, box)} x2={valueX(t, domain, box)}
                y1={mid - band * 0.3} y2={mid + band * 0.3}
                stroke={target.color} strokeWidth={2}
              />
            )}
          </Mark>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Waterfall, bridge and Pareto                                               */
/* -------------------------------------------------------------------------- */

/**
 * WATERFALL and BRIDGE: each bar starts where the last one ended.
 *
 * Rising and falling steps are coloured apart because the sign is the whole message,
 * and the connectors are drawn because the picture is how the total was arrived at --
 * without them this is a bar chart whose bars float at unexplained heights. The domain
 * comes from the running totals rather than from the deltas: the tallest thing on the
 * chart is where the balance got to, not the largest single step.
 */
function Waterfall({ model, box, onHover, onSelect }: CartesianProps) {
  const { t } = useBiI18n();
  const steps = waterfallSteps(model);
  const display = axisDisplay(model.series);
  const name = model.series[0]?.label ?? '';
  const totalLabel = t('الإجمالي التراكمي', 'Cumul', 'Running total');
  const bounds = steps.reduce(
    (acc, s) => ({
      min: Math.min(acc.min, s.start, s.end),
      max: Math.max(acc.max, s.start, s.end),
    }),
    { min: 0, max: 0 },
  );
  const domain: PlotDomain = bounds.min === 0 && bounds.max === 0 ? { min: 0, max: 1 } : bounds;
  const band = bandOf(steps.length, box);
  const inner = band * 0.7;

  return (
    <>
      <ValueAxisY box={box} domain={domain} display={display} />
      <CategoryAxisX box={box} labels={steps.map((s) => s.label)} />
      <ZeroLine box={box} domain={domain} horizontal={false} />
      {steps.map((s, i) => {
        const y0 = valueY(s.start, domain, box);
        const y1 = valueY(s.end, domain, box);
        const x = box.left + band * i + (band - inner) / 2;
        const rows = [
          {
            label: name,
            value: formatMetricValue(s.delta, display),
            color: s.delta >= 0 ? RISE : FALL,
          },
          { label: totalLabel, value: formatMetricValue(s.end, display) },
        ];
        return (
          <Fragment key={`${s.label}-${i}`}>
            {i > 0 && (
              <line
                x1={x - (band - inner)} x2={x} y1={y0} y2={y0}
                className="stroke-[var(--border)]" strokeWidth={1} strokeDasharray="3 3"
              />
            )}
            <Mark
              label={[s.label, ...rows.map((r) => `${r.label}: ${r.value}`)].join(', ')}
              onSelect={onSelect ? () => onSelect(i) : undefined}
              onHover={() => onHover({
                x: x + inner / 2, y: Math.min(y0, y1), title: s.label, rows,
              })}
              onLeave={() => onHover(null)}
            >
              <rect
                x={x} y={Math.min(y0, y1)} width={inner}
                height={Math.max(Math.abs(y1 - y0), 1)}
                fill={s.delta >= 0 ? RISE : FALL} rx={2}
              />
            </Mark>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * PARETO: the bars in descending order with the cumulative share as a line.
 *
 * The line has its own 0..1 scale, and this is the one place in this file where two
 * scales share a frame -- a share of the bars cannot be read on the bars' axis. Rather
 * than squeeze a second axis into the 14px the frame keeps on the right, the 80% line
 * is drawn and labelled: it is the reading anyone opens a Pareto for, and it says what
 * the line's scale is.
 */
function Pareto({ model, box, onHover, onSelect }: CartesianProps) {
  const { t } = useBiI18n();
  const bars = paretoBars(model);
  const display = axisDisplay(model.series);
  const name = model.series[0]?.label ?? '';
  const shareLabel = t('النسبة التراكمية', 'Part cumulée', 'Cumulative share');
  const max = bars.reduce((m, r) => Math.max(m, r.value), 0);
  const domain: PlotDomain = { min: 0, max: max > 0 ? max : 1 };
  const share: PlotDomain = { min: 0, max: 1 };
  const band = bandOf(bars.length, box);
  const inner = band * 0.7;
  const y80 = valueY(0.8, share, box);
  const barColor = model.series[0]?.color ?? SERIES_COLORS[0];

  return (
    <>
      <ValueAxisY box={box} domain={domain} display={display} />
      <CategoryAxisX box={box} labels={bars.map((r) => r.label)} />
      <line
        x1={box.left} x2={box.left + plotWidth(box)} y1={y80} y2={y80}
        className="stroke-[var(--warning)]" strokeWidth={1} strokeDasharray="4 3"
      />
      <text x={box.left + 4} y={y80 - 4} className="fill-[var(--warning)] text-[10px]">80%</text>
      <path
        d={linePath(bars.map((r) => r.cumulative), share, box)}
        fill="none" stroke={SERIES_COLORS[3]} strokeWidth={2} strokeLinejoin="round"
      />
      {bars.map((r, i) => {
        const yTop = valueY(r.value, domain, box);
        const x = box.left + band * i + (band - inner) / 2;
        const rows = [
          { label: name, value: formatMetricValue(r.value, display), color: barColor },
          {
            label: shareLabel,
            value: formatMetricValue(r.cumulative, { format: 'PERCENT', decimals: 1 }),
            color: SERIES_COLORS[3],
          },
        ];
        return (
          <Fragment key={`${r.label}-${r.index}`}>
            <Mark
              label={[r.label, ...rows.map((q) => `${q.label}: ${q.value}`)].join(', ')}
              // The category's position in the model, not on screen: the sort is what
              // makes this a Pareto, and drilling the fourth bar must open the record
              // the fourth bar is, not whatever was fourth in the query.
              onSelect={onSelect ? () => onSelect(r.index) : undefined}
              onHover={() => onHover({
                x: x + inner / 2, y: yTop, title: r.label, rows,
              })}
              onLeave={() => onHover(null)}
            >
              <rect
                x={x} y={yTop} width={inner}
                height={Math.max(valueY(0, domain, box) - yTop, 1)}
                fill={barColor} rx={2}
              />
            </Mark>
            <circle
              cx={bandX(i, bars.length, box)} cy={valueY(r.cumulative, share, box)}
              r={2.5} fill={SERIES_COLORS[3]}
            />
          </Fragment>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
