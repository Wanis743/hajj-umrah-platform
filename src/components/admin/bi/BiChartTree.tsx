/**
 * The two trees: DECOMPOSITION_TREE and DRIVER_TREE.
 *
 * One model in ./biTreeModel, two interactions here, because what separates these charts
 * is the question and not the arithmetic. A decomposition keeps the whole chain from the
 * total to the leaf on screen and adds a column per click; a driver tree throws the chain
 * away, makes the clicked node the total, and leaves a breadcrumb as the only way back.
 *
 * Three things are printed rather than assumed. A rollup of a non-additive metric says so,
 * because every card above the leaves is then a sum of numbers that do not sum. Rows with
 * no measure are counted rather than folded in as zero. And the tail of a wide level
 * arrives as one "+k" card, so what is on screen still adds up to the number above it.
 *
 * Both trees drill, and neither can use the category index the other renderers pass: a
 * node's dimension is a property of its depth, so the column travels with the selection.
 */
import { useCallback, useMemo, useState } from 'react';
import type { BiChartType, BiQuerySuccess, BiResultColumn } from '@/types/bi';
import { fmtInt, formatMetricValue, useBiI18n, type MetricDisplay } from './biFormat';
import {
  HEAT_DOWN, HEAT_UP, colorAt, type BiChartSelection, type FrameBox,
} from './biChartData';
import {
  buildTree, expandedChain, nodeAt, pathOf, treeLayout,
  type TreeCard, type TreeColumn, type TreeModel, type TreeNode,
} from './biTreeModel';
import { Mark, type HoverInfo } from './BiChartFrame';

export interface TreeProps {
  type: BiChartType;
  result: BiQuerySuccess;
  box: FrameBox;
  onHover: (info: HoverInfo | null) => void;
  /** The full selection rather than a category index: a node's dimension changes with
   *  its depth, so the first dimension the other renderers assume would name the wrong
   *  field on every level but the first. */
  onDrill?: (selection: BiChartSelection) => void;
}

const AXIS = 'fill-[var(--text-muted)] text-[10px]';
const NOTE = 'fill-[var(--text-secondary)] text-[10px]';
const SHARE: MetricDisplay = { format: 'PERCENT', decimals: 1 };

/** Roughly one character at the 10px label size. SVG text cannot be measured without a
 *  DOM, so every label here is cut against an estimate -- deliberately a generous one,
 *  since a label cut one character early is tidy and one character late overlaps the
 *  number beside it. */
const CH = 5.6;

const cut = (text: string, px: number): string => {
  const max = Math.max(1, Math.floor(px / CH));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
};

/** The elbow from a parent card's trailing edge to a child's leading one: out, across at
 *  the halfway line, then in. Two right angles rather than a curve, because at this size a
 *  bezier between forty-pixel cards reads as a smudge. */
const elbow = (from: { x: number; y: number }, card: TreeCard): string => {
  const cy = (card.y + card.h / 2).toFixed(2);
  const mid = ((from.x + card.x) / 2).toFixed(2);
  return `M${from.x.toFixed(2)},${from.y.toFixed(2)} H${mid} V${cy} H${card.x.toFixed(2)}`;
};

