/**
 * The filter list: every predicate that will reach `private.bi_compile_filters`, and
 * the shape each operator needs.
 *
 * The operator drives the row rather than the other way round. `BI_OPERATOR_ARITY` is
 * the same table the compiler enforces, so BETWEEN gets two boxes, IN gets one
 * comma-separated box and IS_NULL gets none. A screen that offered BETWEEN a single
 * value would be assembling a request the compiler refuses with 22023 -- and because
 * every run writes a `bi_query_log` row including the refusals, learning that from the
 * server costs an audit row to say what this row could have said for free.
 *
 * Operators print as the tokens they compile to (`=`, `<>`, `IN`) rather than as
 * translated words, because the compiled statement is shown on the same screen and a
 * reader should find the same characters in it.
 *
 * Values are typed by the column and not by the text: `02` typed against a numeric
 * column becomes 2, because `= '02'` is a comparison that matches nothing and reads as
 * an empty result rather than as a mistake.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import {
  BI_FILTER_OPERATORS, BI_OPERATOR_ARITY,
  type BiDataType, type BiFilter, type BiFilterOperator, type BiScalar,
} from '@/types/bi';
import { Panel, Pill } from './atoms';
import {
  blankFilter, filterComplete, parseScalar, parseScalarList, retypeFilter,
} from './biBuilderState';
import { OPERATOR_SQL, filterText, fmtInt, useBiI18n } from './biFormat';

/**
 * One filterable thing: a dimension of the dataset, or a column of its source.
 *
 * `group` is printed after the label rather than as an option group, because the
 * picker flattens `optgroup` into one list -- and the distinction is worth showing:
 * the compiler resolves a name against dimensions first, so a name that is both
 * filters through the dimension's stored expression, not the raw column.
 */
interface FilterField {
  key: string;
  label: string;
  dataType?: BiDataType;
  group: string;
}

const scalarText = (value: BiScalar | undefined): string =>
  (value === null || value === undefined ? '' : String(value));

