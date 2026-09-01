/**
 * The two edge-shaped charts: SANKEY and DEPENDENCY_GRAPH.
 *
 * One component for both, because the geometry is the only thing that differs -- a sankey
 * draws filled ribbons between magnitude-sized bars, a graph draws stroked curves between
 * labelled boxes -- while the interaction that makes either of them worth having is the
 * same one: pick a node and see the chain it belongs to. That gesture answers "where does
 * this end up" on a flow and "what breaks if this changes" on a dependency graph, and both
 * are `reachable` in the two directions.
 *
 * Everything else here is restraint. Hover explains, click traces, and nothing else moves:
 * a diagram that re-dims itself under the pointer flickers as the mouse crosses it, and a
 * reader trying to follow one ribbon across four levels is the person that costs.
 *
 * Back edges are drawn and counted rather than dropped, so a circular model looks circular.
 */
import { useCallback, useMemo, useState } from 'react';
import type { BiChartType, BiQuerySuccess } from '@/types/bi';
import { fmtInt, formatMetricValue, useBiI18n, type MetricDisplay } from './biFormat';
import { splitColumns, type BiChartSelection, type FrameBox } from './biChartData';
import {
  graphLayout, linksTouching, reachable, sankeyLayout,
  type FlowLink, type FlowModel, type FlowNode,
} from './biFlowLayout';
import { Mark, type HoverInfo } from './BiChartFrame';

export interface FlowProps {
  type: BiChartType;
  result: BiQuerySuccess;
  box: FrameBox;
  /** The full selection rather than a category index: a node's dimension is the `from`
   *  column on one side of the diagram and the `to` column on the other, so the first
   *  dimension the other renderers assume would name the wrong field on half the nodes. */
  onDrill?: (selection: BiChartSelection) => void;
  onHover: (info: HoverInfo | null) => void;
}

const NOTE = 'fill-[var(--text-secondary)] text-[10px]';

/** The headline sits in the top padding and the note in the bottom, so the diagram itself
 *  gets everything between them. A flow has no axis to letter, which is why these are the
 *  only two reservations made. */
const PAD_X = 8;
const PAD_TOP = 18;
const PAD_BOTTOM = 16;

/** Roughly one character at the 10px label size. SVG text cannot be measured without a
 *  DOM, so labels are cut against an estimate. */
const CH = 5.6;
const cut = (text: string, px: number): string => {
  const max = Math.max(1, Math.floor(px / CH));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
};

/** What the traced chain covers, and how big it turned out to be. */
interface Lit {
  /** In the chain. True for everything when nothing is focused, which is what keeps the
   *  unfocused diagram from having to know whether it is dimmed. */
  node: (id: string) => boolean;
  link: (link: FlowLink) => boolean;
  down: number;
  up: number;
  /** The focus can reach itself, so it sits on a cycle. Worth saying out loud on a
   *  dependency graph, where it is the finding rather than a detail. */
  loop: boolean;
}

const ALL: Lit = { node: () => true, link: () => true, down: 0, up: 0, loop: false };

/**
 * The chain a focused node belongs to: everything it reaches, everything that reaches it.
 *
 * A link is in the chain when both of its ends are. That admits an edge between an upstream
 * node and a downstream one that bypasses the focus entirely -- and it should, because both
 * of its ends are things the focus is tangled with, and the question a reader clicks a node
 * to ask is which part of the diagram this one is involved in.
 */
function useLit(model: FlowModel, focusId: string | null): Lit {
  return useMemo(() => {
    if (focusId === null) return ALL;
    const down = reachable(model.links, focusId, 'DOWNSTREAM');
    const up = reachable(model.links, focusId, 'UPSTREAM');
    const chain = new Set<string>([focusId, ...down, ...up]);
    return {
      node: (id) => chain.has(id),
      link: (link) => chain.has(link.from) && chain.has(link.to),
      down: down.size,
      up: up.size,
      loop: down.has(focusId),
    };
  }, [model.links, focusId]);
}
/* -------------------------------------------------------------------------- */
/* The diagram                                                                */
/* -------------------------------------------------------------------------- */

