/**
 * Fluent UI kit — charts.
 *
 * Hand-rolled SVG rather than a charting library: the OS needs charts that
 * inherit the Fluent tokens exactly, render in a 200×60 tile as happily as a
 * full window, and never pull a second layout engine into a window frame.
 *
 * Every scale is computed deterministically from the data (no randomness, no
 * animation timers), so a re-render produces an identical frame.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useElementWidth } from './responsive';
import { colorAt, niceCeil } from './tokens';

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  /** Tints the area beneath the line. */
  filled?: boolean;
  /** Marks the last point. */
  marker?: boolean;
}

export function Sparkline({ values, width = 96, height = 28, color, filled = true, marker = true }: SparklineProps) {
  const gradientId = useId();
  const stroke = color ?? 'var(--fx-accent-light2)';
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 2;
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = points[points.length - 1]?.split(',') ?? ['0', '0'];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled ? (
        <polygon points={`0,${height} ${points.join(' ')} ${width},${height}`} fill={`url(#${gradientId})`} />
      ) : null}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {marker ? <circle cx={last[0]} cy={last[1]} r="2.2" fill={stroke} /> : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Bar chart
 * ------------------------------------------------------------------ */

export interface BarDatum {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  height?: number;
  /** Horizontal bars read better for long category names. */
  orientation?: 'vertical' | 'horizontal';
  format?: (value: number) => string;
  /** Draws a reference line, e.g. budget. */
  target?: number;
}

export function BarChart({ data, height = 200, orientation = 'vertical', format, target }: BarChartProps) {
  const fmt = format ?? ((value: number) => value.toLocaleString());
  const max = niceCeil(Math.max(0, ...data.map((datum) => Math.abs(datum.value)), target ?? 0));

  if (orientation === 'horizontal') {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {data.map((datum, index) => (
          <div key={datum.label} style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fx-caption)' }}>
              <span style={{ color: 'var(--fx-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {datum.label}
              </span>
              <span className="fx-mono" style={{ fontWeight: 600 }}>
                {fmt(datum.value)}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--fx-control)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, (Math.abs(datum.value) / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: datum.color ?? colorAt(index),
                  transition: 'width var(--fx-slow) var(--fx-ease-out)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const gap = 8;
  const plotHeight = height - 26;
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {target !== undefined && max > 0 ? (
        <div
          title={`Target ${fmt(target)}`}
          style={{
            position: 'absolute',
            insetInline: 0,
            bottom: 26 + (target / max) * plotHeight,
            height: 0,
            borderTop: '1px dashed var(--fx-warning)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap, height, minWidth: 0 }}>
        {data.map((datum, index) => {
          const ratio = max > 0 ? Math.abs(datum.value) / max : 0;
          return (
            <div
              key={datum.label}
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              title={`${datum.label}: ${fmt(datum.value)}`}
            >
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', minHeight: 0 }}>
                <div
                  style={{
                    width: '100%',
                    height: Math.max(2, ratio * plotHeight),
                    borderRadius: '4px 4px 2px 2px',
                    background: datum.color ?? (datum.value < 0 ? 'var(--fx-danger)' : colorAt(index)),
                    transition: 'height var(--fx-slow) var(--fx-ease-out)',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fx-text-tertiary)',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {datum.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Line chart
 * ------------------------------------------------------------------ */

export interface LineSeries {
  readonly label: string;
  readonly values: readonly number[];
  readonly color?: string;
  readonly dashed?: boolean;
}

export interface LineChartProps {
  categories: readonly string[];
  series: readonly LineSeries[];
  height?: number;
  format?: (value: number) => string;
  /** Shade the area under the first series. */
  area?: boolean;
  legend?: boolean;
}

export function LineChart({ categories, series, height = 220, format, area = true, legend = true }: LineChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = format ?? ((value: number) => value.toLocaleString());

  const { max, min } = useMemo(() => {
    const all = series.flatMap((entry) => entry.values);
    if (all.length === 0) return { max: 1, min: 0 };
    const rawMax = Math.max(...all);
    const rawMin = Math.min(...all, 0);
    return { max: niceCeil(rawMax === rawMin ? rawMax + 1 : rawMax), min: rawMin < 0 ? -niceCeil(-rawMin) : 0 };
  }, [series]);

  const width = 640;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 10;
  const plotH = height - 34;
  const span = max - min || 1;
  const stepX = categories.length > 1 ? (width - padLeft - padRight) / (categories.length - 1) : 0;
  const yOf = (value: number) => padTop + (1 - (value - min) / span) * (plotH - padTop);
  const xOf = (index: number) => padLeft + index * stepX;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + ratio * span);

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height, overflow: 'visible' }}
        preserveAspectRatio="none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relative = ((event.clientX - rect.left) / rect.width) * width;
          const index = stepX > 0 ? Math.round((relative - padLeft) / stepX) : 0;
          setHover(Math.max(0, Math.min(categories.length - 1, index)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color ?? 'var(--fx-accent-light2)'} stopOpacity="0.26" />
            <stop offset="100%" stopColor={series[0]?.color ?? 'var(--fx-accent-light2)'} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yOf(value)}
              y2={yOf(value)}
              stroke="var(--fx-divider)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {hover !== null ? (
          <line
            x1={xOf(hover)}
            x2={xOf(hover)}
            y1={padTop}
            y2={plotH}
            stroke="var(--fx-text-tertiary)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {area && series[0] !== undefined && series[0].values.length > 1 ? (
          <polygon
            points={`${xOf(0)},${plotH} ${series[0].values
              .map((value, index) => `${xOf(index)},${yOf(value)}`)
              .join(' ')} ${xOf(series[0].values.length - 1)},${plotH}`}
            fill={`url(#${gradientId})`}
          />
        ) : null}

        {series.map((entry, seriesIndex) => (
          <polyline
            key={entry.label}
            points={entry.values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' ')}
            fill="none"
            stroke={entry.color ?? colorAt(seriesIndex)}
            strokeWidth="2"
            strokeDasharray={entry.dashed === true ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {hover !== null
          ? series.map((entry, seriesIndex) => {
              const value = entry.values[hover];
              if (value === undefined) return null;
              return (
                <circle
                  key={entry.label}
                  cx={xOf(hover)}
                  cy={yOf(value)}
                  r="3.5"
                  fill="var(--fx-solid)"
                  stroke={entry.color ?? colorAt(seriesIndex)}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })
          : null}
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fx-text-tertiary)' }}>
        {categories.map((category, index) => (
          <span
            key={`${category}-${index}`}
            style={{
              flex: 1,
              textAlign: index === 0 ? 'start' : index === categories.length - 1 ? 'end' : 'center',
              fontWeight: hover === index ? 700 : 400,
              color: hover === index ? 'var(--fx-text-primary)' : undefined,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {category}
          </span>
        ))}
      </div>

      {legend ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 'var(--fx-caption)' }}>
          {series.map((entry, seriesIndex) => (
            <span key={entry.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 3,
                  borderRadius: 999,
                  background: entry.color ?? colorAt(seriesIndex),
                }}
              />
              <span style={{ color: 'var(--fx-text-secondary)' }}>{entry.label}</span>
              {hover !== null && entry.values[hover] !== undefined ? (
                <span className="fx-mono" style={{ fontWeight: 600 }}>
                  {fmt(entry.values[hover] as number)}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Donut
 * ------------------------------------------------------------------ */

export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
  format?: (value: number) => string;
  legend?: boolean;
}

export function DonutChart({ slices, size = 160, thickness = 18, center, format, legend = true }: DonutChartProps) {
  const fmt = format ?? ((value: number) => value.toLocaleString());
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map((slice, index) => {
    const ratio = total > 0 ? Math.max(0, slice.value) / total : 0;
    const arc = { slice, index, ratio, dash: ratio * circumference, offset };
    offset += ratio * circumference;
    return arc;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--fx-control)"
            strokeWidth={thickness}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.slice.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.slice.color ?? colorAt(arc.index)}
              strokeWidth={thickness}
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={-arc.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        {center !== undefined ? (
          <foreignObject x={thickness} y={thickness} width={size - thickness * 2} height={size - thickness * 2}>
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                fontSize: 'var(--fx-caption)',
              }}
            >
              {center}
            </div>
          </foreignObject>
        ) : null}
      </svg>
      {legend ? (
        <div style={{ display: 'grid', gap: 6, minWidth: 140, flex: 1 }}>
          {slices.map((slice, index) => (
            <div key={slice.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fx-caption)' }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  flex: 'none',
                  background: slice.color ?? colorAt(index),
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: 'var(--fx-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {slice.label}
              </span>
              <span className="fx-mono" style={{ fontWeight: 600 }}>
                {fmt(slice.value)}
              </span>
              <span style={{ color: 'var(--fx-text-tertiary)', width: 38, textAlign: 'end' }}>
                {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Waterfall (variance bridges, cash bridges)
 * ------------------------------------------------------------------ */

export interface WaterfallStep {
  readonly label: string;
  readonly value: number;
  /** `total` steps are drawn from zero; `delta` steps stack on the running sum. */
  readonly kind?: 'delta' | 'total';
}

export function Waterfall({
  steps,
  height = 220,
  format,
}: {
  steps: readonly WaterfallStep[];
  height?: number;
  format?: (value: number) => string;
}) {
  const fmt = format ?? ((value: number) => value.toLocaleString());
  let running = 0;
  const bars = steps.map((step) => {
    const isTotal = step.kind === 'total';
    const start = isTotal ? 0 : running;
    const end = isTotal ? step.value : running + step.value;
    if (!isTotal) running = end;
    else running = step.value;
    return { step, start, end, low: Math.min(start, end), high: Math.max(start, end) };
  });

  const maxHigh = Math.max(...bars.map((bar) => bar.high), 0);
  const minLow = Math.min(...bars.map((bar) => bar.low), 0);
  const span = maxHigh - minLow || 1;
  const plotHeight = height - 40;
  const yOf = (value: number) => ((maxHigh - value) / span) * plotHeight;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ position: 'relative', height: plotHeight, display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <div
          style={{
            position: 'absolute',
            insetInline: 0,
            top: yOf(0),
            height: 1,
            background: 'var(--fx-stroke-strong)',
          }}
        />
        {bars.map((bar) => {
          const isTotal = bar.step.kind === 'total';
          const positive = bar.end >= bar.start;
          const color = isTotal ? 'var(--fx-accent)' : positive ? 'var(--fx-success)' : 'var(--fx-danger)';
          return (
            <div
              key={bar.step.label}
              style={{ flex: 1, minWidth: 0, position: 'relative' }}
              title={`${bar.step.label}: ${fmt(bar.step.value)}`}
            >
              <div
                style={{
                  position: 'absolute',
                  insetInline: '12%',
                  top: yOf(bar.high),
                  height: Math.max(2, yOf(bar.low) - yOf(bar.high)),
                  borderRadius: 3,
                  background: color,
                  opacity: isTotal ? 1 : 0.85,
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {bars.map((bar) => (
          <div key={bar.step.label} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <div className="fx-mono" style={{ fontSize: 10, fontWeight: 600 }}>
              {fmt(bar.step.value)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--fx-text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {bar.step.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stacked horizontal composition bar (mix analysis, aging buckets). */
export function StackedBar({
  segments,
  height = 10,
  format,
}: {
  segments: readonly BarDatum[];
  height?: number;
  format?: (value: number) => string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const fmt = format ?? ((value: number) => value.toLocaleString());
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: 'var(--fx-control)' }}>
        {segments.map((segment, index) => (
          <div
            key={segment.label}
            title={`${segment.label}: ${fmt(segment.value)}`}
            style={{
              width: total > 0 ? `${(Math.max(0, segment.value) / total) * 100}%` : '0%',
              background: segment.color ?? colorAt(index),
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11 }}>
        {segments.map((segment, index) => (
          <span key={segment.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: segment.color ?? colorAt(index) }}
            />
            <span style={{ color: 'var(--fx-text-secondary)' }}>{segment.label}</span>
            <span className="fx-mono" style={{ fontWeight: 600 }}>
              {fmt(segment.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Treemap
 * ------------------------------------------------------------------ */

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Worst aspect ratio in a row laid `sum / side` deep along `side`. */
function worstRatio(row: readonly number[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  const thickness = sum / side;
  let worst = 1;
  for (const area of row) {
    const other = area / thickness;
    if (other <= 0) return Number.POSITIVE_INFINITY;
    worst = Math.max(worst, thickness / other, other / thickness);
  }
  return worst;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000).
 *
 * The naïve slice-and-dice treemap produces slivers — a two per cent share in a
 * wide box becomes a six-pixel ribbon with nowhere to put its label, which is
 * the failure mode that gives treemaps their reputation. Squarifying greedily
 * grows each row until taking the next tile would make that row's worst aspect
 * ratio worse, which keeps tiles near square and therefore labellable.
 *
 * `areas` must arrive sorted descending and already scaled so their sum is the
 * area of `into`. The caller does both, because it is the caller that knows
 * which values were dropped for being non-positive.
 */
function squarify(areas: readonly number[], into: Rect): Rect[] {
  const out: Rect[] = [];
  const queue = [...areas];
  let free = into;

  while (queue.length > 0 && free.w > 0.01 && free.h > 0.01) {
    const side = Math.min(free.w, free.h);
    const row: number[] = [];
    let sum = 0;
    let best = Number.POSITIVE_INFINITY;

    while (queue.length > 0) {
      const next = queue[0] as number;
      const ratio = worstRatio([...row, next], sum + next, side);
      if (row.length > 0 && ratio > best) break;
      row.push(next);
      queue.shift();
      sum += next;
      best = ratio;
    }

    const thickness = sum / side;
    if (free.w >= free.h) {
      let y = free.y;
      for (const area of row) {
        const h = area / thickness;
        out.push({ x: free.x, y, w: thickness, h });
        y += h;
      }
      free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
    } else {
      let x = free.x;
      for (const area of row) {
        const w = area / thickness;
        out.push({ x, y: free.y, w, h: thickness });
        x += w;
      }
      free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    }
  }
  return out;
}

export interface TreemapCell {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
  /** A second line — a margin, a share, a delta — shown when the tile is tall enough. */
  readonly secondary?: string;
}

export interface TreemapProps {
  cells: readonly TreemapCell[];
  height?: number;
  format?: (value: number) => string;
  selected?: string | null;
  onSelect?: (label: string) => void;
  label?: string;
}

/**
 * Composition by area, for the question "what is this made of".
 *
 * Profitability asks which products, destinations and seasons carry the result,
 * and a bar chart answers it by making the reader compare lengths down a sorted
 * list. A treemap answers it by area, so the largest contributor is literally
 * the biggest thing on the screen and the long tail is visibly a tail rather
 * than forty more rows to scroll.
 *
 * HTML boxes rather than SVG `<rect>`s, which is the one place this file departs
 * from the rest of itself. A treemap's tiles carry text, and text inside an SVG
 * scaled by `preserveAspectRatio="none"` is stretched and cannot ellipsize.
 * Positioned `<div>`s keep the type upright and let each tile be a real button.
 *
 * The layout is computed from the measured box rather than a normalised square,
 * because squarifying for a square and then stretching to 2:1 gives every tile
 * the wrong aspect ratio — which is the sliver problem the algorithm exists to
 * avoid, arrived at by a different route.
 */
export function Treemap({ cells, height = 260, format, selected = null, onSelect, label }: TreemapProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const fmt = format ?? ((value: number) => value.toLocaleString());

  const laid = useMemo(() => {
    const kept = cells
      .map((cell, index) => ({ cell, index }))
      .filter((entry) => Number.isFinite(entry.cell.value) && entry.cell.value > 0)
      .sort((a, b) => b.cell.value - a.cell.value);
    const total = kept.reduce((sum, entry) => sum + entry.cell.value, 0);
    if (kept.length === 0 || total <= 0) return [];
    // Before the first measurement the box is squarified against a 16:9 guess
    // rather than skipped. `useElementWidth` reads `clientWidth` in a layout
    // effect, so this frame is not painted in a browser — but an empty
    // rectangle is the wrong answer anywhere it is, and a treemap that renders
    // nothing until a resize observer fires is indistinguishable from one that
    // is broken.
    const box: Rect = { x: 0, y: 0, w: width > 0 ? width : Math.round(height * (16 / 9)), h: height };
    const rects = squarify(
      kept.map((entry) => (entry.cell.value * (box.w * box.h)) / total),
      box,
    );
    return kept.map((entry, position) => ({ ...entry, rect: rects[position], share: entry.cell.value / total }));
  }, [cells, width, height]);

  return (
    <div ref={frame} role="group" aria-label={label} style={{ position: 'relative', width: '100%', height }}>
      {laid.map((entry) => {
        const rect = entry.rect;
        if (rect === undefined) return null;
        const chosen = entry.cell.label === selected;
        const named = rect.w >= 54 && rect.h >= 24;
        const detailed = named && rect.h >= 46 && rect.w >= 74;
        return (
          <button
            key={entry.cell.label}
            type="button"
            disabled={onSelect === undefined}
            onClick={onSelect === undefined ? undefined : () => onSelect(entry.cell.label)}
            title={`${entry.cell.label} · ${fmt(entry.cell.value)} · ${Math.round(entry.share * 1000) / 10}%`}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: Math.max(0, rect.w - 2),
              height: Math.max(0, rect.h - 2),
              background: entry.cell.color ?? colorAt(entry.index),
              border: chosen ? '2px solid var(--fx-text-primary)' : 'none',
              borderRadius: 3,
              paddingInline: named ? 7 : 0,
              paddingBlock: named ? 5 : 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              overflow: 'hidden',
              cursor: onSelect === undefined ? 'default' : 'pointer',
              font: 'inherit',
              /* The palette is the same eight hues in both themes, so the type on
               * top of it is a fixed dark. A theme-following colour would put
               * white on #ffb900 the moment the OS went dark. */
              color: '#101418',
              textAlign: 'start',
            }}
          >
            {named ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
              >
                {entry.cell.label}
              </span>
            ) : null}
            {detailed ? (
              <span className="fx-mono" style={{ fontSize: 11, opacity: 0.78, lineHeight: 1.2 }}>
                {entry.cell.secondary ?? fmt(entry.cell.value)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
