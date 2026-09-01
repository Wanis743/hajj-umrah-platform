/**
 * Form state for authoring definitions, and the few refusals worth predicting.
 *
 * The database is the authority here and this file does not pretend otherwise.
 * `private.bi_validate_dimension` and `private.bi_validate_metric` run every expression
 * through `private.bi_assert_safe_expression` -- an allowlist scan against the source's
 * real columns, a paren balance, a type check -- before a row is stored, and
 * `trg_bi_freeze_published_metric` refuses a structural edit to a published metric.
 * Re-implementing any of that here would create a second set of rules that drifts from
 * the first, and the drift would always favour the client, which is the wrong direction
 * for a boundary that decides what SQL runs.
 *
 * So what is checked below is only what makes a Save worth pressing: a blank required
 * field, a key that cannot match the shape three CHECK constraints share, a RATIO with
 * an operand missing or pointing at itself, a filter whose operator has no value yet.
 * Everything else is left to the write, whose refusal comes back as an authored sentence
 * that `useBiCommand` shows verbatim rather than a code this layer would have to guess at.
 *
 * Three deliberate omissions in the mappers, each mirroring something the trigger does:
 *   - `is_additive` is never sent. The trigger measures it (`false` for a RATIO,
 *     `aggregate in ('SUM','COUNT')` otherwise), so a form control for it would be a
 *     control whose value is discarded.
 *   - A RATIO sends `formula: ''`. The trigger blanks it, and `bi_metrics_ratio_shape`
 *     refuses a row carrying both a formula and two operands.
 *   - A forward `drill_to_key` is not blocked. A hierarchy is authored top-down, so
 *     `region -> city` legitimately exists before `city` does; only a cycle is refused,
 *     and only the database can walk far enough to see one.
 *
 * Numerics are held as strings on purpose. A controlled `<input type="number">` bound to
 * a parsed number cannot be typed into: `1.` parses to `1`, the box is rewritten to `1`,
 * and the decimal point is gone before the digit after it arrives.
 */
import type {
  BiAggregate, BiDatasetDetail, BiDatasetInput, BiDimension, BiDimensionDataType,
  BiDimensionInput, BiDrillThroughKind, BiFilter, BiMetric, BiMetricFormat, BiMetricInput,
} from '@/types/bi';
import { filterComplete } from './biBuilderState';

/** `bi_datasets_key_shape`, `bi_dimensions_key_shape` and `bi_metrics_key_shape` are one
 *  regex over three tables. A key is a token because saved analyses cite it by name:
 *  `bi_visualizations.dimensions` and `.measures` are arrays of these strings. */
export const BI_KEY_SHAPE = /^[a-z][a-z0-9_]{1,60}$/;

/** The six types a dimension may declare, in the order `bi_dimensions.data_type`'s CHECK
 *  lists them. `json` is absent from `BiDimensionDataType` because a json column cannot
 *  be grouped by, so it can never be a dimension. */
export const BI_DIMENSION_DATA_TYPES: readonly BiDimensionDataType[] = [
  'text', 'number', 'date', 'timestamp', 'boolean', 'uuid',
];

/**
 * A reason Save is not worth pressing yet, as a code rather than a sentence.
 *
 * The same split `BuilderIssue` uses: this file decides *what* is wrong, the `.tsx`
 * decides how to say it in three languages. A component that received prose from here
 * could not translate it, and a state file that returned prose would have to import the
 * language context to produce it.
 */
export type DefinitionIssue =
  | { kind: 'KEY_BLANK' }
  | { kind: 'KEY_SHAPE' }
  | { kind: 'NAME_BLANK' }
  | { kind: 'FILTER_NEEDS_SOURCE' }
  | { kind: 'TIME_COLUMN_NEEDS_SOURCE' }
  | { kind: 'FILTER_INCOMPLETE'; field: string }
  | { kind: 'EXPRESSION_BLANK' }
  | { kind: 'DRILL_PAIR' }
  | { kind: 'SELF_DRILL' }
  | { kind: 'FORMULA_BLANK' }
  | { kind: 'RATIO_OPERAND_MISSING' }
  | { kind: 'RATIO_SELF' }
  | { kind: 'RATIO_UNKNOWN_OPERAND'; key: string }
  | { kind: 'RATIO_OF_RATIO'; key: string }
  | { kind: 'DECIMALS_RANGE' }
  | { kind: 'SORT_ORDER_NUMBER' };

/** A stable React key for an issue, since two issues of one kind can differ only by the
 *  key they name. */
export const definitionIssueKey = (issue: DefinitionIssue): string => {
  if (issue.kind === 'FILTER_INCOMPLETE') return `${issue.kind}:${issue.field}`;
  if (issue.kind === 'RATIO_UNKNOWN_OPERAND' || issue.kind === 'RATIO_OF_RATIO') {
    return `${issue.kind}:${issue.key}`;
  }
  return issue.kind;
};

