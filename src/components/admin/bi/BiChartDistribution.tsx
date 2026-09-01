/**
 * BOX_PLOT and FORECAST_BAND: the two charts whose subject is uncertainty.
 *
 * Grouped together because they answer the same objection. Every other chart in this
 * folder draws numbers the query returned; these two draw numbers derived from them -- a
 * quartile nobody stored, a value for a period that has not happened -- and a derived
 * number presented like a measured one is the most expensive kind of chart to be wrong.
 *
 * So both of them show their work on the face of the drawing. A box prints the count of
 * points behind it, because a box over four categories and a box over four hundred look
 * identical. A band prints its R², its standard error and the name of the series it was
 * fitted to, and its projected half is dashed rather than solid, because the reader who
 * screenshots this into a document should not be able to lose the distinction between the
 * part that was measured and the part that was inferred.
 */
import type { BiChartType } from '@/types/bi';
import { formatMetricValue, useBiI18n, type MetricDisplay } from './biFormat';
import {
  axisDisplay, bandX, linePath, plotHeight, plotWidth, valueY, visibleOf,
  type FrameBox, type PlotModel,
} from './biChartData';
import {
  bandPath, boxDomain, boxLayout, boxSummaries,
  forecastBand, forecastDomain, forecastLines,
  type BoxGeometry, type ForecastFit, type ForecastRefusal,
} from './biChartStats';
import {
  CategoryAxisX, CategoryAxisY, Mark, ValueAxisX, ValueAxisY, type HoverInfo,
} from './BiChartFrame';

export interface DistributionProps {
  type: BiChartType;
  model: PlotModel;
  box: FrameBox;
  hidden: ReadonlySet<string>;
  onHover: (info: HoverInfo | null) => void;
  /** Category index. On a box plot only the outliers carry one: a box is a distribution
   *  over every category, so there is no single row a click on it could open. */
  onSelect?: (index: number) => void;
}

const AXIS = 'fill-[var(--text-muted)] text-[10px]';
const NOTE = 'fill-[var(--text-secondary)] text-[10px]';

/** Shares and fit quality are fractions everywhere in this folder, printed to two
 *  decimals here because an R² of 0.9 and one of 0.94 are different arguments. */
const RATIO: MetricDisplay = { format: 'NUMBER', decimals: 2 };

export function BiChartDistribution(props: DistributionProps) {
  return props.type === 'BOX_PLOT' ? <BoxPlot {...props} /> : <Forecast {...props} />;
}

/* -------------------------------------------------------------------------- */
/* BOX_PLOT                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One box per series, lying across a horizontal value axis.
 *
 * Horizontal because the labels are series names and a series name does not fit under a
 * vertical box -- the same reason a bar chart of branches is horizontal. The mean is
 * marked separately from the median, since a box whose mean sits outside its own box is
 * telling the reader about a skew that the five-number summary alone does not show.
 */
function BoxPlot({ model, box, hidden, onHover, onSelect }: DistributionProps) {
  const { t } = useBiI18n();
  const summaries = boxSummaries(model, hidden);
  const domain = boxDomain(summaries);
  const geometry = boxLayout(summaries, domain, box);
  const display = axisDisplay(visibleOf(model, hidden));

  return (
    <>
      <ValueAxisX box={box} domain={domain} display={display} />
      <CategoryAxisY box={box} labels={summaries.map((s) => s.label)} />
      {geometry.map((g) => (
        <BoxMark
          key={g.summary.label} geometry={g} box={box}
          onHover={onHover} onSelect={onSelect} rangeLabel={t('المدى', 'Étendue', 'Range')}
          countLabel={t('نقاط', 'points', 'points')}
        />
      ))}
      {summaries.length === 0 && (
        <text x={box.left} y={box.top + plotHeight(box) / 2} className={NOTE}>
          {t('لا سلسلة ظاهرة', 'Aucune série visible', 'No series is visible')}
        </text>
      )}
    </>
  );
}

/**
 * One box, its whiskers, its median and mean, and its outliers.
 *
 * Split out from BoxPlot rather than inlined so the hover targets stay legible: there are
 * two kinds here -- the box, which describes a distribution, and an outlier, which is a
 * row -- and only the second one drills.
 */
