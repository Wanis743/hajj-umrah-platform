/**
 * The hierarchy behind DECOMPOSITION_TREE and DRIVER_TREE.
 *
 * One model, two charts, on purpose. Both read the same thing -- the result's dimension
 * columns as nested levels, with a measure rolled up along them -- and what separates
 * them is the question the reader is asking, which is the interaction rather than the
 * arithmetic:
 *
 *   DECOMPOSITION_TREE  "what is inside this?" The path stays visible: expanding a node
 *                       opens the next level beside it, so the reader keeps the whole
 *                       chain from total to leaf on screen.
 *   DRIVER_TREE         "what moved this?" The chosen node becomes the total and its
 *                       children are re-stated as shares of it, with a breadcrumb back.
 *                       Nothing above the new root is drawn, because the question is
 *                       about what feeds this number and not where it sits.
 *
 * A rollup adds child values into their parent, which is a claim the metric has to
 * support. `additive` is carried through from the result column so the chart can say so
 * when it does not: an average of averages is not an average, and a tree that sums one
 * silently is the kind of chart that gets quoted in a meeting.
 */
import type { BiQuerySuccess, BiResultColumn, BiScalar } from '@/types/bi';
import { formatCell, numericCell, type MetricDisplay } from './biFormat';
import { plotHeight, plotWidth, splitColumns, type FrameBox } from './biChartData';

export interface TreeNode {
  /** Stable across renders and unique within the tree: the parent's id and this
   *  node's key joined. Expansion state is a list of these, so it has to survive a
   *  re-query that returns the same groups in a different order. */
  id: string;
  label: string;
  /** The cell a click filters on. Null on the root and on a remainder node, neither of
   *  which corresponds to a single grouped value. */
  raw: BiScalar;
  /** The dimension this node's value came from. Null on the root. */
  column: BiResultColumn | null;
  depth: number;
  value: number;
  /** Share of the siblings' combined magnitude, |value| / Σ|siblings|. Magnitudes,
   *  because a level holding +90 and -10 sums to 80 and a share of 112% is not a share.
   *  The sign stays on `value`, where a driver tree reads it. */
  share: number;
  children: TreeNode[];
  /** Result rows underneath this node. */
  rows: number;
  /** The synthetic "+k more" node. It has no single cell behind it, so it neither
   *  drills nor expands -- and it exists rather than being dropped, because a level
   *  showing eight of two hundred children while the total counts all two hundred is a
   *  chart whose parts do not add up to its whole. */
  remainder: boolean;
}

export interface TreeModel {
  root: TreeNode;
  /** The dimension columns, in the order they became levels. */
  levels: BiResultColumn[];
  display: MetricDisplay;
  /** False when the measure declared itself non-additive, so the frame can warn that
   *  every rollup above the leaves is a sum of numbers that do not sum. */
  additive: boolean;
  measure: BiResultColumn | null;
  /** Rows with no numeric measure, counted rather than folded in as zero. */
  skipped: number;
}

/** Ids are built by joining keys, so the separator has to be a character a dimension
 *  value will not contain: U+0001, which is not typeable and which Postgres text can
 *  nonetheless hold. That is the trade a delimiter should make -- unreachable in
 *  practice, and if it ever does appear two ids merge into one node rather than
 *  crashing. Written as fromCharCode and not as a literal, because a control byte
 *  pasted into source is a character no reviewer can see. */
const KEY_SEP = String.fromCharCode(1);

/** A tiebreak that does not move with the interface language, so two readers in two
 *  locales get the same tree rather than two orderings of the same numbers. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The node under construction, carrying the lookup its children are found by. The
 *  map is what keeps the build linear in the number of rows instead of scanning the
 *  siblings at every level of every row. */
interface Building { node: TreeNode; byKey: Map<string, Building> }

const newNode = (
  id: string, label: string, raw: BiScalar, column: BiResultColumn | null, depth: number,
): TreeNode => ({
  id, label, raw, column, depth,
  value: 0, share: 0, children: [], rows: 0, remainder: false,
});

