/**
 * The shared frame every BI chart draws inside: gridlines, axes, legend and the one
 * tooltip. Components only -- the geometry is in ./biChartData.
 *
 * Hand-drawn SVG over plain arithmetic rather than the vendored chart kit in
 * src/components/charts. That kit takes a known series shape and animates it; these
 * charts take whatever thirty-three types and a runtime column list produce, and every
 * mark has to carry the dimension value that produced it so a click can drill. One
 * engine for all of them beats two that disagree about what hover means.
 */
import { type ReactNode } from 'react';
import { formatMetricValue, type MetricDisplay } from './biFormat';
import {
  domainTicks, fraction, plotHeight, plotWidth,
  type FrameBox, type PlotDomain, type PlotSeries,
} from './biChartData';

const AXIS = 'fill-[var(--text-muted)] text-[10px]';
const GRID = 'stroke-[var(--border)]';

/** Horizontal gridlines with their values, for a vertical value axis. */
export function ValueAxisY({ box, domain, display, ticks = 4 }: {
  box: FrameBox; domain: PlotDomain; display: MetricDisplay; ticks?: number;
}) {
  const h = plotHeight(box);
  const w = plotWidth(box);
  return (
    <g aria-hidden="true">
      {domainTicks(domain, ticks).map((value) => {
        const y = box.top + h - fraction(value, domain) * h;
        return (
          <g key={value}>
            <line x1={box.left} x2={box.left + w} y1={y} y2={y} className={GRID} strokeWidth={1} />
            <text x={box.left - 6} y={y + 3} textAnchor="end" className={AXIS}>
              {formatMetricValue(value, display)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Vertical gridlines with their values, for a horizontal value axis (BAR, FUNNEL). */
export function ValueAxisX({ box, domain, display, ticks = 4 }: {
  box: FrameBox; domain: PlotDomain; display: MetricDisplay; ticks?: number;
}) {
  const h = plotHeight(box);
  const w = plotWidth(box);
  return (
    <g aria-hidden="true">
      {domainTicks(domain, ticks).map((value) => {
        const x = box.left + fraction(value, domain) * w;
        return (
          <g key={value}>
            <line x1={x} x2={x} y1={box.top} y2={box.top + h} className={GRID} strokeWidth={1} />
            <text x={x} y={box.top + h + 14} textAnchor="middle" className={AXIS}>
              {formatMetricValue(value, display)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Category labels along the bottom, thinned to fit.
 *
 * Thinning drops labels and never abbreviates the axis: a chart of 300 days shows
 * every bar and about eight dates, which is honest, whereas sampling the data to
 * 8 points would change what is drawn.
 */
export function CategoryAxisX({ box, labels }: { box: FrameBox; labels: readonly string[] }) {
  const w = plotWidth(box);
  const step = labels.length > 0 ? w / labels.length : 0;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(w / 68))));
  return (
    <g aria-hidden="true">
      {labels.map((label, i) => {
        if (i % every !== 0) return null;
        const x = box.left + step * i + step / 2;
        return (
          <text
            key={`${label}-${i}`}
            x={x}
            y={box.top + plotHeight(box) + 16}
            textAnchor="middle"
            className={AXIS}
          >
            {label.length > 12 ? `${label.slice(0, 11)}…` : label}
          </text>
        );
      })}
    </g>
  );
}

/** Category labels down the left, for a horizontal chart. Truncated at the width the
 *  frame reserved for them, so a long branch name cannot push into the plot. */
export function CategoryAxisY({ box, labels }: { box: FrameBox; labels: readonly string[] }) {
  const h = plotHeight(box);
  const step = labels.length > 0 ? h / labels.length : 0;
  return (
    <g aria-hidden="true">
      {labels.map((label, i) => (
        <text
          key={`${label}-${i}`}
          x={box.left - 8}
          y={box.top + step * i + step / 2 + 3}
          textAnchor="end"
          className={AXIS}
        >
          {label.length > 16 ? `${label.slice(0, 15)}…` : label}
        </text>
      ))}
    </g>
  );
}

/**
 * The series legend, and the interaction that makes a stacked chart readable: click a
 * series to hide it. Hiding is presentational and rescales the axis, which is why the
 * hidden ones stay listed and struck through rather than disappearing -- a reader
 * looking at a chart with two of five series drawn needs to see that.
 */
export function ChartLegend({ series, hidden, onToggle }: {
  series: readonly PlotSeries[];
  hidden: ReadonlySet<string>;
  onToggle?: (label: string) => void;
}) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {series.map((s) => {
        const off = hidden.has(s.label);
        const content = (
          <>
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: s.color, opacity: off ? 0.3 : 1 }}
            />
            <span className={off ? 'line-through opacity-50' : ''}>{s.label}</span>
          </>
        );
        return (
          <li key={s.label} className="text-[11px] text-[var(--text-secondary)]">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(s.label)}
                aria-pressed={!off}
                className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-[var(--bg-hover)]"
              >
                {content}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What the hover layer shows. Values arrive already formatted -- the tooltip is not
 *  allowed to be the second place a number gets rounded. */
export interface HoverInfo {
  x: number;
  y: number;
  title: string;
  rows: ReadonlyArray<{ label: string; value: string; color?: string }>;
}

/** One tooltip per chart, positioned in the container's pixel space and clamped to it.
 *  `pointer-events-none` so it never eats the hover that produced it. */
export function ChartTooltip({ hover, width }: { hover: HoverInfo; width: number }) {
  const left = Math.min(Math.max(hover.x, 70), Math.max(70, width - 70));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-[7rem] -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 shadow-lg"
      style={{ left, top: Math.max(hover.y - 8, 8) }}
    >
      <p className="mb-0.5 text-[11px] font-semibold text-[var(--text-primary)]">{hover.title}</p>
      {hover.rows.map((row) => (
        <p key={row.label} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          {row.color && (
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: row.color }} />
          )}
          <span className="truncate">{row.label}</span>
          <span className="ms-auto tabular text-[var(--text-primary)]">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * One interactive mark: a bar, a slice, a cell, a point.
 *
 * The keyboard path is the reason this is a component rather than three spread props.
 * A chart whose cells open records on click and cannot be reached by Tab is a feature
 * only some people have, so every mark that can be clicked is focusable and answers
 * Enter and Space, and `aria-label` carries the same sentence the tooltip shows.
 */
export function Mark({ label, onSelect, onHover, onLeave, children }: {
  label: string;
  onSelect?: () => void;
  onHover?: () => void;
  onLeave?: () => void;
  children: ReactNode;
}) {
  const interactive = Boolean(onSelect);
  return (
    <g
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
      className={interactive ? 'cursor-pointer outline-none focus-visible:opacity-80' : undefined}
    >
      {children}
    </g>
  );
}