function BoxMark({ geometry, box, onHover, onSelect, rangeLabel, countLabel }: {
  geometry: BoxGeometry;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  onSelect?: (index: number) => void;
  rangeLabel: string;
  countLabel: string;
}) {
  const { summary, cy, thick } = geometry;
  const print = (value: number): string => formatMetricValue(value, summary.display);
  const half = thick / 2;
  const rows = [
    { label: 'Q3', value: print(summary.q3), color: summary.color },
    { label: 'Median', value: print(summary.median) },
    { label: 'Q1', value: print(summary.q1) },
    { label: 'Mean', value: print(summary.mean) },
    { label: rangeLabel, value: `${print(summary.low)} → ${print(summary.high)}` },
    { label: countLabel, value: String(summary.n) },
  ];

  return (
    <>
      <Mark
        label={`${summary.label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}
        onHover={() => onHover({ x: geometry.median, y: cy - half, title: summary.label, rows })}
        onLeave={() => onHover(null)}
      >
        {/* The whisker, then the box over it: one line the full extent, so the box's
            edges read as the quartiles rather than as the ends of the data. */}
        <line
          x1={geometry.low} x2={geometry.high} y1={cy} y2={cy}
          stroke={summary.color} strokeWidth={1.5}
        />
        <line
          x1={geometry.low} x2={geometry.low} y1={cy - half * 0.6} y2={cy + half * 0.6}
          stroke={summary.color} strokeWidth={1.5}
        />
        <line
          x1={geometry.high} x2={geometry.high} y1={cy - half * 0.6} y2={cy + half * 0.6}
          stroke={summary.color} strokeWidth={1.5}
        />
        <rect
          x={Math.min(geometry.q1, geometry.q3)} y={cy - half}
          width={Math.max(1, Math.abs(geometry.q3 - geometry.q1))} height={thick}
          fill={summary.color} fillOpacity={0.24}
          stroke={summary.color} strokeWidth={1.5} rx={2}
        />
        <line
          x1={geometry.median} x2={geometry.median} y1={cy - half} y2={cy + half}
          stroke={summary.color} strokeWidth={2.5}
        />
        {/* The mean as a hollow diamond -- a different shape from the median line, because
            two lines of different weights is a distinction that survives no screenshot. */}
        <path
          d={`M${geometry.mean} ${cy - 4}L${geometry.mean + 4} ${cy}L${geometry.mean} ${cy + 4}L${geometry.mean - 4} ${cy}Z`}
          fill="var(--surface-raised)" stroke={summary.color} strokeWidth={1.5}
        />
        <text x={box.left + plotWidth(box)} y={cy - half - 3} textAnchor="end" className={AXIS}>
          {`n=${summary.n}`}
        </text>
      </Mark>
      {geometry.outliers.map(({ x, outlier }) => (
        <Mark
          key={`${outlier.index}-${outlier.value}`}
          label={`${outlier.label}: ${print(outlier.value)}`}
          onSelect={onSelect ? () => onSelect(outlier.index) : undefined}
          onHover={() => onHover({
            x, y: cy - 6, title: outlier.label,
            rows: [{ label: summary.label, value: print(outlier.value), color: summary.color }],
          })}
          onLeave={() => onHover(null)}
        >
          <circle
            cx={x} cy={cy} r={3.5}
            fill="var(--surface-raised)" stroke={summary.color} strokeWidth={1.5}
          />
        </Mark>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* FORECAST_BAND                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The observed series, a least-squares fit, and a 95% prediction interval.
 *
 * The band is drawn first and the lines over it, so the interval never hides a
 * measurement. Every period gets one invisible full-height hover column rather than a hit
 * target on each dot: at a horizon of twelve the dots are a few pixels apart, and a
 * tooltip the reader has to aim for is a tooltip they will not use.
 */
function Forecast({ model, box, hidden, onHover, onSelect }: DistributionProps) {
  const { t } = useBiI18n();
  const grain = model.categoryColumn?.grain ?? null;
  const result = forecastBand(model, hidden, grain);
  if (!result.ok) {
    return (
      <text x={box.left} y={box.top + plotHeight(box) / 2} className={NOTE}>
        {refusalText(result.reason, t)}
      </text>
    );
  }

  const { fit } = result;
  const domain = forecastDomain(fit);
  const lines = forecastLines(fit.points);
  const count = fit.points.length;
  const color = fit.series.color;
  const print = (value: number): string => formatMetricValue(value, fit.series.display);

  return (
    <>
      <ValueAxisY box={box} domain={domain} display={fit.series.display} />
      <CategoryAxisX box={box} labels={fit.points.map((p) => p.label)} />
      <path d={bandPath(fit.points, domain, box)} fill={color} fillOpacity={0.14} />
      <path
        d={linePath(lines.fitted, domain, box)} fill="none"
        stroke={color} strokeWidth={1} strokeOpacity={0.55}
      />
      <path
        d={linePath(lines.ahead, domain, box)} fill="none"
        stroke={color} strokeWidth={2} strokeDasharray="5 4"
      />
      <path
        d={linePath(lines.actual, domain, box)} fill="none"
        stroke={color} strokeWidth={2}
      />
      {fit.points.map((point, index) => {
        const x = bandX(index, count, box);
        const rows = [
          ...(point.actual !== null
            ? [{ label: fit.series.label, value: print(point.actual), color }]
            : []),
          { label: t('التقدير', 'Ajusté', 'Fit'), value: print(point.fit) },
          {
            label: t('مجال ٩٥٪', 'Intervalle 95 %', '95% interval'),
            value: `${print(point.low)} → ${print(point.high)}`,
          },
        ];
        return (
          <Mark
            key={`${point.label}-${index}`}
            label={`${point.label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}
            onSelect={onSelect && !point.projected ? () => onSelect(index) : undefined}
            onHover={() => onHover({ x, y: valueY(point.high, domain, box), title: point.label, rows })}
            onLeave={() => onHover(null)}
          >
            <rect
              x={x - plotWidth(box) / Math.max(1, count) / 2} y={box.top}
              width={plotWidth(box) / Math.max(1, count)} height={plotHeight(box)}
              fill="transparent"
            />
            {point.actual !== null && (
              <circle cx={x} cy={valueY(point.actual, domain, box)} r={2.5} fill={color} />
            )}
            {point.projected && (
              <circle
                cx={x} cy={valueY(point.fit, domain, box)} r={2.5}
                fill="var(--surface-raised)" stroke={color} strokeWidth={1.5}
              />
            )}
          </Mark>
        );
      })}
      <FitNote fit={fit} box={box} />
    </>
  );
}

