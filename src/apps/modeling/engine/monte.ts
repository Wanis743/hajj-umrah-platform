/**
 * The same model, ten thousand times, with the inputs drawn rather than chosen.
 *
 * A scenario answers "what if these numbers were those numbers". Three scenarios answer it three
 * times, and a board reads them as a range — which is the mistake, because nothing about a base,
 * an upside and a downside says how likely any of them is, and the three were almost always
 * built by moving every assumption in the same direction at once. That last part is what makes a
 * downside case useless as a risk estimate: every driver hitting its bad end together is a much
 * rarer event than any of them doing so, so the "downside" is simultaneously too pessimistic to
 * plan against and silent about the far more likely case where two things go wrong and one goes
 * right.
 *
 * So this draws instead. Every assumption with a distribution gets a value per iteration, the
 * model runs, and the target is recorded; ten thousand of those make a distribution of outcomes
 * with percentiles somebody can actually decide against — "P10 cash is 2.1m" rather than "the
 * downside says 1.4m".
 *
 * Two commitments make the output usable as evidence rather than as a colour. The draws come from
 * a seeded generator, so the same model and the same seed give the same P10 forever and a number
 * in a board pack can be reproduced six months later; ./version hashes what was run so it can be
 * proved to be the same model. And the parameters are the assumptions' own declared `value`, `low`
 * and `high` rather than a second registry — a simulation configured somewhere else drifts out of
 * step with the model it claims to describe, and then reports risk about a plan nobody is running.
 *
 * The honest limitation, stated here because ./certify reports it and a reader should not have to
 * discover it: draws are independent. Real drivers are not — price and volume move together, and
 * so do occupancy and rate — and independence understates the tails, because it lets one bad draw
 * be cancelled by a good one that in reality would have moved the same way. A correlated draw
 * needs a correlation matrix somebody has actually estimated, and inventing one here would trade a
 * stated limitation for a hidden fabrication.
 */
import { runCompiled } from './model';
import type { CompiledModel, ModelFailure } from './model';
import { measureRun } from './sensitivity';
import type { Target } from './sensitivity';
import type { Assumption } from './scenario';

/**
 * The shape of an assumption's uncertainty.
 *
 * Four shapes and a way to opt out, because the choice of shape is a claim about the world and
 * these are the four claims a planner can actually defend:
 *
 * - `UNIFORM`: anything in the range, nothing more likely than anything else. The right shape for
 *   genuine ignorance between two bounds, and the wrong one for almost everything else — it says
 *   the edge of the range is exactly as likely as the middle.
 * - `TRIANGULAR`: the declared value is the most likely, the bounds are the extremes, and it falls
 *   off linearly between. The workhorse, because it is the shape somebody has already described
 *   when they wrote down a low, a value and a high.
 * - `NORMAL`: symmetric around the value, with the range read as a 90% interval rather than a
 *   hard bound. Draws can land outside `low`..`high`, deliberately — a normal that could not is a
 *   truncated normal, and nobody means that when they say "normal".
 * - `LOGNORMAL`: multiplicative, right-skewed, floored above zero. What a growth rate or a cost
 *   overrun actually looks like: it can double but it cannot go below nothing.
 * - `FIXED`: not drawn. Held at the scenario's value in every iteration, so that an assumption
 *   nobody has an opinion about does not get an invented one.
 */
export type DistributionKind = 'UNIFORM' | 'TRIANGULAR' | 'NORMAL' | 'LOGNORMAL' | 'FIXED';

/** Which shape to draw one assumption from. The numbers are the assumption's own. */
export interface Draw {
  readonly key: string;
  readonly kind: DistributionKind;
}

export type MonteIssueKind =
  /** A draw on a key no assumption declares. */
  | 'NOT_DECLARED'
  /** A drawn assumption with no `low`, no `high`, or neither. There is nothing to draw between. */
  | 'NO_RANGE'
  /** `low` equals `high`. Declare it `FIXED` instead of drawing N identical numbers and calling
   *  the zero-width result a distribution. */
  | 'EMPTY_RANGE'
  /** `LOGNORMAL` with a bound or a value at or below zero. The log of that does not exist, and
   *  substituting a small positive number would answer a question nobody asked. */
  | 'NOT_POSITIVE'
  /** Fewer than two iterations, or more than the cap. */
  | 'BAD_ITERATIONS'
  /** The target names a row the run has no series for. */
  | 'NO_TARGET'
  /** The model did not run. */
  | 'RUN_FAILED';

export interface MonteIssue {
  readonly kind: MonteIssueKind;
  readonly where: string;
  /** Only for RUN_FAILED; null otherwise. */
  readonly failure: ModelFailure | null;
}

/** One bar of the outcome histogram. `from` inclusive, `to` exclusive, except the last bin,
 *  which includes its upper edge so the maximum lands somewhere. */
