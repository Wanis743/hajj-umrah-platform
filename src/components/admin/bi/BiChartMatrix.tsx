/**
 * The matrix and cloud families: heatmap, correlation matrix, sensitivity matrix,
 * treemap, scatter and bubble.
 *
 * What these five have in common is that position alone is not the message. A heatmap
 * says it with colour, a treemap with area, a bubble with all three, and each of those
 * channels is easier to mislead with than a bar's height. So the rules are written down
 * next to the drawing: opacity carries magnitude and never bottoms out for a value that
 * exists, a diverging grid gets a diverging ramp, area is proportional to the value and
 * a bubble's radius to its square root, and every row the query returned but the chart
 * could not place is counted on screen instead of vanishing.
 */
import type { BiQuerySuccess, BiResultColumn, BiScalar, BiChartType } from '@/types/bi';
import { formatMetricValue, useBiI18n, type MetricDisplay } from './biFormat';
import {
  colorAt, heatFill, heatGrid, plotWidth, scatterPoints, scatterScales, treemapRects,
  valueX, valueY, type FrameBox, type PlotModel,
} from './biChartData';
import {
  CategoryAxisX, CategoryAxisY, Mark, ValueAxisX, ValueAxisY, type HoverInfo,
} from './BiChartFrame';

export interface MatrixProps {
  type: BiChartType;
  model: PlotModel;
  /** Scatter reads the rows rather than the plot model: two measures against each other
   *  are not a category axis, and folding them into one would lose the pairing. */
  result: BiQuerySuccess;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  /** Category index, for the grid and the treemap. Absent when there is no drill. */
  onSelect?: (index: number) => void;
  /** A scatter point is a row, not a category, so it hands back the dimension value it
   *  was drawn from and the caller pairs it with the column. */
  onPick?: (value: BiScalar, label: string) => void;
}

const AXIS = 'fill-[var(--text-muted)] text-[10px]';

/** The print instructions a metric column carries. A dimension column carries none, and
 *  gets an empty object rather than a guessed format. */
const displayFor = (col: BiResultColumn | null): MetricDisplay =>
  (col && col.kind === 'METRIC'
    ? { format: col.format, decimals: col.decimals, unit: col.unit }
    : {});