export function BiFilterEditor({ fields, filters, drillFrom, onAdd, onSet, onRemove }: {
  fields: readonly FilterField[];
  filters: readonly BiFilter[];
  /** Index at which drill-added filters begin -- `filters.length` when the trail is
   *  empty. Marked rather than hidden: a drill *is* a filter, and a reader should be
   *  able to see the whole predicate behind the number in front of them. */
  drillFrom: number;
  onAdd: (filter: BiFilter) => void;
  onSet: (index: number, filter: BiFilter) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useBiI18n();
  const [pick, setPick] = useState('');
  // Derived rather than remembered: the dataset can change under this component, and a
  // key that no longer exists must not stay addable.
  const chosen = fields.some((f) => f.key === pick) ? pick : (fields[0]?.key ?? '');

  return (
    <Panel
      title={t('المرشّحات', 'Filtres', 'Filters')}
      subtitle={t('تُطبَّق قبل التجميع، فوق ما يُسمح لك بقراءته أصلًا',
        'Appliqués avant l’agrégation, au-dessus de ce que vous pouvez déjà lire',
        'Applied before grouping, on top of what you may already read')}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={chosen}
          onChange={(e) => setPick(e.target.value)}
          className="input min-w-0 grow"
          disabled={fields.length === 0}
          aria-label={t('الحقل', 'Champ', 'Field')}
        >
          {fields.map((field) => (
            <option key={field.key} value={field.key}>{`${field.label} · ${field.group}`}</option>
          ))}
        </Select>
        <button
          type="button"
          className="btn btn-sm shrink-0"
          disabled={chosen === ''}
          onClick={() => onAdd(blankFilter(chosen))}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('أضف مرشّحًا', 'Ajouter un filtre', 'Add filter')}
        </button>
      </div>

      {filters.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] py-6 text-center text-[12px] text-[var(--text-muted)]">
          {t('لا مرشّح — الاستعلام يقرأ كل صف يُسمح لك بقراءته',
            'Aucun filtre — la requête lit toutes les lignes que vous pouvez lire',
            'No filter — the query reads every row you are allowed to read')}
        </p>
      ) : (
        <ul className="space-y-2">
          {filters.map((filter, index) => (
            <FilterRow
              key={`${index}:${filter.field}`}
              filter={filter}
              index={index}
              fields={fields}
              fromDrill={index >= drillFrom}
              onSet={onSet}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One filter, as one row.
 *
 * The line under the controls is `filterText` -- the same rendering the readiness notes
 * and the dataset screens use -- so what the row says and what the compiled statement
 * says are the same sentence, and a reviewer reading the SQL block below the chart can
 * find this predicate in it.
 */
function FilterRow({ filter, index, fields, fromDrill, onSet, onRemove }: {
  filter: BiFilter;
  index: number;
  fields: readonly FilterField[];
  fromDrill: boolean;
  onSet: (index: number, filter: BiFilter) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useBiI18n();
  const field = fields.find((f) => f.key === filter.field);
  const text = filterText(filter);

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="min-w-0 grow truncate text-[12px] font-medium text-[var(--text-primary)]"
          title={field ? undefined : t('حقل غير معروض في هذه المجموعة',
            'Champ absent de ce jeu', 'A field this dataset does not offer')}
        >
          {field?.label ?? filter.field}
        </span>
        {fromDrill && <Pill tone="info">{t('من التنقيب', 'Exploration', 'From drill')}</Pill>}
        {!filterComplete(filter) && (
          <Pill tone="warn">{t('ناقص', 'Incomplet', 'Incomplete')}</Pill>
        )}
        <Select
          value={filter.op}
          onChange={(e) => onSet(index, retypeFilter(filter, e.target.value as BiFilterOperator))}
          className="input w-auto shrink-0 font-mono"
          aria-label={t('المعامل', 'Opérateur', 'Operator')}
        >
          {BI_FILTER_OPERATORS.map((op) => (
            <option key={op} value={op}>{OPERATOR_SQL[op]}</option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={t('أزل المرشّح', 'Retirer le filtre', 'Remove filter')}
          className="btn btn-sm btn-ghost shrink-0"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <ValueInputs filter={filter} index={index} dataType={field?.dataType} onSet={onSet} />

      <p className="mt-1.5 truncate font-mono text-[11px] text-[var(--text-muted)]" dir="ltr" title={text}>
        {text}
      </p>
    </li>
  );
}

/**
 * The value boxes for one operator, chosen by arity rather than by operator name.
 *
 * Reading the arity table instead of switching on thirteen names is what keeps this in
 * step with the compiler: a fourteenth operator added to the CHECK constraint and to
 * `BI_OPERATOR_ARITY` gets the right boxes here without an edit.
 */
function ValueInputs({ filter, index, dataType, onSet }: {
  filter: BiFilter;
  index: number;
  dataType?: BiDataType;
  onSet: (index: number, filter: BiFilter) => void;
}) {
  const { t } = useBiI18n();
  const arity = BI_OPERATOR_ARITY[filter.op];

  if (arity === 'none') {
    return (
      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        {t('هذا المعامل لا يأخذ قيمة', 'Cet opérateur ne prend aucune valeur',
          'This operator takes no value')}
      </p>
    );
  }

  if (arity === 'many') {
    const values = filter.values ?? [];
    return (
      <div className="mt-1.5">
        <ScalarInput
          value={values.map(scalarText).join(', ')}
          label={t('القيم', 'Valeurs', 'Values')}
          placeholder={t('قيم مفصولة بفواصل', 'Valeurs séparées par des virgules',
            'Comma-separated values')}
          onChange={(raw) => onSet(index, { ...filter, values: parseScalarList(raw, dataType) })}
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)] tabular">
          {t(`${fmtInt(values.length)} قيمة`, `${fmtInt(values.length)} valeurs`,
            `${fmtInt(values.length)} values`)}
        </p>
      </div>
    );
  }

  if (arity === 'two') {
    return (
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ScalarInput
          dataType={dataType}
          value={scalarText(filter.value)}
          label={t('من', 'De', 'From')}
          onChange={(raw) => onSet(index, { ...filter, value: parseScalar(raw, dataType) })}
        />
        <ScalarInput
          dataType={dataType}
          value={scalarText(filter.value2)}
          label={t('إلى', 'À', 'To')}
          onChange={(raw) => onSet(index, { ...filter, value2: parseScalar(raw, dataType) })}
        />
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <ScalarInput
        dataType={dataType}
        value={scalarText(filter.value)}
        label={t('القيمة', 'Valeur', 'Value')}
        onChange={(raw) => onSet(index, { ...filter, value: parseScalar(raw, dataType) })}
      />
    </div>
  );
}

/**
 * One value box.
 *
 * The text being typed is local and the parsed scalar is the prop, for the same reason
 * the row limit keeps a draft: `1.` parses to 1, and an input rewritten to `1` between
 * the dot and the 5 is an input in which `1.5` cannot be typed at all. `seen` reconciles
 * the two when the value changes from anywhere but this box.
 *
 * An IN list gets no `dataType` and stays a text box however the column is typed --
 * a comma-separated list is not a number -- while the parsing still types each element.
 */
function ScalarInput({ dataType, value, label, placeholder, onChange }: {
  dataType?: BiDataType;
  value: string;
  label: string;
  placeholder?: string;
  onChange: (raw: string) => void;
}) {
  const [draft, setDraft] = useState({ text: value, seen: value });
  if (draft.seen !== value) setDraft({ text: value, seen: value });

  return (
    <input
      type={inputType(dataType)}
      value={draft.text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        setDraft({ text: e.target.value, seen: value });
        onChange(e.target.value);
      }}
      className="input"
      dir={dataType === 'number' || dataType === 'date' || dataType === 'timestamp' ? 'ltr' : undefined}
    />
  );
}

/**
 * A number column gets a number box and a date column a date picker.
 *
 * A timestamp gets the date picker too, deliberately. A wall-clock time typed without a
 * zone is read in the server's zone, so `datetime-local` would offer an hour-level
 * boundary it cannot actually honour; a day boundary is both what an analyst filters on
 * and what the value means.
 */
function inputType(dataType?: BiDataType): 'text' | 'number' | 'date' {
  if (dataType === 'number') return 'number';
  if (dataType === 'date' || dataType === 'timestamp') return 'date';
  return 'text';
}
