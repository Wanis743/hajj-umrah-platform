/**
 * Sheets — dates and money.
 *
 * A date in a spreadsheet is a number: day 1 is 1900-01-01 and the fraction is the
 * time of day, which is the only representation in which `=B2-B1` gives you a
 * count of days for free. Rendering it as a date is the *cell's* job, so this file
 * never formats anything — it converts, and `workbook.ts` decides how it looks.
 *
 * The finance functions follow Excel's sign convention rather than inventing a
 * kinder one: money you receive is positive, money you pay is negative, so `PMT`
 * on a loan comes back negative. Anyone checking this sheet against a bank's
 * amortisation table needs the two to agree, and a sheet that flipped the sign to
 * be friendly would be the one that gets the audit wrong.
 */
import {
  type Arg,
  type CellValue,
  type FunctionTable,
  type SheetFunction,
  argAt,
  argInt,
  argNumber,
  err,
  fn,
  isValue,
  num,
  numbersOf,
} from './values';

/** Excel's epoch: serial 1 is 1900-01-01, so the zero day is 1899-12-30. */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const serialOf = (utc: number): number => (utc - EPOCH) / DAY_MS;
const dateOf = (serial: number): Date => new Date(EPOCH + Math.round(serial * DAY_MS));

/** Today at midnight, read in the user's own timezone and stored as UTC noonless. */
function todaySerial(): number {
  const now = new Date();
  return serialOf(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function nowSerial(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsed = now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1000;
  return serialOf(midnight) + elapsed / DAY_MS;
}

/** One serial in, one field out — the `YEAR`/`MONTH`/`DAY` shape. */
const field = (read: (date: Date, serial: number) => number): SheetFunction => (args) => {
  const serial = argNumber(args, 0);
  if (isValue(serial)) return serial;
  if (serial < 0) return err('#NUM!');
  return num(read(dateOf(serial), serial));
};

const DATES: FunctionTable = {
  TODAY: fn('TODAY()', 0, 0, () => num(todaySerial())),
  NOW: fn('NOW()', 0, 0, () => num(nowSerial())),
  DATE: fn('DATE(year, month, day)', 3, 3, (args) => {
    const year = argInt(args, 0);
    if (isValue(year)) return year;
    const month = argInt(args, 1);
    if (isValue(month)) return month;
    const day = argInt(args, 2);
    if (isValue(day)) return day;
    // Month 13 rolls into next January, which is what makes `DATE(y, m+1, 0)` the
    // idiomatic last-day-of-month and why the arguments are not range-checked.
    return num(serialOf(Date.UTC(year, month - 1, day)));
  }),
  YEAR: fn('YEAR(serial)', 1, 1, field((date) => date.getUTCFullYear())),
  MONTH: fn('MONTH(serial)', 1, 1, field((date) => date.getUTCMonth() + 1)),
  DAY: fn('DAY(serial)', 1, 1, field((date) => date.getUTCDate())),
  HOUR: fn('HOUR(serial)', 1, 1, field((_date, serial) => Math.floor((serial % 1) * 24))),
  MINUTE: fn('MINUTE(serial)', 1, 1, field((_date, serial) => Math.floor((serial % 1) * 1440) % 60)),
  // Excel numbers the week from Sunday = 1 unless told otherwise.
  WEEKDAY: fn('WEEKDAY(serial, [type])', 1, 2, (args) => {
    const serial = argNumber(args, 0);
    if (isValue(serial)) return serial;
    const type = args.length > 1 ? argInt(args, 1) : 1;
    if (isValue(type)) return type;
    const day = dateOf(serial).getUTCDay();
    if (type === 2) return num(((day + 6) % 7) + 1);
    if (type === 3) return num((day + 6) % 7);
    return num(day + 1);
  }),
  DAYS: fn('DAYS(end, start)', 2, 2, (args) => {
    const end = argNumber(args, 0);
    if (isValue(end)) return end;
    const start = argNumber(args, 1);
    return isValue(start) ? start : num(Math.trunc(end) - Math.trunc(start));
  }),
  EDATE: fn('EDATE(serial, months)', 2, 2, (args) => {
    const serial = argNumber(args, 0);
    if (isValue(serial)) return serial;
    const months = argInt(args, 1);
    if (isValue(months)) return months;
    const date = dateOf(serial);
    // Clamped to the end of the target month: 31 January plus one month is the
    // 28th, not the 3rd of March.
    const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0);
    const last = new Date(target).getUTCDate();
    const day = Math.min(date.getUTCDate(), last);
    return num(serialOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, day)));
  }),
  EOMONTH: fn('EOMONTH(serial, months)', 2, 2, (args) => {
    const serial = argNumber(args, 0);
    if (isValue(serial)) return serial;
    const months = argInt(args, 1);
    if (isValue(months)) return months;
    const date = dateOf(serial);
    return num(serialOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0)));
  }),
};