function descend(
  parent: Building, row: Readonly<Record<string, BiScalar>>,
  column: BiResultColumn, depth: number,
): Building {
  const raw = row[column.alias] ?? null;
  // Grouped on the raw value, labelled with the formatted one. Two distinct keys that
  // format alike stay two nodes, which is the right way round: the formatter rounds.
  const key = String(raw);
  const found = parent.byKey.get(key);
  if (found !== undefined) return found;
  const made: Building = {
    node: newNode(
      parent.node.id === '' ? key : `${parent.node.id}${KEY_SEP}${key}`,
      formatCell(raw, column), raw, column, depth,
    ),
    byKey: new Map(),
  };
  parent.byKey.set(key, made);
  parent.node.children.push(made.node);
  return made;
}

/**
 * Children ordered by magnitude, the tail folded into one remainder node, shares taken.
 *
 * Descending by |value| rather than by the query's ORDER BY: a decomposition tree is
 * read for what is biggest, and a level whose first child is the smallest one makes the
 * reader do the sorting. The remainder keeps no children of its own -- the tail is a
 * count and a subtotal, not a branch worth walking into.
 */
function finalize(node: TreeNode, maxChildren: number): void {
  if (node.children.length === 0) return;
  node.children.sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value) || compareText(a.label, b.label));
  if (node.children.length > maxChildren) {
    const rest = node.children.slice(maxChildren);
    const tail = newNode(
      `${node.id}${KEY_SEP}#rest`, `+${rest.length}`, null, rest[0].column, rest[0].depth);
    tail.remainder = true;
    tail.value = rest.reduce((sum, child) => sum + child.value, 0);
    tail.rows = rest.reduce((sum, child) => sum + child.rows, 0);
    node.children = [...node.children.slice(0, maxChildren), tail];
  }
  const magnitude = node.children.reduce((sum, child) => sum + Math.abs(child.value), 0);
  for (const child of node.children) {
    child.share = magnitude === 0 ? 0 : Math.abs(child.value) / magnitude;
    finalize(child, maxChildren);
  }
}

/**
 * The tree, from the result's dimension columns in the order they arrive.
 *
 * The first dimension is the first level, and no attempt is made to reorder levels by
 * cardinality or by name. That order is the one the reader arranged on the shelves, and
 * rearranging it would answer a different question than the one they built while
 * looking like the answer to theirs.
 */
export function buildTree(result: BiQuerySuccess, maxChildren = 8): TreeModel {
  const { dimensions, measures } = splitColumns(result.columns);
  const measure = measures[0] ?? null;
  const root: Building = { node: newNode('', '', null, null, 0), byKey: new Map() };
  let skipped = 0;
  for (const row of result.rows) {
    const value = measure ? numericCell(row[measure.alias] ?? null) : null;
    // A null measure is not a zero. Folding it in as one would move every share on the
    // level it sits in, so the row is counted out loud and left out of the arithmetic.
    if (value === null) { skipped += 1; continue; }
    let at: Building = root;
    at.node.value += value;
    at.node.rows += 1;
    for (let depth = 0; depth < dimensions.length; depth += 1) {
      at = descend(at, row, dimensions[depth], depth + 1);
      at.node.value += value;
      at.node.rows += 1;
    }
  }
  finalize(root.node, maxChildren);
  root.node.share = 1;
  return {
    root: root.node,
    levels: dimensions,
    display: measure
      ? { format: measure.format, decimals: measure.decimals, unit: measure.unit }
      : {},
    additive: measure?.is_additive !== false,
    measure,
    skipped,
  };
}

/** The node with this id, or null. Depth-first, and cheap at these sizes: every level
 *  is capped at maxChildren + 1, so three shelves of eight is 585 nodes in the worst
 *  case rather than one per result row. */
export function nodeAt(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = nodeAt(child, id);
    if (found !== null) return found;
  }
  return null;
}

/** The root-to-node chain, both ends included, for a breadcrumb. Empty when the id no
 *  longer exists -- which happens on re-query, and is why the driver tree falls back to
 *  the total instead of drawing an empty frame around a node that has gone. */