/** What the fit claims, in the corner of the frame it was fitted in. On its own line so
 *  it cannot be cropped away from the picture it qualifies. */
function FitNote({ fit, box }: { fit: ForecastFit; box: FrameBox }) {
  const { t } = useBiI18n();
  const parts = [
    fit.series.label,
    `R²=${formatMetricValue(fit.r2, RATIO)}`,
    `SE=${formatMetricValue(fit.se, fit.series.display)}`,
    `n=${fit.observed}`,
    `+${fit.horizon} ${t('فترة', 'périodes', 'periods')}`,
  ];
  return (
    <text x={box.left} y={box.height - 4} className={NOTE}>{parts.join(' · ')}</text>
  );
}

/** Why there is no band. Named rather than blank: "two points" and "a flat dimension"
 *  are different problems and the author fixes them differently. */
function refusalText(
  reason: ForecastRefusal, t: (ar: string, fr: string, en: string) => string,
): string {
  if (reason === 'NO_SERIES') {
    return t('لا سلسلة ظاهرة لملاءمتها', 'Aucune série visible à ajuster', 'No visible series to fit');
  }
  if (reason === 'TOO_FEW_POINTS') {
    return t('يحتاج التوقع إلى ٣ فترات على الأقل',
      'La projection demande au moins 3 périodes',
      'A projection needs at least 3 periods');
  }
  return t('كل الفترات في موضع واحد، فلا ميل يمكن ملاءمته',
    'Toutes les périodes sont au même point : aucune pente à ajuster',
    'Every period sits at one point, so there is no slope to fit');
}
