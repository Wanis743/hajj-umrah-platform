/**
 * The predicate editor — the one control in this app that a text input cannot be.
 *
 * A `BiFilter` is `{ field, op, value?, value2?, values? }`, and which of those three payload
 * slots is live is decided entirely by the operator: `BI_OPERATOR_ARITY` calls thirteen
 * operators `none`, `one`, `two` or `many`, and `private.bi_compile_filters` refuses the pairing
 * server-side. So the row below redraws its own right-hand side every time the operator changes,
 * and `retypeFilter` — not this file — decides what carries over when it does. A value typed
 * into `IN` and then switched to `BETWEEN` survives as the lower bound because the migration's
 * own conversion says it should, and nothing here re-decides that.
 *
 * Three call sites, one component. A dataset's `rowFilters` are the predicates every query
 * against it inherits; a metric's `filters` are the predicates that metric alone applies; and
 * the builder's `filters` are the ones the reader is asking about right now. All three are the
 * same jsonb going to the same compiler, so all three are edited the same way.
 *
 * Fields come in as `BiSourceColumn`s rather than as strings, because a filter's *value* is
 * parsed by the field's data type — `parseScalar('true', 'boolean')` is a boolean and
 * `parseScalar('true', 'text')` is the word — and an editor that did not know the type would
 * send the word every time.
 *
 * `react-refresh/only-export-components` is error-level here, so this file exports components
 * and nothing else. The one string function it needs, `operandText`, is private.
 */
import { Plus, X } from 'lucide-react';
import {
  Button,
  Field,
  IconButton,
  Input,
  Select,
  useLocale,
  type SelectOption,
} from '@/platform/sdk';
import {
  blankFilter,
  filterComplete,
  parseScalar,
  parseScalarList,
  retypeFilter,
} from './builder';
import { OPERATOR_SQL } from './format';
import {
  BI_FILTER_OPERATORS,
  BI_OPERATOR_ARITY,
  type BiFilter,
  type BiFilterOperator,
  type BiScalar,
  type BiSourceColumn,
} from './types';

/**
 * A scalar back into the box it was typed in.
 *
 * `parseScalar` turns `'12'` into `12` and `'true'` into `true`, and an input whose `value` is
 * a number renders `12` while one whose value is `undefined` renders as uncontrolled and warns.
 * Null is the empty string rather than the word `null`: a reader who cleared the box did not
 * type a null, and `filterComplete` already refuses the row.
 */
function operandText(value: BiScalar | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export interface OperatorPickerProps {
  readonly value: BiFilterOperator;
  readonly onChange: (op: BiFilterOperator) => void;
  readonly disabled?: boolean;
}

/**
 * The thirteen operators, spelled as SQL spells them.
 *
 * Deliberately untranslated, and `labels.ts` says so in as many words: `=`, `IN` and `IS NULL`
 * are the same three tokens in every language this app speaks, and an analyst reading a filter
 * row is reading the predicate that will be compiled. `OPERATOR_SQL` is the same table the
 * read-only `filterText` prints from, so a filter looks the same in the editor as it does in the
 * inspector.
 */
export function OperatorPicker({ value, onChange, disabled }: OperatorPickerProps) {
  const options: readonly SelectOption[] = BI_FILTER_OPERATORS.map((op) => ({
    value: op,
    label: OPERATOR_SQL[op],
  }));
  return (
    <Select
      value={value}
      options={options}
      disabled={disabled}
      onChange={(next) => onChange(next as BiFilterOperator)}
    />
  );
}

interface OperandProps {
  readonly filter: BiFilter;
  readonly column: BiSourceColumn | undefined;
  readonly onChange: (filter: BiFilter) => void;
  readonly disabled?: boolean;
}

/**
 * Whatever the operator's arity asks for, and nothing when it asks for nothing.
 *
 * `none` draws no box at all rather than a disabled one: `IS NULL` takes no operand, and an
 * empty greyed input beside it invites a value the compiler would drop. `many` is a single
 * comma-separated line rather than a chip editor because `parseScalarList` already splits on
 * commas and trims, and a chip editor would be a second parser with its own opinion about
 * whitespace.
 */
function Operand({ filter, column, onChange, disabled }: OperandProps) {
  const { tr } = useLocale();
  const arity = BI_OPERATOR_ARITY[filter.op];
  const type = column?.dataType;

  if (arity === 'none') return <span />;

  if (arity === 'many') {
    return (
      <Input
        value={(filter.values ?? []).map(operandText).join(', ')}
        disabled={disabled}
        placeholder={tr('قيمة، قيمة', 'valeur, valeur', 'value, value')}
        onChange={(next) => onChange({ ...filter, values: parseScalarList(next, type) })}
      />
    );
  }

  if (arity === 'two') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Input
          value={operandText(filter.value)}
          disabled={disabled}
          placeholder={tr('من', 'De', 'From')}
          onChange={(next) => onChange({ ...filter, value: parseScalar(next, type) })}
        />
        <Input
          value={operandText(filter.value2)}
          disabled={disabled}
          placeholder={tr('إلى', 'À', 'To')}
          onChange={(next) => onChange({ ...filter, value2: parseScalar(next, type) })}
        />
      </div>
    );
  }

  return (
    <Input
      value={operandText(filter.value)}
      disabled={disabled}
      onChange={(next) => onChange({ ...filter, value: parseScalar(next, type) })}
    />
  );
}

