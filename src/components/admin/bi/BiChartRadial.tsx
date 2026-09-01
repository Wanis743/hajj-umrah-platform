/**
 * The radial and single-number families: pie, donut, radar, gauge, funnel and KPI.
 *
 * These are the charts that carry the least data and the most weight, which is why the
 * rules they follow are stricter rather than looser. A pie drops negatives and says how
 * many it dropped. A donut prints a centre total only when the metric may be summed.
 * A gauge needs its target as a second measure instead of scaling to itself. A KPI over
 * a grouped result names the group it is showing rather than implying it is the whole.
 */
import type { BiChartType } from '@/types/bi';
import { formatMetricValue, useBiI18n, type MetricDisplay } from './biFormat';
import {
  arcPath, colorAt, funnelStages, gaugeReading, hoverRows, markLabel, pieSlices, polar,
  plotHeight, plotWidth, visibleOf,
  type FrameBox, type FunnelStage, type GaugeReading, type PlotModel, type PlotSeries,
} from './biChartData';
import { Mark, type HoverInfo } from './BiChartFrame';

export interface RadialProps {
  type: BiChartType;
  model: PlotModel;
  box: FrameBox;
  hidden: ReadonlySet<string>;
  onHover: (info: HoverInfo | null) => void;
  /** Category index. Absent when the dimension has nowhere to drill. */
  onSelect?: (index: number) => void;
}

const AXIS = 'fill-[var(--text-muted)] text-[10px]';

/** Shares are fractions everywhere in this folder, printed to one decimal. */
const SHARE = { format: 'PERCENT' as const, decimals: 1 };

/** The first series still switched on, or the first one there is. A pie has one measure
 *  by definition, and hiding it should leave the legend's own state visible rather than
 *  blanking the tile. */
const primary = (model: PlotModel, hidden: ReadonlySet<string>): PlotSeries | undefined =>
  visibleOf(model, hidden)[0] ?? model.series[0];

