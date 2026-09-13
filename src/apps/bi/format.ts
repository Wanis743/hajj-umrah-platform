/**
 * How a number is written.
 *
 * This is the app's most load-bearing file and the smallest one to get wrong. A
 * metric arrives already folded — the server did the arithmetic — carrying its
 * own `format`, `decimals` and `unit`, and everything here decides how many
 * digits to print and never what to print. `biFormat.ts` opened with that rule
 * and it survives verbatim: a percentage that reads 0.42 on one screen and 42 %
 * on another is the semantic layer failing at the only thing it exists for.
 *
 * What changed in the move is the locale. Every `Intl.NumberFormat` in the admin
 * version was hard-coded to `en-US`, so a French analyst read `1,250.00` in a
 * window whose chrome said `1 250,00`. Locale is OS policy: `fmt.intlLocaleFor`
 * decides it once for every window, and each function below takes the `lang` the
 * frame is already rendering in.
 *
 * Three formatters have no SDK equivalent and are here for stated reasons:
 * {@link decimal} because `fmt` fixes its digits at 0 or 2 and a metric may
 * declare up to six, {@link latency} because `fmt.duration` floors to whole
 * seconds and most queries finish inside one, and {@link periodLabel} because a
 * month bucket is a month and not midnight on its first day.
 *
 * One export is not a formatter at all. {@link isoToday} reads the clock instead
 * of its argument, and is here because the file the export command writes is
 * named after a date that a filesystem has to accept and nobody has to read.
 */
import { fmt, type AppLang } from '@/platform/sdk';
import { BI_DECIMALS_MAX, BI_OPERATOR_ARITY } from './types';
import type { BiColumn, BiFilter, BiFilterOperator, BiMetricFormat, BiScalar, BiTimeGrain } from './types';

/** The em dash every unknown renders as, matching what `fmt` returns for a bad
 *  input. A null metric is a group the query found no rows for; printing `0`
 *  would invent a measurement. */
export const DASH = '—';

/** One hour, in the milliseconds `fmt.duration` speaks. */
const HOUR_MS = 3_600_000;

/**
 * `YYYY-MM-DD` for today, in UTC — the same calendar the server's `CURRENT_DATE`
 * uses.
 *
 * Not a formatter of a measurement, and the only function here that reads the
 * clock rather than its argument. It exists because an export filename needs a
 * date and `fmt.date` writes one for a reader (`12 sept. 2026`) rather than for a
 * filesystem. `../dms/format.ts` carries the same line for the same reason;
 * `../shared/` has no date module to put it in, so the duplication is two copies
 * of one sentence rather than a helper nobody could find.
 */
export const isoToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * A grouped number with an exact number of decimals.
 *
 * The one arithmetic primitive the SDK does not carry: `fmt.integer` fixes zero
 * digits and `fmt.amount` fixes two, while `bi_metrics.decimals` is any value
 * from 0 to {@link BI_DECIMALS_MAX}. Locale still comes from the SDK, so the
 * grouping and the decimal mark match the rest of the desktop — this widens what
 * `fmt` can say, it does not re-decide it.
 */