export function BiChartFlow({ type, result, box, onHover, onDrill }: FlowProps) {
  const { t, isAr } = useBiI18n();
  const graph = type === 'DEPENDENCY_GRAPH';
  const w = Math.max(40, box.width - PAD_X * 2);
  const h = Math.max(40, box.height - PAD_TOP - PAD_BOTTOM);
  // The layouts take a bare rectangle rather than the frame, because a flow has no axis to
  // letter and a gutter would be blank space taken off the only thing on screen. So the
  // geometry comes back at the origin and is moved into place once, below.
  const model = useMemo(
    () => (graph ? graphLayout(result, w, h) : sankeyLayout(result, w, h)),
    [graph, result, w, h]);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Resolved against the current model rather than trusted. A re-query that stopped
  // returning that group would otherwise leave the whole diagram dimmed around a node
  // that is no longer on it.
  const focus = useMemo(
    () => model.nodes.find((node) => node.id === focusId) ?? null,
    [model.nodes, focusId]);
  const lit = useLit(model, focus?.id ?? null);
  const byId = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes]);
  const measureName = useMemo(() => {
    const measure = splitColumns(result.columns).measures[0];
    if (measure === undefined) return t('القيمة', 'Valeur', 'Value');
    return (isAr && measure.label_ar) ? measure.label_ar : measure.label;
  }, [result.columns, isAr, t]);

  // Tooltip coordinates are the frame's and the geometry's are the diagram's. Reconciled
  // here, once, so that no mark has to remember the offset it was drawn at.
  const hoverAt = useCallback((info: HoverInfo | null) => {
    onHover(info === null ? null : { ...info, x: info.x + PAD_X, y: info.y + PAD_TOP });
  }, [onHover]);

  const toggle = useCallback((node: FlowNode) => {
    setFocusId((prev) => (prev === node.id ? null : node.id));
  }, []);

  if (model.nodes.length === 0) return <Empty box={box} />;
  return (
    <>
      <Headline focus={focus} lit={lit} box={box} onClear={() => setFocusId(null)} />
      {/* Links first, so a node is never drawn underneath the ribbon that reaches it. */}
      <g transform={`translate(${PAD_X},${PAD_TOP})`}>
        {model.links.map((link) => {
          const a = byId.get(link.from);
          const b = byId.get(link.to);
          // A link whose ends are not both on the diagram cannot be placed. The layouts
          // build their nodes from their links, so this is a type narrowing rather than a
          // case that happens.
          if (a === undefined || b === undefined) return null;
          return (
            <LinkMark
              key={link.id}
              link={link}
              a={a}
              b={b}
              graph={graph}
              lit={lit.link(link)}
              display={model.display}
              measureName={measureName}
              onHover={hoverAt}
            />
          );
        })}
        {model.nodes.map((node) => (
          <NodeMark
            key={node.id}
            node={node}
            graph={graph}
            lit={lit.node(node.id)}
            focused={focus?.id === node.id}
            links={model.links}
            display={model.display}
            measureName={measureName}
            width={w}
            onSelect={() => toggle(node)}
            onHover={hoverAt}
            onDrill={onDrill}
          />
        ))}
      </g>
      <FlowNote model={model} box={box} />
    </>
  );
}
/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One edge: a filled ribbon on a sankey, a stroked curve on a graph.
 *
 * The same `path` string either way, because the layout closed the sankey's and left the
 * graph's open -- so all that differs here is which attribute it is handed to. A back edge
 * is dashed: on a dependency graph it is the thing that means "this model is circular", and
 * a reader should be able to find it without following every curve to its end.
 *
 * Hover, and no click. A link is a pair of nodes and there is no third value to filter on,
 * so it explains itself and leaves the clicking to the nodes at its ends.
 */
