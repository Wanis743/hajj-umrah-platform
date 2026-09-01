/**
 * Layout for the two edge-shaped charts: SANKEY and DEPENDENCY_GRAPH.
 *
 * Both read the same thing the query compiler already returns for a two-dimension
 * grouping -- a from, a to and a measure -- and the difference between them is what an
 * edge is taken to mean:
 *
 *   SANKEY   an edge is a *quantity moving*. Sources and targets are separate nodes even
 *            when they carry the same value, because "Jeddah as an origin" and "Jeddah
 *            as a destination" are two ends of a flow and drawing them as one node turns
 *            a diagram of movement into a diagram of a loop.
 *   GRAPH    an edge is a *dependency*. Here the same value is the same node wherever it
 *            appears, which is the entire point: that is how a chain three rows long
 *            becomes a path three nodes deep, and how a cycle becomes visible.
 *
 * Neither layout iterates to convergence. A sankey stacks each level by value and orders
 * ribbons by where they land; a graph layers by longest path and stacks within the
 * layer. Force simulation would look smoother and would put the same data in a different
 * place on every render, which for a chart that gets screenshotted into a document is a
 * defect and not a flourish.
 */
import type { BiQuerySuccess, BiResultColumn, BiScalar } from '@/types/bi';
import { formatCell, numericCell, type MetricDisplay } from './biFormat';
import { colorAt, splitColumns } from './biChartData';

