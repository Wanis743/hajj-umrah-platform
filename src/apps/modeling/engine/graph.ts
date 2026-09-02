/**
 * What depends on what, and in which order a period can be computed.
 *
 * This is the file that makes a spreadsheet a model. A grid of formulas has no defined order —
 * you recompute until it stops moving, and if it never stops you get a circular-reference
 * warning in one cell and a wrong number in the rest. A graph has one order, computed once,
 * and a cycle is a refusal before any arithmetic happens rather than a warning after it.
 *
 * The distinction that makes this possible is the one ./expression already drew. `sum(x)` and
 * `npv(r, x)` read every period of `x`, including the one being computed, so they are ordinary
 * same-period edges and can close a cycle. `prior(x)` reads a period that is finished, so it
 * cannot — which is exactly what lets `cash = prior(cash) + net` be an ordinary formula and not
 * a contradiction. Lagged reads are therefore excluded from the cycle check, and that exclusion
 * is safe only because ./expression refuses a zero lag: a `prior(x, 0)` would be a same-period
 * read wearing a lag's clothing, and this file trusts that it cannot exist.
 *
 * Everything here is deterministic. Keys are sorted before they are walked, so one model
 * produces one order and ./version can hash it; a traversal that depended on insertion order
 * would make two identical models hash differently and report a change nobody made.
 */
import type { Refs } from './expression';

/** A key that is read but is neither computed nor given. */
export interface MissingIssue {
  readonly kind: 'MISSING';
  readonly key: string;
  /** The formula that reads it. Named, because "revenue is missing" is not actionable and
   *  "gross_margin reads revenue, which no row defines" is. */
  readonly readBy: string;
}

/** A key that is both computed and given. Refused rather than resolved by precedence: a
 *  precedence rule here would decide which of two definitions a reader meant. */
export interface ShadowedIssue {
  readonly kind: 'SHADOWED';
  readonly key: string;
}

export interface CycleIssue {
  readonly kind: 'CYCLE';
  /** The keys in dependency order; the last one reads the first. A single-element path is a
   *  formula that reads itself in its own period. */
  readonly path: readonly string[];
}

export type GraphIssue = MissingIssue | ShadowedIssue | CycleIssue;

/**
 * The model as this file needs to see it: which keys are computed and what each one reads,
 * and which keys are simply given.
 *
 * `Refs` comes straight from `referencesOf`, so a caller cannot describe a formula's
 * dependencies differently from the way it actually parses.
 */
export interface GraphInput {
  readonly formulas: ReadonlyMap<string, Refs>;
  /** Assumptions, actuals, anything with a value rather than a formula. */
  readonly inputs: ReadonlySet<string>;
}

export interface ModelGraph {
  /** Evaluation order for one period: every computed key sits after everything its formula
   *  reads in the same period. Given keys come first, in sorted order. */
  readonly order: readonly string[];
  /** Reverse edges: for each key, the formulas that read it in the same period. What
   *  sensitivity walks to answer "what does moving this touch". */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
  /** Longest same-period chain ending here. Zero for a given key. This is the number a driver
   *  tree indents by and the number a model's complexity is actually felt as. */
  readonly depth: ReadonlyMap<string, number>;
  /** Keys whose formula reads an earlier period, in sorted order. These are the rows whose
   *  first period rests on an opening balance rather than on arithmetic. */
  readonly rollForward: readonly string[];
}

export type GraphResult =
  | { readonly ok: true; readonly graph: ModelGraph }
  | { readonly ok: false; readonly issues: readonly GraphIssue[] };

/**
 * Build the graph, or say why there isn't one.
 *
 * Two passes, each with one job. The first settles whether every name resolves and resolves
 * once; the second settles whether the same-period edges admit an order. They are not merged
 * because a model with a misspelled key produces cycles that are artefacts of the misspelling,
 * and reporting those alongside the typo would bury it.
 */
export function buildGraph(input: GraphInput): GraphResult {
  const named = names(input);
  if (named.length > 0) return { ok: false, issues: named };
  const sorted = sortTopologically(input);
  if (sorted.kind === 'CYCLE') return { ok: false, issues: [sorted.issue] };
  return { ok: true, graph: complete(input, sorted.order) };
}

/** Missing and shadowed keys, all of them, in a stable order. Reported together because they
 *  are the same kind of mistake — a name that does not mean one thing — and a reader fixing a
 *  model's vocabulary wants the whole list, not the first entry. */