/** Blank text is `null`, not `''`: the columns are nullable and "no description" is a
 *  different fact from "a description that is the empty string". Sending `null` on an
 *  update is also the only way to clear a field that once had a value. */
const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** An integer held as text. Blank falls back rather than failing -- an unset sort order
 *  is a real answer and the column defaults to 0 -- but a non-integer returns `null` so
 *  the caller can raise an issue instead of silently sending `NaN`. */
function intOr(text: string, fallback: number): number | null {
  const raw = text.trim();
  if (raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function keyIssues(key: string): DefinitionIssue[] {
  const trimmed = key.trim();
  if (trimmed === '') return [{ kind: 'KEY_BLANK' }];
  if (!BI_KEY_SHAPE.test(trimmed)) return [{ kind: 'KEY_SHAPE' }];
  return [];
}

/** `filterComplete` is the builder's own predicate, reused so a metric-local filter and
 *  an ad-hoc one are held to exactly the same standard. */
function filterIssues(filters: readonly BiFilter[]): DefinitionIssue[] {
  return filters
    .filter((filter) => !filterComplete(filter))
    .map((filter) => ({ kind: 'FILTER_INCOMPLETE' as const, field: filter.field }));
}

/* -------------------------------------------------------------------------- */
/* Dataset                                                                     */
/* -------------------------------------------------------------------------- */

/** `sourceId` and `defaultTimeColumn` are `''` for absent rather than `null`, because a
 *  `<select>` has no null value and `''` is what an unselected option submits. */
export interface DatasetForm {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  sourceId: string;
  defaultTimeColumn: string;
  rowFilter: readonly BiFilter[];
}

export const emptyDatasetForm = (): DatasetForm => ({
  key: '', name: '', nameAr: '', description: '',
  sourceId: '', defaultTimeColumn: '', rowFilter: [],
});

/** A loaded dataset as its own form. One name disagreement is deliberate and lives here:
 *  the column is `display_name_ar` but `get_bi_dataset_detail` returns it as `name_ar`,
 *  so the read is one name and the write is the other. */
export function datasetFormFrom(detail: BiDatasetDetail): DatasetForm {
  const row = detail.dataset;
  return {
    key: row.key,
    name: row.name,
    nameAr: row.name_ar ?? '',
    description: row.description ?? '',
    sourceId: detail.source?.id ?? '',
    defaultTimeColumn: row.default_time_column ?? '',
    rowFilter: row.row_filter_json,
  };
}

/**
 * What `private.bi_validate_dataset` would refuse, checked before the round trip.
 *
 * Both source-dependent refusals are worth predicting because they are easy to walk into
 * and the fix is elsewhere on the form: a row filter needs a source to filter, and a
 * default time column has to be a real date or timestamp column of one. Whether the named
 * column actually is temporal is left to the trigger, which reads `bi_source_columns`.
 */
export function datasetIssues(form: DatasetForm): readonly DefinitionIssue[] {
  const issues: DefinitionIssue[] = [...keyIssues(form.key)];
  if (form.name.trim() === '') issues.push({ kind: 'NAME_BLANK' });
  if (form.sourceId === '') {
    if (form.rowFilter.length > 0) issues.push({ kind: 'FILTER_NEEDS_SOURCE' });
    if (form.defaultTimeColumn !== '') issues.push({ kind: 'TIME_COLUMN_NEEDS_SOURCE' });
  }
  issues.push(...filterIssues(form.rowFilter));
  return issues;
}

export function datasetInput(form: DatasetForm): BiDatasetInput {
  return {
    key: form.key.trim(),
    name: form.name.trim(),
    display_name_ar: orNull(form.nameAr),
    description: orNull(form.description),
    source_id: orNull(form.sourceId),
    default_time_column: orNull(form.defaultTimeColumn),
    row_filter_json: form.rowFilter,
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension                                                                   */
/* -------------------------------------------------------------------------- */

export interface DimensionForm {
  key: string;
  displayName: string;
  displayNameAr: string;
  description: string;
  expression: string;
  dataType: BiDimensionDataType;
  sortOrder: string;
  isDefault: boolean;
  drillToKey: string;
  /** `''` means no drill-through. The pair is enforced together below because
   *  `bi_dimensions_drill_pair` refuses one without the other. */
  drillThroughKind: BiDrillThroughKind | '';
  drillThroughExpression: string;
}

export const emptyDimensionForm = (): DimensionForm => ({
  key: '', displayName: '', displayNameAr: '', description: '', expression: '',
  dataType: 'text', sortOrder: '0', isDefault: false, drillToKey: '',
  drillThroughKind: '', drillThroughExpression: '',
});

export function dimensionFormFrom(row: BiDimension): DimensionForm {
  return {
    key: row.key,
    displayName: row.display_name,
    displayNameAr: row.display_name_ar ?? '',
    description: row.description ?? '',
    expression: row.expression,
    dataType: row.data_type,
    sortOrder: String(row.sort_order),
    isDefault: row.is_default,
    drillToKey: row.drill_to_key ?? '',
    drillThroughKind: row.drill_through_kind ?? '',
    drillThroughExpression: row.drill_through_expression ?? '',
  };
}

/**
 * The two dimension constraints a form can see, and no more.
 *
 * `bi_dimensions_no_self_drill` and `bi_dimensions_drill_pair` are both decidable from
 * this one row, so they are checked. The cycle guard is not: it walks up to 32 levels
 * through rows this form does not hold, and a client that guessed at it would either
 * block a legal top-down hierarchy or miss a real loop.
 */
export function dimensionIssues(form: DimensionForm): readonly DefinitionIssue[] {
  const issues: DefinitionIssue[] = [...keyIssues(form.key)];
  if (form.displayName.trim() === '') issues.push({ kind: 'NAME_BLANK' });
  if (form.expression.trim() === '') issues.push({ kind: 'EXPRESSION_BLANK' });
  if ((form.drillThroughKind !== '') !== (form.drillThroughExpression.trim() !== '')) {
    issues.push({ kind: 'DRILL_PAIR' });
  }
  const drillTo = form.drillToKey.trim();
  if (drillTo !== '' && drillTo === form.key.trim()) issues.push({ kind: 'SELF_DRILL' });
  if (intOr(form.sortOrder, 0) === null) issues.push({ kind: 'SORT_ORDER_NUMBER' });
  return issues;
}

export function dimensionInput(form: DimensionForm, datasetId: string): BiDimensionInput {
  return {
    dataset_id: datasetId,
    key: form.key.trim(),
    display_name: form.displayName.trim(),
    display_name_ar: orNull(form.displayNameAr),
    description: orNull(form.description),
    expression: form.expression.trim(),
    data_type: form.dataType,
    sort_order: intOr(form.sortOrder, 0) ?? 0,
    is_default: form.isDefault,
    drill_to_key: orNull(form.drillToKey),
    drill_through_kind: form.drillThroughKind === '' ? null : form.drillThroughKind,
    drill_through_expression: orNull(form.drillThroughExpression),
  };
}

/* -------------------------------------------------------------------------- */
/* Metric                                                                      */
/* -------------------------------------------------------------------------- */

/** No `isAdditive` field: the trigger measures it from the aggregate and overwrites
 *  whatever a client sends, so offering it would be offering a lie. */
export interface MetricForm {
  key: string;
  displayName: string;
  displayNameAr: string;
  description: string;
  formula: string;
  aggregate: BiAggregate;
  numeratorKey: string;
  denominatorKey: string;
  format: BiMetricFormat;
  unit: string;
  decimals: string;
  sortOrder: string;
  filter: readonly BiFilter[];
}

export const emptyMetricForm = (): MetricForm => ({
  key: '', displayName: '', displayNameAr: '', description: '', formula: '',
  aggregate: 'SUM', numeratorKey: '', denominatorKey: '',
  format: 'NUMBER', unit: '', decimals: '2', sortOrder: '0', filter: [],
});

export function metricFormFrom(row: BiMetric): MetricForm {
  return {
    key: row.key,
    displayName: row.display_name,
    displayNameAr: row.display_name_ar ?? '',
    description: row.description ?? '',
    formula: row.formula,
    aggregate: row.aggregate,
    numeratorKey: row.numerator_metric_key ?? '',
    denominatorKey: row.denominator_metric_key ?? '',
    format: row.format,
    unit: row.unit ?? '',
    decimals: String(row.decimals),
    sortOrder: String(row.sort_order),
    filter: row.filter_json,
  };
}

/**
 * The RATIO rules, which are the only place a metric form needs to look at its siblings.
 *
 * `private.bi_validate_metric` refuses three ratio shapes, and all three are visible from
 * the dataset's own metric list: an operand that is not a metric of this dataset (*"define
 * it first"*), an operand that is itself a RATIO (*"use the underlying additive metrics
 * instead"*), and a ratio of itself. Checking them here turns three round trips into none,
 * and the refusals still exist underneath for anything this list is stale about.
 */
export function metricIssues(
  form: MetricForm, siblings: readonly BiMetric[],
): readonly DefinitionIssue[] {
  const issues: DefinitionIssue[] = [...keyIssues(form.key)];
  if (form.displayName.trim() === '') issues.push({ kind: 'NAME_BLANK' });

  if (form.aggregate === 'RATIO') {
    const own = form.key.trim();
    const operands = [form.numeratorKey.trim(), form.denominatorKey.trim()];
    if (operands.some((operand) => operand === '')) {
      issues.push({ kind: 'RATIO_OPERAND_MISSING' });
    }
    if (own !== '' && operands.includes(own)) issues.push({ kind: 'RATIO_SELF' });
    for (const operand of operands) {
      if (operand === '' || operand === own) continue;
      const sibling = siblings.find((metric) => metric.key === operand);
      if (sibling === undefined) {
        issues.push({ kind: 'RATIO_UNKNOWN_OPERAND', key: operand });
      } else if (sibling.aggregate === 'RATIO') {
        issues.push({ kind: 'RATIO_OF_RATIO', key: operand });
      }
    }
  } else if (form.formula.trim() === '') {
    issues.push({ kind: 'FORMULA_BLANK' });
  }

  const decimals = intOr(form.decimals, 2);
  if (decimals === null || decimals < 0 || decimals > 6) issues.push({ kind: 'DECIMALS_RANGE' });
  if (intOr(form.sortOrder, 0) === null) issues.push({ kind: 'SORT_ORDER_NUMBER' });
  issues.push(...filterIssues(form.filter));
  return issues;
}

export function metricInput(form: MetricForm, datasetId: string): BiMetricInput {
  const ratio = form.aggregate === 'RATIO';
  return {
    dataset_id: datasetId,
    key: form.key.trim(),
    display_name: form.displayName.trim(),
    display_name_ar: orNull(form.displayNameAr),
    description: orNull(form.description),
    formula: ratio ? '' : form.formula.trim(),
    aggregate: form.aggregate,
    filter_json: form.filter,
    numerator_metric_key: ratio ? orNull(form.numeratorKey) : null,
    denominator_metric_key: ratio ? orNull(form.denominatorKey) : null,
    format: form.format,
    unit: orNull(form.unit),
    decimals: intOr(form.decimals, 2) ?? 2,
    sort_order: intOr(form.sortOrder, 0) ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Two things the editor should say before the write, not after                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether this edit touches one of the five columns a published metric freezes.
 *
 * `trg_bi_freeze_published_metric` refuses a PUBLISHED-to-PUBLISHED change to `formula`,
 * `aggregate`, `filter_json`, `numerator_metric_key` or `denominator_metric_key` -- and
 * only those. A label, a format, a unit, the decimals and the sort order stay editable on
 * a published metric, which is the distinction worth drawing on screen: renaming a
 * published metric is fine, redefining what it measures is a refusal with an instruction
 * attached (*"return it to draft before changing what it measures"*).
 */
export function changesPublishedMeaning(form: MetricForm, row: BiMetric): boolean {
  const ratio = form.aggregate === 'RATIO';
  return form.aggregate !== row.aggregate
    || (ratio ? '' : form.formula.trim()) !== row.formula
    || (ratio ? orNull(form.numeratorKey) : null) !== row.numerator_metric_key
    || (ratio ? orNull(form.denominatorKey) : null) !== row.denominator_metric_key
    || JSON.stringify(form.filter) !== JSON.stringify(row.filter_json);
}

/**
 * Whether an edit renames the key, which nothing in the database forbids and every saved
 * analysis depends on.
 *
 * `bi_visualizations.dimensions` and `.measures` are jsonb arrays of keys, not foreign
 * keys, and a dimension's `drill_to_key` and a ratio's operands are keys too. So a rename
 * is accepted by the write and then fails at query time as *"is not defined on dataset"*.
 * That is exactly the kind of consequence a form should state up front.
 */
export const renamesKey = (form: { key: string }, row: { key: string }): boolean =>
  form.key.trim() !== row.key;

/** What `bi_set_status` would refuse a publish for, each with its own authored sentence
 *  server-side. Every one is answerable from the loaded detail, so the status bar can name
 *  it instead of offering a button that raises 22023. The first three are a dataset's; the
 *  fourth is the only one a metric has, and it is why the status bar takes a list rather
 *  than a dataset. */
export type PublishBlocker =
  | 'NO_SOURCE' | 'NO_DIMENSION' | 'NO_METRIC' | 'DATASET_NOT_PUBLISHED';

export function datasetPublishBlockers(detail: BiDatasetDetail): readonly PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (detail.source === null) blockers.push('NO_SOURCE');
  if (detail.dimensions.length === 0) blockers.push('NO_DIMENSION');
  if (detail.metrics.length === 0) blockers.push('NO_METRIC');
  return blockers;
}

/** A metric publishes only after the dataset behind it: *"Publish the dataset behind
 *  metric "%" first"*. The reverse order would publish a measure nobody can group. */
export const metricPublishBlockers = (detail: BiDatasetDetail): readonly PublishBlocker[] =>
  (detail.dataset.status === 'PUBLISHED' ? [] : ['DATASET_NOT_PUBLISHED']);