export function decimal(value: number, digits: number, lang: AppLang): string {
  if (!Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(fmt.intlLocaleFor(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/* ------------------------------------------------------------------ *
 * A metric's presentation
 * ------------------------------------------------------------------ */

/**
 * The presentation half of a metric, as `bi_metrics` stores it and every result
 * column repeats.
 *
 * Widened to the nullable shape on purpose: {@link BiMetric} always has a format
 * and a decimal count, {@link BiColumn} has them only when `kind` is `'METRIC'`,
 * and both are structurally assignable here so neither call site has to build an
 * intermediate object.
 */
export interface MetricDisplay {
  readonly format: BiMetricFormat | null;
  readonly decimals: number | null;
  readonly unit: string | null;
}

/**
 * What each format prints when the metric did not say.
 *
 * `PERCENT` gets one digit rather than two because a rate quoted to a hundredth
 * of a percent claims a precision no booking count supports, and
 * `DURATION_HOURS` gets one for the same reason.
 */
const DEFAULT_DECIMALS: Readonly<Record<BiMetricFormat, number>> = {
  NUMBER: 2,
  INTEGER: 0,
  CURRENCY: 2,
  PERCENT: 1,
  DURATION_HOURS: 1,
};

/** Clamped to the range the migration's own CHECK allows, so a hand-edited row
 *  cannot ask `Intl` for forty digits and throw inside a table cell. */
function decimalsFor(display: MetricDisplay): number {
  const format = display.format ?? 'NUMBER';
  const declared = display.decimals;
  if (declared === null || !Number.isFinite(declared)) return DEFAULT_DECIMALS[format];
  return Math.min(BI_DECIMALS_MAX, Math.max(0, Math.trunc(declared)));
}

/**
 * A count of hours as a span, sign intact.
 *
 * `fmt.duration` is the desktop's span rendering and localizes its own units, so
 * a `DURATION_HOURS` metric reads the same way as an uptime in the tray. It also
 * returns an em dash for anything below zero, which for a variance metric would
 * turn "four hours early" into "unknown" — so the sign is taken off first and put
 * back on the front.
 *
 * The metric's declared decimals are deliberately dropped here: `2h 15min` is
 * what `2.25` means, and it is the more useful of the two readings.
 */
function hours(value: number, lang: AppLang): string {
  const span = fmt.duration(Math.abs(value) * HOUR_MS, lang);
  return value < 0 ? `-${span}` : span;
}

/**
 * One folded metric value, printed.
 *
 * `PERCENT` means a fraction. The compiler emits a `RATIO` as
 * `sum(n) / nullif(sum(d), 0)` and never multiplies, so 0.42 is what arrives and
 * `42,0 %` is what shows. A metric over a column that already stores 0–100 has to
 * declare `NUMBER` with `unit: '%'` instead — one rule everywhere, rather than a
 * guess per screen.
 *
 * `CURRENCY` goes through `fmt.money` only for the two currencies `@/lib/money`
 * knows, because that is the function that owns symbol placement and minor units.
 * A metric whose unit is anything else still prints — grouped, with its unit as a
 * suffix — rather than being forced through a currency formatter that would put
 * the wrong symbol on it.
 *
 * A metric that is not a number is a definition that is wrong, so it prints as
 * itself rather than as `NaN`: seeing the raw value is how its author finds it.
 */
export function metricValue(value: BiScalar, display: MetricDisplay, lang: AppLang): string {
  if (value === null) return DASH;
  // A boolean here is a MIN or MAX over a boolean column, which is a real answer.
  if (typeof value === 'boolean') return value ? '1' : '0';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) return String(value);

  const digits = decimalsFor(display);
  const unit = display.unit === null || display.unit === '' ? '' : ` ${display.unit}`;

  switch (display.format ?? 'NUMBER') {
    case 'INTEGER':
      return fmt.integer(Math.round(numeric), lang) + unit;
    case 'PERCENT':
      return fmt.percent(numeric, lang, digits);
    case 'DURATION_HOURS':
      return hours(numeric, lang);
    case 'CURRENCY':
      if (display.unit === 'DZD' || display.unit === 'SAR') {
        return fmt.money(numeric, display.unit, lang);
      }
      return decimal(numeric, digits, lang) + unit;
    default:
      return decimal(numeric, digits, lang) + unit;
  }
}

/* ------------------------------------------------------------------ *
 * Dimensions
 * ------------------------------------------------------------------ */

/**
 * A time bucket, printed as the bucket it is.
 *
 * The one place this app knowingly reads better than the screens it replaces.
 * `formatCell` in `biFormat.ts` sent every grain but `DAY` through a full
 * date-time, so a `MONTH` bucket showed `01 janv. 2026, 00:00` — a month labelled
 * with a midnight that means nothing. The compiler emits `date_trunc('month', …)`
 * and midnight on the first is only where a month begins; a person reading a
 * twelve-row trend wants `janv. 2026`.
 *
 * `QUARTER` has no `Intl` option, so its mark is written out per language on the
 * precedent `fmt.duration` sets by carrying its own `'ي' | 'j' | 'd'` inline.
 *
 * Month, quarter and year are read off the local clock rather than UTC so that a
 * `MONTH` label and a `DAY` label in the same result agree with each other —
 * `fmt.date` renders through `toLocaleDateString`, and one convention that can be
 * corrected in one place beats two that disagree.
 */
export function periodLabel(value: BiScalar, grain: BiTimeGrain, lang: AppLang): string {
  if (value === null || typeof value === 'boolean') return DASH;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return String(value);

  switch (grain) {
    // A week is named by the Monday the compiler truncated it to, so both of
    // these buckets are one day and read as one.
    case 'DAY':
    case 'WEEK':
      return fmt.date(at, lang);
    case 'MONTH':
      return new Intl.DateTimeFormat(fmt.intlLocaleFor(lang), {
        month: 'short',
        year: 'numeric',
      }).format(at);
    case 'QUARTER': {
      const mark = lang === 'ar' ? 'ر' : lang === 'fr' ? 'T' : 'Q';
      return `${mark}${Math.floor(at.getMonth() / 3) + 1} ${at.getFullYear()}`;
    }
    case 'YEAR':
      return String(at.getFullYear());
  }
}

/**
 * One result cell, chosen by what its column says it is.
 *
 * A column carries its own `kind`, `dataType` and `grain`, so nothing here
 * inspects the value to guess: the semantic layer already answered that question
 * and a cell that decided for itself would disagree with the axis beside it.
 *
 * `grain` is checked before `dataType` because a truncated timestamp is still a
 * timestamp and {@link periodLabel} is the whole reason the distinction exists.
 */
export function cell(value: BiScalar, column: BiColumn, lang: AppLang): string {
  if (column.kind === 'METRIC') return metricValue(value, column, lang);
  if (value === null) return DASH;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (column.grain !== null) return periodLabel(value, column.grain, lang);

  switch (column.dataType) {
    case 'date':
      return fmt.date(value, lang);
    case 'timestamp':
      return fmt.dateTime(value, lang);
    case 'number':
      return typeof value === 'number' ? fmt.integer(value, lang) : String(value);
    default:
      return String(value);
  }
}

/**
 * The same cell as a number, or nothing.
 *
 * What every chart reads. A null group is a gap in a line and not a zero, so this
 * refuses to coerce: `Number(null)` is `0`, and a zero drawn where a month had no
 * bookings is a claim the query never made.
 */
export function numericCell(value: BiScalar): number | null {
  if (value === null || typeof value === 'boolean') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/* ------------------------------------------------------------------ *
 * The app's own numbers
 * ------------------------------------------------------------------ */

/**
 * How long something took, at the precision that range deserves.
 *
 * `fmt.duration` floors to whole seconds, and almost every query in the log
 * finishes inside one — through the SDK, a 40 ms read and a 900 ms read both
 * print `0s`, which is the one comparison the query log exists to support.
 *
 * So: sub-second stays in milliseconds, because that is the range the ledger's
 * p95 lives in. One to sixty seconds gets two decimals below ten and one above,
 * since the difference between 2.14 s and 2.9 s is worth seeing and the
 * difference between 41.2 s and 41.24 s is not. Past a minute the SDK's own
 * `1min 12s` is better than any of it, and a query that slow is a definition to
 * fix rather than a number to compare.
 */
export function latency(ms: number | null | undefined, lang: AppLang): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${decimal(ms / 1000, ms < 10_000 ? 2 : 1, lang)} s`;
  return fmt.duration(ms, lang);
}

/** A count the app holds rather than the server folded — rows returned, metrics
 *  on a dataset, tiles on a dashboard. Null-tolerant because a health block asks
 *  for counts the catalog read may not have answered. */
export function int(value: number | null | undefined, lang: AppLang): string {
  if (value === null || value === undefined) return DASH;
  return fmt.integer(value, lang);
}

/**
 * A share this app computed itself.
 *
 * Takes a fraction, on exactly the rule {@link metricValue} follows: the word
 * "percent" has one meaning everywhere in this app, and it is `n / d`. A slice's
 * share of its total and the query log's denial rate both arrive that way, and
 * neither is multiplied by a hundred first.
 */
export function pct(fraction: number | null | undefined, lang: AppLang, digits = 1): string {
  if (fraction === null || fraction === undefined) return DASH;
  return fmt.percent(fraction, lang, digits);
}

/* ------------------------------------------------------------------ *
 * A filter, in words
 * ------------------------------------------------------------------ */

/**
 * The SQL token each operator becomes.
 *
 * Deliberately not translated. A filter is read beside the statement it produced
 * — the query log shows compiled SQL two panes away — and `status = CONFIRMED`
 * matches what a reader will find in it, where `status égal à CONFIRMED` would
 * not. `CONTAINS` and `STARTS WITH` are not real SQL either; they are what the
 * compiler's `LIKE '%…%'` means, said in the same register.
 */
export const OPERATOR_SQL: Readonly<Record<BiFilterOperator, string>> = {
  EQ: '=',
  NE: '<>',
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
  IN: 'IN',
  NOT_IN: 'NOT IN',
  BETWEEN: 'BETWEEN',
  CONTAINS: 'CONTAINS',
  STARTS_WITH: 'STARTS WITH',
  IS_NULL: 'IS NULL',
  IS_NOT_NULL: 'IS NOT NULL',
};

/** How many members of an `IN` list a chip shows before it counts the rest. Four
 *  fits a filter row at the narrowest window the manifest allows. */
export const FILTER_VALUES_SHOWN = 4;

/** One operand, written the way the statement writes it rather than the way the
 *  locale would — grouping separators inside a `WHERE` clause would be a lie. */
function operand(value: BiScalar | undefined): string {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * A whole filter as one line, arity-aware.
 *
 * Which operand fields are populated is a function of the operator and nothing
 * else, so this switches on {@link BI_OPERATOR_ARITY} rather than testing which
 * fields happen to be present. A `BETWEEN` missing its second bound prints
 * `NULL` and is visibly wrong, which is the useful outcome — the compiler will
 * refuse it, and a screen that quietly rendered `field BETWEEN 5` would hide why.
 */
export function filterText(filter: BiFilter): string {
  const head = `${filter.field} ${OPERATOR_SQL[filter.op]}`;
  switch (BI_OPERATOR_ARITY[filter.op]) {
    case 'none':
      return head;
    case 'two':
      return `${head} ${operand(filter.value)} AND ${operand(filter.value2)}`;
    case 'many': {
      const values = filter.values ?? [];
      const shown = values.slice(0, FILTER_VALUES_SHOWN).map(operand).join(', ');
      const rest = values.length - FILTER_VALUES_SHOWN;
      return rest > 0 ? `${head} (${shown}, +${rest})` : `${head} (${shown})`;
    }
    default:
      return `${head} ${operand(filter.value)}`;
  }
}

/**
 * Whoever did it, as much of them as this app can know.
 *
 * The first eight characters of a UUID. `bi_events` and `bi_query_log` record an
 * actor id and `staff_profiles` carries no name column any of the BI reads join
 * to, so a prefix is the honest rendering: enough to tell two actors apart in a
 * history, and visibly an id rather than a person's name.
 */
export function actorLabel(id: string | null): string {
  if (id === null || id === '') return DASH;
  return id.slice(0, 8);
}