export function pathOf(root: TreeNode, id: string): TreeNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const below = pathOf(child, id);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}

/**
 * The chain of nodes the reader has opened, cut at the first id that no longer exists.
 *
 * Truncating beats discarding after a re-query: the levels that still match stay open
 * and the reader carries on from the deepest one that survived, rather than being sent
 * back to the total because one group at the bottom stopped being returned. A leaf and
 * a remainder both end the chain -- neither has anything to open.
 */
export function expandedChain(root: TreeNode, path: readonly string[]): TreeNode[] {
  const chain: TreeNode[] = [root];
  for (const id of path) {
    const parent = chain[chain.length - 1];
    const next = parent.children.find((child) => child.id === id && !child.remainder);
    if (next === undefined || next.children.length === 0) break;
    chain.push(next);
  }
  return chain;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export interface TreeCard {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The share bar's width, inside the card. Clamped at the card, because a share above
   *  one happens whenever a level mixes signs and a bar wider than its card reads as a
   *  drawing error rather than as the sign change it is. */
  barW: number;
  /** This node is the one currently opened in its column. Drawn heavier, so a reader who
   *  scrolled away can still see which branch the columns to the right belong to. */
  open: boolean;
}

export interface TreeColumn {
  /** The node whose children these are. Null in the first column, which is the total. */
  parent: TreeNode | null;
  /** Where an elbow to each card leaves from: the parent card's trailing edge, mid
   *  height. Null in the first column, which has nothing to its left. */
  anchor: { x: number; y: number } | null;
  cards: TreeCard[];
}

const GAP_Y = 6;
const GAP_X = 18;

/** One column of sibling cards, stacked and vertically centred so a level of two sits
 *  opposite the parent it came from rather than at the top of the frame. */
function cardsOf(
  nodes: readonly TreeNode[], x: number, w: number, frame: FrameBox,
  openIds: ReadonlySet<string>,
): TreeCard[] {
  const n = nodes.length;
  if (n === 0) return [];
  const space = plotHeight(frame);
  const h = Math.max(14, Math.min(40, (space - GAP_Y * (n - 1)) / n));
  const top = frame.top + Math.max(0, (space - (h * n + GAP_Y * (n - 1))) / 2);
  return nodes.map((node, index) => ({
    node,
    x,
    y: top + index * (h + GAP_Y),
    w,
    h,
    barW: w * Math.max(0, Math.min(1, node.share)),
    open: openIds.has(node.id),
  }));
}

/**
 * The opened chain, as columns of cards left to right.
 *
 * One more column than the chain is long: the first holds the total on its own, and each
 * one after it holds the children of the chain node to its left. So a reader who has
 * opened nothing sees the total and its first level, and every click adds a column rather
 * than replacing the picture -- which is the difference between a decomposition and a
 * sequence of unrelated charts.
 *
 * Columns are equal width and the frame is fixed, so a fourth level makes every card
 * narrower rather than running off the right edge. That is a real limit of the shape, and
 * the honest place to hit it is the card label, which truncates.
 */
export function treeLayout(chain: readonly TreeNode[], frame: FrameBox): TreeColumn[] {
  const count = chain.length + 1;
  const colW = plotWidth(frame) / count;
  const cardW = Math.max(40, colW - GAP_X);
  const openIds = new Set(chain.map((node) => node.id));
  const columns: TreeColumn[] = [];
  let anchor: { x: number; y: number } | null = null;

  chain.forEach((node, level) => {
    const x = frame.left + colW * level;
    if (level === 0) {
      const cards = cardsOf([node], x, cardW, frame, openIds);
      columns.push({ parent: null, anchor: null, cards });
      const card = cards[0];
      anchor = card ? { x: card.x + card.w, y: card.y + card.h / 2 } : null;
    }
    const childX = frame.left + colW * (level + 1);
    const cards = cardsOf(node.children, childX, cardW, frame, openIds);
    columns.push({ parent: node, anchor, cards });
    const opened = cards.find((card) => card.open);
    anchor = opened ? { x: opened.x + opened.w, y: opened.y + opened.h / 2 } : null;
  });
  return columns;
}