function names(input: GraphInput): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const key of [...input.formulas.keys()].sort()) {
    if (input.inputs.has(key)) issues.push({ kind: 'SHADOWED', key });
  }
  for (const key of [...input.formulas.keys()].sort()) {
    const refs = input.formulas.get(key);
    if (refs === undefined) continue;
    // Lagged reads are checked here too. They are exempt from the cycle rule, not from
    // existing: `prior(revenu)` is a typo whichever period it points at. A key read both ways
    // by one formula is one missing name, so the two lists are merged before they are walked.
    for (const read of [...new Set([...refs.direct, ...refs.lagged])].sort()) {
      if (!input.formulas.has(read) && !input.inputs.has(read)) {
        issues.push({ kind: 'MISSING', key: read, readBy: key });
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ order ---- */

type SortOutcome =
  | { readonly kind: 'ORDER'; readonly order: readonly string[] }
  | { readonly kind: 'CYCLE'; readonly issue: CycleIssue };

/**
 * Depth-first, post-order, over same-period edges only.
 *
 * Depth-first rather than Kahn's algorithm for one reason: when it fails it knows the path. A
 * queue-based sort ends with a set of keys it could not place and no account of how they hold
 * each other up, and "these eleven rows form a cycle" is not something a reader can fix.
 * Here the recursion stack *is* the path, so the report is `margin → price → margin` and the
 * reader can see which edge to break.
 *
 * Only the first cycle is reported. A model with one real cycle usually shows several, each the
 * same loop entered from a different row, and a list of them reads as five problems where there
 * is one.
 */
function sortTopologically(input: GraphInput): SortOutcome {
  const order: string[] = [];
  const done = new Set<string>();
  const open = new Set<string>();
  const path: string[] = [];

  // Returns the cycle it found, or null. Reported as a return value rather than collected in a
  // captured variable so that the first cycle stops the traversal at the frame that found it,
  // with the path still intact.
  const visit = (key: string): CycleIssue | null => {
    if (done.has(key)) return null;
    if (open.has(key)) return { kind: 'CYCLE', path: path.slice(path.indexOf(key)) };
    const refs = input.formulas.get(key);
    // A given key is a leaf. It is placed by the sorted sweep below rather than by whoever
    // reaches it first, so its position never depends on who read it.
    if (refs !== undefined) {
      open.add(key);
      path.push(key);
      for (const read of refs.direct) {
        const found = visit(read);
        // The bookkeeping is deliberately not unwound here. The traversal is over; leaving
        // `path` as it stands is what keeps the reported cycle readable.
        if (found !== null) return found;
      }
      path.pop();
      open.delete(key);
    }
    done.add(key);
    order.push(key);
    return null;
  };

  for (const key of [...input.inputs].sort()) {
    const found = visit(key);
    if (found !== null) return { kind: 'CYCLE', issue: found };
  }
  for (const key of [...input.formulas.keys()].sort()) {
    const found = visit(key);
    if (found !== null) return { kind: 'CYCLE', issue: found };
  }
  return { kind: 'ORDER', order };
}

/* ------------------------------------------------------------- completions ---- */

/**
 * The rest of the graph, once an order exists.
 *
 * All three of these are single passes over the order, which is the point of having one: a
 * reverse-edge map, a depth and a roll-forward list are all things a spreadsheet can only
 * answer by searching, and a model answers by reading.
 */
function complete(input: GraphInput, order: readonly string[]): ModelGraph {
  const dependents = new Map<string, string[]>();
  const depth = new Map<string, number>();
  const rollForward: string[] = [];

  for (const key of order) {
    const refs = input.formulas.get(key);
    if (refs === undefined) {
      depth.set(key, 0);
      continue;
    }
    if (refs.lagged.length > 0) rollForward.push(key);
    let deepest = 0;
    for (const read of refs.direct) {
      const list = dependents.get(read);
      if (list === undefined) dependents.set(read, [key]);
      else list.push(key);
      // Every direct read is earlier in `order`, so its depth is already settled. That is the
      // whole value of doing this after the sort rather than during it.
      deepest = Math.max(deepest, (depth.get(read) ?? 0) + 1);
    }
    depth.set(key, deepest);
  }

  return { order, dependents, depth, rollForward: rollForward.sort() };
}
