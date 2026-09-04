/**
 * The parts a form is made of.
 *
 * `dialogs.tsx` opens eight modals; this file draws the questions inside them. The split
 * is the one `detail.tsx` and `rows.tsx` already made, for the same reason: the modals
 * know which record is being written and which command will write it, while nothing here
 * knows either. A field arrives as a `FieldSpec`, a string, and a callback, and leaves as
 * a labelled input.
 *
 * Three rules the whole file keeps.
 *
 * A blocking problem is red; an advisory problem is grey. `Field` draws its `error`
 * *instead of* its `hint`, and those two slots are exactly the two kinds of `Problem` the
 * validators produce — a blocking one takes the error slot and locks the save, an advisory
 * one takes the hint slot and only warns. Painting an advisory red would make *'the
 * booking will be confirmed with no payment recorded'* look like a refusal.
 *
 * A problem no input owns is drawn above the grid. `PROBLEM_TARGET` and
 * `PROBLEM_IDENTITY` belong to no column — one is an OR-check across three foreign keys,
 * the other asks whether a lead has any name at all — and `validateSend`'s `lines` and
 * `validateAccept`'s `seats` are facts about a list, not about a field. `Notices` takes
 * the keys the inputs already show and draws whatever is left over.
 *
 * A foreign key is a list of names, never a uuid to paste. Six `LookupName`s resolve
 * against data the app already loaded; two of them — `leads` and `quotes` — have no
 * `*ById` map to read, so they are built from `model.all` instead.
 */
import { AlertTriangle, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Field,
  InfoBar,
  Input,
  Select,
  type SelectOption,
  TextArea,
  useLocale,
} from '@/platform/sdk';
import { ENTITY_FIELDS } from './form';
import type { FieldKind, FieldSpec, LookupName, Problem, RecordDraft } from './form';
import type { CrmModel } from './model';

/**
 * Which `<input type>` each kind wears. Total over `FieldKind` rather than partial, so the
 * four kinds that are not an `<input>` at all have to say so here instead of falling
 * through a `??`: `multiline` is a `TextArea`, `select` and `lookup` are a `Select`, and
 * the `text` they carry is only what a `fixed` field's read-only box would use.
 */
const INPUT_TYPE: Readonly<Record<FieldKind, string>> = {
  text: 'text',
  multiline: 'text',
  select: 'text',
  lookup: 'text',
  integer: 'number',
  money: 'number',
  decimal: 'number',
  date: 'date',
  datetime: 'datetime-local',
};

/**
 * The granularity a number is entered at. Partial on purpose — a `step` of `undefined` is
 * the browser's own default, which is what every non-numeric kind wants, and writing five
 * explicit `undefined`s would only invite someone to fill them in.
 */
const STEP: Readonly<Partial<Record<FieldKind, string>>> = {
  integer: '1',
  money: '0.01',
  decimal: '0.01',
};

/** Alphabetical, because a picker is read by name while the query returned it by recency. */
const byLabel = (options: readonly SelectOption[]): readonly SelectOption[] =>
  [...options].sort((a, b) => a.label.localeCompare(b.label));

/**
 * The six pickers, each over `model.all` rather than `model.visible`: the search box
 * narrows the register a person is reading, and having it silently narrow the customers a
 * quote may be written against would be a different feature entirely — one nobody asked
 * for and nobody would be told about.
 *
 * `leads` and `quotes` are built from the branch because the model keeps no `*ById` map for
 * either. The four maps it does keep hold whole rows, so they would buy nothing here.
 *
 * An exhaustive `switch` with no `default`: a seventh `LookupName` added to `form.ts` must
 * fail this file's typecheck rather than quietly render an empty dropdown.
 */
function lookupRows(model: CrmModel, name: LookupName): readonly SelectOption[] {
  switch (name) {
    case 'customers':
      return model.all.customers.map((row) => ({ value: row.id, label: row.name }));
    case 'leads':
      return model.all.leads.map((row) => ({ value: row.id, label: row.name }));
    case 'opportunities':
      return model.all.opportunities.map((row) => ({
        value: row.id,
        label: row.title.trim() === '' ? row.reference : row.title,
      }));
    case 'quotes':
      return model.all.quotes.map((row) => ({ value: row.id, label: row.number }));
    case 'packages':
      return model.packages.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }));
    case 'campaigns':
      return model.all.campaigns.map((row) => ({ value: row.id, label: row.name }));
  }
}

