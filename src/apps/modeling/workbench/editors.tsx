/**
 * Modeling workbench — the four dialogs.
 *
 * `commands.ts` made a wrong payload unspellable; this file is where a person fills a right one
 * in. Two things run through all four dialogs and are worth stating once.
 *
 * **They close on success and stay open on refusal.** Every command returns `Promise<boolean>`
 * — the reason `commands.ts` returns booleans at all — so a dialog awaits the answer and calls
 * `onClose` only when it is `true`. A broker refusal leaves the form exactly as it was typed,
 * with the toast explaining why, instead of throwing somebody's work away to an
 * `INVALID_ARGUMENT` they cannot see any more.
 *
 * **They refuse a bad key before the database has to.** The same key is judged by three
 * different rules in this system: the engine's `isValidKey` (shape only), the database's
 * `private.modeling_key_ok` (shape, sixty characters, and nineteen words the lexer has already
 * claimed), and a stricter lowercase rule on the model's own key. A dialog validating with
 * `isValidKey` alone would let somebody name a row `min` — which passes the client, passes the
 * engine, and comes back from Postgres as a CHECK violation in a toast that names no field. So
 * all three rules are restated here, beside the input, in the reader's language, while they are
 * still typing.
 *
 * Each dialog is two components: an exported wrapper that renders nothing while closed, and a
 * form that initialises its state at mount. The wrapper gives the form a `key` derived from what
 * is being edited, so opening the dialog on a different row mounts a fresh form — and, just as
 * important, a dataset refetch while the dialog is open does not. An effect synchronising draft
 * state against props would have reset the form under somebody's hands every time any window
 * ran any command.
 */
import { type CSSProperties, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  Field,
  fmt,
  Input,
  type Localized,
  Select,
  type SelectOption,
  TextArea,
  useLocale,
} from '@/platform/sdk';
import { type AssumptionUnit, type FnName, isValidKey, parseFormula, referencesOf } from '../engine';
import type { AssumptionEdit, ModelEdit, NewModel, RowBody, RowEdit, ScenarioEdit } from './commands';
import { type DocAssumption, type DocRow, type DocScenario, type ModelHeader, toUnit } from './document';
import { PARSE_ERROR_LABEL, UNIT_LABEL } from './labels';

/* ------------------------------------------------------------------ *
 * The words the lexer has already claimed
 * ------------------------------------------------------------------ */

/**
 * The thirteen function names, keyed off the engine's own union.
 *
 * `FN_ARITY` and `SERIES_FORMS` are module-private inside `engine/expression.ts` — deliberately,
 * since they are the parser's internals — so the reserved list cannot be imported and has to be
 * restated. Restating it as `Readonly<Record<FnName, true>>` rather than as an array of strings
 * is what keeps the copy honest: a fourteenth function added to `FnName` breaks this line, and
 * whoever added it is told that a row may no longer be named after it.
 */
const FUNCTION_WORDS: Readonly<Record<FnName, true>> = {
  min: true,
  max: true,
  avg: true,
  abs: true,
  floor: true,
  ceil: true,
  sqrt: true,
  round: true,
  pow: true,
  clamp: true,
  if: true,
  growth: true,
  pmt: true,
};

/**
 * The six words that are not function names and are still taken.
 *
 * `prior`, `sum` and `npv` are the series forms — they read a whole row rather than a value, so
 * the parser keeps them in a `Set<string>` rather than in `FnName`. `and`, `or` and `not` are
 * operators, spelled as words. Neither group exists as a union to be total over, so this array
 * is a hand-written copy and says so.
 */
const WORD_FORMS: readonly string[] = ['prior', 'sum', 'npv', 'and', 'or', 'not'];

/** The nineteen, matched case-insensitively, exactly as `private.modeling_key_ok` matches them. */
const RESERVED: ReadonlySet<string> = new Set([...Object.keys(FUNCTION_WORDS), ...WORD_FORMS]);

/* ------------------------------------------------------------------ *
 * What can be wrong with a key
 * ------------------------------------------------------------------ */

type KeyFault = 'EMPTY' | 'SHAPE' | 'CASE' | 'LONG' | 'RESERVED' | 'TAKEN';