function LinkMark({ link, a, b, graph, lit, display, measureName, onHover }: {
  link: FlowLink;
  a: FlowNode;
  b: FlowNode;
  graph: boolean;
  lit: boolean;
  display: MetricDisplay;
  measureName: string;
  onHover: (info: HoverInfo | null) => void;
}) {
  const { t } = useBiI18n();
  const valueText = formatMetricValue(link.value, display);
  const title = `${a.label} → ${b.label}`;
  const rows = [
    { label: measureName, value: valueText, color: a.color },
    { label: t('صفوف', 'Lignes', 'Rows'), value: fmtInt(link.rows) },
    ...(link.back
      ? [{ label: t('اتجاه', 'Sens', 'Direction'), value: t('عكسي', 'Retour', 'Back edge') }]
      : []),
  ];
  // Between the two nodes rather than on the curve: a back edge bows away from this point,
  // and a tooltip that chases the geometry is harder to read than one that sits between the
  // two things it is about.
  const x = (a.x + a.width + b.x) / 2;
  const y = (a.y + a.height / 2 + b.y + b.height / 2) / 2;

  return (
    <Mark
      label={`${title}, ${measureName}: ${valueText}`}
      onHover={() => onHover({ x, y, title, rows })}
      onLeave={() => onHover(null)}
    >
      <path
        d={link.path}
        fill={graph ? 'none' : a.color}
        fillOpacity={graph ? undefined : (lit ? 0.3 : 0.07)}
        stroke={graph ? a.color : 'none'}
        strokeOpacity={graph ? (lit ? 0.75 : 0.12) : undefined}
        strokeWidth={graph ? 1.5 : undefined}
        strokeDasharray={link.back ? '4 3' : undefined}
      />
    </Mark>
  );
}
/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

const sum = (links: readonly FlowLink[]): number =>
  links.reduce((total, link) => total + link.value, 0);

/**
 * One node, and the two things a click on it can mean.
 *
 * The node's own gesture is tracing: a click lights the chain it belongs to and dims the
 * rest, and a second click puts the diagram back. That is the primary target, because it is
 * the question the shape exists to answer. Filtering the query on this node's value is the
 * second, and takes the smaller one -- a chevron beside the label on a sankey, where a
 * twelve-pixel bar has no room inside it, and inside the box on a graph.
 *
 * The two targets are siblings rather than nested, because a control inside a control is one
 * element with two meanings to a screen reader.
 */