/**
 * Reads the leading numeric arguments, filling an omitted tail from `defaults`.
 *
 * Every annuity function takes the same five values in the same order with the
 * same optional tail, so the reading is done once here rather than five times
 * below with five chances to get the default wrong.
 */
function reads(args: readonly Arg[], defaults: readonly number[]): readonly number[] | CellValue {
  const out: number[] = [];
  for (let index = 0; index < defaults.length; index += 1) {
    if (index >= args.length) {
      out.push(defaults[index] ?? 0);
      continue;
    }
    const value = argNumber(args, index);
    if (isValue(value)) return value;
    out.push(value);
  }
  return out;
}

/** `type` is 0 for payments at the end of a period and 1 for the beginning. */
const due = (rate: number, type: number): number => 1 + rate * (type === 0 ? 0 : 1);

/** The level payment that takes `pv` to `fv` in `nper` periods. */
function pmtOf(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (nper === 0) return Number.NaN;
  if (rate === 0) return -(pv + fv) / nper;
  const growth = (1 + rate) ** nper;
  return (-(pv * growth + fv) * rate) / ((growth - 1) * due(rate, type));
}

/** What the account holds after `nper` periods — Excel's `FV`, sign included. */
function fvOf(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const growth = (1 + rate) ** nper;
  return -(pv * growth + pmt * due(rate, type) * ((growth - 1) / rate));
}

const money = (compute: (values: readonly number[]) => number, defaults: readonly number[]): SheetFunction => (args) => {
  const values = reads(args, defaults);
  if (isValue(values)) return values;
  const result = compute(values);
  return Number.isFinite(result) ? num(result) : err('#NUM!');
};

/** Present value: what a stream of payments and a final balance are worth now. */
function pvOf(rate: number, nper: number, pmt: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pmt * nper);
  const growth = (1 + rate) ** nper;
  return -(fv + pmt * due(rate, type) * ((growth - 1) / rate)) / growth;
}

function nperOf(rate: number, pmt: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return pmt === 0 ? Number.NaN : -(pv + fv) / pmt;
  const payment = pmt * due(rate, type);
  const ratio = (payment - fv * rate) / (payment + pv * rate);
  return ratio <= 0 ? Number.NaN : Math.log(ratio) / Math.log(1 + rate);
}

/**
 * The interest inside one payment.
 *
 * It is the period's opening balance times the rate, and the opening balance is
 * just `FV` after one period fewer — which is why this is four lines instead of an
 * amortisation loop. Payments at the beginning of a period carry no interest in
 * their first instalment, because nothing has been owed yet.
 */
function ipmtOf(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  if (per < 1 || per > nper) return Number.NaN;
  const pmt = pmtOf(rate, nper, pv, fv, type);
  if (per === 1) return type > 0 ? 0 : -pv * rate;
  return type > 0 ? (fvOf(rate, per - 2, pmt, pv, 1) - pmt) * rate : fvOf(rate, per - 1, pmt, pv, 0) * rate;
}

/**
 * Bisection over the range a rate can live in.
 *
 * `RATE` and `IRR` are the two functions here with no closed form, and Newton's
 * method on a cash flow that changes sign more than once will happily walk off to
 * an answer that is not there. Bisection is slower and cannot lie: either the
 * bracket contains a root or the answer is `#NUM!`.
 */