const KEY_FAULT: Readonly<Record<KeyFault, Localized>> = {
  EMPTY: { ar: 'المفتاح مطلوب.', fr: 'La clé est obligatoire.', en: 'A key is required.' },
  SHAPE: {
    ar: 'حروف وأرقام وشرطة سفلية فقط، ولا يبدأ برقم.',
    fr: 'Lettres, chiffres et tirets bas seulement, et pas de chiffre en tête.',
    en: 'Letters, digits and underscores only, and not starting with a digit.',
  },
  CASE: {
    ar: 'حروف صغيرة وأرقام وشرطة سفلية، حرفان على الأقل.',
    fr: 'Minuscules, chiffres et tirets bas, deux caractères au minimum.',
    en: 'Lowercase, digits and underscores, at least two characters.',
  },
  LONG: { ar: 'ستون حرفًا على الأكثر.', fr: 'Soixante caractères au maximum.', en: 'Sixty characters at most.' },
  RESERVED: {
    ar: 'هذا الاسم تستعمله الصيغ نفسها، فلن تستطيع أي صيغة الإشارة إليه.',
    fr: 'Ce nom est celui d’une fonction : aucune formule ne pourrait y faire référence.',
    en: 'A formula already means something else by this name, so no formula could refer to it.',
  },
  TAKEN: { ar: 'المفتاح مستعمل في هذا النموذج.', fr: 'Cette clé est déjà utilisée dans ce modèle.', en: 'That key is already used in this model.' },
};

/**
 * The rule for a key a formula will have to name: an assumption, a row, or a scenario.
 *
 * Cheapest test first, and each fault distinct, because "invalid key" beside an input is not
 * advice. `RESERVED` is the one worth spelling out: `min` satisfies `isValidKey`, satisfies the
 * shape check in Postgres, and is still unusable, because `min + 1` lexes as a call to `min` with
 * no arguments rather than as a reference to a row. The database refuses it in a CHECK; this
 * refuses it while the cursor is still in the field.
 */
function keyFault(key: string, taken: ReadonlySet<string>): KeyFault | null {
  if (key === '') return 'EMPTY';
  if (!isValidKey(key)) return 'SHAPE';
  if (key.length > 60) return 'LONG';
  if (RESERVED.has(key.toLowerCase())) return 'RESERVED';
  if (taken.has(key)) return 'TAKEN';
  return null;
}

/**
 * The rule for the model's own key, written out whole rather than delegated.
 *
 * It would read better as `keyFault` plus a lowercase test, and it would be wrong. The models
 * table's constraint is `key ~ '^[a-z][a-z0-9_]{1,60}$'` and nothing else: lowercase, two to
 * sixty-one characters, and **no reserved-word test**, because a model key is never named in a
 * formula. `min` is a perfectly good name for a model. Delegating would have had the client
 * refuse a key the database accepts, which is the worse of the two failures — a refusal nobody
 * can appeal against a rule that does not exist.
 */
function modelKeyFault(key: string, taken: ReadonlySet<string>): KeyFault | null {
  if (key === '') return 'EMPTY';
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(key)) return 'CASE';
  if (taken.has(key)) return 'TAKEN';
  return null;
}

/* ------------------------------------------------------------------ *
 * Reading numbers and periods out of a textarea
 * ------------------------------------------------------------------ */

/**
 * The axis, one period per line — or per comma, or per semicolon.
 *
 * Order is preserved and blanks are dropped, so a trailing newline is not a nameless period.
 * Nothing here validates the labels themselves: `FY26`, `2026-01` and `Q1` are all legitimate
 * names for a period and the model does not care which convention a company keeps.
 */