export interface Bin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

/**
 * The chance the target ends at or below a number somebody cares about.
 *
 * The output that makes a simulation a decision rather than a chart. A covenant, a funding
 * requirement and a bonus threshold are all questions of this shape, and the answer to "how often
 * do we breach" is the one number a percentile table does not directly give.
 */
export interface Threshold {
  readonly at: number;
  readonly atOrBelow: number;
  readonly probability: number;
}

export interface Percentiles {
  readonly p5: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
}

export interface Simulation {
  readonly target: Target;
  readonly seed: number;
  readonly iterations: number;
  /** What the model says with no draws at all. Kept because the base is almost never the median,
   *  and the gap between them is itself a finding: a plan sitting at its own P70 is a plan whose
   *  assumptions are optimistic in aggregate, however reasonable each looked alone. */
  readonly baseResult: number;
  readonly mean: number;
  /** Sample standard deviation, over `iterations − 1`. */
  readonly stdev: number;
  readonly min: number;
  readonly max: number;
  readonly percentiles: Percentiles;
  /**
   * How precise `mean` is: `stdev / sqrt(iterations)`.
   *
   * Reported because iterations are a choice and this is the only thing that says whether the
   * choice was enough. A mean of 4.0m with a standard error of 300k has not settled, and a reader
   * shown only the mean has no way to know that the fourth digit is noise from the seed.
   */
  readonly standardError: number;
  readonly bins: readonly Bin[];
  readonly thresholds: readonly Threshold[];
  /** Keys held at the scenario value: everything `FIXED`, and everything nobody gave a draw for.
   *  Sorted, and reported for the same reason ./sensitivity reports `unranged` — a simulation
   *  that hides which inputs were never varied overstates how much of the model it stressed. */
  readonly held: readonly string[];
}

export type MonteResult =
  | { readonly ok: true; readonly simulation: Simulation }
  | { readonly ok: false; readonly issues: readonly MonteIssue[] };

/** Above this the wait stops being worth the fourth digit: the standard error falls as the square
 *  root of the count, so a hundred thousand iterations buys about 3× the precision of ten
 *  thousand for 10× the time, and no planning input is known well enough to deserve it. */
export const MAX_ITERATIONS = 100_000;

/* -------------------------------------------------------------------- noise ---- */

/**
 * mulberry32: one 32-bit state, one multiply-xorshift round, uniform on [0, 1).
 *
 * Written out rather than reached for because the platform's built-in generator cannot be seeded,
 * and a simulation that cannot be reproduced is an anecdote. Small, fast, and good enough by a wide
 * margin for this purpose — it passes the practical randomness tests at this scale, and nothing here
 * is cryptographic. It must never be used for anything that is: this is a plotting tool, and its
 * output is predictable by design.
 *
 * The name of that built-in is deliberately not written anywhere in this file. scripts/verify-source.mjs
 * bans the call outright, with a directory exemption only for the vendored charts, and the ban is
 * worth more than the prose: this is the one file in the repository most likely to reach for it, so an
 * exemption here would blind the gate exactly where it needs to see.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The span between the declared bounds, in standard deviations, for the two unbounded shapes.
 *
 * `low`..`high` is read as a 5th-to-95th-percentile interval, and that span is 2 × 1.6449 σ. The
 * alternative reading — bounds as ±1σ — would call a two-thirds-confidence guess a plausible
 * range and produce a distribution a third of whose draws sit outside the numbers somebody wrote
 * down. Ninety percent is what people mean by "it should be between these".
 */
const NINETY_PERCENT_SPAN = 3.2897;

/** Box–Muller, one of the pair kept. The second value is discarded rather than cached: caching it
 *  makes a draw's value depend on how many draws came before it in the same iteration, so adding
 *  a distribution to one assumption would silently change every other assumption's stream and the
 *  seed would stop meaning what it says. */
function standardNormal(next: () => number): number {
  // Shifted off zero because `Math.log(0)` is −Infinity. `next()` is on [0, 1), so `1 − u` is on
  // (0, 1] and the log is finite for every value the generator can produce.
  const radius = Math.sqrt(-2 * Math.log(1 - next()));
  return radius * Math.cos(2 * Math.PI * next());
}

/**
 * Triangular by inverse CDF, so one uniform draw gives one sample with no rejection loop.
 *
 * The mode is clamped into the range rather than refused. An assumption whose declared value sits
 * outside its own declared bounds is a registry that contradicts itself — ./certify says so once,
 * where it can be fixed — and refusing every iteration of a ten-thousand-run simulation over it
 * would report the contradiction as a simulation failure at the least useful possible moment.
 */
function triangular(next: () => number, low: number, high: number, mode: number): number {
  const peak = Math.min(Math.max(mode, low), high);
  const width = high - low;
  const split = (peak - low) / width;
  const draw = next();
  if (draw < split) return low + Math.sqrt(draw * width * (peak - low));
  return high - Math.sqrt((1 - draw) * width * (high - peak));
}