export function BiChartRadial(props: RadialProps) {
  const { type } = props;
  if (type === 'RADAR') return <Radar {...props} />;
  if (type === 'GAUGE') return <Gauge {...props} />;
  if (type === 'FUNNEL') return <Funnel {...props} />;
  if (type === 'KPI') return <Kpi {...props} />;
  return <Pie {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Pie and donut                                                              */
/* -------------------------------------------------------------------------- */

function Pie({ type, model, box, hidden, onHover, onSelect }: RadialProps) {
  const { t } = useBiI18n();
  const series = primary(model, hidden);
  const { slices, dropped } = pieSlices(model, series);
  const cx = box.width / 2;
  const cy = box.height / 2;
  const r = Math.max(0, Math.min(box.width, box.height) / 2 - 16);
  const inner = type === 'DONUT' ? r * 0.58 : 0;
  const display = series?.display ?? {};
  const name = series?.label ?? '';
  const shareLabel = t('النسبة', 'Part', 'Share');
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <>
      {slices.map((s) => {
        const at = polar(cx, cy, inner > 0 ? (r + inner) / 2 : r * 0.62, (s.a0 + s.a1) / 2);
        const rows = [
          { label: name, value: formatMetricValue(s.value, display), color: s.color },
          {
            label: shareLabel,
            value: formatMetricValue(s.share, { format: 'PERCENT', decimals: 1 }),
          },
        ];
        return (
          <Mark
            key={s.index}
            label={[s.label, ...rows.map((q) => `${q.label}: ${q.value}`)].join(', ')}
            onSelect={onSelect ? () => onSelect(s.index) : undefined}
            onHover={() => onHover({ x: at.x, y: at.y, title: s.label, rows })}
            onLeave={() => onHover(null)}
          >
            <path
              d={arcPath(cx, cy, r, inner, s.a0, s.a1)}
              fill={s.color}
              className="stroke-[var(--surface)]"
              strokeWidth={1}
            />
          </Mark>
        );
      })}
      {type === 'DONUT' && series?.additive && slices.length > 0 && (
        // Only when the metric may be summed. A donut with an average in the middle of
        // it is the most confident wrong number a dashboard can print.
        <>
          <text x={cx} y={cy - 2} textAnchor="middle" className="fill-[var(--text-primary)] text-[15px] font-semibold">
            {formatMetricValue(total, display)}
          </text>
          <text x={cx} y={cy + 13} textAnchor="middle" className={AXIS}>
            {t('الإجمالي', 'Total', 'Total')}
          </text>
        </>
      )}
      {dropped > 0 && (
        <text x={4} y={box.height - 4} className={AXIS}>
          {`${dropped} ${t('قيمة سالبة مستبعدة', 'valeurs négatives exclues', 'negative values excluded')}`}
        </text>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Radar                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * RADAR: one spoke per category, one polygon per visible series.
 *
 * Every series is measured on one radius rather than normalized per axis. Per-axis
 * normalization is what gave radar charts their reputation: it makes every polygon look
 * balanced and hides that one axis is in thousands while another is in single digits.
 * A missing value is skipped rather than drawn at the centre, so the polygon cuts the
 * corner instead of claiming a zero, and the count of skips is printed.
 */
function Radar({ model, box, hidden, onHover, onSelect }: RadialProps) {
  const { t } = useBiI18n();
  const series = visibleOf(model, hidden);
  const cats = model.categories;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const r = Math.max(0, Math.min(box.width, box.height) / 2 - 28);
  let max = 0;
  let gaps = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (v === null || v === undefined) { gaps += 1; continue; }
      if (v > max) max = v;
    }
  }
  const scale = max > 0 ? max : 1;
  const angleAt = (i: number) => -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, cats.length);
  const pointsOf = (s: PlotSeries): string => {
    const out: string[] = [];
    for (let i = 0; i < cats.length; i += 1) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      const q = polar(cx, cy, (v / scale) * r, angleAt(i));
      out.push(`${q.x.toFixed(2)},${q.y.toFixed(2)}`);
    }
    return out.join(' ');
  };
  const half = Math.PI / Math.max(1, cats.length);

  return (
    <>
      <g aria-hidden="true">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle
            key={f} cx={cx} cy={cy} r={r * f}
            fill="none" className="stroke-[var(--border)]" strokeWidth={1}
          />
        ))}
        {cats.map((cat, i) => {
          const edge = polar(cx, cy, r, angleAt(i));
          const text = polar(cx, cy, r + 12, angleAt(i));
          const anchor = Math.abs(text.x - cx) < 4 ? 'middle' : (text.x > cx ? 'start' : 'end');
          return (
            <g key={cat.key || `sp-${i}`}>
              <line
                x1={cx} y1={cy} x2={edge.x} y2={edge.y}
                className="stroke-[var(--border)]" strokeWidth={1}
              />
              <text x={text.x} y={text.y + 3} textAnchor={anchor} className={AXIS}>
                {cat.label.length > 10 ? `${cat.label.slice(0, 9)}…` : cat.label}
              </text>
            </g>
          );
        })}
      </g>
      {series.map((s) => (
        <polygon
          key={s.label} points={pointsOf(s)}
          fill={s.color} fillOpacity={0.18} stroke={s.color} strokeWidth={2}
        />
      ))}
      {cats.map((cat, i) => {
        const at = polar(cx, cy, r * 0.75, angleAt(i));
        return (
          <Mark
            key={cat.key || `hit-${i}`}
            label={markLabel(cat.label, series, i)}
            onSelect={onSelect ? () => onSelect(i) : undefined}
            onHover={() => onHover({
              x: at.x, y: at.y, title: cat.label, rows: hoverRows(series, i),
            })}
            onLeave={() => onHover(null)}
          >
            {/* The whole sector, so the target is the wedge a reader points at rather
                than the vertex where the polygon happens to cross it. */}
            <path
              d={arcPath(cx, cy, r, 0, angleAt(i) - half, angleAt(i) + half)}
              fill="transparent"
            />
          </Mark>
        );
      })}
      {gaps > 0 && (
        <text x={4} y={box.height - 4} className={AXIS}>
          {`${gaps} ${t('قيمة غائبة', 'valeurs manquantes', 'missing values')}`}
        </text>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Gauge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GAUGE: the first measure against the second, which is its target.
 *
 * The full sweep is the target, so a full dial means the target was met and the number
 * in the middle is the true attainment -- the only place an overshoot can be read, since
 * the arc has nowhere further to go. The fill keeps the series' own colour rather than
 * turning green at 100%: more is better for revenue and worse for cost, and a chart that
 * does not know which should not be the one passing judgement.
 */
/** The dial's numbers, printed. The arithmetic is in `gaugeReading`; this only decides
 *  how many digits each of them shows. */
function gaugeText(read: GaugeReading) {
  return {
    name: read.actual?.label ?? '',
    targetName: read.target?.label ?? '',
    color: read.actual?.color ?? colorAt(0),
    valueText: formatMetricValue(read.value, read.actual?.display ?? {}),
    goalText: formatMetricValue(read.goal, read.target?.display ?? {}),
    shareText: formatMetricValue(read.frac, SHARE),
  };
}

function Gauge({ model, box, hidden, onHover, onSelect }: RadialProps) {
  const { t } = useBiI18n();
  const dial = gaugeReading(model, hidden);
  const read = gaugeText(dial);
  const cx = box.width / 2;
  const r = Math.max(0, Math.min(box.width / 2, box.height / 1.5) - 18);
  const cy = box.height / 2 + r * 0.16;
  const a0 = Math.PI * (150 / 180);
  const sweep = Math.PI * (240 / 180);
  const ring = Math.max(6, r * 0.22);
  const rows = [
    { label: read.name, value: read.valueText, color: read.color },
    { label: read.targetName, value: read.goalText },
    { label: t('نسبة التحقيق', 'Atteinte', 'Attainment'), value: read.shareText },
  ];

  return (
    <>
      <path
        d={arcPath(cx, cy, r, r - ring, a0, a0 + sweep)}
        className="fill-[var(--bg-hover)]"
        aria-hidden="true"
      />
      <Mark
        label={[t('مقياس', 'Jauge', 'Gauge'), ...rows.map((q) => `${q.label}: ${q.value}`)].join(', ')}
        onSelect={onSelect ? () => onSelect(0) : undefined}
        onHover={() => onHover({ x: cx, y: cy - r, title: read.name, rows })}
        onLeave={() => onHover(null)}
      >
        <path d={arcPath(cx, cy, r, 0, a0, a0 + sweep)} fill="transparent" />
        {dial.drawn > 0 && (
          <path
            d={arcPath(cx, cy, r, r - ring, a0, a0 + sweep * dial.drawn)}
            fill={read.color}
          />
        )}
        <text x={cx} y={cy} textAnchor="middle" className="fill-[var(--text-primary)] text-[17px] font-semibold">
          {read.valueText}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" className="fill-[var(--text-secondary)] text-[11px]">
          {read.shareText}
        </text>
        <text x={cx} y={cy + 31} textAnchor="middle" className={AXIS}>
          {`${t('الهدف', 'Cible', 'Target')} ${read.goalText}`}
        </text>
      </Mark>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Funnel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * FUNNEL: the stages down the page, each as wide as its share of the first.
 *
 * Width is the share of the first stage, so the taper is the drop-off rather than a
 * decoration, and every stage carries both shares -- of the first and of the one before
 * it -- because "40% of all leads" and "80% of the previous step" are different findings
 * and a funnel drawn without the second hides where the loss actually happened. Stages
 * stay in the order the query returned them; a stage with no value is skipped and
 * counted, never drawn as an empty band that reads like a zero.
 */
function Funnel({ model, box, hidden, onHover, onSelect }: RadialProps) {
  const { t } = useBiI18n();
  const series = primary(model, hidden);
  const stages = funnelStages(model, series);
  const display = series?.display ?? {};
  const name = series?.label ?? '';
  const w = plotWidth(box);
  const h = plotHeight(box);
  const mid = box.left + w / 2;
  const band = stages.length > 0 ? h / stages.length : 0;
  const gap = Math.min(7, band * 0.16);
  const pct = { format: 'PERCENT' as const, decimals: 1 };
  const ofFirst = t('من الأولى', 'De la 1re', 'of first');
  const ofPrev = t('من السابقة', 'De la précédente', 'of previous');
  const missing = model.categories.length - stages.length;

  return (
    <>
      {stages.map((s, i) => {
        const next = stages[i + 1];
        const wTop = Math.max(3, s.ofFirst * w);
        const wEnd = Math.max(3, (next ? next.ofFirst : s.ofFirst) * w);
        const y0 = box.top + band * i;
        const y1 = y0 + band - gap;
        const cy = (y0 + y1) / 2;
        const color = colorAt(s.index);
        const rows = [
          { label: name, value: formatMetricValue(s.value, display), color },
          { label: ofFirst, value: formatMetricValue(s.ofFirst, pct) },
          { label: ofPrev, value: formatMetricValue(s.ofPrev, pct) },
        ];
        return (
          <FunnelBand
            key={s.label || `fn-${s.index}`}
            {...{ s, mid, wTop, wEnd, y0, y1, cy, color, rows, display, box, onHover }}
            onSelect={onSelect ? () => onSelect(s.index) : undefined}
          />
        );
      })}
      {missing > 0 && (
        <text x={4} y={box.height - 4} className={AXIS}>
          {`${missing} ${t('مرحلة بلا قيمة', 'étapes sans valeur', 'stages with no value')}`}
        </text>
      )}
    </>
  );
}

/**
 * One stage. A soft fill with a solid edge, the same treatment the radar polygons get,
 * so the value can be printed in the theme's own text colour instead of a hard-coded
 * white that would only work on one of the two themes.
 */
function FunnelBand({ s, mid, wTop, wEnd, y0, y1, cy, color, rows, display, box, onHover, onSelect }: {
  s: FunnelStage;
  mid: number; wTop: number; wEnd: number; y0: number; y1: number; cy: number;
  color: string;
  rows: HoverInfo['rows'];
  display: MetricDisplay;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  onSelect?: () => void;
}) {
  const points = [
    `${mid - wTop / 2},${y0}`, `${mid + wTop / 2},${y0}`,
    `${mid + wEnd / 2},${y1}`, `${mid - wEnd / 2},${y1}`,
  ].join(' ');
  const caption = `${formatMetricValue(s.value, display)} · ${formatMetricValue(s.ofFirst, { format: 'PERCENT', decimals: 1 })}`;
  return (
    <Mark
      label={[s.label, ...rows.map((q) => `${q.label}: ${q.value}`)].join(', ')}
      onSelect={onSelect}
      onHover={() => onHover({ x: mid, y: y0, title: s.label, rows })}
      onLeave={() => onHover(null)}
    >
      <text x={box.left - 8} y={cy + 3} textAnchor="end" className={AXIS}>
        {s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label}
      </text>
      <polygon points={points} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2} />
      <text
        x={mid} y={cy + 4} textAnchor="middle"
        className="fill-[var(--text-primary)] text-[11px] font-semibold"
      >
        {caption}
      </text>
    </Mark>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * KPI: one number, at the size of the tile it was given.
 *
 * A KPI is a claim about the whole, so a grouped result names the group it is actually
 * showing and says how many there are. Silently printing the first row of twelve as
 * "Revenue" is the cheapest way a dashboard lies, and it is the reader who carries it.
 */
function Kpi({ model, box, hidden, onHover, onSelect }: RadialProps) {
  const { t } = useBiI18n();
  const series = primary(model, hidden);
  const value = series?.values[0] ?? null;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const groups = model.categories.length;
  const head = model.categories[0]?.label ?? '';
  const size = Math.max(20, Math.min(42, box.height * 0.3));
  const rows = [{
    label: series?.label ?? '',
    value: formatMetricValue(value, series?.display ?? {}),
    color: series?.color,
  }];
  const note = groups > 1
    ? t(`${head} — 1 من ${groups} مجموعات`,
        `${head} — 1 sur ${groups} groupes`,
        `${head} — 1 of ${groups} groups`)
    : head;

  return (
    <Mark
      label={[series?.label ?? '', rows[0].value, note].filter(Boolean).join(', ')}
      onSelect={onSelect && groups > 0 ? () => onSelect(0) : undefined}
      onHover={() => onHover({ x: cx, y: cy - size * 0.5, title: series?.label ?? '', rows })}
      onLeave={() => onHover(null)}
    >
      <rect x={0} y={0} width={box.width} height={box.height} fill="transparent" />
      <text
        x={cx} y={cy} textAnchor="middle" fontSize={size}
        className="fill-[var(--text-primary)] font-semibold"
      >
        {rows[0].value}
      </text>
      <text x={cx} y={cy + 20} textAnchor="middle" className="fill-[var(--text-secondary)] text-[12px]">
        {series?.label ?? ''}
      </text>
      {note && (
        <text x={cx} y={cy + 36} textAnchor="middle" className={AXIS}>{note}</text>
      )}
    </Mark>
  );
}