export interface FlowNode {
  /** Opaque and never parsed back apart: a level prefix for a sankey, the bare group key
   *  for a graph. Only ever compared, so no separator can be ambiguous. */
  id: string;
  label: string;
  /** The cell a click filters on, with the column it came from. */
  raw: BiScalar;
  column: BiResultColumn;
  level: number;
  /** max(inflow, outflow). A node that receives 100 and passes on 60 is 100 tall, and
   *  the 40 it keeps is the visible gap -- which is the one thing a sankey is uniquely
   *  good at showing and is lost the moment nodes are sized by outflow alone. */
  value: number;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowLink {
  id: string;
  from: string;
  to: string;
  value: number;
  /** Result rows behind this edge. More than one means the pair repeated across a third
   *  dimension and the value is their sum. */
  rows: number;
  /** An SVG path: a filled ribbon for a sankey, a stroked curve for a graph. */
  path: string;
  /** True when the edge runs back to an earlier layer, i.e. it closes a cycle. Drawn
   *  dashed and counted rather than hidden: a dependency graph that quietly drops its
   *  back edges is a graph that reports a clean acyclic model over a circular one. */
  back: boolean;
}

export interface FlowModel {
  nodes: FlowNode[];
  links: FlowLink[];
  /** How many levels (sankey) or layers (graph) the layout produced. */
  levels: number;
  display: MetricDisplay;
  /** False when the measure declared itself non-additive, so the frame can warn that
   *  edges repeated across a third dimension were summed to get their width. */
  additive: boolean;
  /** Rows with no usable measure, or a measure that cannot be a width. Counted, so the
   *  frame can say what it left out. */
  skipped: number;
  /** Back edges found. Zero is the interesting answer and is worth printing. */
  cycles: number;
}

/** An edge before it has geometry. */
interface Edge { from: string; to: string; value: number; rows: number }

/** A node before it has a position. */
interface Vertex {
  id: string; label: string; raw: BiScalar; column: BiResultColumn;
  level: number; out: number; into: number;
}

interface EdgeSet {
  vertices: Map<string, Vertex>;
  edges: Edge[];
  dims: BiResultColumn[];
  measure: BiResultColumn | null;
  skipped: number;
  additive: boolean;
  /** A→A. Real, and undrawable as a curve between two positions, so it is counted as
   *  the one-node cycle it is instead of vanishing. */
  selfLoops: number;
}

/**
 * The result read as a list of edges, once, for both charts.
 *
 * `mode` carries the two differences and nothing else, so neither chart can drift into
 * reading the rows differently from the other:
 *
 *   FLOW    a value is a different node at each level it appears in, and a measure that
 *           is not positive is skipped -- a ribbon's width is a magnitude, and drawing
 *           |−40| as forty units of flow states the opposite of what the number says.
 *   GRAPH   a value is one node wherever it appears, and a zero measure is kept. The
 *           compiler returned the pair, so the dependency exists; its weight being zero
 *           is a fact about the weight, not grounds for hiding the edge.
 *
 * Consecutive dimension pairs either way, so three dimensions give two levels of flow
 * rather than one edge and a silently ignored column.
 */
function edgesOf(result: BiQuerySuccess, mode: 'FLOW' | 'GRAPH'): EdgeSet {
  const { dimensions, measures } = splitColumns(result.columns);
  const measure = measures[0] ?? null;
  const vertices = new Map<string, Vertex>();
  const byPair = new Map<string, Edge>();
  const edges: Edge[] = [];
  let skipped = 0;
  let selfLoops = 0;
  const touch = (level: number, column: BiResultColumn, raw: BiScalar): Vertex => {
    const id = mode === 'FLOW' ? `L${level}:${String(raw)}` : `N:${String(raw)}`;
    const found = vertices.get(id);
    if (found !== undefined) return found;
    const made: Vertex = {
      id, label: formatCell(raw, column), raw, column, level, out: 0, into: 0,
    };
    vertices.set(id, made);
    return made;
  };
  for (const row of result.rows) {
    const value = measure ? numericCell(row[measure.alias] ?? null) : null;
    if (value === null || (mode === 'FLOW' ? value <= 0 : value < 0)) { skipped += 1; continue; }
    for (let level = 0; level + 1 < dimensions.length; level += 1) {
      const a = dimensions[level];
      const b = dimensions[level + 1];
      const from = touch(level, a, row[a.alias] ?? null);
      const to = touch(level + 1, b, row[b.alias] ?? null);
      if (from.id === to.id) { selfLoops += 1; continue; }
      from.out += value;
      to.into += value;
      const key = `${from.id}>${to.id}`;
      const seen = byPair.get(key);
      if (seen === undefined) {
        const made: Edge = { from: from.id, to: to.id, value, rows: 1 };
        byPair.set(key, made);
        edges.push(made);
      } else {
        seen.value += value;
        seen.rows += 1;
      }
    }
  }
  return {
    vertices, edges, dims: dimensions, measure, skipped, selfLoops,
    additive: measure?.is_additive !== false,
  };
}

/** Print instructions from the measure column, or none when there is no measure. */
const displayOf = (measure: BiResultColumn | null): MetricDisplay =>
  (measure ? { format: measure.format, decimals: measure.decimals, unit: measure.unit } : {});

/** Node thickness, and the least space allowed between two nodes in one level. */
const NODE_W = 12;
const NODE_GAP = 10;

/** A node's own size: what passes through it, not what it passes on. */
const magnitude = (vertex: Vertex): number => Math.max(vertex.out, vertex.into);

/** A tiebreak that does not move with the interface language, so two readers in two
 *  locales get the same diagram rather than two orderings of the same numbers. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const pushEdge = (into: Map<string, Edge[]>, key: string, edge: Edge): void => {
  const list = into.get(key);
  if (list === undefined) into.set(key, [edge]);
  else list.push(edge);
};

const keyOf = (edge: Edge): string => `${edge.from}>${edge.to}`;

/**
 * The scale that makes the busiest level fit the frame.
 *
 * One scale for the whole diagram, taken from whichever level needs the most room. A
 * per-level scale would fill the height at every level, which would draw the same
 * quantity at two different widths at either end of one ribbon -- a sankey saying the
 * amount changed in transit when it did not.
 */
function flowScale(byLevel: readonly Vertex[][], height: number): number {
  let scale = Infinity;
  for (const level of byLevel) {
    if (level.length === 0) continue;
    const total = level.reduce((sum, vertex) => sum + magnitude(vertex), 0);
    const room = height - NODE_GAP * (level.length - 1);
    if (total <= 0 || room <= 0) return 0;
    scale = Math.min(scale, room / total);
  }
  return Number.isFinite(scale) ? scale : 0;
}

/**
 * Level 0 ordered by size; every later level by the average height of what feeds it.
 *
 * One barycentre pass, not a sweep to convergence. It removes the crossings that exist
 * only because the map handed the level back in insertion order, and it returns the same
 * answer on every render of the same result.
 */
function orderLevel(
  here: Vertex[], inbound: Map<string, Edge[]>, placed: Map<string, FlowNode>,
): void {
  const anchor = new Map<string, number>();
  for (const vertex of here) {
    let weight = 0;
    let sum = 0;
    for (const edge of inbound.get(vertex.id) ?? []) {
      const from = placed.get(edge.from);
      if (from === undefined) continue;
      sum += (from.y + from.height / 2) * edge.value;
      weight += edge.value;
    }
    // Nothing placed upstream to anchor to: level 0, or a node whose only feeds come
    // from a level that has not been positioned. Falls through to size below.
    anchor.set(vertex.id, weight === 0 ? Number.MAX_SAFE_INTEGER : sum / weight);
  }
  here.sort((a, b) =>
    (anchor.get(a.id) ?? 0) - (anchor.get(b.id) ?? 0)
    || magnitude(b) - magnitude(a)
    || compareText(a.label, b.label));
}

/** A ribbon: two cubics with their control points on the horizontal midpoint, so it
 *  leaves and arrives level and reads as one band rather than as a diagonal. */
function ribbon(x0: number, x1: number, top0: number, top1: number, thick: number): string {
  const mid = (x0 + x1) / 2;
  const base0 = top0 + thick;
  const base1 = top1 + thick;
  return `M${x0},${top0}C${mid},${top0} ${mid},${top1} ${x1},${top1}`
    + `L${x1},${base1}C${mid},${base1} ${mid},${base0} ${x0},${base0}Z`;
}

/**
 * Where each ribbon meets a node, stacked in order.
 *
 * Ribbons leave a node ordered by where they land, and arrive ordered by where they came
 * from. That single rule is what stops a sankey's ribbons crossing over the node they
 * share, and it is why every edge is measured twice here: once against its source, once
 * against its target.
 */
function ribbonTops(
  grouped: Map<string, Edge[]>, nodes: Map<string, FlowNode>, scale: number,
  by: 'SOURCE' | 'TARGET',
): Map<string, number> {
  const tops = new Map<string, number>();
  const facing = (edge: Edge): number =>
    nodes.get(by === 'SOURCE' ? edge.to : edge.from)?.y ?? 0;
  for (const [id, list] of grouped) {
    list.sort((a, b) => facing(a) - facing(b) || compareText(keyOf(a), keyOf(b)));
    let at = nodes.get(id)?.y ?? 0;
    for (const edge of list) {
      tops.set(keyOf(edge), at);
      at += edge.value * scale;
    }
  }
  return tops;
}

/**
 * SANKEY: levels left to right, nodes stacked by value, ribbons ordered by where they
 * land.
 *
 * Takes the whole width and height it is given rather than a `frameBox`. A flow diagram
 * has no axis to letter, so a gutter would be blank space taken off the only thing on
 * screen.
 */
export function sankeyLayout(
  result: BiQuerySuccess, width: number, height: number,
): FlowModel {
  const set = edgesOf(result, 'FLOW');
  const blank: FlowModel = {
    nodes: [], links: [], levels: 0, display: displayOf(set.measure),
    additive: set.additive, skipped: set.skipped, cycles: set.selfLoops,
  };
  if (set.edges.length === 0) return blank;
  const depth = [...set.vertices.values()]
    .reduce((max, vertex) => Math.max(max, vertex.level), 0) + 1;
  const byLevel: Vertex[][] = Array.from({ length: depth }, () => []);
  for (const vertex of set.vertices.values()) byLevel[vertex.level].push(vertex);
  const scale = flowScale(byLevel, height);
  if (scale <= 0) return blank;
  const inbound = new Map<string, Edge[]>();
  const outbound = new Map<string, Edge[]>();
  for (const edge of set.edges) {
    pushEdge(inbound, edge.to, edge);
    pushEdge(outbound, edge.from, edge);
  }
  const step = depth > 1 ? (width - NODE_W) / (depth - 1) : 0;
  const nodes = new Map<string, FlowNode>();
  let painted = 0;
  for (let level = 0; level < depth; level += 1) {
    const here = byLevel[level];
    orderLevel(here, inbound, nodes);
    const total = here.reduce((sum, vertex) => sum + magnitude(vertex), 0);
    const stack = total * scale + NODE_GAP * (here.length - 1);
    // Centred rather than top-aligned: a thin level pinned to the top of a tall frame
    // reads as a level that starts late, which is a claim about the data.
    let y = Math.max(0, (height - stack) / 2);
    for (const vertex of here) {
      const size = magnitude(vertex) * scale;
      nodes.set(vertex.id, {
        id: vertex.id, label: vertex.label, raw: vertex.raw, column: vertex.column,
        level, value: magnitude(vertex), color: colorAt(painted),
        x: level * step, y, width: NODE_W, height: size,
      });
      painted += 1;
      y += size + NODE_GAP;
    }
  }
  const leaves = ribbonTops(outbound, nodes, scale, 'SOURCE');
  const arrives = ribbonTops(inbound, nodes, scale, 'TARGET');
  const links: FlowLink[] = set.edges.map((edge) => {
    const id = keyOf(edge);
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    return {
      id, from: edge.from, to: edge.to, value: edge.value, rows: edge.rows,
      // Levels only ever increase in FLOW mode -- the id carries the level, so an edge
      // cannot land where it started. Cycles are a graph's problem, not a sankey's.
      back: false,
      path: from === undefined || to === undefined ? '' : ribbon(
        from.x + from.width, to.x,
        leaves.get(id) ?? from.y, arrives.get(id) ?? to.y, edge.value * scale),
    };
  });
  return {
    nodes: [...nodes.values()], links, levels: depth, display: displayOf(set.measure),
    additive: set.additive, skipped: set.skipped, cycles: set.selfLoops,
  };
}

/** A dependency node is a labelled box, not a magnitude: the entity is the thing, and
 *  its weight is carried by the edges. Boxes shrink to fit a crowded layer; they never
 *  grow, so one node in a layer does not become a banner. */
const BOX_W = 132;
const BOX_H = 26;
const BOX_GAP = 12;

/**
 * Layers by longest path, with the number of relaxation passes capped at the node count.
 *
 * Relaxing `layer(to) = layer(from) + 1` until nothing moves is ordinary longest-path
 * layering, and on a cyclic graph it does not terminate. The cap is what makes it
 * terminate -- and after |V| passes, any edge still pointing at a layer it does not
 * precede is part of a cycle. So the cap is not a safety net bolted onto the algorithm;
 * it is how the cycles get found.
 */
function layerOf(set: EdgeSet): Map<string, number> {
  const layer = new Map<string, number>();
  for (const id of set.vertices.keys()) layer.set(id, 0);
  const cap = Math.max(1, set.vertices.size);
  for (let pass = 0; pass < cap; pass += 1) {
    let moved = false;
    for (const edge of set.edges) {
      const from = layer.get(edge.from) ?? 0;
      if ((layer.get(edge.to) ?? 0) <= from) {
        layer.set(edge.to, from + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** A dependency edge: a stroked curve between two box edges. A back edge bows below the
 *  layers instead of cutting straight back through them, so the one line that says
 *  "this is circular" is the one line the reader can actually follow. */
function wire(
  from: FlowNode, to: FlowNode, back: boolean, height: number,
): string {
  const y0 = from.y + from.height / 2;
  const y1 = to.y + to.height / 2;
  if (!back) {
    const x0 = from.x + from.width;
    const x1 = to.x;
    const mid = (x0 + x1) / 2;
    return `M${x0},${y0}C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
  }
  const x0 = from.x;
  const x1 = to.x + to.width;
  const bow = Math.min(56, Math.max(24, height * 0.12));
  return `M${x0},${y0}C${x0 - bow},${y0 + bow} ${x1 + bow},${y1 + bow} ${x1},${y1}`;
}

/**
 * DEPENDENCY_GRAPH: layered left to right, one node per value, cycles drawn and counted.
 *
 * The same value is the same node at every layer it appears in, which is what makes a
 * chain of rows into a path and a circular reference into a visible loop. Nothing here
 * iterates: layers come from longest path, order within a layer comes from degree, and
 * the diagram is therefore identical on every render of the same result.
 */
export function graphLayout(
  result: BiQuerySuccess, width: number, height: number,
): FlowModel {
  const set = edgesOf(result, 'GRAPH');
  const display = displayOf(set.measure);
  if (set.edges.length === 0) {
    return {
      nodes: [], links: [], levels: 0, display,
      additive: set.additive, skipped: set.skipped, cycles: set.selfLoops,
    };
  }
  const layer = layerOf(set);
  const depth = [...layer.values()].reduce((max, at) => Math.max(max, at), 0) + 1;
  const byLayer: Vertex[][] = Array.from({ length: depth }, () => []);
  for (const vertex of set.vertices.values()) {
    byLayer[layer.get(vertex.id) ?? 0].push(vertex);
  }
  const step = depth > 1 ? (width - BOX_W) / (depth - 1) : 0;
  const nodes = new Map<string, FlowNode>();
  let painted = 0;
  byLayer.forEach((here, at) => {
    // Busiest first, so the node with the most dependencies is the one the eye lands on.
    here.sort((a, b) =>
      (b.out + b.into) - (a.out + a.into)
      || (b.out - a.out)
      || compareText(a.label, b.label));
    const slot = Math.min(BOX_H + BOX_GAP, height / Math.max(1, here.length));
    const box = Math.max(8, Math.min(BOX_H, slot - 4));
    const stack = slot * here.length - (slot - box);
    let y = Math.max(0, (height - stack) / 2);
    for (const vertex of here) {
      nodes.set(vertex.id, {
        id: vertex.id, label: vertex.label, raw: vertex.raw, column: vertex.column,
        level: at, value: magnitude(vertex), color: colorAt(painted),
        x: at * step, y, width: BOX_W, height: box,
      });
      painted += 1;
      y += slot;
    }
  });
  let cycles = set.selfLoops;
  const links: FlowLink[] = set.edges.map((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const back = (layer.get(edge.to) ?? 0) <= (layer.get(edge.from) ?? 0);
    if (back) cycles += 1;
    return {
      id: keyOf(edge), from: edge.from, to: edge.to, value: edge.value, rows: edge.rows,
      back,
      path: from === undefined || to === undefined ? '' : wire(from, to, back, height),
    };
  });
  return {
    nodes: [...nodes.values()], links, levels: depth, display,
    additive: set.additive, skipped: set.skipped, cycles,
  };
}

/**
 * Everything reachable from one node in one direction, back edges included.
 *
 * This is the set a dependency graph highlights when the reader picks a node:
 * DOWNSTREAM answers "what breaks if this changes", UPSTREAM answers "what this rests
 * on". Back edges are followed like any other, because refusing to traverse them would
 * report a shorter chain than the data has.
 *
 * The starting node is not seeded into the result, so a node that leads back to itself
 * turns up in its own set and a node that does not, does not -- which makes membership
 * the test for "is this one inside a cycle".
 */
export function reachable(
  links: readonly FlowLink[], from: string, direction: 'DOWNSTREAM' | 'UPSTREAM',
): Set<string> {
  const next = new Map<string, string[]>();
  for (const link of links) {
    const key = direction === 'DOWNSTREAM' ? link.from : link.to;
    const value = direction === 'DOWNSTREAM' ? link.to : link.from;
    const list = next.get(key);
    if (list === undefined) next.set(key, [value]);
    else list.push(value);
  }
  const seen = new Set<string>();
  const queue: string[] = [...(next.get(from) ?? [])];
  let cursor = 0;
  while (cursor < queue.length) {
    const at = queue[cursor];
    cursor += 1;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const step of next.get(at) ?? []) {
      if (!seen.has(step)) queue.push(step);
    }
  }
  return seen;
}

/** The edges that touch a node, either end, for the panel beside a selected node. */
export const linksTouching = (
  links: readonly FlowLink[], id: string,
): FlowLink[] => links.filter((link) => link.from === id || link.to === id);