export interface FilterRowsProps {
  readonly filters: readonly BiFilter[];
  readonly columns: readonly BiSourceColumn[];
  readonly onChange: (filters: readonly BiFilter[]) => void;
  readonly disabled?: boolean;
}

/**
 * A list of predicates, each one field, one operator and whatever the operator needs.
 *
 * An incomplete row is marked here rather than only at run time. `filterComplete` is the same
 * predicate `readiness` reports as `FILTER_INCOMPLETE` and the same one the compiler enforces,
 * so a row the server would refuse is red while it is being typed — and the caller's own
 * primary button, which quotes the same function, is dark for the same reason.
 *
 * Rows are keyed by index and not by field. Two predicates on the same column are legal and
 * ordinary — `amount > 0` and `amount < 1000` are a range somebody wrote before `BETWEEN`
 * occurred to them — so a key on the field name would collapse the pair into one row.
 */
export function FilterRows({ filters, columns, onChange, disabled }: FilterRowsProps) {
  const { tr } = useLocale();
  const first = columns[0]?.columnName ?? '';
  const fields: readonly SelectOption[] = columns.map((column) => ({
    value: column.columnName,
    label: column.name === '' ? column.columnName : column.name,
  }));

  const replace = (index: number, filter: BiFilter): void => {
    onChange(filters.map((current, at) => (at === index ? filter : current)));
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {filters.map((filter, index) => {
        const column = columns.find((one) => one.columnName === filter.field);
        const incomplete = !filterComplete(filter);
        return (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 110px 1.4fr 28px',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <Select
              value={filter.field}
              options={fields}
              disabled={disabled}
              onChange={(next) => replace(index, { ...filter, field: next })}
            />
            <OperatorPicker
              value={filter.op}
              disabled={disabled}
              onChange={(op) => replace(index, retypeFilter(filter, op))}
            />
            <Operand
              filter={filter}
              column={column}
              disabled={disabled}
              onChange={(next) => replace(index, next)}
            />
            <IconButton
              icon={X}
              label={tr('إزالة', 'Retirer', 'Remove')}
              disabled={disabled}
              tone={incomplete ? 'danger' : undefined}
              onClick={() => onChange(filters.filter((_, at) => at !== index))}
            />
          </div>
        );
      })}
      <div>
        <Button
          icon={Plus}
          variant="subtle"
          size="sm"
          disabled={disabled === true || columns.length === 0}
          onClick={() => onChange([...filters, blankFilter(first)])}
        >
          {tr('إضافة شرط', 'Ajouter un filtre', 'Add filter')}
        </Button>
      </div>
    </div>
  );
}

export interface FilterFieldProps extends FilterRowsProps {
  /** Overrides the default label, for the metric editor's *"applies to this measure only"*. */
  readonly label?: string;
  readonly hint?: string;
}

/**
 * The predicate list inside an SDK `Field`, which is how the two dialogs want it.
 *
 * A separate export rather than a prop on {@link FilterRows} because the builder does not want
 * a `Field` — it has its own section header and its own spacing — and a `label?: undefined`
 * that silently changed the markup would be the sort of thing somebody has to read the source
 * to discover.
 */
export function FilterField({ label, hint, ...rows }: FilterFieldProps) {
  const { tr } = useLocale();
  return (
    <Field label={label ?? tr('الشروط', 'Filtres', 'Filters')} hint={hint}>
      <FilterRows {...rows} />
    </Field>
  );
}