export function BiChartMatrix(props: MatrixProps) {
  const { type } = props;
  if (type === 'TREEMAP') return <Treemap {...props} />;
  if (type === 'SCATTER' || type === 'BUBBLE') return <Scatter {...props} />;
  return <Grid {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Heatmap, correlation matrix, sensitivity matrix                            */
/* -------------------------------------------------------------------------- */

/**
 * One cell per (category, split value), coloured by magnitude.
 *
 * The legend is deliberately not a series legend: the rows are the second dimension, so
 * switching one off would punch a hole in the grid rather than rescale anything, and the
 * caller suppresses it for this family. What replaces it is the pair of numbers at the
 * bottom right -- the ends of the ramp -- because opacity cannot be read without them.
 */
function Grid({ model, box, onHover, onSelect }: MatrixProps) {
  const { t } = useBiI18n();
  const grid = heatGrid(model, box);
  const scale = `${formatMetricValue(grid.min, grid.display)} → ${formatMetricValue(grid.max, grid.display)}`;

  return (
    <>
      <CategoryAxisX box={box} labels={model.categories.map((c) => c.label)} />
      <CategoryAxisY box={box} labels={model.series.map((s) => s.label)} />
      {grid.cells.map((cell) => {
        const paint = heatFill(cell.t, grid.diverging);
        const text = formatMetricValue(cell.value, grid.display);
        const rows = [{
          label: `${cell.rowLabel} · ${cell.colLabel}`, value: text, color: paint.color,
        }];
        return (
          <Mark
            key={`${cell.si}-${cell.ci}`}
            label={`${cell.colLabel}, ${cell.rowLabel}: ${text}`}
            onSelect={onSelect ? () => onSelect(cell.ci) : undefined}
            onHover={() => onHover({
              x: cell.x + cell.w / 2, y: cell.y, title: cell.colLabel, rows,
            })}
            onLeave={() => onHover(null)}
          >
            <rect
              x={cell.x + 1} y={cell.y + 1}
              width={Math.max(0, cell.w - 2)} height={Math.max(0, cell.h - 2)}
              fill={paint.color} fillOpacity={paint.opacity}
              className="stroke-[var(--border)]" strokeWidth={cell.value === null ? 1 : 0}
              rx={2}
            />
            {cell.value !== null && cell.w > 46 && cell.h > 17 && (
              <text
                x={cell.x + cell.w / 2} y={cell.y + cell.h / 2 + 3} textAnchor="middle"
                className="fill-[var(--text-primary)] text-[10px]"
              >
                {text}
              </text>
            )}
          </Mark>
        );
      })}
      <text x={box.width - 2} y={box.height - 4} textAnchor="end" className={AXIS}>{scale}</text>
      {grid.blanks > 0 && (
        <text x={4} y={box.height - 4} className={AXIS}>
          {`${grid.blanks} ${t('خلية بلا قيمة', 'cellules sans valeur', 'cells with no value')}`}
        </text>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Treemap                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * TREEMAP: area is the value, over the whole tile rather than inside an axis frame.
 *
 * Negative and null categories cannot have an area, so they are dropped and the count is
 * printed on the line this reserves at the bottom -- reserved whether or not it is used,
 * so the picture does not resize depending on how clean the data was.
 */
function Treemap({ model, box, onHover, onSelect }: MatrixProps) {
  const { t } = useBiI18n();
  const bodyH = Math.max(0, box.height - 14);
  const rects = treemapRects(model, box.width, bodyH);
  const display = model.series[0]?.display ?? {};
  const name = model.series[0]?.label ?? '';
  const dropped = model.categories.length - rects.length;

  return (
    <>
      {rects.map((r) => {
        const text = formatMetricValue(r.value, display);
        const rows = [{ label: name, value: text, color: r.color }];
        return (
          <Mark
            key={`${r.index}-${r.label}`}
            label={`${r.label}: ${text}`}
            onSelect={onSelect ? () => onSelect(r.index) : undefined}
            onHover={() => onHover({ x: r.x + r.w / 2, y: r.y, title: r.label, rows })}
            onLeave={() => onHover(null)}
          >
            <rect
              x={r.x + 1} y={r.y + 1}
              width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)}
              fill={r.color} fillOpacity={0.28} stroke={r.color} strokeWidth={1.5} rx={3}
            />
            {r.w > 62 && r.h > 20 && (
              <text x={r.x + 7} y={r.y + 15} className="fill-[var(--text-primary)] text-[10px] font-medium">
                {r.label.length > Math.floor(r.w / 6) ? `${r.label.slice(0, Math.floor(r.w / 6))}…` : r.label}
              </text>
            )}
            {r.w > 62 && r.h > 36 && (
              <text x={r.x + 7} y={r.y + 29} className="fill-[var(--text-secondary)] text-[10px]">
                {text}
              </text>
            )}
          </Mark>
        );
      })}
      {dropped > 0 && (
        <text x={4} y={box.height - 3} className={AXIS}>
          {`${dropped} ${t('قيمة غير قابلة للعرض', 'valeurs non représentables', 'values with no area')}`}
        </text>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Scatter and bubble                                                         */
/* -------------------------------------------------------------------------- */

/**
 * SCATTER and BUBBLE: the first measure against the second, one point per row.
 *
 * Both axes are named on screen, because "which one is x" is the first question a
 * scatter raises and a legend cannot answer it. A row missing either measure cannot be
 * placed at all -- placing it at zero would invent a point in the corner -- so it is
 * skipped and counted. A bubble sizes on the third measure and falls back to the plain
 * dot when there is none, rather than sizing every bubble the same and implying a third
 * reading that was never asked for.
 */
function Scatter({ type, result, box, onHover, onPick }: MatrixProps) {
  const { t } = useBiI18n();
  const { points, x, y, size } = scatterPoints(result);
  const scales = scatterScales(points);
  const dx = displayFor(x);
  const dy = displayFor(y);
  const bubble = type === 'BUBBLE' && size !== null;
  const skipped = result.rows.length - points.length;
  const color = colorAt(0);

  return (
    <>
      <ValueAxisY box={box} domain={scales.y} display={dy} />
      <ValueAxisX box={box} domain={scales.x} display={dx} />
      <text x={box.left} y={box.top - 4} className={AXIS}>{y?.label ?? ''}</text>
      <text x={box.left + plotWidth(box)} y={box.height - 20} textAnchor="end" className={AXIS}>
        {x?.label ?? ''}
      </text>
      {points.map((p, i) => {
        const rows = [
          { label: x?.label ?? '', value: formatMetricValue(p.x, dx), color },
          { label: y?.label ?? '', value: formatMetricValue(p.y, dy) },
          ...(bubble && size
            ? [{ label: size.label, value: formatMetricValue(p.size, displayFor(size)) }]
            : []),
        ];
        const cx = valueX(p.x, scales.x, box);
        const cy = valueY(p.y, scales.y, box);
        return (
          <Mark
            key={`${p.label}-${i}`}
            label={[p.label, ...rows.map((q) => `${q.label}: ${q.value}`)].join(', ')}
            onSelect={onPick ? () => onPick(p.raw, p.label) : undefined}
            onHover={() => onHover({ x: cx, y: cy, title: p.label, rows })}
            onLeave={() => onHover(null)}
          >
            <circle
              cx={cx} cy={cy} r={bubble ? scales.radius(p.size) : 4}
              fill={color} fillOpacity={bubble ? 0.42 : 0.85} stroke={color} strokeWidth={1}
            />
          </Mark>
        );
      })}
      {skipped > 0 && (
        <text x={4} y={box.height - 4} className={AXIS}>
          {`${skipped} ${t('صف بلا قياس', 'lignes sans mesure', 'rows with a missing measure')}`}
        </text>
      )}
    </>
  );
}