export function BiChartTree(props: TreeProps) {
  return props.type === 'DRIVER_TREE'
    ? <Driver {...props} />
    : <Decomposition {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Decomposition                                                              */
/* -------------------------------------------------------------------------- */

/**
 * DECOMPOSITION_TREE: "what is inside this?"
 *
 * The opened path is a list of node ids rather than of indices, so a re-query that returns
 * the same groups in a different order leaves the reader where they were. Clicking the card
 * that is already open closes it, and closing truncates the path -- everything to the right
 * of it was the children of what was just closed, and would otherwise be orphaned columns.
 */
function Decomposition({ result, box, onHover, onDrill }: TreeProps) {
  const { isAr } = useBiI18n();
  const model = useMemo(() => buildTree(result), [result]);
  const [path, setPath] = useState<readonly string[]>([]);
  const chain = useMemo(() => expandedChain(model.root, path), [model.root, path]);
  const columns = useMemo(() => treeLayout(chain, box), [chain, box]);

  const toggle = useCallback((level: number, node: TreeNode) => {
    setPath((prev) => (prev[level - 1] === node.id
      ? prev.slice(0, level - 1)
      : [...prev.slice(0, level - 1), node.id]));
  }, []);

  if (model.root.children.length === 0) return <Empty box={box} />;

  return (
    <>
      <LevelHeads columns={columns} levels={model.levels} isAr={isAr} />
      {columns.map((column, level) => (
        <Level
          key={`dc-${level}`}
          column={column}
          model={model}
          // Coloured by position in the level, which is position by magnitude: the biggest
          // child of every parent gets the same colour, so the eye can follow "the largest
          // thing" across the columns without reading a number.
          colorOf={(card, index) => (card.node.remainder ? 'var(--text-muted)' : colorAt(index))}
          onOpen={level === 0 ? undefined : (node) => toggle(level, node)}
          onHover={onHover}
          onDrill={onDrill}
        />
      ))}
      <TreeNote model={model} box={box} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * DRIVER_TREE: "what moved this?"
 *
 * Two columns and never more: the node in focus, and what feeds it. Nothing above the focus
 * is drawn, because the question is about what is underneath this number rather than where
 * it sits, and a chart that answers both at once answers neither clearly. The breadcrumb is
 * the whole of the way back, which is why it is drawn even when it is one hop long.
 *
 * Cards are coloured by sign rather than by position. On a driver tree the interesting cell
 * is the one going the other way, and a level of eight where one is negative should not need
 * the reader to check eight numbers to find it.
 */
function Driver({ result, box, onHover, onDrill }: TreeProps) {
  const model = useMemo(() => buildTree(result), [result]);
  const [rootId, setRootId] = useState<string | null>(null);
  // Falls back to the total when the id has gone, which is what a re-query that stopped
  // returning that group leaves behind. The alternative is an empty frame around a node
  // that no longer exists.
  const focus = useMemo(
    () => (rootId === null ? model.root : nodeAt(model.root, rootId) ?? model.root),
    [model.root, rootId]);
  const trail = useMemo(() => pathOf(model.root, focus.id), [model.root, focus]);
  const columns = useMemo(() => treeLayout([focus], box), [focus, box]);

  if (model.root.children.length === 0) return <Empty box={box} />;

  return (
    <>
      <Breadcrumb
        trail={trail}
        box={box}
        onGo={(node) => setRootId(node.depth === 0 ? null : node.id)}
      />
      {columns.map((column, level) => (
        <Level
          key={`dr-${level}`}
          column={column}
          model={model}
          colorOf={(card) => (card.node.value < 0 ? HEAT_DOWN : HEAT_UP)}
          onOpen={level === 0 ? undefined : (node) => setRootId(node.id)}
          onHover={onHover}
          onDrill={onDrill}
        />
      ))}
      <TreeNote model={model} box={box} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared drawing                                                             */
/* -------------------------------------------------------------------------- */

/** One column: the elbows in from its parent, then the cards. Elbows first so a card is
 *  never drawn under the line that points at it. */
function Level({ column, model, colorOf, onOpen, onHover, onDrill }: {
  column: TreeColumn;
  model: TreeModel;
  colorOf: (card: TreeCard, index: number) => string;
  /** Absent on the first column, whose single card is the total: there is nothing above it
   *  to open, and a card that looks clickable and does nothing is worse than a plain one. */
  onOpen?: (node: TreeNode) => void;
  onHover: (info: HoverInfo | null) => void;
  onDrill?: (selection: BiChartSelection) => void;
}) {
  const anchor = column.anchor;
  return (
    <>
      {anchor && (
        <g aria-hidden="true">
          {column.cards.map((card) => (
            <path
              key={`e-${card.node.id}`}
              d={elbow(anchor, card)}
              fill="none"
              className="stroke-[var(--border-strong)]"
              strokeWidth={1}
            />
          ))}
        </g>
      )}
      {column.cards.map((card, index) => (
        <CardMark
          key={card.node.id}
          card={card}
          model={model}
          color={colorOf(card, index)}
          onOpen={onOpen}
          onHover={onHover}
          onDrill={onDrill}
        />
      ))}
    </>
  );
}

/**
 * One card, and the two things a click on it can mean.
 *
 * A card does the most useful thing it can: it opens when it has children, because that is
 * the chart's own gesture, and it drills when it is a leaf, because that is the only thing
 * left. A card that can do both gets a second, smaller target at its trailing edge -- drawn
 * after the card so that it, and not the card underneath it, takes the click.
 *
 * A remainder card is inert. It stands for a tail of groups rather than for one value, so
 * there is nothing to open and no cell to filter on, and making it look clickable would be
 * a promise the rest of the chart cannot keep.
 */
function CardMark({ card, model, color, onOpen, onHover, onDrill }: {
  card: TreeCard;
  model: TreeModel;
  color: string;
  onOpen?: (node: TreeNode) => void;
  onHover: (info: HoverInfo | null) => void;
  onDrill?: (selection: BiChartSelection) => void;
}) {
  const { t, isAr } = useBiI18n();
  const node = card.node;
  const total = node.depth === 0;
  const name = total ? t('الإجمالي', 'Total', 'Total') : node.label;
  const valueText = formatMetricValue(node.value, model.display);
  const measure = model.measure;
  const measureName = measure
    ? ((isAr && measure.label_ar) ? measure.label_ar : measure.label)
    : t('القيمة', 'Valeur', 'Value');
  const rows = [
    { label: measureName, value: valueText, color },
    ...(total ? [] : [{
      label: t('النسبة', 'Part', 'Share'),
      value: formatMetricValue(node.share, SHARE),
    }]),
    { label: t('صفوف', 'Lignes', 'Rows'), value: fmtInt(node.rows) },
  ];
  // Hoisted so the closures below narrow them. A destructured parameter does not keep its
  // narrowing inside an arrow function; a local const does.
  const openThis = onOpen;
  const drillTo = onDrill;
  const drillColumn = node.column;
  const raw = node.raw;
  const open = openThis && !node.remainder && node.children.length > 0
    ? () => openThis(node)
    : undefined;
  const drill = drillTo && !node.remainder && drillColumn !== null && raw !== null
    ? () => drillTo({ column: drillColumn, value: raw, label: node.label })
    : undefined;
  const tall = card.h >= 26;
  const tail = open && drill ? 20 : 8;
  const nameW = tall ? card.w - 12 - tail : card.w - 16 - tail - valueText.length * CH;

  return (
    <>
      <Mark
        label={[name, ...rows.map((r) => `${r.label}: ${r.value}`)].join(', ')}
        onSelect={open ?? drill}
        onHover={() => onHover({ x: card.x + card.w / 2, y: card.y, title: name, rows })}
        onLeave={() => onHover(null)}
      >
        <rect
          x={card.x} y={card.y} width={card.w} height={card.h} rx={4}
          className="fill-[var(--bg-subtle)]"
          stroke={card.open ? 'var(--accent)' : 'var(--border)'}
          strokeWidth={card.open ? 1.5 : 1}
        />
        {/* The share as a tint across the card rather than a bar beside it: at forty pixels
            there is no room for a second row, and a fill compared by eye is the part of a
            decomposition that survives being glanced at. */}
        <rect
          x={card.x} y={card.y} width={card.barW} height={card.h} rx={2}
          fill={color} fillOpacity={0.2}
        />
        <rect x={card.x} y={card.y} width={2.5} height={card.h} fill={color} />
        {tall ? (
          <>
            <text x={card.x + 8} y={card.y + card.h / 2 - 3} className={NOTE}>
              {cut(name, nameW)}
            </text>
            <text
              x={card.x + 8} y={card.y + card.h / 2 + 9}
              className="fill-[var(--text-primary)] text-[11px] font-semibold"
            >
              {valueText}
            </text>
          </>
        ) : (
          <>
            <text x={card.x + 8} y={card.y + card.h / 2 + 3.5} className={NOTE}>
              {cut(name, nameW)}
            </text>
            <text
              x={card.x + card.w - tail} y={card.y + card.h / 2 + 3.5} textAnchor="end"
              className="fill-[var(--text-primary)] text-[10px] font-semibold"
            >
              {valueText}
            </text>
          </>
        )}
      </Mark>
      {open && drill && (
        // The second target, for the card that can do both. A sibling rather than a child,
        // because a control inside a control is one element with two meanings to a screen
        // reader; painted after the card, so it takes the click in the fourteen pixels it
        // covers and the card keeps the rest.
        <Mark
          label={`${t('تصفية على', 'Filtrer sur', 'Filter on')} ${name}: ${valueText}`}
          onSelect={drill}
          onHover={() => onHover({ x: card.x + card.w, y: card.y, title: name, rows })}
          onLeave={() => onHover(null)}
        >
          <rect
            x={card.x + card.w - 17} y={card.y + card.h / 2 - 7} width={14} height={14}
            fill="transparent"
          />
          <path
            d={`M${(card.x + card.w - 14).toFixed(2)},${(card.y + card.h / 2 - 3.5).toFixed(2)} l4,3.5 l-4,3.5`}
            fill="none" className="stroke-[var(--text-muted)]" strokeWidth={1.4}
          />
        </Mark>
      )}
    </>
  );
}
/* -------------------------------------------------------------------------- */
/* Headings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which dimension each column is, in the frame's top padding.
 *
 * A decomposition of four levels is four different questions read left to right, and a
 * reader who arrives at the third column of cards cannot tell whether they are looking at
 * agencies or at months. The first column is the total and names nothing, so the heading
 * for column j is level j-1 -- the field whose values the cards in it are.
 */
function LevelHeads({ columns, levels, isAr }: {
  columns: readonly TreeColumn[];
  levels: readonly BiResultColumn[];
  isAr: boolean;
}) {
  return (
    <g aria-hidden="true">
      {columns.map((column, level) => {
        const col = levels[level - 1];
        const card = column.cards[0];
        if (col === undefined || card === undefined) return null;
        const label = (isAr && col.label_ar) ? col.label_ar : col.label;
        return (
          <text key={`h-${level}`} x={card.x} y={10} className={AXIS}>
            {cut(label, card.w)}
          </text>
        );
      })}
    </g>
  );
}
/**
 * The way back up a driver tree.
 *
 * Drawn even when it is one hop long, because a chart whose navigation appears only once
 * you are lost is one the reader has to discover by getting lost. The last hop is where
 * the reader already is, so it is inert and printed in the text colour rather than the
 * accent: a link to here is a link that does nothing.
 *
 * Positions are advanced by a character estimate, since SVG text cannot be measured
 * without a DOM. The estimate is generous, so a long trail spaces out rather than
 * overlapping -- and a trail wide enough to leave the frame is a trail whose earlier hops
 * the reader can still reach by clicking one of the ones that fit.
 */
function Breadcrumb({ trail, box, onGo }: {
  trail: readonly TreeNode[];
  box: FrameBox;
  onGo: (node: TreeNode) => void;
}) {
  const { t } = useBiI18n();
  const totalName = t('الإجمالي', 'Total', 'Total');
  const hops = useMemo(() => {
    let x = box.left;
    return trail.map((node, index) => {
      const last = index === trail.length - 1;
      const text = `${node.depth === 0 ? totalName : node.label}${last ? '' : ' ›'}`;
      const at = x;
      x += (text.length + 1) * CH + 6;
      return { node, text, x: at, last };
    });
  }, [trail, box.left, totalName]);

  return (
    <>
      {hops.map((hop) => (hop.last ? (
        <text
          key={`bc-${hop.node.id}`} x={hop.x} y={10}
          className="fill-[var(--text-primary)] text-[10px] font-semibold"
        >
          {hop.text}
        </text>
      ) : (
        <Mark
          key={`bc-${hop.node.id}`}
          label={`${t('ارجع إلى', 'Revenir à', 'Back to')} ${hop.text}`}
          onSelect={() => onGo(hop.node)}
        >
          <text x={hop.x} y={10} className="fill-[var(--accent)] text-[10px]">{hop.text}</text>
        </Mark>
      )))}
    </>
  );
}
/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The rows the tree left out.
 *
 * Only that. A non-additive measure is already announced above the frame, because TREE is
 * one of the families `chartIssues` treats as summing its values, and one caveat printed
 * twice on one tile reads as two different caveats. What no other line covers is the rows
 * with no measure: they are not in any card, so the counts on screen are short of the
 * result by exactly this many, and a reader reconciling the tree against the grid needs
 * to be told where the difference went.
 */
function TreeNote({ model, box }: { model: TreeModel; box: FrameBox }) {
  const { t } = useBiI18n();
  if (model.skipped === 0) return null;
  return (
    <text x={4} y={box.height - 4} className={NOTE}>
      {t(`${fmtInt(model.skipped)} صف بلا قيمة، مستبعدة من الحساب`,
        `${fmtInt(model.skipped)} lignes sans valeur, exclues du calcul`,
        `${fmtInt(model.skipped)} rows with no value, left out of the arithmetic`)}
    </text>
  );
}

/** Nothing to draw: a result with no dimension has a total and no levels under it, which
 *  is a number rather than a tree. Said plainly instead of drawing one lonely card. */
function Empty({ box }: { box: FrameBox }) {
  const { t } = useBiI18n();
  return (
    <text
      x={box.width / 2} y={box.height / 2} textAnchor="middle"
      className="fill-[var(--text-muted)] text-[12px]"
    >
      {t('لا مستويات للتفصيل', 'Aucun niveau à décomposer', 'No levels to decompose')}
    </text>
  );
}