/**
 * One value for one assumption.
 *
 * Every branch is reached exactly once per iteration per drawn assumption, and every branch is
 * total: the parameters were validated before the first iteration, so nothing here needs to check
 * a bound or fall back to a default. Any `FIXED` key never arrives — it is filtered out where the
 * plan is built, so that the generator is not advanced for an assumption nobody is varying.
 */
function sample(next: () => number, kind: DistributionKind, one: Assumption): number {
  const low = one.low ?? one.value;
  const high = one.high ?? one.value;
  switch (kind) {
    case 'UNIFORM':
      return low + next() * (high - low);
    case 'TRIANGULAR':
      return triangular(next, low, high, one.value);
    case 'NORMAL':
      return one.value + standardNormal(next) * ((high - low) / NINETY_PERCENT_SPAN);
    case 'LOGNORMAL': {
      // Drawn on the log scale and exponentiated, which is what makes it multiplicative: the
      // declared value is the median rather than the mean, and the result cannot reach zero.
      const spread = (Math.log(high) - Math.log(low)) / NINETY_PERCENT_SPAN;
      return Math.exp(Math.log(one.value) + standardNormal(next) * spread);
    }
    case 'FIXED':
    default:
      return one.value;
  }
}

/* --------------------------------------------------------------------- plan ---- */

interface Planned {
  readonly kind: DistributionKind;
  readonly assumption: Assumption;
}

interface PlanOk {
  readonly ok: true;
  readonly planned: readonly Planned[];
  readonly held: readonly string[];
}

type PlanOutcome = PlanOk | { readonly ok: false; readonly issues: readonly MonteIssue[] };

const monteIssue = (
  kind: MonteIssueKind,
  where: string,
  failure: ModelFailure | null = null,
): MonteIssue => ({ kind, where, failure });

/**
 * Settle every distribution before the first iteration.
 *
 * All of it up front, and all of the problems at once. A simulation that validated lazily would
 * discover on iteration 6,000 that one assumption's bounds cross zero, having already spent the
 * time; and a reader fixing a model's draw configuration wants the whole list, not the first
 * entry followed by another five-second wait.
 *
 * Order is the registry's, then sorted for the held list, so the same model and the same draws
 * advance the generator in the same sequence every time. Without that the seed would be
 * meaningless — two runs of one model would draw the same numbers in a different order and
 * produce different percentiles.
 */
function plan(model: CompiledModel, draws: readonly Draw[]): PlanOutcome {
  const wanted = new Map(draws.map((one) => [one.key, one.kind]));
  const issues: MonteIssue[] = [];
  for (const key of [...wanted.keys()].sort()) {
    if (!model.spec.assumptions.some((one) => one.key === key)) {
      issues.push(monteIssue('NOT_DECLARED', key));
    }
  }

  const planned: Planned[] = [];
  const held: string[] = [];

  for (const assumption of model.spec.assumptions) {
    const kind = wanted.get(assumption.key);
    if (kind === undefined || kind === 'FIXED') {
      held.push(assumption.key);
      continue;
    }
    const { low, high, value } = assumption;
    if (low === null || high === null) {
      issues.push(monteIssue('NO_RANGE', assumption.key));
      continue;
    }
    if (low === high) {
      issues.push(monteIssue('EMPTY_RANGE', assumption.key));
      continue;
    }
    if (kind === 'LOGNORMAL' && (low <= 0 || high <= 0 || value <= 0)) {
      issues.push(monteIssue('NOT_POSITIVE', assumption.key));
      continue;
    }
    planned.push({ kind, assumption });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, planned, held: held.sort() };
}

/* ----------------------------------------------------------------- statistics ---- */

/**
 * Linear interpolation between order statistics, on an already-sorted sample.
 *
 * The same convention as `PERCENTILE.INC` and R's default, chosen because it is the one a reader
 * can check against a spreadsheet. The alternative — taking the nearest observation — makes the
 * P10 of ten thousand draws jump in visible steps as the seed changes, which reads as instability
 * in the model rather than in the estimator.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * fraction;
  const lower = Math.floor(rank);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * Equal-width bins over the observed range.
 *
 * Equal-width rather than equal-count, because the shape is the point: a histogram with equal
 * counts per bin is flat by construction and would draw every distribution as a rectangle. The
 * degenerate case — every draw identical, which happens when the target does not depend on any
 * drawn assumption — is one bin of zero width rather than N empty ones, so that a screen shows a
 * spike and the reader asks the right question.
 */
