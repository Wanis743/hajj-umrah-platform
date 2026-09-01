/**
 * The one chart component the rest of the workspace uses: give it a chart type and a
 * compiled result, get an interactive chart or an explicit reason there isn't one.
 *
 * Everything that is shared by all thirty-three drawn types lives here rather than in the
 * seven renderer files -- the measured width, the hover state, which series the reader
 * switched off, and the translation of a clicked mark back into the dimension value the
 * server grouped on. The renderers below it only draw.
 *
 * The two rules this file exists to keep: a chart type that this build cannot draw says
 * so by name, and a chart that is missing a dimension or a measure says which, because
 * an empty frame is indistinguishable from a broken one and that is what makes readers
 * stop trusting a BI tool.
 *
 * TABLE and PIVOT come through here too and are handed to the grid rather than to a
 * renderer, so a caller does not have to branch on the chart type before it can show a
 * saved analysis whose author chose the numbers over a picture.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BiChartType, BiFilter, BiQuerySuccess, BiScalar } from '@/types/bi';
import { CHART_FAMILY, formatCell, useBiChartLabels, useBiI18n, type ChartFamily } from './biFormat';
import { InlineNote } from './atoms';
import {
  blocksDrawing, buildPlotModel, chartIssues, frameBox, wantsWideGutter,
  type BiChartSelection, type ChartIssue,
} from './biChartData';
import { ChartLegend, ChartTooltip, type HoverInfo } from './BiChartFrame';
import { BiChartCartesian } from './BiChartCartesian';
import { BiChartRadial, type RadialProps } from './BiChartRadial';
import { BiChartMatrix } from './BiChartMatrix';
import { BiChartDistribution } from './BiChartDistribution';
import { BiChartSchedule } from './BiChartSchedule';
import { BiChartTree } from './BiChartTree';
import { BiChartFlow } from './BiChartFlow';
import { BiResultTable } from './BiResultTable';

export interface BiChartProps {
  type: BiChartType;
  result: BiQuerySuccess;
  /** Plot height in pixels. The width is measured, never assumed. */
  height?: number;
  /** Called with the dimension value behind the clicked mark. Absent means the marks
   *  are not clickable at all, which is how a read-only tile is expressed. */
  onSelect?: (selection: BiChartSelection) => void;
  /** TABLE and PIVOT only, and only for drill-through: the grid needs the dataset the
   *  cell belongs to before it can ask what records are behind it. */
  datasetId?: string | null;
  /** The filter state this result was produced under, forwarded to a drill-through. */
  filters?: readonly BiFilter[];
}

/**
 * Families where switching a series off changes the picture, so a legend earns its height.
 *
 * A gauge and a bullet are out: there the second series is the target, and hiding it would
 * promote the target to the value -- a dial reading 100% because the reader clicked a
 * legend is worse than no legend at all. A box plot and a forecast band are in, because
 * both draw one shape per series and both read `hidden` before they measure the axis, so
 * switching off the outlying series actually rescales the chart instead of leaving a gap
 * where it was.
 */
const LEGEND_FAMILIES: ReadonlySet<ChartFamily> = new Set<ChartFamily>([
  'LINE', 'BAR', 'RADAR', 'BOX', 'FORECAST',
]);

