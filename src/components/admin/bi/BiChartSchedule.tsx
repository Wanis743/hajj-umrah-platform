/**
 * GANTT: the schedule, drawn from whatever the query returned.
 *
 * The only chart in this folder whose x axis is a clock rather than a category band, which
 * is why it does not use CategoryAxisX: its ticks sit at instants, evenly spaced in time,
 * and a band axis would place them at row boundaries instead -- putting `2026-03-01`
 * wherever the third bar happened to start.
 *
 * Two things are printed on the face of it, both because the reader cannot otherwise tell.
 * A derived schedule -- one date column grouped into min..max spans -- says so, since "when
 * this was active" and "when this was scheduled" are different claims and only the second
 * is a schedule. And a bar standing for more than one row prints its row count, because a
 * bar over four hundred rows and a bar over one are drawn identically.
 */
import { useMemo } from 'react';
import type { BiQuerySuccess } from '@/types/bi';
import { formatMetricValue, useBiI18n } from './biFormat';
import {
  plotHeight, plotWidth, valueX,
  type BiChartSelection, type FrameBox, type PlotDomain,
} from './biChartData';
import { ganttLayout, ganttModel, ganttTicks, type GanttGeometry } from './biChartStats';
import { CategoryAxisY, Mark, type HoverInfo } from './BiChartFrame';

export interface ScheduleProps {
  result: BiQuerySuccess;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  /** The full selection rather than a category index: a bar's drill column is the first
   *  non-temporal dimension, which is not necessarily the first dimension, so the index
   *  the other renderers pass would name the wrong field. */
  onDrill?: (selection: BiChartSelection) => void;
}

const AXIS = 'fill-[var(--text-muted)] text-[10px]';
const NOTE = 'fill-[var(--text-secondary)] text-[10px]';
const DAY = 86_400_000;

export function BiChartSchedule({ result, box, onHover, onDrill }: ScheduleProps) {
  const { t } = useBiI18n();
  const model = useMemo(() => ganttModel(result), [result]);
  const geometry = useMemo(() => ganttLayout(model, box), [model, box]);
  const domain: PlotDomain = { min: model.min, max: model.max };
  const now = Date.now();
  /** Hoisted so the closure below narrows it. A bar's drill column is a property of the
   *  result, not of the bar, so asking once is also the honest number of times to ask. */
  const drillColumn = model.labelColumn;

  if (model.bars.length === 0) {
    return (
      <text x={box.left} y={box.top + plotHeight(box) / 2} className={NOTE}>
        {t('لا مدى زمني صالح في النتيجة',
          'Aucune période exploitable dans le résultat',
          'No usable period in the result')}
      </text>
    );
  }

  return (
    <>
      {ganttTicks(model.min, model.max).map((tick) => {
        const x = valueX(tick.at, domain, box);
        return (
          <g key={tick.at}>
            <line
              x1={x} x2={x} y1={box.top} y2={box.top + plotHeight(box)}
              stroke="var(--border-subtle)" strokeWidth={1}
            />
            <text x={x} y={box.top + plotHeight(box) + 14} textAnchor="middle" className={AXIS}>
              {tick.label}
            </text>
          </g>
        );
      })}
      <CategoryAxisY box={box} labels={model.bars.map((bar) => bar.label)} />
      {/* Today, only when today is inside the span the query returned. A marker pinned to
          the edge of a schedule that ended in 2019 is not information about the schedule. */}
      {now > model.min && now < model.max && (
        <>
          <line
            x1={valueX(now, domain, box)} x2={valueX(now, domain, box)}
            y1={box.top} y2={box.top + plotHeight(box)}
            stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="3 3"
          />
          <text
            x={valueX(now, domain, box)} y={box.top - 3} textAnchor="middle" className={AXIS}
          >
            {t('اليوم', 'aujourd’hui', 'today')}
          </text>
        </>
      )}
      {geometry.map((g) => (
        <BarMark
          key={`${g.bar.index}-${g.bar.label}`} geometry={g} box={box}
          onHover={onHover}
          onSelect={onDrill && drillColumn
            ? () => onDrill({ column: drillColumn, value: g.bar.raw, label: g.bar.label })
            : undefined}
        />
      ))}
      <ScheduleNote
        derived={model.derived} skipped={model.skipped} bars={model.bars.length} box={box}
      />
    </>
  );
}