function NodeMark({
  node, graph, lit, focused, links, display, measureName, width, onSelect, onHover, onDrill,
}: {
  node: FlowNode;
  graph: boolean;
  lit: boolean;
  focused: boolean;
  links: readonly FlowLink[];
  display: MetricDisplay;
  measureName: string;
  /** The diagram's width, which decides whether a sankey label goes to the left or the
   *  right of its bar. */
  width: number;
  onSelect: () => void;
  onHover: (info: HoverInfo | null) => void;
  onDrill?: (selection: BiChartSelection) => void;
}) {
  const { t } = useBiI18n();
  const valueText = formatMetricValue(node.value, display);
  const ends = useMemo(() => {
    const touching = linksTouching(links, node.id);
    return {
      into: touching.filter((link) => link.to === node.id),
      out: touching.filter((link) => link.from === node.id),
    };
  }, [links, node.id]);
  // Two shapes, two questions. Beside a sankey node a reader wants how much arrives and how
  // much leaves, since the gap between them is what it keeps; beside a graph node the counts
  // are the finding.
  const rows = [
    { label: measureName, value: valueText, color: node.color },
    ...(graph ? [
      { label: t('يعتمد على', 'Dépend de', 'Depends on'), value: fmtInt(ends.into.length) },
      { label: t('يعتمد عليه', 'Requis par', 'Required by'), value: fmtInt(ends.out.length) },
    ] : [
      { label: t('داخل', 'Entrant', 'In'), value: formatMetricValue(sum(ends.into), display) },
      { label: t('خارج', 'Sortant', 'Out'), value: formatMetricValue(sum(ends.out), display) },
    ]),
  ];
  // Hoisted so the closure below narrows them: a destructured parameter does not keep its
  // narrowing inside an arrow function, and a local const does.
  const drillTo = onDrill;
  const raw = node.raw;
  const column = node.column;
  const drill = drillTo && raw !== null
    ? () => drillTo({ column, value: raw, label: node.label })
    : undefined;
  const leftSide = node.x + node.width / 2 <= width / 2;
  const gap = drill ? 17 : 3;
  const labelX = graph ? node.x + 8 : (leftSide ? node.x + node.width + gap : node.x - gap);
  const labelW = graph
    ? node.width - 16 - (drill ? 14 : 0)
    : (leftSide ? width - node.x - node.width - gap - 2 : node.x - gap - 2);
  const glyphX = graph
    ? node.x + node.width - 17
    : (leftSide ? node.x + node.width + 2 : node.x - 16);
  const twoLine = graph && node.height >= 24;
  // A label taller than the bar it names collides with its neighbours', and a sankey level
  // can hold a great many thin bars. Under nine pixels the tooltip is the label.
  const showLabel = graph || node.height >= 9;
  return (
    <>
      <Mark
        label={[node.label, ...rows.map((row) => `${row.label}: ${row.value}`)].join(', ')}
        onSelect={onSelect}
        onHover={() => onHover({
          x: node.x + node.width / 2, y: node.y, title: node.label, rows,
        })}
        onLeave={() => onHover(null)}
      >
        {/* Dimming the group rather than each shape, so a node and its label leave the
            traced chain together. */}
        <g opacity={lit ? 1 : 0.25}>
          <rect
            x={node.x} y={node.y} width={node.width} height={node.height}
            rx={graph ? 4 : 2}
            fill={graph ? 'var(--bg-subtle)' : node.color}
            stroke={focused ? 'var(--accent)' : (graph ? 'var(--border)' : 'none')}
            strokeWidth={focused ? 1.5 : 1}
          />
          {/* A graph box is the colour of the surface, so its series colour goes on the
              leading edge -- which is also where the eye lands following a wire in. */}
          {graph && (
            <rect x={node.x} y={node.y} width={2.5} height={node.height} fill={node.color} />
          )}
          {showLabel && (twoLine ? (
            <>
              <text x={labelX} y={node.y + node.height / 2 - 2} className={NOTE}>
                {cut(node.label, labelW)}
              </text>
              <text
                x={labelX} y={node.y + node.height / 2 + 9}
                className="fill-[var(--text-primary)] text-[10px] font-semibold"
              >
                {valueText}
              </text>
            </>
          ) : (
            <text
              x={labelX} y={node.y + node.height / 2 + 3.5}
              textAnchor={(graph || leftSide) ? 'start' : 'end'}
              className={NOTE}
            >
              {cut(node.label, labelW)}
            </text>
          ))}
        </g>
      </Mark>
      {drill && showLabel && (
        // Painted after the node, so it takes the click in the fourteen pixels it covers
        // and the node keeps the rest. A bar too thin to label is too thin to aim at, which
        // is why this rides on the same condition.
        <Mark
          label={`${t('تصفية على', 'Filtrer sur', 'Filter on')} ${node.label}: ${valueText}`}
          onSelect={drill}
          onHover={() => onHover({ x: glyphX + 7, y: node.y, title: node.label, rows })}
          onLeave={() => onHover(null)}
        >
          <rect
            x={glyphX} y={node.y + node.height / 2 - 7} width={14} height={14}
            fill="transparent"
          />
          <path
            d={`M${(glyphX + 4).toFixed(2)},${(node.y + node.height / 2 - 3.5).toFixed(2)} l4,3.5 l-4,3.5`}
            fill="none" className="stroke-[var(--text-muted)]" strokeWidth={1.4}
          />
        </Mark>
      )}
    </>
  );
}
/* -------------------------------------------------------------------------- */
/* Headline and notes                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What is traced, and how to stop tracing it.
 *
 * The unfocused state says what the click does. A diagram whose one real interaction has to
 * be discovered by accident is one most readers never find, and the top padding is empty
 * anyway. Once something is focused the same line carries the chain's size -- how many nodes
 * feed it, how many it feeds -- and doubles as the way out.
 */