const lookupOptions = (model: CrmModel, name: LookupName): readonly SelectOption[] =>
  byLabel(lookupRows(model, name));

/** The name behind a key, or the key itself — the bargain `rows.tsx`'s `Linked` also strikes. */
const nameIn = (options: readonly SelectOption[], value: string): string =>
  options.find((option) => option.value === value)?.label ?? value;

interface LookupProps {
  readonly model: CrmModel;
  readonly name: LookupName;
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** A required key offers no blank choice once one is made; an optional one offers *none*. */
  readonly required?: boolean;
}

/**
 * A foreign key as a list of names.
 *
 * A component rather than a helper because `react-refresh/only-export-components` is
 * error-level here and `dialogs.tsx` needs the package picker for Convert — a function
 * exported from a `.tsx` would fail lint, so the reusable unit has to be the input itself.
 *
 * The empty option carries the whole difference between the two kinds of key: *'Select…'*
 * on a required one is an instruction, while *'None'* on an optional one is an answer.
 */
export function Lookup({ model, name, value, onChange, required }: LookupProps) {
  const { tr } = useLocale();
  return (
    <Select
      value={value}
      onChange={onChange}
      options={lookupOptions(model, name)}
      placeholder={
        required === true ? tr('اختر…', 'Choisir…', 'Select…') : tr('لا شيء', 'Aucun', 'None')
      }
    />
  );
}

interface ControlProps {
  readonly spec: FieldSpec;
  readonly value: string;
  readonly model: CrmModel;
  /** True when a blocking problem names this field, so the box itself can go red. */
  readonly invalid: boolean;
  readonly onChange: (next: string) => void;
}

/**
 * One input, chosen by kind.
 *
 * `fixed` is tested before the kind is read at all, because a fixed field is a *statement*
 * rather than a question — the quote a line belongs to, the deal a quote was written
 * against — so it draws a read-only box holding the resolved name instead of the uuid.
 * Monospaced, for the reason `Linked` gives: by then it is something to check, not to read.
 *
 * Everything numeric, dated or plain ends at one `Input`, spread through `INPUT_TYPE` and
 * `STEP`. `Select` carries no `invalid` prop, which is why only that last branch takes one:
 * a dropdown cannot hold an unparseable value, so the only thing it can be wrong about is
 * being empty, and the red label `Field` draws already says that.
 */
function Control({ spec, value, model, invalid, onChange }: ControlProps) {
  const { t, tr } = useLocale();
  if (spec.fixed === true) {
    const shown = spec.lookup === undefined ? value : nameIn(lookupRows(model, spec.lookup), value);
    return <Input value={shown} onChange={() => undefined} readOnly mono />;
  }
  if (spec.kind === 'multiline') return <TextArea value={value} onChange={onChange} rows={3} />;
  if (spec.kind === 'select') {
    return (
      <Select
        value={value}
        onChange={onChange}
        options={(spec.options ?? []).map((option) => ({
          value: option.value,
          label: t(option.label),
        }))}
        placeholder={
          spec.defaulted === true
            ? tr('افتراضي', 'Par défaut', 'Default')
            : tr('اختر…', 'Choisir…', 'Select…')
        }
      />
    );
  }
  if (spec.kind === 'lookup' && spec.lookup !== undefined) {
    return (
      <Lookup
        model={model}
        name={spec.lookup}
        value={value}
        onChange={onChange}
        required={spec.required}
      />
    );
  }
  return (
    <Input
      type={INPUT_TYPE[spec.kind]}
      step={STEP[spec.kind]}
      min={spec.min}
      max={spec.max}
      value={value}
      onChange={onChange}
      invalid={invalid}
    />
  );
}

/**
 * The grid a form is laid out on.
 *
 * `auto-fit` with a 200px floor rather than a fixed column count, so the same markup gives
 * two columns in a 560px dialog and one column when the window is too narrow for two. The
 * responsive behaviour is therefore a property of the grid itself and costs the desktop
 * nothing — no media query, no breakpoint, nothing to keep in step with the shell's own.
 */