function parseAxis(text: string): readonly string[] {
  return text
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Twelve months from a start, for the common case that would otherwise be twelve lines of typing. */
function monthlyAxis(startIso: string, count: number): readonly string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(startIso.trim());
  if (match === null) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return [];
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const absolute = (year * 12 + (month - 1)) + index;
    out.push(`${String(Math.floor(absolute / 12))}-${String(absolute % 12 + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * A pasted series: whitespace and semicolons separate the numbers, and commas never do.
 *
 * `fmt.parseAmount` reads a comma as a decimal separator, which is the right call for a French
 * or Arabic keyboard and makes `1,5 2,5` a two-number series rather than a four-number one.
 * Splitting on commas here would have quietly turned every decimal into two integers. One bad
 * token refuses the whole paste: a series silently one number short would shift every period
 * after it, and holding the last value is a decision the engine documents, not one a dropped
 * token should make by accident.
 */
function parseSeries(text: string): readonly number[] | null {
  const tokens = text.split(/[\s;]+/).filter((token) => token !== '');
  const out: number[] = [];
  for (const token of tokens) {
    const value = fmt.parseAmount(token);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The unit picker
 * ------------------------------------------------------------------ */

/**
 * The five units as a list, derived from a record rather than written as an array.
 *
 * Each unit maps to itself, so `Object.values` hands back `AssumptionUnit[]` with no cast and no
 * `as const`. The point is the same as everywhere else in this folder: a sixth unit added to the
 * engine breaks this record, where a hand-written array would have shipped a picker that silently
 * cannot offer it.
 */
const UNIT_ORDER: Readonly<Record<AssumptionUnit, AssumptionUnit>> = {
  CURRENCY: 'CURRENCY',
  RATE: 'RATE',
  COUNT: 'COUNT',
  DAYS: 'DAYS',
  FACTOR: 'FACTOR',
};

/** The picker's options, in the reader's language. */
function unitOptions(t: (text: Localized) => string): readonly SelectOption[] {
  return Object.values(UNIT_ORDER).map((unit) => ({ value: unit, label: t(UNIT_LABEL[unit]) }));
}

/** A text field's value on its way into a payload: what was typed, trimmed, and never `undefined`. */
const said = (text: string): string => text.trim();

/**
 * A position field, read back as the one thing in these forms that may legitimately be absent.
 *
 * Every other text field sends what was typed: a form displays what is stored, so an empty
 * Arabic-name box means the name is empty, not that it is unchanged. `sortOrder` is different
 * because `DocRow`, `DocAssumption` and `DocScenario` deliberately do not carry it — the client
 * is not told where an item currently sits — so a blank box has to mean "leave it where it is",
 * which is `undefined`, the one value `defined()` in `commands.ts` drops from the payload.
 */
function position(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = fmt.parseAmount(trimmed);
  if (value === null) return undefined;
  return Math.round(value);
}

/**
 * Submitting: busy while it is in flight, closed only if it succeeded.
 *
 * The whole reason `commands.ts` hands back a boolean instead of firing and forgetting. On a
 * refusal the form stays mounted with every character still in it and the toast says why; on
 * success the wrapper unmounts the form, so there is no state left to reset.
 */
function useSubmit(onClose: () => void): { readonly busy: boolean; readonly go: (run: () => Promise<boolean>) => void } {
  const [busy, setBusy] = useState(false);
  const go = (run: () => Promise<boolean>): void => {
    if (busy) return;
    setBusy(true);
    void run().then(
      (ok) => {
        if (ok) onClose();
        else setBusy(false);
      },
      () => {
        setBusy(false);
      },
    );
  };
  return { busy, go };
}

/** The stack every dialog body is: one column, twelve pixels apart. */
const STACK: CSSProperties = { display: 'grid', gap: 12 };

/** Two fields on one line, for the pairs that read as one idea — a low and a high, a start and a count. */
const PAIR: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

/* ------------------------------------------------------------------ *
 * The model: a key, a name, and an axis
 * ------------------------------------------------------------------ */

export interface ModelDialogProps {
  readonly open: boolean;
  /** The model being edited, or null when this is a create. */
  readonly subject: ModelHeader | null;
  /** The axis as it stands. Ignored while creating. */
  readonly periods: readonly string[];
  /** Every model key already in use, so a duplicate is refused here, not by the unique index. */
  readonly taken: ReadonlySet<string>;
  readonly onCreate: (input: NewModel) => Promise<boolean>;
  readonly onUpdate: (input: ModelEdit) => Promise<boolean>;
  readonly onClose: () => void;
}

/**
 * Renders nothing while closed, and a form that never resets while open.
 *
 * `Dialog` returns null when `open` is false, but the component *holding* it stays mounted — so a
 * form whose `useState` initialisers read the subject would still be showing the previous
 * subject's values the second time it opened. Mounting the form under a key derived from the
 * subject settles both halves at once: a different model gets a fresh form, and a `useDataset`
 * refetch — which happens after every command, including one issued in another window — does not,
 * because the key has not changed.
 */
export function ModelDialog(props: ModelDialogProps) {
  if (!props.open) return null;
  return <ModelForm key={props.subject?.id ?? '@new'} {...props} />;
}

function ModelForm({ subject, periods, taken, onCreate, onUpdate, onClose }: ModelDialogProps) {
  const { t, tr } = useLocale();
  const { busy, go } = useSubmit(onClose);
  const creating = subject === null;

  const [key, setKey] = useState(subject?.key ?? '');
  const [name, setName] = useState(subject?.name ?? '');
  const [nameAr, setNameAr] = useState(subject?.nameAr ?? '');
  const [description, setDescription] = useState(subject?.description ?? '');
  const [axis, setAxis] = useState(creating ? '' : periods.join('\n'));
  const [start, setStart] = useState('');
  const [count, setCount] = useState('12');

  const parsed = useMemo(() => parseAxis(axis), [axis]);
  /** What the generator would produce, so the button can refuse itself rather than fill in nothing. */
  const generated = useMemo(() => {
    const many = fmt.parseAmount(count);
    if (many === null) return [];
    const rounded = Math.round(many);
    if (rounded < 1 || rounded > 600) return [];
    return monthlyAxis(start, rounded);
  }, [count, start]);

  // The key is validated only while creating: after that it is fixed, and a rule applied to a
  // field nobody can change is a rule that can only ever be wrong about the past.
  const fault = creating ? modelKeyFault(key.trim(), taken) : null;
  const axisFault =
    parsed.length === 0
      ? tr('فترة واحدة على الأقل.', 'Au moins une période.', 'At least one period.')
      : parsed.length > 600
        ? tr('ستمئة فترة على الأكثر.', 'Six cents périodes au maximum.', 'Six hundred periods at most.')
        : null;
  const ready = fault === null && said(name) !== '' && axisFault === null;

  const submit = (): void => {
    if (!ready) return;
    const words = { name: said(name), nameAr: said(nameAr), description: said(description), periods: parsed };
    go(() => (creating ? onCreate({ key: key.trim(), ...words }) : onUpdate(words)));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={creating ? tr('نموذج جديد', 'Nouveau modèle', 'New model') : tr('تعديل النموذج', 'Modifier le modèle', 'Edit model')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: creating ? tr('إنشاء', 'Créer', 'Create') : tr('حفظ', 'Enregistrer', 'Save'),
        onClick: submit,
        disabled: !ready,
        busy,
      }}
    >
      <div style={STACK}>
        {creating ? (
          // Shown only while creating, because the key is fixed afterwards — and a rule enforced
          // against a field nobody can edit can only ever be wrong about the past.
          <Field
            label={tr('المفتاح', 'Clé', 'Key')}
            required
            error={key === '' || fault === null ? null : t(KEY_FAULT[fault])}
            hint={tr('حروف صغيرة وأرقام. لا يتغيّر بعد الإنشاء.', 'Minuscules et chiffres. Définitif après création.', 'Lowercase and digits. Fixed once created.')}
          >
            <Input value={key} onChange={setKey} mono placeholder="base_case" onEnter={submit} />
          </Field>
        ) : null}
        <Field label={tr('الاسم', 'Nom', 'Name')} required>
          <Input value={name} onChange={setName} onEnter={submit} />
        </Field>
        <div style={PAIR}>
          <Field label={tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name')}>
            <Input value={nameAr} onChange={setNameAr} onEnter={submit} />
          </Field>
          <Field label={tr('الوصف', 'Description', 'Description')}>
            <Input value={description} onChange={setDescription} onEnter={submit} />
          </Field>
        </div>
        <Field
          label={tr('الفترات', 'Périodes', 'Periods')}
          required
          error={axisFault}
          hint={tr(
            `${String(parsed.length)} فترة — واحدة في كل سطر.`,
            `${String(parsed.length)} période(s) — une par ligne.`,
            `${String(parsed.length)} period(s) — one per line.`,
          )}
        >
          <TextArea value={axis} onChange={setAxis} rows={6} mono placeholder={'2026-01\n2026-02\n2026-03'} />
        </Field>
        {/*
          The generator writes into the textarea rather than replacing the axis at submit. Months
          are the common case and twelve lines is a lot of typing, but `FY26` and `Q1` are perfectly
          good period names — so this fills the field and then gets out of the way.
        */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label={tr('يبدأ في', 'Début', 'Starts')} hint="YYYY-MM">
            <Input value={start} onChange={setStart} mono placeholder="2026-01" />
          </Field>
          <Field label={tr('عدد الأشهر', 'Combien de mois', 'How many months')}>
            <Input value={count} onChange={setCount} inputMode="numeric" />
          </Field>
          <Button onClick={() => setAxis(generated.join('\n'))} disabled={generated.length === 0}>
            {tr('توليد', 'Générer', 'Fill')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * An assumption: a number somebody chose, and the range they will admit to
 * ------------------------------------------------------------------ */

export interface AssumptionDialogProps {
  readonly open: boolean;
  /** The assumption being edited, or null when this is a new one. */
  readonly subject: DocAssumption | null;
  /**
   * Every key the document already spends.
   *
   * Rows and assumptions share one namespace — a formula naming `revenue` must mean exactly one
   * thing — so this is both lists, and the engine's `SHADOWED` graph issue is what happens when
   * it is not checked.
   */
  readonly taken: ReadonlySet<string>;
  /** How many assumptions there are, so a new one lands at the bottom rather than at the top. */
  readonly count: number;
  readonly onSave: (input: AssumptionEdit) => Promise<boolean>;
  readonly onClose: () => void;
}

export function AssumptionDialog(props: AssumptionDialogProps) {
  if (!props.open) return null;
  return <AssumptionForm key={props.subject?.key ?? '@new'} {...props} />;
}

/** A number on its way into a field: what is stored, or blank when there is nothing stored. */
const shown = (value: number | null): string => (value === null ? '' : String(value));

function AssumptionForm({ subject, taken, count, onSave, onClose }: AssumptionDialogProps) {
  const { t, tr } = useLocale();
  const { busy, go } = useSubmit(onClose);
  const creating = subject === null;

  const [key, setKey] = useState(subject?.key ?? '');
  const [label, setLabel] = useState(subject?.label ?? '');
  const [labelAr, setLabelAr] = useState(subject?.labelAr ?? '');
  const [unit, setUnit] = useState<AssumptionUnit>(subject?.unit ?? 'CURRENCY');
  const [value, setValue] = useState(shown(subject?.value ?? null));
  const [low, setLow] = useState(shown(subject?.low ?? null));
  const [high, setHigh] = useState(shown(subject?.high ?? null));
  const [note, setNote] = useState(subject?.note ?? '');
  const [pos, setPos] = useState(creating ? String(count) : '');

  // Both bounds are optional and either may be cleared; `AssumptionEdit` declares them
  // required-and-nullable precisely so a blank field can *mean* something, rather than being
  // dropped from the payload and leaving yesterday's range in place.
  const number = fmt.parseAmount(value);
  const lowNumber = low.trim() === '' ? null : fmt.parseAmount(low);
  const highNumber = high.trim() === '' ? null : fmt.parseAmount(high);

  const fault = creating ? keyFault(key.trim(), taken) : null;
  const badValue = value.trim() !== '' && number === null;
  const badRange =
    (low.trim() !== '' && lowNumber === null) ||
    (high.trim() !== '' && highNumber === null) ||
    (lowNumber !== null && highNumber !== null && lowNumber > highNumber);

  const ready = fault === null && said(label) !== '' && number !== null && !badRange;

  const submit = (): void => {
    if (!ready || number === null) return;
    // An upsert is keyed on what it is given, so a changed key would create a second assumption
    // rather than rename this one. The field is read-only once it exists and the stored key is
    // what gets sent; renaming is a delete and a create, which at least says what it is doing.
    const target = subject === null ? key.trim() : subject.key;
    go(() =>
      onSave({
        key: target,
        label: said(label),
        labelAr: said(labelAr),
        unit,
        value: number,
        low: lowNumber,
        high: highNumber,
        note: said(note),
        sortOrder: position(pos),
      }),
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={creating ? tr('افتراض جديد', 'Nouvelle hypothèse', 'New assumption') : tr('تعديل الافتراض', 'Modifier l’hypothèse', 'Edit assumption')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{ label: tr('حفظ', 'Enregistrer', 'Save'), onClick: submit, disabled: !ready, busy }}
    >
      <div style={STACK}>
        <div style={PAIR}>
          <Field
            label={tr('المفتاح', 'Clé', 'Key')}
            required
            error={!creating || key === '' || fault === null ? null : t(KEY_FAULT[fault])}
            hint={creating ? tr('كما تكتبه الصيغ.', 'Tel qu’une formule l’écrira.', 'As a formula will write it.') : undefined}
          >
            <Input value={key} onChange={setKey} mono disabled={!creating} placeholder="unit_price" onEnter={submit} />
          </Field>
          <Field label={tr('الوحدة', 'Unité', 'Unit')} required>
            <Select value={unit} onChange={(next) => setUnit(toUnit(next))} options={unitOptions(t)} />
          </Field>
        </div>
        <Field label={tr('العنوان', 'Libellé', 'Label')} required>
          <Input value={label} onChange={setLabel} onEnter={submit} />
        </Field>
        <div style={PAIR}>
          <Field label={tr('العنوان بالعربية', 'Libellé en arabe', 'Arabic label')}>
            <Input value={labelAr} onChange={setLabelAr} onEnter={submit} />
          </Field>
          <Field
            label={tr('الترتيب', 'Position', 'Position')}
            hint={creating ? undefined : tr('فارغ: يبقى في موضعه.', 'Vide : ne pas déplacer.', 'Blank: leave it where it is.')}
          >
            <Input value={pos} onChange={setPos} inputMode="numeric" onEnter={submit} />
          </Field>
        </div>
        <Field
          label={tr('القيمة الأساسية', 'Valeur de base', 'Base value')}
          required
          error={badValue ? tr('رقم غير مقروء.', 'Nombre illisible.', 'That is not a number.') : null}
          hint={tr('الفاصلة والنقطة كلتاهما فاصلة عشرية.', 'La virgule et le point valent séparateur décimal.', 'Comma and dot both read as a decimal point.')}
        >
          <Input value={value} onChange={setValue} inputMode="decimal" mono onEnter={submit} />
        </Field>
        {/*
          One field for two inputs, because a range is one idea and the fault it can carry —
          a low above its high — belongs to neither half of it. `Field` shows an error in place
          of its hint, so the two bounds share the line that explains what they are for.
        */}
        <Field
          label={tr('المجال المعلن', 'Plage déclarée', 'Declared range')}
          error={badRange ? tr('الحد الأدنى فوق الأعلى.', 'La borne basse dépasse la haute.', 'The low bound is above the high one.') : null}
          hint={tr(
            'اختياري. المجالات هي ما يقيس به المحرّك الحساسية.',
            'Facultatif. Ce sont les plages qui rendent la sensibilité mesurable.',
            'Optional. Ranges are what make sensitivity measurable.',
          )}
        >
          <div style={PAIR}>
            <Input value={low} onChange={setLow} inputMode="decimal" mono placeholder={tr('الأدنى', 'Basse', 'Low')} onEnter={submit} />
            <Input value={high} onChange={setHigh} inputMode="decimal" mono placeholder={tr('الأعلى', 'Haute', 'High')} onEnter={submit} />
          </div>
        </Field>
        <Field
          label={tr('ملاحظة', 'Note', 'Note')}
          hint={tr('من أين جاء هذا الرقم.', 'D’où vient ce chiffre.', 'Where this number came from.')}
        >
          <TextArea value={note} onChange={setNote} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
/* ------------------------------------------------------------------ *
 * A row
 * ------------------------------------------------------------------ */

/** The two shapes a row can have, in the order the picker offers them. */
const KIND_LABEL: Readonly<Record<RowBody['kind'], Localized>> = {
  COMPUTED: { ar: 'محسوب من صيغة', fr: 'Calculée par formule', en: 'Computed from a formula' },
  GIVEN: { ar: 'أرقام مُدخلة', fr: 'Chiffres saisis', en: 'Numbers typed in' },
};

export interface RowDialogProps {
  readonly open: boolean;
  readonly subject: DocRow | null;
  /** Every row key already in the model, for the create-time collision test. */
  readonly taken: ReadonlySet<string>;
  /** The axis, so a typed series can say how much of it it covers. */
  readonly periods: readonly string[];
  /** Every key a formula may legally read — the model's rows and its assumptions. */
  readonly known: ReadonlySet<string>;
  readonly count: number;
  readonly onSave: (input: RowEdit) => Promise<boolean>;
  readonly onClose: () => void;
}

export function RowDialog(props: RowDialogProps) {
  if (!props.open) return null;
  return <RowForm key={props.subject?.key ?? '@new'} {...props} />;
}

function RowForm({ subject, taken, periods, known, count, onSave, onClose }: RowDialogProps) {
  const { t, tr } = useLocale();
  const { busy, go } = useSubmit(onClose);
  const creating = subject === null;

  const [key, setKey] = useState(subject?.key ?? '');
  const [label, setLabel] = useState(subject?.label ?? '');
  const [labelAr, setLabelAr] = useState(subject?.labelAr ?? '');
  const [unit, setUnit] = useState<AssumptionUnit>(subject?.unit ?? 'CURRENCY');
  // A row that arrives with no formula is one whose numbers were typed; a new row starts as a
  // formula because that is what a model is mostly made of.
  const [kind, setKind] = useState<RowBody['kind']>(subject !== null && subject.formula === null ? 'GIVEN' : 'COMPUTED');
  const [formula, setFormula] = useState(subject?.formula ?? '');
  const [typed, setTyped] = useState(subject === null ? '' : subject.given.join(' '));
  const [note, setNote] = useState(subject?.note ?? '');
  const [pos, setPos] = useState(creating ? String(count) : '');

  // The key the save will be filed under. Computed once, here, because three separate things
  // below need it: the collision test, the self-reference test and the payload.
  const target = subject === null ? key.trim() : subject.key;

  const parsed = useMemo(() => (kind === 'COMPUTED' ? parseFormula(formula) : null), [kind, formula]);
  const refs = useMemo(() => (parsed !== null && parsed.ok ? referencesOf(parsed.ast) : null), [parsed]);
  const series = useMemo(() => (kind === 'GIVEN' ? parseSeries(typed) : null), [kind, typed]);

  /**
   * A same-period read of this row's own key is a cycle, and the only one the dialog can see.
   *
   * `prior(self)` is not — it reads the period before, which is how a balance is written — so
   * only `refs.direct` is tested. Cycles through *other* rows are a property of the graph, not
   * of this formula, and the engine reports them as `CYCLE` when the model compiles.
   */
  const selfCycle = refs !== null && target !== '' && refs.direct.includes(target);

  /** Keys the formula reads that the model does not declare. A notice, not a refusal. */
  const unknown = useMemo(
    () => (refs === null ? [] : [...refs.direct, ...refs.lagged].filter((read) => read !== target && !known.has(read))),
    [known, refs, target],
  );

  const fault = creating ? keyFault(key.trim(), taken) : null;
  const bodyReady = kind === 'COMPUTED' ? parsed !== null && parsed.ok && !selfCycle : series !== null && series.length > 0;
  const ready = fault === null && said(label) !== '' && bodyReady;

  const submit = (): void => {
    if (!ready) return;
    // The tagged union is built here rather than in `commands.ts` so that a row carrying both a
    // formula and a series is unspellable on this side of the syscall too.
    const body: RowBody | null =
      kind === 'COMPUTED'
        ? { kind: 'COMPUTED', formula: formula.trim() }
        : series === null
          ? null
          : { kind: 'GIVEN', given: series };
    if (body === null) return;
    go(() =>
      onSave({
        key: target,
        label: said(label),
        labelAr: said(labelAr),
        unit,
        body,
        note: said(note),
        sortOrder: position(pos),
      }),
    );
  };

  /** The parser's own words, plus where it stopped. Offsets are shown one-based, as people count. */
  const formulaError =
    parsed !== null && !parsed.ok
      ? `${t(PARSE_ERROR_LABEL[parsed.error.code])} — ${tr('عند الحرف', 'au caractère', 'at character')} ${String(parsed.error.at + 1)}`
      : selfCycle
        ? tr(
            'الصيغة تقرأ هذا السطر في الفترة نفسها.',
            'La formule lit cette ligne dans la même période.',
            'The formula reads this row in the same period.',
          )
        : null;

  const seriesError =
    kind === 'COMPUTED'
      ? null
      : series === null
        ? tr('رقم غير مقروء في السلسلة.', 'Un nombre illisible dans la série.', 'A number in the series is unreadable.')
        : series.length === 0
          ? tr('لا أرقام بعد.', 'Aucun chiffre pour l’instant.', 'No numbers yet.')
          : null;

  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      title={creating ? tr('سطر جديد', 'Nouvelle ligne', 'New row') : tr('تعديل السطر', 'Modifier la ligne', 'Edit row')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{ label: tr('حفظ', 'Enregistrer', 'Save'), onClick: submit, disabled: !ready, busy }}
    >
      <div style={STACK}>
        <div style={PAIR}>
          <Field
            label={tr('المفتاح', 'Clé', 'Key')}
            required
            error={!creating || key === '' || fault === null ? null : t(KEY_FAULT[fault])}
            hint={creating ? tr('كما تكتبه الصيغ.', 'Tel qu’une formule l’écrira.', 'As a formula will write it.') : undefined}
          >
            <Input value={key} onChange={setKey} mono disabled={!creating} placeholder="gross_margin" />
          </Field>
          <Field label={tr('الوحدة', 'Unité', 'Unit')} required>
            <Select value={unit} onChange={(next) => setUnit(toUnit(next))} options={unitOptions(t)} />
          </Field>
        </div>
        <Field label={tr('العنوان', 'Libellé', 'Label')} required>
          <Input value={label} onChange={setLabel} />
        </Field>
        <div style={PAIR}>
          <Field label={tr('العنوان بالعربية', 'Libellé en arabe', 'Arabic label')}>
            <Input value={labelAr} onChange={setLabelAr} />
          </Field>
          <Field
            label={tr('الترتيب', 'Position', 'Position')}
            hint={creating ? undefined : tr('فارغ: يبقى في موضعه.', 'Vide : ne pas déplacer.', 'Blank: leave it where it is.')}
          >
            <Input value={pos} onChange={setPos} inputMode="numeric" />
          </Field>
        </div>
        <Field label={tr('نوع السطر', 'Type de ligne', 'Row kind')} required>
          <Select
            value={kind}
            onChange={(next) => setKind(next === 'GIVEN' ? 'GIVEN' : 'COMPUTED')}
            options={Object.entries(KIND_LABEL).map(([value, words]) => ({ value, label: t(words) }))}
          />
        </Field>
        {kind === 'COMPUTED' ? (
          <Field
            label={tr('الصيغة', 'Formule', 'Formula')}
            required
            error={formulaError}
            hint={
              unknown.length > 0
                ? `${tr('مفاتيح لا يعلنها النموذج:', 'Clés non déclarées par le modèle :', 'Keys the model does not declare:')} ${unknown.join(', ')}`
                : [...RESERVED].join('  ')
            }
          >
            <TextArea value={formula} onChange={setFormula} rows={3} mono />
          </Field>
        ) : (
          <Field
            label={tr('الأرقام', 'Les chiffres', 'The numbers')}
            required
            error={seriesError}
            hint={`${String(series?.length ?? 0)} / ${String(periods.length)} · ${tr('السلسلة الأقصر تُثبَّت على آخر قيمة.', 'Une série plus courte tient sa dernière valeur.', 'A shorter series holds its last value.')}`}
          >
            <TextArea value={typed} onChange={setTyped} rows={3} mono placeholder="120000 132000 145200" />
          </Field>
        )}
        <Field label={tr('ملاحظة', 'Note', 'Note')}>
          <TextArea value={note} onChange={setNote} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
/* ------------------------------------------------------------------ *
 * A scenario
 * ------------------------------------------------------------------ */

/**
 * Every scenario that inherits from `root`, transitively, plus `root` itself.
 *
 * A fixed point rather than a recursive walk, and the reason is the case this is here to
 * prevent. `CHAIN_CYCLE` is a fault the engine can *report*, which means a model can be holding
 * one right now — and a recursive descent through data that already loops does not return. This
 * loop only ever adds to a set bounded by the scenario count, so it terminates on any input and
 * still answers correctly on the sane ones.
 */
function descendantsOf(root: string, scenarios: readonly DocScenario[]): ReadonlySet<string> {
  const out = new Set<string>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const scenario of scenarios) {
      if (scenario.baseId !== null && out.has(scenario.baseId) && !out.has(scenario.id)) {
        out.add(scenario.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface ScenarioDialogProps {
  readonly open: boolean;
  readonly subject: DocScenario | null;
  /** The whole set: the collision test and the parent list are both read off it. */
  readonly scenarios: readonly DocScenario[];
  readonly count: number;
  readonly onSave: (input: ScenarioEdit) => Promise<boolean>;
  readonly onClose: () => void;
}

export function ScenarioDialog(props: ScenarioDialogProps) {
  if (!props.open) return null;
  return <ScenarioForm key={props.subject?.id ?? '@new'} {...props} />;
}

function ScenarioForm({ subject, scenarios, count, onSave, onClose }: ScenarioDialogProps) {
  const { t, tr } = useLocale();
  const { busy, go } = useSubmit(onClose);
  const creating = subject === null;

  const [key, setKey] = useState(subject?.id ?? '');
  const [name, setName] = useState(subject?.name ?? '');
  const [nameAr, setNameAr] = useState(subject?.nameAr ?? '');
  // The empty string is the select's way of saying "nothing", and it becomes an explicit null
  // in the payload. `ScenarioEdit.baseKey` is nullable rather than optional for that reason:
  // a scenario that used to inherit and now does not has to be able to say so.
  const [base, setBase] = useState(subject?.baseId ?? '');
  const [note, setNote] = useState(subject?.note ?? '');
  const [pos, setPos] = useState(creating ? String(count) : '');

  const taken = useMemo(() => new Set(scenarios.map((scenario) => scenario.id)), [scenarios]);
  const blocked = useMemo(
    () => (subject === null ? new Set<string>() : descendantsOf(subject.id, scenarios)),
    [scenarios, subject],
  );

  /**
   * The parents this scenario may legally have.
   *
   * Anything that inherits from this scenario is left out, which is what makes `CHAIN_CYCLE`
   * unreachable from the dialog: the fault stays in the engine's vocabulary for models built
   * before this screen existed, and stops being something a person can do by hand.
   */
  const bases = useMemo<readonly SelectOption[]>(
    () => [
      { value: '', label: t({ ar: 'لا يرث شيئًا', fr: 'N’hérite de rien', en: 'Inherits from nothing' }) },
      ...scenarios.filter((scenario) => !blocked.has(scenario.id)).map((scenario) => ({ value: scenario.id, label: scenario.name })),
    ],
    [blocked, scenarios, t],
  );

  const fault = creating ? keyFault(key.trim(), taken) : null;
  const ready = fault === null && said(name) !== '';

  const submit = (): void => {
    if (!ready) return;
    const target = subject === null ? key.trim() : subject.id;
    go(() =>
      onSave({
        key: target,
        name: said(name),
        nameAr: said(nameAr),
        baseKey: base === '' ? null : base,
        note: said(note),
        sortOrder: position(pos),
      }),
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={creating ? tr('سيناريو جديد', 'Nouveau scénario', 'New scenario') : tr('تعديل السيناريو', 'Modifier le scénario', 'Edit scenario')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{ label: tr('حفظ', 'Enregistrer', 'Save'), onClick: submit, disabled: !ready, busy }}
    >
      <div style={STACK}>
        <div style={PAIR}>
          <Field
            label={tr('المفتاح', 'Clé', 'Key')}
            required
            error={!creating || key === '' || fault === null ? null : t(KEY_FAULT[fault])}
          >
            <Input value={key} onChange={setKey} mono disabled={!creating} placeholder="downside" onEnter={submit} />
          </Field>
          <Field
            label={tr('الترتيب', 'Position', 'Position')}
            hint={creating ? undefined : tr('فارغ: يبقى في موضعه.', 'Vide : ne pas déplacer.', 'Blank: leave it where it is.')}
          >
            <Input value={pos} onChange={setPos} inputMode="numeric" onEnter={submit} />
          </Field>
        </div>
        <Field label={tr('الاسم', 'Nom', 'Name')} required>
          <Input value={name} onChange={setName} onEnter={submit} />
        </Field>
        <Field label={tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name')}>
          <Input value={nameAr} onChange={setNameAr} onEnter={submit} />
        </Field>
        <Field
          label={tr('يرث من', 'Hérite de', 'Inherits from')}
          hint={tr(
            'ما لا يعدّله هذا السيناريو يأتي من الأب.',
            'Ce que ce scénario ne change pas vient du parent.',
            'Whatever this scenario does not change comes from its parent.',
          )}
        >
          <Select value={base} onChange={setBase} options={bases} />
        </Field>
        <Field label={tr('ملاحظة', 'Note', 'Note')}>
          <TextArea value={note} onChange={setNote} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