function histogram(sorted: readonly number[], count: number): Bin[] {
  if (sorted.length === 0) return [];
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (low === high) return [{ from: low, to: high, count: sorted.length }];

  const width = (high - low) / count;
  const counts = new Array<number>(count).fill(0);
  for (const value of sorted) {
    // The maximum belongs to the last bin, not to a phantom bin above it.
    const index = Math.min(Math.floor((value - low) / width), count - 1);
    counts[index] += 1;
  }
  return counts.map((tally, index) => ({
    from: low + width * index,
    to: index === count - 1 ? high : low + width * (index + 1),
    count: tally,
  }));
}

/** Sample standard deviation, over `n − 1`. The population form would understate the spread of a
 *  sample, and every one of these is a sample of a distribution nobody can enumerate. */
function deviation(samples: readonly number[], mean: number): number {
  if (samples.length < 2) return 0;
  let total = 0;
  for (const value of samples) total += (value - mean) * (value - mean);
  return Math.sqrt(total / (samples.length - 1));
}

/* ----------------------------------------------------------------- simulate ---- */

export interface MonteSettings {
  /** Any integer. The same seed and the same model give the same answer, which is the whole
   *  reason a seed is a parameter rather than a timestamp. */
  readonly seed?: number;
  readonly iterations?: number;
  /** Histogram resolution. */
  readonly bins?: number;
  /** Target values to report the probability of landing at or below. */
  readonly thresholds?: readonly number[];
}

/**
 * The whole thing: validate, draw, run, summarise.
 *
 * One pass, storing only the measured target per iteration rather than the runs. Ten thousand full
 * `ModelRun`s of a hundred-row model is millions of numbers nobody will read; the summary is what
 * anybody looks at, and keeping the samples is what allows the percentiles and the histogram to be
 * exact rather than accumulated approximations.
 *
 * The base is measured last, with no probe, so that a failure of the ordinary run cannot be blamed
 * on the draws. It is reported beside the distribution because the two together answer the
 * question the distribution alone does not: not "what is the range" but "where in the range is the
 * number we have been telling people".
 */
export function simulate(
  model: CompiledModel,
  scenarioId: string,
  target: Target,
  draws: readonly Draw[],
  settings: MonteSettings = {},
): MonteResult {
  const iterations = settings.iterations ?? 10_000;
  if (iterations < 2 || iterations > MAX_ITERATIONS) {
    return { ok: false, issues: [monteIssue('BAD_ITERATIONS', String(iterations))] };
  }

  const prepared = plan(model, draws);
  if (!prepared.ok) return { ok: false, issues: prepared.issues };

  const seed = settings.seed ?? 1;
  const next = mulberry32(seed);
  const samples: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const probe = new Map<string, number>();
    for (const one of prepared.planned) {
      probe.set(one.assumption.key, sample(next, one.kind, one.assumption));
    }
    const run = runCompiled(model, scenarioId, probe);
    if (!run.ok) {
      return { ok: false, issues: [monteIssue('RUN_FAILED', scenarioId, run.failure)] };
    }
    const measured = measureRun(run.run, target);
    if (measured === undefined) {
      return { ok: false, issues: [monteIssue('NO_TARGET', target.key)] };
    }
    samples.push(measured);
  }

  const base = runCompiled(model, scenarioId);
  if (!base.ok) {
    return { ok: false, issues: [monteIssue('RUN_FAILED', scenarioId, base.failure)] };
  }
  const baseResult = measureRun(base.run, target);
  if (baseResult === undefined) {
    return { ok: false, issues: [monteIssue('NO_TARGET', target.key)] };
  }

  return {
    ok: true,
    simulation: summarise(
      samples,
      target,
      seed,
      baseResult,
      settings.bins ?? 24,
      settings.thresholds ?? [],
      prepared.held,
    ),
  };
}

/** Sorted once, and every order statistic read off that one copy: seven percentiles, a min, a max
 *  and a histogram would otherwise be nine walks or nine sorts of ten thousand numbers. */
function summarise(
  samples: readonly number[],
  target: Target,
  seed: number,
  baseResult: number,
  bins: number,
  thresholds: readonly number[],
  held: readonly string[],
): Simulation {
  const sorted = [...samples].sort((left, right) => left - right);
  let total = 0;
  for (const value of samples) total += value;
  const mean = total / samples.length;
  const stdev = deviation(samples, mean);

  return {
    target,
    seed,
    iterations: samples.length,
    baseResult,
    mean,
    stdev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    percentiles: {
      p5: percentile(sorted, 0.05),
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      p95: percentile(sorted, 0.95),
    },
    standardError: stdev / Math.sqrt(samples.length),
    bins: histogram(sorted, Math.max(1, bins)),
    thresholds: [...thresholds].sort((left, right) => left - right).map((at) => {
      let atOrBelow = 0;
      for (const value of sorted) {
        if (value > at) break;
        atOrBelow += 1;
      }
      return { at, atOrBelow, probability: atOrBelow / sorted.length };
    }),
    held,
  };
}
