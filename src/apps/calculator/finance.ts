/**
 * Calculator — the finance engine.
 *
 * Two families, both pure. The five-key time-value-of-money solver (N, I/Y, PV,
 * PMT, FV — give any four and the fifth is determined) and discounted cash-flow
 * measures (NPV, IRR, MIRR, payback, profitability index).
 *
 * The sign convention is the one every business calculator and spreadsheet uses,
 * and it is not decoration: money received is positive, money paid is negative,
 * and the whole equation balances to zero. A borrower therefore enters PV as a
 * positive number and reads PMT back as a negative one. Getting this wrong is the
 * single most common way a loan calculation comes out plausible and false, so the
 * equation is written once, here, and every solver is an inversion of it:
 *
 *     PV·(1+i)^n  +  PMT·k·((1+i)^n − 1)/i  +  FV  =  0        k = 1+i in begin mode
 *
 * Rates are periodic decimals throughout (0.005 for 0.5% a month). Converting an
 * annual nominal rate into that is the caller's job, because whether a year has
 * twelve compounding periods or four is a question about the instrument, not about
 * arithmetic.
 */

/** When each payment lands inside its period — ordinary annuity or annuity-due. */
export type Timing = 'end' | 'begin';

export interface Tvm {
  /** Number of periods. Fractional periods are permitted; `NPER` returns them. */
  readonly n: number;
  /** Periodic interest rate as a decimal. */
  readonly i: number;
  readonly pv: number;
  readonly pmt: number;
  readonly fv: number;
  readonly timing: Timing;
}

export type SolveReason = 'noSolution' | 'needsSignChange' | 'degenerate' | 'notConverged';

export type Solve = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: SolveReason };

const solved = (value: number): Solve =>
  Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'noSolution' };

const failed = (reason: SolveReason): Solve => ({ ok: false, reason });

/** Rates below −100% are not a lower bracket for a search; they are nonsense. */
const RATE_FLOOR = -0.999999;
const RATE_CEIL = 100;

/** Growth factor and annuity factor — the two pieces every formula below shares. */
const growth = (i: number, n: number): number => Math.pow(1 + i, n);
const annuity = (i: number, n: number): number => (i === 0 ? n : (growth(i, n) - 1) / i);
const due = (i: number, timing: Timing): number => (timing === 'begin' ? 1 + i : 1);

/**
 * The residual of the TVM equation. Zero means the five values are consistent;
 * the sign tells a solver which way to move.
 */
export function residual(tvm: Tvm): number {
  const { n, i, pv, pmt, fv, timing } = tvm;
  return pv * growth(i, n) + pmt * due(i, timing) * annuity(i, n) + fv;
}

export function solvePmt(tvm: Omit<Tvm, 'pmt'>): Solve {
  const { n, i, pv, fv, timing } = tvm;
  if (n === 0) return failed('degenerate');
  const factor = due(i, timing) * annuity(i, n);
  if (factor === 0) return failed('degenerate');
  return solved(-(pv * growth(i, n) + fv) / factor);
}

export function solvePv(tvm: Omit<Tvm, 'pv'>): Solve {
  const { n, i, pmt, fv, timing } = tvm;
  return solved(-(fv + pmt * due(i, timing) * annuity(i, n)) / growth(i, n));
}

export function solveFv(tvm: Omit<Tvm, 'fv'>): Solve {
  const { n, i, pv, pmt, timing } = tvm;
  return solved(-(pv * growth(i, n) + pmt * due(i, timing) * annuity(i, n)));
}

/**
 * Periods. Closed form: with `g = (1+i)^n`, the equation rearranges to
 * `g·(PV + PMT·k/i) = PMT·k/i − FV`, so `n = ln g / ln(1+i)`.
 */
export function solveNper(tvm: Omit<Tvm, 'n'>): Solve {
  const { i, pv, pmt, fv, timing } = tvm;
  if (i === 0) return pmt === 0 ? failed('degenerate') : solved(-(pv + fv) / pmt);
  const level = (pmt * due(i, timing)) / i;
  const numerator = level - fv;
  const denominator = pv + level;
  if (denominator === 0 || numerator / denominator <= 0) return failed('noSolution');
  return solved(Math.log(numerator / denominator) / Math.log(1 + i));
}

/**
 * The rate. There is no closed form, so it is bracketed and bisected — slower
 * than Newton and immune to the divergence Newton shows when the derivative is
 * near zero, which for a long amortising loan it very nearly is.
 */
export function solveRate(tvm: Omit<Tvm, 'i'>): Solve {
  const { n, pv, pmt, fv, timing } = tvm;
  if (n <= 0) return failed('degenerate');
  return bisect((rate) => residual({ n, i: rate, pv, pmt, fv, timing }));
}

/**
 * Sign-change search followed by bisection. Both `solveRate` and `irr` need the
 * same thing: the one rate where a monotone-ish function crosses zero.
 */
function bisect(fn: (rate: number) => number, floor = RATE_FLOOR, ceil = RATE_CEIL): Solve {
  let low = floor;
  let atLow = fn(low);
  if (atLow === 0) return solved(low);
  const STEPS = 400;
  for (let step = 1; step <= STEPS; step += 1) {
    // Geometric-ish walk: dense where real rates live, still reaching 10 000%.
    const high = floor + (ceil - floor) * Math.pow(step / STEPS, 3);
    const atHigh = fn(high);
    if (atHigh === 0) return solved(high);
    if (Number.isFinite(atHigh) && Number.isFinite(atLow) && atLow * atHigh < 0) {
      return refine(fn, low, high);
    }
    low = high;
    atLow = atHigh;
  }
  return failed('needsSignChange');
}