function Headline({ focus, lit, box, onClear }: {
  focus: FlowNode | null;
  lit: Lit;
  box: FrameBox;
  onClear: () => void;
}) {
  const { t } = useBiI18n();
  if (focus === null) {
    return (
      <text x={PAD_X} y={10} className="fill-[var(--text-muted)] text-[10px]">
        {t('اختر عقدة لتتبّع سلسلتها',
          'Cliquez un nœud pour tracer sa chaîne',
          'Click a node to trace its chain')}
      </text>
    );
  }
  const counts = [
    `↑ ${fmtInt(lit.up)}`,
    `↓ ${fmtInt(lit.down)}`,
    // Reachable from itself, which on a dependency graph is the finding and not a detail.
    ...(lit.loop ? [t('حلقة', 'cycle', 'cycle')] : []),
  ];
  return (
    <Mark
      label={`${t('أزل التحديد', 'Effacer la sélection', 'Clear selection')}: ${focus.label}`}
      onSelect={onClear}
    >
      <text x={PAD_X} y={10} className="fill-[var(--text-primary)] text-[10px] font-semibold">
        {`✕ ${cut(focus.label, Math.max(40, box.width - 160))} · ${counts.join(' · ')}`}
      </text>
    </Mark>
  );
}
/**
 * The two things the drawing cannot show.
 *
 * Back edges are on screen, dashed, but a reader scanning a wide graph should not have to
 * find them to learn that there are any -- and on a sankey, where the layout produces none,
 * the line simply does not appear. Rows with no measure are the other: they are in no node
 * and no ribbon, so the totals here are short of the result by exactly this many.
 *
 * A non-additive measure is not mentioned. FLOW and GRAPH are both families `chartIssues`
 * treats as summing their values, so that warning is already above the frame, and one caveat
 * printed twice on one tile reads as two different caveats.
 */
function FlowNote({ model, box }: { model: FlowModel; box: FrameBox }) {
  const { t } = useBiI18n();
  const parts = [
    ...(model.cycles > 0
      ? [t(`${fmtInt(model.cycles)} حافة عكسية (اعتماد دائري)`,
          `${fmtInt(model.cycles)} arêtes de retour (dépendance circulaire)`,
          `${fmtInt(model.cycles)} back edges (circular dependency)`)]
      : []),
    ...(model.skipped > 0
      ? [t(`${fmtInt(model.skipped)} صف بلا قيمة، مستبعدة`,
          `${fmtInt(model.skipped)} lignes sans valeur, exclues`,
          `${fmtInt(model.skipped)} rows with no value, left out`)]
      : []),
  ];
  if (parts.length === 0) return null;
  return <text x={4} y={box.height - 4} className={NOTE}>{parts.join(' · ')}</text>;
}

/** Nothing to draw. Both shapes are made of edges, so a result whose rows all pair a value
 *  with itself, or carry no measure at all, has no diagram in it -- said plainly rather than
 *  drawn as an empty frame. */
function Empty({ box }: { box: FrameBox }) {
  const { t } = useBiI18n();
  return (
    <text
      x={box.width / 2} y={box.height / 2} textAnchor="middle"
      className="fill-[var(--text-muted)] text-[12px]"
    >
      {t('لا روابط لرسمها', 'Aucun lien à tracer', 'No links to draw')}
    </text>
  );
}