export function BiChart({
  type, result, height = 260, onSelect, datasetId = null, filters = [],
}: BiChartProps) {
  const { t } = useBiI18n();
  const chartLabels = useBiChartLabels();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Measured, not assumed: these tiles sit in a grid that reflows, and a chart drawn at
  // a guessed width either clips or leaves a gutter at every breakpoint.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => buildPlotModel(result), [result]);
  const family = CHART_FAMILY[type];
  const rowCount = result.rows.length;
  const issues = useMemo(
    () => chartIssues(type, model, rowCount), [type, model, rowCount],
  );
  const blocked = issues.some(blocksDrawing);
  // Four shapes label their rows down the left-hand side rather than along the bottom --
  // a horizontal bar, a schedule, a box plot, a heatmap -- and 56px of gutter does not
  // hold a branch name. `wantsWideGutter` knows the first three; the heatmap is asked for
  // by family here because its rows are a second dimension rather than a category axis.
  const box = frameBox(width, height, wantsWideGutter(type) || family === 'HEATMAP');

  const toggle = useCallback((label: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  /** A category index turned into the value the server grouped on. Undefined when the
   *  result has no dimension to name, which leaves the marks non-interactive. */
  const pick = useMemo(() => {
    const column = model.categoryColumn;
    if (!onSelect || !column) return undefined;
    return (index: number) => {
      const cat = model.categories[index];
      if (cat) onSelect({ column, value: cat.raw, label: cat.label });
    };
  }, [onSelect, model]);

  /** A scatter point is a row rather than a category, so it arrives as the value itself
   *  and gets paired with the first dimension here. */
  const pickPoint = useMemo(() => {
    const column = model.dimensions[0];
    if (!onSelect || !column) return undefined;
    return (value: BiScalar, label: string) => onSelect({ column, value, label });
  }, [onSelect, model]);

  const legendOn = LEGEND_FAMILIES.has(family) && type !== 'BULLET';
  const shared = { type, model, box, hidden, onHover: setHover, onSelect: pick };
  const notes = issues.map((issue) => (
    <IssueLine key={`${issue.kind}-${'label' in issue ? issue.label : ''}`} issue={issue} />
  ));

  // TABLE and PIVOT are results rather than drawings, and the grid is their renderer.
  // Falling through to the cartesian family would draw bars for the two types whose
  // whole point is that the reader wanted the numbers.
  if (family === 'TABLE') {
    return (
      <div className="w-full">
        {!blocked && (
          <BiResultTable
            result={result}
            datasetId={datasetId}
            filters={filters}
            onDrillDown={onSelect
              ? (column, value) => onSelect({ column, value, label: formatCell(value, column) })
              : undefined}
          />
        )}
        {notes}
      </div>
    );
  }

  return (
    <div ref={hostRef} className="relative w-full">
      {!blocked && width > 0 && (
        <svg
          width={width} height={height}
          role="group"
          aria-label={`${chartLabels[type]} — ${rowCount} ${t('صف', 'lignes', 'rows')}`}
          className="block max-w-full"
        >
          <ChartBody
            family={family} shared={shared} result={result}
            onPick={pickPoint} onDrill={onSelect}
          />
        </svg>
      )}
      {notes}
      {legendOn && !blocked && (
        <ChartLegend series={model.series} hidden={hidden} onToggle={toggle} />
      )}
      {hover && !blocked && <ChartTooltip hover={hover} width={width} />}
    </div>
  );
}

/**
 * Which of the seven renderers draws this family.
 *
 * Separate from `BiChart` so that file holds the wiring and this one holds the dispatch:
 * the family decision is a single fact, and spelling it as nested ternaries inside the
 * component put every branch's condition into the parent's complexity budget without
 * making either half easier to read.
 *
 * Two families need more than the plot model. The matrix one takes the rows, because a
 * scatter point is a row rather than a category and folding the pair into a category axis
 * would lose the pairing that is the whole chart. The four newest ones -- schedule, tree,
 * flow, graph -- take the whole result and read it themselves, because each nests or spans
 * in a way a flat list of categories cannot hold.
 */
function ChartBody({ family, shared, result, onPick, onDrill }: {
  family: ChartFamily;
  shared: RadialProps;
  result: BiQuerySuccess;
  onPick?: (value: BiScalar, label: string) => void;
  /** The column-aware drill. Every renderer above this line filters on the first
   *  dimension, which is the only one a category axis has. The four below it each name
   *  their own: a schedule's is the first non-temporal dimension, a tree node's changes
   *  with its depth, and a flow node's is the `from` column on one side of the diagram
   *  and the `to` column on the other. So they are handed the selection callback itself
   *  rather than an index that would name the wrong field. */
  onDrill?: (selection: BiChartSelection) => void;
}) {
  const { type, model, box, onHover, onSelect } = shared;
  if (family === 'HEATMAP' || family === 'TREEMAP' || family === 'SCATTER') {
    return (
      <BiChartMatrix
        type={type} model={model} result={result} box={box}
        onHover={onHover} onSelect={onSelect} onPick={onPick}
      />
    );
  }
  if (family === 'SCHEDULE') {
    return (
      <BiChartSchedule result={result} box={box} onHover={onHover} onDrill={onDrill} />
    );
  }
  if (family === 'TREE') {
    return (
      <BiChartTree
        type={type} result={result} box={box} onHover={onHover} onDrill={onDrill}
      />
    );
  }
  if (family === 'FLOW' || family === 'GRAPH') {
    return (
      <BiChartFlow
        type={type} result={result} box={box} onHover={onHover} onDrill={onDrill}
      />
    );
  }
  if (family === 'BOX' || family === 'FORECAST') {
    return <BiChartDistribution {...shared} />;
  }
  if (family === 'KPI' || family === 'GAUGE' || family === 'PIE'
    || family === 'FUNNEL' || family === 'RADAR') {
    return <BiChartRadial {...shared} />;
  }
  return <BiChartCartesian {...shared} />;
}

/**
 * One issue, as a sentence.
 *
 * PENDING names the chart type, which is the whole point of having the state: "Sankey is
 * not drawn in this build" is a fact the author can act on, where a table appearing in
 * place of the diagram they picked looks like the tool disagreeing with them silently.
 */
function IssueLine({ issue }: { issue: ChartIssue }) {
  const { t } = useBiI18n();
  const labels = useBiChartLabels();

  if (issue.kind === 'PENDING') {
    const name = labels[issue.chartType];
    return (
      <InlineNote tone="info">
        {t(`${name}: غير مرسوم في هذه النسخة`,
          `${name} : pas encore dessiné dans cette version`,
          `${name}: not drawn in this build yet`)}
      </InlineNote>
    );
  }
  if (issue.kind === 'EMPTY') {
    return (
      <InlineNote tone="neutral">
        {t('لم يُرجع الاستعلام أي صفوف', 'La requête n’a renvoyé aucune ligne', 'The query returned no rows')}
      </InlineNote>
    );
  }
  if (issue.kind === 'NEEDS_DIMENSION') {
    return (
      <InlineNote>
        {t(`يحتاج هذا الرسم إلى ${issue.need} بعد على الأقل، والنتيجة تحتوي ${issue.have}`,
          `Ce graphique demande ${issue.need} dimension(s), le résultat en a ${issue.have}`,
          `This chart needs ${issue.need} dimension(s); the result has ${issue.have}`)}
      </InlineNote>
    );
  }
  if (issue.kind === 'NEEDS_MEASURE') {
    return (
      <InlineNote>
        {t(`يحتاج هذا الرسم إلى ${issue.need} قياس على الأقل، والنتيجة تحتوي ${issue.have}`,
          `Ce graphique demande ${issue.need} mesure(s), le résultat en a ${issue.have}`,
          `This chart needs ${issue.need} measure(s); the result has ${issue.have}`)}
      </InlineNote>
    );
  }
  // Named as a date rather than as a count, because this is the one requirement no extra
  // column can satisfy: a Gantt places its bars along real time, and a schedule of text
  // categories has nothing to place them on.
  if (issue.kind === 'NEEDS_TEMPORAL') {
    return (
      <InlineNote>
        {t('يحتاج هذا الرسم إلى بعد زمني (تاريخ أو حبيبة زمنية)، ولا يوجد في النتيجة',
          'Ce graphique demande une dimension temporelle (date ou granularité) ; le résultat n’en a aucune',
          'This chart needs a time dimension (a date or a grain); the result has none')}
      </InlineNote>
    );
  }
  return (
    <InlineNote>
      {t(`${issue.label} غير قابل للجمع، والتكديس يجمعه`,
        `${issue.label} n’est pas additive, et l’empilement la somme`,
        `${issue.label} is not additive, and stacking sums it`)}
    </InlineNote>
  );
}