export function FormGrid({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

interface EntryProps {
  readonly label: string;
  /** The key a validator names its problem with — usually the column, sometimes not. */
  readonly field: string;
  readonly problems: readonly Problem[];
  readonly children: ReactNode;
  /** The field's own note, shown only while no advisory problem has something to say. */
  readonly hint?: string;
  readonly required?: boolean;
  readonly wide?: boolean;
}

/**
 * A labelled slot, and the one place the two kinds of `Problem` are told apart.
 *
 * `Field` draws its `error` *instead of* its `hint`, which maps exactly onto the two things
 * a validator can return: a blocking problem takes the error slot and is red, an advisory
 * problem takes the hint slot and is grey. Getting this the wrong way round would paint
 * *'the booking will be confirmed with no payment recorded'* — a warning about a real
 * consequence of a permitted action — in the colour this app reserves for a refusal.
 *
 * An advisory outranks the field's own `hint`: a note that always shows is worth less than
 * one the validator raised about the value actually typed.
 */
export function Entry({ label, field, problems, children, hint, required, wide }: EntryProps) {
  const { t } = useLocale();
  const bad = problems.find((problem) => problem.field === field && problem.blocking);
  const note = problems.find((problem) => problem.field === field && !problem.blocking);
  return (
    <div style={{ gridColumn: wide === true ? '1 / -1' : undefined, minWidth: 0 }}>
      <Field
        label={label}
        required={required}
        error={bad === undefined ? null : t(bad.text)}
        hint={note === undefined ? hint : t(note.text)}
      >
        {children}
      </Field>
    </div>
  );
}

interface NoticesProps {
  readonly problems: readonly Problem[];
  /** The keys the inputs on screen draw for themselves. Everything else surfaces here. */
  readonly own: readonly string[];
}

/**
 * The problems no input can show.
 *
 * Two of them are declared in `form.ts` — `PROBLEM_TARGET`, an OR-check across three
 * foreign keys, and `PROBLEM_IDENTITY`, which asks whether a lead has any name at all —
 * and the lifecycle validators add their own: `validateSend`'s `lines` is a fact about a
 * quote's line list, `validateAccept`'s `seats` about a package's remaining capacity.
 * None of them belongs beside a box, so all of them are drawn above the grid.
 *
 * The caller passes the keys its own inputs already display, which is why this takes a list
 * rather than filtering on the two synthetic markers: a dialog that omits a field still
 * owes the reader whatever the validator said about it.
 *
 * The key carries `blocking` as well as the field, because one field can raise both at once
 * — a value that is refused *and* a consequence worth mentioning — and React would
 * otherwise drop the second bar.
 */
export function Notices({ problems, own }: NoticesProps) {
  const { t } = useLocale();
  const loose = problems.filter((problem) => !own.includes(problem.field));
  if (loose.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {loose.map((problem) => (
        <InfoBar
          key={`${problem.field}:${String(problem.blocking)}`}
          tone={problem.blocking ? 'danger' : 'warning'}
          icon={problem.blocking ? AlertTriangle : CircleAlert}
          title={t(problem.text)}
        />
      ))}
    </div>
  );
}

interface RecordFormProps {
  readonly draft: RecordDraft;
  readonly model: CrmModel;
  readonly problems: readonly Problem[];
  readonly onEdit: (key: string, text: string) => void;
}

/**
 * All eight record editors, from one loop over `ENTITY_FIELDS`.
 *
 * There is no per-entity form in this app and there was never a reason for eight of them:
 * a table's columns, their kinds, their options and their foreign keys are all declared in
 * `form.ts`, so the difference between the lead editor and the campaign editor is entirely
 * data. What is left over — which command saves it, whether it may be saved at all — is
 * the dialog's business, and the dialog is where it stays.
 *
 * `wide` is honoured, and forced for anything multiline: a paragraph in a half-width column
 * is a worse place to write notes than the grid's own second column is to lose them.
 */
export function RecordForm({ draft, model, problems, onEdit }: RecordFormProps) {
  const { t } = useLocale();
  const specs = ENTITY_FIELDS[draft.entity];
  const blocking = problems.filter((problem) => problem.blocking).map((problem) => problem.field);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Notices problems={problems} own={specs.map((spec) => spec.key)} />
      <FormGrid>
        {specs.map((spec) => (
          <Entry
            key={spec.key}
            label={t(spec.label)}
            field={spec.key}
            problems={problems}
            hint={spec.hint === undefined ? undefined : t(spec.hint)}
            required={spec.required}
            wide={spec.wide === true || spec.kind === 'multiline'}
          >
            <Control
              spec={spec}
              value={draft.values[spec.key] ?? ''}
              model={model}
              invalid={blocking.includes(spec.key)}
              onChange={(next) => onEdit(spec.key, next)}
            />
          </Entry>
        ))}
      </FormGrid>
    </div>
  );
}
