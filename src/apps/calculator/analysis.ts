/**
 * Calculator — the two finance panels' state.
 *
 * Both are edited as *text*, not numbers. A field bound to a number cannot hold
 * `-`, or `1.`, or empty, which are all things a person types on the way to a
 * value; parsing on every keystroke and writing the parse back is how a form
 * fights the person filling it in. So the strings are the state, and the model is
 * derived from them on each render.
 *
 * The rate a person enters is the annual nominal rate, because that is what a
 * contract quotes. Everything below the surface is periodic — the conversion is
 * `annual / 100 / periodsPerYear`, and it is applied in one place so a twelve-
 * payment year and a four-payment year cannot disagree.
 */
import { useCallback, useMemo, useState } from 'react';
import { fmt } from '@/platform/sdk';
import {
  type AmortRow,
  type ProfilePoint,
  type Solve,
  type Timing,
  type Tvm,
  amortize,
  amortizeTotals,
  irr,
  mirr,
  npv,
  npvProfile,
  payback,
  profitabilityIndex,
  solveFv,
  solveNper,
  solvePmt,
  solvePv,
  solveRate,
} from './finance';

/** Which of the five keys is being solved for — the `CPT` of a business calculator. */
export type TvmTarget = 'n' | 'rate' | 'pv' | 'pmt' | 'fv';

export interface TvmInputs {
  readonly n: string;
  /** Annual nominal rate, in percent. */
  readonly rate: string;
  readonly pv: string;
  readonly pmt: string;
  readonly fv: string;
  readonly perYear: string;
}

export type TvmField = keyof TvmInputs;

/**
 * A five-year instalment plan at 7.5% nominal, which is the shape of the finance
 * this OS is asked about most. Seeding the form with a real case means the panel
 * answers something the moment it opens instead of showing five empty boxes.
 */
const SEED_TVM: TvmInputs = { n: '60', rate: '7.5', pv: '2400000', pmt: '', fv: '0', perYear: '12' };

const number = (text: string): number => fmt.parseAmount(text) ?? 0;

export interface TvmModel {
  readonly inputs: TvmInputs;
  readonly set: (field: TvmField, value: string) => void;
  readonly target: TvmTarget;
  readonly setTarget: (next: TvmTarget) => void;
  readonly timing: Timing;
  readonly setTiming: (next: Timing) => void;
  /** The answer, already converted to the unit the field is labelled in. */
  readonly result: Solve;
  /** All five values, periodic, once the target is solved — `null` if it is not. */
  readonly resolved: Tvm | null;
  readonly schedule: readonly AmortRow[];
  readonly totals: { readonly paid: number; readonly interest: number } | null;
  readonly reset: () => void;
}

function solveFor(target: TvmTarget, tvm: Tvm): Solve {
  if (target === 'pmt') return solvePmt(tvm);
  if (target === 'pv') return solvePv(tvm);
  if (target === 'fv') return solveFv(tvm);
  if (target === 'n') return solveNper(tvm);
  return solveRate(tvm);
}

export function useTvm(): TvmModel {
  const [inputs, setInputs] = useState<TvmInputs>(SEED_TVM);
  const [target, setTarget] = useState<TvmTarget>('pmt');
  const [timing, setTiming] = useState<Timing>('end');

  const model = useMemo(() => {
    const perYear = Math.max(number(inputs.perYear), 1);
    const periodic = number(inputs.rate) / 100 / perYear;
    const draft: Tvm = {
      n: number(inputs.n),
      i: periodic,
      pv: number(inputs.pv),
      pmt: number(inputs.pmt),
      fv: number(inputs.fv),
      timing,
    };
    const answer = solveFor(target, draft);
    if (!answer.ok) return { result: answer, resolved: null, schedule: [] as readonly AmortRow[], totals: null };
    // Put the answer back where it belongs before deriving anything from it.
    const resolved: Tvm = {
      ...draft,
      n: target === 'n' ? answer.value : draft.n,
      i: target === 'rate' ? answer.value : draft.i,
      pv: target === 'pv' ? answer.value : draft.pv,
      pmt: target === 'pmt' ? answer.value : draft.pmt,
      fv: target === 'fv' ? answer.value : draft.fv,
    };
    // The rate is solved per period and read back as the annual nominal percent.
    const result: Solve = target === 'rate' ? { ok: true, value: answer.value * perYear * 100 } : answer;
    const schedule = amortize(resolved);
    return {
      result,
      resolved,
      schedule,
      totals: schedule.length === 0 ? null : amortizeTotals(schedule),
    };
  }, [inputs, target, timing]);

  const set = useCallback((field: TvmField, value: string) => {
    setInputs((previous) => ({ ...previous, [field]: value }));
  }, []);

  return {
    inputs,
    set,
    target,
    setTarget,
    timing,
    setTiming,
    result: model.result,
    resolved: model.resolved,
    schedule: model.schedule,
    totals: model.totals,
    reset: () => {
      setInputs(SEED_TVM);
      setTarget('pmt');
      setTiming('end');
    },
  };
}