function refine(fn: (rate: number) => number, from: number, to: number): Solve {
  let low = from;
  let high = to;
  let atLow = fn(low);
  for (let pass = 0; pass < 200; pass += 1) {
    const mid = (low + high) / 2;
    const atMid = fn(mid);
    if (atMid === 0 || high - low < 1e-12) return solved(mid);
    if (atLow * atMid < 0) high = mid;
    else {
      low = mid;
      atLow = atMid;
    }
  }
  return failed('notConverged');
}

/* ------------------------------------------------------------------ *
 * Amortisation
 * ------------------------------------------------------------------ */

export interface AmortRow {
  readonly period: number;
  readonly opening: number;
  readonly payment: number;
  readonly interest: number;
  readonly principal: number;
  readonly closing: number;
}

/** A schedule longer than this is a chart, not a table anyone reads. */
const MAX_ROWS = 600;

/**
 * The payment-by-payment split. Presented in magnitudes rather than signed cash
 * flows, because a schedule is read as a balance coming down — the last row's
 * payment absorbs the rounding so the closing balance lands exactly on zero,
 * which is what a lender's own schedule does.
 */
export function amortize(tvm: Tvm): readonly AmortRow[] {
  const periods = Math.min(Math.floor(tvm.n), MAX_ROWS);
  if (periods <= 0) return [];
  const rate = tvm.i;
  const level = Math.abs(tvm.pmt);
  const rows: AmortRow[] = [];
  let balance = Math.abs(tvm.pv);
  for (let period = 1; period <= periods; period += 1) {
    const base = tvm.timing === 'begin' ? Math.max(balance - level, 0) : balance;
    const interest = base * rate;
    const last = period === periods;
    const payment = last ? balance + interest : level;
    const principal = payment - interest;
    const closing = last ? 0 : Math.max(balance - principal, 0);
    rows.push({ period, opening: balance, payment, interest, principal, closing });
    balance = closing;
    if (balance === 0 && !last) break;
  }
  return rows;
}

export interface AmortTotals {
  readonly paid: number;
  readonly interest: number;
}

/**
 * What the schedule adds up to. Summed from the rows rather than as `pmt × n` so
 * the figure quoted as "total interest" is the same arithmetic the table shows,
 * including the final payment's rounding.
 */
export function amortizeTotals(rows: readonly AmortRow[]): AmortTotals {
  let paid = 0;
  let interest = 0;
  for (const row of rows) {
    paid += row.payment;
    interest += row.interest;
  }
  return { paid, interest };
}

/* ------------------------------------------------------------------ *
 * Discounted cash flow
 * ------------------------------------------------------------------ */

/** Flows are periodic and positional: index 0 is time zero, index 1 is period 1. */
export function npv(rate: number, flows: readonly number[]): number {
  let total = 0;
  for (const [period, flow] of flows.entries()) total += flow / Math.pow(1 + rate, period);
  return total;
}

/**
 * The rate at which NPV is zero. A series with no sign change has no IRR — that
 * is a property of the cash flows, not a failure of the search, so it is reported
 * rather than papered over with a plausible-looking number.
 */
export function irr(flows: readonly number[]): Solve {
  if (flows.length < 2) return failed('degenerate');
  const positive = flows.some((flow) => flow > 0);
  const negative = flows.some((flow) => flow < 0);
  if (!positive || !negative) return failed('needsSignChange');
  return bisect((rate) => npv(rate, flows));
}

/**
 * Modified IRR — outflows financed at one rate, inflows reinvested at another.
 * It exists because plain IRR silently assumes every interim receipt earns the
 * IRR itself, which for a project returning 40% is a claim nobody would make out
 * loud.
 */
export function mirr(flows: readonly number[], financeRate: number, reinvestRate: number): Solve {
  const periods = flows.length - 1;
  if (periods <= 0) return failed('degenerate');
  let inflowFv = 0;
  let outflowPv = 0;
  for (const [period, flow] of flows.entries()) {
    if (flow > 0) inflowFv += flow * Math.pow(1 + reinvestRate, periods - period);
    else outflowPv += flow / Math.pow(1 + financeRate, period);
  }
  if (outflowPv === 0 || inflowFv === 0) return failed('needsSignChange');
  return solved(Math.pow(inflowFv / -outflowPv, 1 / periods) - 1);
}

/**
 * Periods until cumulative cash turns positive, interpolated inside the period it
 * happens in. `rate` of zero gives plain payback; a positive rate gives the
 * discounted kind.
 */
export function payback(flows: readonly number[], rate = 0): Solve {
  let cumulative = 0;
  for (const [period, flow] of flows.entries()) {
    const discounted = flow / Math.pow(1 + rate, period);
    const before = cumulative;
    cumulative += discounted;
    if (before < 0 && cumulative >= 0 && discounted !== 0) {
      return solved(period - 1 + -before / discounted);
    }
  }
  return failed('noSolution');
}

/** PV of what comes back, per unit of what goes in. Above 1 is worth doing. */
export function profitabilityIndex(rate: number, flows: readonly number[]): Solve {
  const outlay = flows[0] ?? 0;
  if (outlay >= 0) return failed('degenerate');
  // `slice(1)` shifts every flow one period early, so the sum is discounted once more.
  return solved(npv(rate, flows.slice(1)) / (1 + rate) / -outlay);
}

export interface ProfilePoint {
  readonly rate: number;
  readonly npv: number;
}

/**
 * NPV against discount rate. The curve is the honest picture of a project: where
 * it crosses zero is the IRR, and how steeply it crosses is how much that IRR is
 * worth trusting.
 */
export function npvProfile(flows: readonly number[], to = 0.5, steps = 60): readonly ProfilePoint[] {
  const points: ProfilePoint[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const rate = (to * step) / steps;
    points.push({ rate, npv: npv(rate, flows) });
  }
  return points;
}