/**
 * One bar, or one diamond where the span is zero.
 *
 * The shape carries the distinction rather than the tooltip: a milestone drawn as a
 * two-pixel bar is a bar the reader will read as a very short duration, and a schedule
 * whose milestones are invisible is the schedule they will plan against anyway.
 */
function BarMark({ geometry, box, onHover, onSelect }: {
  geometry: GanttGeometry;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  onSelect?: () => void;
}) {
  const { t } = useBiI18n();
  const { bar, cy, thick, x1, x2, milestone } = geometry;
  const half = thick / 2;
  const rows = [
    { label: t('من', 'Début', 'Start'), value: isoOf(bar.start), color: bar.color },
    { label: t('إلى', 'Fin', 'End'), value: isoOf(bar.end) },
    ...(milestone
      ? [{ label: t('نوع', 'Type', 'Type'), value: t('لحظة', 'jalon', 'milestone') }]
      : [{ label: t('المدة', 'Durée', 'Duration'), value: spanText(bar.end - bar.start, t) }]),
    ...(bar.value !== null
      ? [{ label: t('القياس', 'Mesure', 'Measure'), value: formatMetricValue(bar.value, bar.display) }]
      : []),
    ...(bar.rows > 1
      ? [{ label: t('صفوف', 'lignes', 'rows'), value: String(bar.rows) }]
      : []),
  ];

  return (
    <Mark
      label={`${bar.label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}
      onSelect={onSelect}
      onHover={() => onHover({ x: x1, y: cy - half, title: bar.label, rows })}
      onLeave={() => onHover(null)}
    >
      {milestone ? (
        <path
          d={`M${x1} ${cy - half}L${x1 + half} ${cy}L${x1} ${cy + half}L${x1 - half} ${cy}Z`}
          fill={bar.color} fillOpacity={0.85} stroke={bar.color} strokeWidth={1.5}
        />
      ) : (
        <rect
          x={x1} y={cy - half} width={Math.max(2, x2 - x1)} height={thick}
          fill={bar.color} fillOpacity={0.72} stroke={bar.color} strokeWidth={1} rx={3}
        />
      )}
      {bar.rows > 1 && x2 + 26 < box.left + plotWidth(box) && (
        <text x={x2 + 4} y={cy + 3} className={AXIS}>{`×${bar.rows}`}</text>
      )}
    </Mark>
  );
}

/** What the drawing is, and what it left out. One line, bottom left, in the same place
 *  every other chart in this folder puts the rows it could not place. */
function ScheduleNote({ derived, skipped, bars, box }: {
  derived: boolean; skipped: number; bars: number; box: FrameBox;
}) {
  const { t } = useBiI18n();
  const parts = [
    derived
      ? t(`${bars} مدى مشتق من عمود تاريخ واحد`,
        `${bars} période(s) dérivée(s) d’une seule colonne de date`,
        `${bars} span(s) derived from one date column`)
      : t(`${bars} مدى من عمودي بداية ونهاية`,
        `${bars} période(s) depuis une colonne de début et une de fin`,
        `${bars} span(s) from a start and an end column`),
    ...(skipped > 0
      ? [t(`${skipped} صف بلا تاريخ صالح`,
        `${skipped} ligne(s) sans date exploitable`,
        `${skipped} row(s) with no usable date`)]
      : []),
  ];
  return <text x={box.left} y={box.height - 4} className={NOTE}>{parts.join(' · ')}</text>;
}

/** A day-precision instant. ISO on purpose: a tick whose width changes with the interface
 *  language reflows the frame, and the same argument applies inside the tooltip. */
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A duration in the largest unit that does not round to nothing. */
function spanText(ms: number, t: (ar: string, fr: string, en: string) => string): string {
  if (ms >= DAY) {
    const days = ms / DAY;
    const shown = days < 10 ? days.toFixed(1) : String(Math.round(days));
    return `${shown} ${t('يوم', 'jours', 'days')}`;
  }
  const hours = ms / 3_600_000;
  return `${hours < 10 ? hours.toFixed(1) : String(Math.round(hours))} ${t('ساعة', 'heures', 'hours')}`;
}