/* ------------------------------------------------------------------ *
 * Cash flow
 * ------------------------------------------------------------------ */

/** One period's net cash. The row's position *is* its period; index 0 is today. */
export interface FlowRow {
  readonly id: string;
  readonly amount: string;
}

let flowSequence = 0;
const flowRow = (amount: string): FlowRow => {
  flowSequence += 1;
  return { id: `flow-${flowSequence}`, amount };
};

/** An outlay followed by five improving years — a project worth deciding about. */
const SEED_FLOWS: readonly string[] = ['-1200000', '340000', '360000', '380000', '400000', '420000'];

export interface CashflowMetrics {
  readonly npv: number;
  readonly irr: Solve;
  readonly mirr: Solve;
  readonly payback: Solve;
  readonly discounted: Solve;
  readonly index: Solve;
}

export interface CashflowModel {
  readonly rows: readonly FlowRow[];
  readonly rate: string;
  readonly setRate: (next: string) => void;
  readonly financeRate: string;
  readonly setFinanceRate: (next: string) => void;
  readonly reinvestRate: string;
  readonly setReinvestRate: (next: string) => void;
  readonly flows: readonly number[];
  readonly metrics: CashflowMetrics;
  readonly profile: readonly ProfilePoint[];
  readonly set: (id: string, amount: string) => void;
  readonly add: () => void;
  readonly remove: (id: string) => void;
  readonly reset: () => void;
}

export function useCashflow(): CashflowModel {
  const [rows, setRows] = useState<readonly FlowRow[]>(() => SEED_FLOWS.map(flowRow));
  const [rate, setRate] = useState('12');
  const [financeRate, setFinanceRate] = useState('9');
  const [reinvestRate, setReinvestRate] = useState('6');

  const flows = useMemo(() => rows.map((row) => number(row.amount)), [rows]);
  const discount = number(rate) / 100;

  const metrics = useMemo<CashflowMetrics>(
    () => ({
      npv: npv(discount, flows),
      irr: irr(flows),
      mirr: mirr(flows, number(financeRate) / 100, number(reinvestRate) / 100),
      payback: payback(flows),
      discounted: payback(flows, discount),
      index: profitabilityIndex(discount, flows),
    }),
    [flows, discount, financeRate, reinvestRate],
  );

  // Plotted a little past the IRR when there is one, so the crossing is visible.
  const profile = useMemo(() => {
    const crossing = metrics.irr.ok ? metrics.irr.value : discount;
    return npvProfile(flows, Math.max(crossing * 1.6, discount * 2, 0.1));
  }, [flows, metrics.irr, discount]);

  return {
    rows,
    rate,
    setRate,
    financeRate,
    setFinanceRate,
    reinvestRate,
    setReinvestRate,
    flows,
    metrics,
    profile,
    set: (id, amount) => setRows((current) => current.map((row) => (row.id === id ? { ...row, amount } : row))),
    add: () => setRows((current) => [...current, flowRow('0')]),
    remove: (id) => setRows((current) => (current.length <= 2 ? current : current.filter((row) => row.id !== id))),
    reset: () => setRows(SEED_FLOWS.map(flowRow)),
  };
}