function solve(f: (rate: number) => number): number {
  let low = -0.999_999;
  let high = 10;
  const atLow = f(low);
  const atHigh = f(high);
  if (!Number.isFinite(atLow) || !Number.isFinite(atHigh) || atLow * atHigh > 0) return Number.NaN;
  for (let step = 0; step < 200; step += 1) {
    const middle = (low + high) / 2;
    const value = f(middle);
    if (value === 0) return middle;
    if (atLow * value < 0) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}

/** Double-declining balance, walked period by period so it cannot pass salvage. */
function ddbOf(cost: number, salvage: number, life: number, period: number, factor: number): number {
  if (life <= 0 || period < 1 || period > life) return Number.NaN;
  const rate = factor / life;
  let book = cost;
  let charge = 0;
  for (let index = 1; index <= Math.ceil(period); index += 1) {
    charge = Math.min(book * rate, Math.max(book - salvage, 0));
    book -= charge;
  }
  return charge;
}

const MONEY: FunctionTable = {
  PMT: fn('PMT(rate, nper, pv, [fv], [type])', 3, 5, money((v) => pmtOf(v[0], v[1], v[2], v[3], v[4]), [0, 0, 0, 0, 0])),
  FV: fn('FV(rate, nper, pmt, [pv], [type])', 3, 5, money((v) => fvOf(v[0], v[1], v[2], v[3], v[4]), [0, 0, 0, 0, 0])),
  PV: fn('PV(rate, nper, pmt, [fv], [type])', 3, 5, money((v) => pvOf(v[0], v[1], v[2], v[3], v[4]), [0, 0, 0, 0, 0])),
  NPER: fn('NPER(rate, pmt, pv, [fv], [type])', 3, 5, money((v) => nperOf(v[0], v[1], v[2], v[3], v[4]), [0, 0, 0, 0, 0])),
  IPMT: fn(
    'IPMT(rate, period, nper, pv, [fv], [type])',
    4,
    6,
    money((v) => ipmtOf(v[0], v[1], v[2], v[3], v[4], v[5]), [0, 0, 0, 0, 0, 0]),
  ),
  PPMT: fn(
    'PPMT(rate, period, nper, pv, [fv], [type])',
    4,
    6,
    money(
      (v) => pmtOf(v[0], v[2], v[3], v[4], v[5]) - ipmtOf(v[0], v[1], v[2], v[3], v[4], v[5]),
      [0, 0, 0, 0, 0, 0],
    ),
  ),
  // The sixth argument is Excel's guess. Bisection needs no seed, so it is read
  // and ignored rather than refused — a workbook that used it still opens.
  RATE: fn(
    'RATE(nper, pmt, pv, [fv], [type], [guess])',
    3,
    6,
    money((v) => solve((rate) => fvOf(rate, v[0], v[1], v[2], v[4]) - v[3]), [0, 0, 0, 0, 0, 0.1]),
  ),
  SLN: fn('SLN(cost, salvage, life)', 3, 3, money((v) => (v[2] === 0 ? Number.NaN : (v[0] - v[1]) / v[2]), [0, 0, 0])),
  SYD: fn(
    'SYD(cost, salvage, life, period)',
    4,
    4,
    money((v) => ((v[0] - v[1]) * (v[2] - v[3] + 1) * 2) / (v[2] * (v[2] + 1)), [0, 0, 0, 0]),
  ),
  DDB: fn(
    'DDB(cost, salvage, life, period, [factor])',
    4,
    5,
    money((v) => ddbOf(v[0], v[1], v[2], v[3], v[4]), [0, 0, 0, 0, 2]),
  ),
  NPV: fn('NPV(rate, value1, …)', 2, Infinity, (args) => {
    const rate = argNumber(args, 0);
    if (isValue(rate)) return rate;
    if (rate <= -1) return err('#NUM!');
    const flows = numbersOf(args.slice(1));
    if (isValue(flows)) return flows;
    // The first flow is discounted one period, which is what makes `NPV` an
    // end-of-period convention and why a cost at t=0 belongs outside the call.
    return num(flows.reduce((sum, flow, index) => sum + flow / (1 + rate) ** (index + 1), 0));
  }),
  IRR: fn('IRR(values, [guess])', 1, 2, (args) => {
    const flows = numbersOf([argAt(args, 0)]);
    if (isValue(flows)) return flows;
    if (flows.length < 2) return err('#NUM!');
    const rate = solve((candidate) => flows.reduce((sum, flow, index) => sum + flow / (1 + candidate) ** index, 0));
    return Number.isFinite(rate) ? num(rate) : err('#NUM!');
  }),
};

/** Dates and money, in one table. */
export const FINANCE_FUNCTIONS: FunctionTable = { ...DATES, ...MONEY };



